import { BaseAgent } from "./base.js";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";
import { buildWriterSystemPrompt } from "./writer-prompts.js";
import { buildSettlerSystemPrompt, buildSettlerUserPrompt } from "./settler-prompts.js";
import { parseSettlementOutput } from "./settler-parser.js";
import { validatePostWrite, type PostWriteViolation } from "./post-write-validator.js";
import { analyzeAITells } from "./ai-tells.js";
import { parseCreativeOutput } from "./writer-parser.js";
import { buildWriterContext } from "./writer-context.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

/** Presupuesto de tokens por defecto para el prompt del Writer (deja ~28k para output) */
const DEFAULT_CONTEXT_BUDGET = 100_000;

export interface WriteChapterInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly externalContext?: string;
  readonly wordCountOverride?: number;
  readonly temperatureOverride?: number;
}

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface WriteChapterOutput {
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly wordCount: number;
  readonly preWriteCheck: string;
  readonly postSettlement: string;
  readonly updatedState: string;
  readonly updatedLedger: string;
  readonly updatedHooks: string;
  readonly chapterSummary: string;
  readonly updatedSubplots: string;
  readonly updatedEmotionalArcs: string;
  readonly updatedCharacterMatrix: string;
  readonly postWriteErrors: ReadonlyArray<PostWriteViolation>;
  readonly postWriteWarnings: ReadonlyArray<PostWriteViolation>;
  readonly tokenUsage?: TokenUsage;
}

export class WriterAgent extends BaseAgent {
  get name(): string {
    return "writer";
  }

  async writeChapter(input: WriteChapterInput): Promise<WriteChapterOutput> {
    const { book, bookDir, chapterNumber } = input;

    // ── Ensamblar contexto (lectura de archivos + presupuesto) ──
    const writerCtx = await buildWriterContext(
      this.ctx.projectRoot, book, bookDir, chapterNumber,
      {
        externalContext: input.externalContext,
        contextBudget: DEFAULT_CONTEXT_BUDGET,
        logger: this.ctx.logger,
      },
    );

    const { derived, budget } = writerCtx;
    const { genreProfile, genreBody, bookRules, bookRulesBody, styleFingerprint } = derived;
    const b = budget.blocks;

    // ── Phase 1: Creative writing (temperature 0.7) ──
    const creativeSystemPrompt = buildWriterSystemPrompt(
      book, genreProfile, bookRules, bookRulesBody, genreBody, writerCtx.raw.styleGuide, styleFingerprint,
      chapterNumber, "creative", book.language,
    );

    const creativeUserPrompt = this.buildUserPrompt({
      chapterNumber,
      storyBible: b["story_bible"] ?? "",
      volumeOutline: b["volume_outline"] ?? "",
      currentState: b["current_state"] ?? "",
      ledger: b["ledger"] ?? "",
      hooks: b["pending_hooks"] ?? "",
      recentChapters: b["recent_chapters"] ?? "",
      wordCount: input.wordCountOverride ?? book.chapterWordCount,
      externalContext: b["external_context"],
      chapterSummaries: b["chapter_summaries"] ?? "",
      subplotBoard: b["subplot_board"] ?? "",
      emotionalArcs: b["emotional_arcs"] ?? "",
      characterMatrix: b["character_matrix"] ?? "",
      dialogueFingerprints: b["dialogue_fingerprints"] ?? "",
      relevantSummaries: b["relevant_summaries"] ?? "",
      parentCanon: b["parent_canon"] || undefined,
    });

    const creativeTemperature = input.temperatureOverride ?? 0.7;

    this.ctx.logger?.info(`Phase 1: creative writing for chapter ${chapterNumber}`);

    // Scale maxTokens to chapter word count (Chinese ≈ 1.5 tokens/char)
    const targetWords = input.wordCountOverride ?? book.chapterWordCount;
    const creativeMaxTokens = Math.max(8192, Math.ceil(targetWords * 2));

    const creativeResponse = await this.chat(
      [
        { role: "system", content: creativeSystemPrompt },
        { role: "user", content: creativeUserPrompt },
      ],
      { maxTokens: creativeMaxTokens, temperature: creativeTemperature },
    );
    const creativeUsage = creativeResponse.usage;

    const creative = parseCreativeOutput(chapterNumber, creativeResponse.content);

    // ── Phase 2: State settlement (temperature 0.3) ──
    this.ctx.logger?.info(`Phase 2: state settlement for chapter ${chapterNumber} (${creative.wordCount} chars)`);

    const settleResult = await this.settle({
      book,
      genreProfile,
      bookRules,
      chapterNumber,
      title: creative.title,
      content: creative.content,
      currentState: writerCtx.raw.currentState,
      ledger: genreProfile.numericalSystem ? writerCtx.raw.ledger : "",
      hooks: writerCtx.raw.hooks,
      chapterSummaries: writerCtx.raw.chapterSummaries,
      subplotBoard: writerCtx.raw.subplotBoard,
      emotionalArcs: writerCtx.raw.emotionalArcs,
      characterMatrix: writerCtx.raw.characterMatrix,
      volumeOutline: writerCtx.raw.volumeOutline,
    });
    const settlement = settleResult.settlement;
    const settleUsage = settleResult.usage;

    // ── Post-write validation (regex + rule-based, zero LLM cost) ──
    const ruleViolations = validatePostWrite(creative.content, genreProfile, bookRules);
    const aiTellIssues = analyzeAITells(creative.content).issues;

    const postWriteErrors = ruleViolations.filter(v => v.severity === "error");
    const postWriteWarnings = ruleViolations.filter(v => v.severity === "warning");

    if (ruleViolations.length > 0) {
      this.ctx.logger?.warn(
        `Post-write: ${postWriteErrors.length} errors, ${postWriteWarnings.length} warnings in chapter ${chapterNumber}`,
      );
      for (const v of ruleViolations) {
        this.ctx.logger?.warn(`[${v.severity}] ${v.rule}: ${v.description}`);
      }
    }
    if (aiTellIssues.length > 0) {
      this.ctx.logger?.warn(
        `AI-tell check: ${aiTellIssues.length} issues in chapter ${chapterNumber}`,
      );
      for (const issue of aiTellIssues) {
        this.ctx.logger?.warn(`[${issue.severity}] ${issue.category}: ${issue.description}`);
      }
    }

    // ── Merge into WriteChapterOutput ──
    const tokenUsage: TokenUsage = {
      promptTokens: creativeUsage.promptTokens + settleUsage.promptTokens,
      completionTokens: creativeUsage.completionTokens + settleUsage.completionTokens,
      totalTokens: creativeUsage.totalTokens + settleUsage.totalTokens,
    };

    return {
      chapterNumber,
      title: creative.title,
      content: creative.content,
      wordCount: creative.wordCount,
      preWriteCheck: creative.preWriteCheck,
      postSettlement: settlement.postSettlement,
      updatedState: settlement.updatedState,
      updatedLedger: settlement.updatedLedger,
      updatedHooks: settlement.updatedHooks,
      chapterSummary: settlement.chapterSummary,
      updatedSubplots: settlement.updatedSubplots,
      updatedEmotionalArcs: settlement.updatedEmotionalArcs,
      updatedCharacterMatrix: settlement.updatedCharacterMatrix,
      postWriteErrors,
      postWriteWarnings,
      tokenUsage,
    };
  }

  private async settle(params: {
    readonly book: BookConfig;
    readonly genreProfile: GenreProfile;
    readonly bookRules: BookRules | null;
    readonly chapterNumber: number;
    readonly title: string;
    readonly content: string;
    readonly currentState: string;
    readonly ledger: string;
    readonly hooks: string;
    readonly chapterSummaries: string;
    readonly subplotBoard: string;
    readonly emotionalArcs: string;
    readonly characterMatrix: string;
    readonly volumeOutline: string;
  }): Promise<{ settlement: ReturnType<typeof parseSettlementOutput>; usage: TokenUsage }> {
    const settlerSystem = buildSettlerSystemPrompt(
      params.book, params.genreProfile, params.bookRules,
    );

    const settlerUser = buildSettlerUserPrompt({
      chapterNumber: params.chapterNumber,
      title: params.title,
      content: params.content,
      currentState: params.currentState,
      ledger: params.ledger,
      hooks: params.hooks,
      chapterSummaries: params.chapterSummaries,
      subplotBoard: params.subplotBoard,
      emotionalArcs: params.emotionalArcs,
      characterMatrix: params.characterMatrix,
      volumeOutline: params.volumeOutline,
    });

    // Settler outputs all truth files — scale with content size
    const settlerMaxTokens = Math.max(8192, Math.ceil(params.content.length * 0.8));

    const response = await this.chat(
      [
        { role: "system", content: settlerSystem },
        { role: "user", content: settlerUser },
      ],
      { maxTokens: settlerMaxTokens, temperature: 0.3 },
    );

    return {
      settlement: parseSettlementOutput(response.content, params.genreProfile),
      usage: response.usage,
    };
  }

  async saveChapter(
    bookDir: string,
    output: WriteChapterOutput,
    numericalSystem: boolean = true,
  ): Promise<void> {
    const chaptersDir = join(bookDir, "chapters");
    const storyDir = join(bookDir, "story");
    await mkdir(chaptersDir, { recursive: true });

    const paddedNum = String(output.chapterNumber).padStart(4, "0");
    const filename = `${paddedNum}_${this.sanitizeFilename(output.title)}.md`;

    const chapterContent = [
      `# 第${output.chapterNumber}章 ${output.title}`,
      "",
      output.content,
    ].join("\n");

    const writes: Array<Promise<void>> = [
      writeFile(join(chaptersDir, filename), chapterContent, "utf-8"),
      writeFile(join(storyDir, "current_state.md"), output.updatedState, "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), output.updatedHooks, "utf-8"),
    ];

    if (numericalSystem) {
      writes.push(
        writeFile(join(storyDir, "particle_ledger.md"), output.updatedLedger, "utf-8"),
      );
    }

    await Promise.all(writes);
  }

  private buildUserPrompt(params: {
    readonly chapterNumber: number;
    readonly storyBible: string;
    readonly volumeOutline: string;
    readonly currentState: string;
    readonly ledger: string;
    readonly hooks: string;
    readonly recentChapters: string;
    readonly wordCount: number;
    readonly externalContext?: string;
    readonly chapterSummaries: string;
    readonly subplotBoard: string;
    readonly emotionalArcs: string;
    readonly characterMatrix: string;
    readonly dialogueFingerprints?: string;
    readonly relevantSummaries?: string;
    readonly parentCanon?: string;
  }): string {
    const contextBlock = params.externalContext
      ? `\n## 外部指令\n以下是来自外部系统的创作指令，请在本章中融入：\n\n${params.externalContext}\n`
      : "";

    const ledgerBlock = params.ledger
      ? `\n## 资源账本\n${params.ledger}\n`
      : "";

    const summariesBlock = params.chapterSummaries !== "(文件尚未创建)"
      ? `\n## 章节摘要（全部历史章节压缩上下文）\n${params.chapterSummaries}\n`
      : "";

    const subplotBlock = params.subplotBoard !== "(文件尚未创建)"
      ? `\n## 支线进度板\n${params.subplotBoard}\n`
      : "";

    const emotionalBlock = params.emotionalArcs !== "(文件尚未创建)"
      ? `\n## 情感弧线\n${params.emotionalArcs}\n`
      : "";

    const matrixBlock = params.characterMatrix !== "(文件尚未创建)"
      ? `\n## 角色交互矩阵\n${params.characterMatrix}\n`
      : "";

    const fingerprintBlock = params.dialogueFingerprints
      ? `\n## 角色对话指纹\n${params.dialogueFingerprints}\n`
      : "";

    const relevantBlock = params.relevantSummaries
      ? `\n## 相关历史章节摘要\n${params.relevantSummaries}\n`
      : "";

    const canonBlock = params.parentCanon
      ? `\n## 正传正典参照（番外写作专用）
本书是番外作品。以下正典约束不可违反，角色不得引用超出其信息边界的信息。
${params.parentCanon}\n`
      : "";

    return `请续写第${params.chapterNumber}章。
${contextBlock}
## 当前状态卡
${params.currentState}
${ledgerBlock}
## 伏笔池
${params.hooks}
${summariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}${fingerprintBlock}${relevantBlock}${canonBlock}
## 最近章节
${params.recentChapters || "(这是第一章，无前文)"}

## 世界观设定
${params.storyBible}

## 卷纲（硬约束——必须遵守）
${params.volumeOutline}

【卷纲遵守规则】
- 本章内容必须对应卷纲中当前章节范围内的剧情节点，严禁跳过或提前消耗后续节点
- 如果卷纲指定了某个事件/转折发生在第N章，不得提前到本章完成
- 剧情推进速度必须与卷纲规划的章节跨度匹配：如果卷纲规划某段剧情跨5章，不得在1-2章内讲完
- PRE_WRITE_CHECK中必须明确标注本章对应的卷纲节点

要求：
- 正文不少于${params.wordCount}字
- 先输出写作自检表，再写正文
- 只需输出 PRE_WRITE_CHECK、CHAPTER_TITLE、CHAPTER_CONTENT 三个区块`;
  }



  /** Save new truth files (summaries, subplots, emotional arcs, character matrix). */
  async saveNewTruthFiles(bookDir: string, output: WriteChapterOutput): Promise<void> {
    const storyDir = join(bookDir, "story");
    const writes: Array<Promise<void>> = [];

    // Append chapter summary to chapter_summaries.md
    if (output.chapterSummary) {
      writes.push(this.appendChapterSummary(storyDir, output.chapterSummary));
    }

    // Overwrite subplot board
    if (output.updatedSubplots) {
      writes.push(writeFile(join(storyDir, "subplot_board.md"), output.updatedSubplots, "utf-8"));
    }

    // Overwrite emotional arcs
    if (output.updatedEmotionalArcs) {
      writes.push(writeFile(join(storyDir, "emotional_arcs.md"), output.updatedEmotionalArcs, "utf-8"));
    }

    // Overwrite character matrix
    if (output.updatedCharacterMatrix) {
      writes.push(writeFile(join(storyDir, "character_matrix.md"), output.updatedCharacterMatrix, "utf-8"));
    }

    await Promise.all(writes);
  }

  private async appendChapterSummary(storyDir: string, summary: string): Promise<void> {
    const summaryPath = join(storyDir, "chapter_summaries.md");
    let existing = "";
    try {
      existing = await readFile(summaryPath, "utf-8");
    } catch {
      // File doesn't exist yet — start with header
      existing = "# 章节摘要\n\n| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |\n|------|------|----------|----------|----------|----------|----------|----------|\n";
    }

    // Extract only the data row(s) from the summary (skip header lines)
    const dataRows = summary
      .split("\n")
      .filter((line) => line.startsWith("|") && !line.startsWith("| 章节") && !line.startsWith("|--"))
      .join("\n");

    if (dataRows) {
      await writeFile(summaryPath, `${existing.trimEnd()}\n${dataRows}\n`, "utf-8");
    }
  }



  private sanitizeFilename(title: string): string {
    return title
      .replace(/[/\\?%*:|"<>]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 50);
  }
}
