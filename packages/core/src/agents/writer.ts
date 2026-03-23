import { BaseAgent } from "./base.js";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";
import { buildWriterSystemPrompt, type FanficContext } from "./writer-prompts.js";
import { buildSettlerSystemPrompt, buildSettlerUserPrompt } from "./settler-prompts.js";
import { buildObserverSystemPrompt, buildObserverUserPrompt } from "./observer-prompts.js";
import { parseSettlementOutput } from "./settler-parser.js";
import { readGenreProfile, readBookRules } from "./rules-reader.js";
import { validatePostWrite, type PostWriteViolation } from "./post-write-validator.js";
import { analyzeAITells } from "./ai-tells.js";
import { filterHooks, filterSummaries, filterSubplots, filterEmotionalArcs, filterCharacterMatrix } from "../utils/context-filter.js";
import { extractPOVFromOutline, filterMatrixByPOV, filterHooksByPOV } from "../utils/pov-filter.js";
import { parseCreativeOutput } from "./writer-parser.js";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

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

    const [
      storyBible, volumeOutline, styleGuide, currentState, ledger, hooks,
      chapterSummaries, subplotBoard, emotionalArcs, characterMatrix, styleProfileRaw,
      parentCanon, fanficCanonRaw,
    ] = await Promise.all([
        this.readFileOrDefault(join(bookDir, "story/story_bible.md")),
        this.readFileOrDefault(join(bookDir, "story/volume_outline.md")),
        this.readFileOrDefault(join(bookDir, "story/style_guide.md")),
        this.readFileOrDefault(join(bookDir, "story/current_state.md")),
        this.readFileOrDefault(join(bookDir, "story/particle_ledger.md")),
        this.readFileOrDefault(join(bookDir, "story/pending_hooks.md")),
        this.readFileOrDefault(join(bookDir, "story/chapter_summaries.md")),
        this.readFileOrDefault(join(bookDir, "story/subplot_board.md")),
        this.readFileOrDefault(join(bookDir, "story/emotional_arcs.md")),
        this.readFileOrDefault(join(bookDir, "story/character_matrix.md")),
        this.readFileOrDefault(join(bookDir, "story/style_profile.json")),
        this.readFileOrDefault(join(bookDir, "story/parent_canon.md")),
        this.readFileOrDefault(join(bookDir, "story/fanfic_canon.md")),
      ]);

    const recentChapters = await this.loadRecentChapters(bookDir, chapterNumber);
    // Load more chapters for dialogue fingerprint extraction (voice consistency over longer span)
    const fingerprintChapters = await this.loadRecentChapters(bookDir, chapterNumber, 5);

    // Load genre profile + book rules
    const { profile: genreProfile, body: genreBody } =
      await readGenreProfile(this.ctx.projectRoot, book.genre);
    const parsedBookRules = await readBookRules(bookDir);
    const bookRules = parsedBookRules?.rules ?? null;
    const bookRulesBody = parsedBookRules?.body ?? "";

    const styleFingerprint = this.buildStyleFingerprint(styleProfileRaw);

    const dialogueFingerprints = this.extractDialogueFingerprints(fingerprintChapters, storyBible);
    const relevantSummaries = this.findRelevantSummaries(chapterSummaries, volumeOutline, chapterNumber);

    const hasParentCanon = parentCanon !== "(文件尚未创建)";
    const hasFanficCanon = fanficCanonRaw !== "(文件尚未创建)";

    // Build fanfic context if fanfic_canon.md exists
    const fanficContext: FanficContext | undefined = hasFanficCanon && bookRules?.fanficMode
      ? {
          fanficCanon: fanficCanonRaw,
          fanficMode: bookRules.fanficMode,
          allowedDeviations: bookRules.allowedDeviations ?? [],
        }
      : undefined;

    // ── Phase 1: Creative writing (temperature override > agent default) ──
    const resolvedLanguage = book.language ?? genreProfile.language;
    const creativeSystemPrompt = buildWriterSystemPrompt(
      book, genreProfile, bookRules, bookRulesBody, genreBody, styleGuide, styleFingerprint,
      chapterNumber, "creative", fanficContext, resolvedLanguage,
    );

    // Smart context filtering: inject only relevant parts of truth files
    const filteredHooks = filterHooks(hooks);
    const filteredSummaries = filterSummaries(chapterSummaries, chapterNumber);
    const filteredSubplots = filterSubplots(subplotBoard);
    const filteredArcs = filterEmotionalArcs(emotionalArcs, chapterNumber);
    const filteredMatrix = filterCharacterMatrix(characterMatrix, volumeOutline, bookRules?.protagonist?.name);

    // POV-aware filtering: limit context to what the POV character knows
    const povCharacter = extractPOVFromOutline(volumeOutline, chapterNumber);
    const povFilteredMatrix = povCharacter
      ? filterMatrixByPOV(filteredMatrix, povCharacter)
      : filteredMatrix;
    const povFilteredHooks = povCharacter
      ? filterHooksByPOV(filteredHooks, povCharacter, chapterSummaries)
      : filteredHooks;

    const creativeUserPrompt = this.buildUserPrompt({
      chapterNumber,
      storyBible,
      volumeOutline,
      currentState,
      ledger: genreProfile.numericalSystem ? ledger : "",
      hooks: povFilteredHooks,
      recentChapters,
      wordCount: input.wordCountOverride ?? book.chapterWordCount,
      externalContext: input.externalContext,
      chapterSummaries: filteredSummaries,
      subplotBoard: filteredSubplots,
      emotionalArcs: filteredArcs,
      characterMatrix: povFilteredMatrix,
      dialogueFingerprints,
      relevantSummaries,
      parentCanon: hasParentCanon ? parentCanon : undefined,
      language: book.language ?? genreProfile.language,
    });

    const creativeTemperature = input.temperatureOverride ?? this.ctx.client.defaults.temperature;

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
      currentState,
      ledger: genreProfile.numericalSystem ? ledger : "",
      hooks,
      chapterSummaries,
      subplotBoard,
      emotionalArcs,
      characterMatrix,
      volumeOutline,
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
    // Phase 2a: Observer — extract all facts from the chapter
    const resolvedLang = params.book.language ?? params.genreProfile.language;
    const observerSystem = buildObserverSystemPrompt(params.book, params.genreProfile, resolvedLang);
    const observerUser = buildObserverUserPrompt(params.chapterNumber, params.title, params.content, resolvedLang);

    this.ctx.logger?.info(`Phase 2a: observing facts for chapter ${params.chapterNumber}`);
    const observerResponse = await this.chat(
      [
        { role: "system", content: observerSystem },
        { role: "user", content: observerUser },
      ],
      { maxTokens: 4096, temperature: 0.5 },
    );
    const observations = observerResponse.content;

    // Phase 2b: Reflector — merge observations into truth files
    this.ctx.logger?.info(`Phase 2b: reflecting observations into truth files`);
    const settlerSystem = buildSettlerSystemPrompt(
      params.book, params.genreProfile, params.bookRules, resolvedLang,
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
      observations,
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
    language: "zh" | "en" = "zh",
  ): Promise<void> {
    const chaptersDir = join(bookDir, "chapters");
    const storyDir = join(bookDir, "story");
    await mkdir(chaptersDir, { recursive: true });

    const paddedNum = String(output.chapterNumber).padStart(4, "0");
    const filename = `${paddedNum}_${this.sanitizeFilename(output.title)}.md`;

    const heading = language === "en"
      ? `# Chapter ${output.chapterNumber}: ${output.title}`
      : `# 第${output.chapterNumber}章 ${output.title}`;
    const chapterContent = [
      heading,
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
    readonly language?: "zh" | "en";
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

    if (params.language === "en") {
      return `Write chapter ${params.chapterNumber}.
${contextBlock}
## Current State
${params.currentState}
${ledgerBlock}
## Plot Threads
${params.hooks}
${summariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}${fingerprintBlock}${relevantBlock}${canonBlock}
## Recent Chapters
${params.recentChapters || "(This is the first chapter, no previous text)"}

## Worldbuilding
${params.storyBible}

## Volume Outline (Hard Constraint — Must Follow)
${params.volumeOutline}

[Outline Rules]
- This chapter must advance the plot points assigned to it in the volume outline. Do not skip ahead or consume future plot points.
- If the outline specifies an event for chapter N, do not resolve it early.
- Pacing must match the outline's chapter span: if 5 chapters are planned for an arc, do not compress into 1-2.
- PRE_WRITE_CHECK must identify which outline node this chapter covers.

Requirements:
- Chapter body must be at least ${params.wordCount} words
- Output PRE_WRITE_CHECK first, then the chapter
- Output only PRE_WRITE_CHECK, CHAPTER_TITLE, and CHAPTER_CONTENT blocks`;
    }

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

  private async loadRecentChapters(
    bookDir: string,
    currentChapter: number,
    count = 1,
  ): Promise<string> {
    const chaptersDir = join(bookDir, "chapters");
    try {
      const files = await readdir(chaptersDir);
      const mdFiles = files
        .filter((f) => f.endsWith(".md") && !f.startsWith("index"))
        .sort()
        .slice(-count);

      if (mdFiles.length === 0) return "";

      const contents = await Promise.all(
        mdFiles.map(async (f) => {
          const content = await readFile(join(chaptersDir, f), "utf-8");
          return content;
        }),
      );

      return contents.join("\n\n---\n\n");
    } catch {
      return "";
    }
  }

  private async readFileOrDefault(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return "(文件尚未创建)";
    }
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

  private buildStyleFingerprint(styleProfileRaw: string): string | undefined {
    if (!styleProfileRaw || styleProfileRaw === "(文件尚未创建)") return undefined;
    try {
      const profile = JSON.parse(styleProfileRaw);
      const lines: string[] = [];
      if (profile.avgSentenceLength) lines.push(`- 平均句长：${profile.avgSentenceLength}字`);
      if (profile.sentenceLengthStdDev) lines.push(`- 句长标准差：${profile.sentenceLengthStdDev}`);
      if (profile.avgParagraphLength) lines.push(`- 平均段落长度：${profile.avgParagraphLength}字`);
      if (profile.paragraphLengthRange) lines.push(`- 段落长度范围：${profile.paragraphLengthRange.min}-${profile.paragraphLengthRange.max}字`);
      if (profile.vocabularyDiversity) lines.push(`- 词汇多样性(TTR)：${profile.vocabularyDiversity}`);
      if (profile.topPatterns?.length > 0) lines.push(`- 高频句式：${profile.topPatterns.join("、")}`);
      if (profile.rhetoricalFeatures?.length > 0) lines.push(`- 修辞特征：${profile.rhetoricalFeatures.join("、")}`);
      return lines.length > 0 ? lines.join("\n") : undefined;
    } catch {
      return undefined;
    }
  }


  /**
   * Extract dialogue fingerprints from recent chapters.
   * For each character with multiple dialogue lines, compute speaking style markers.
   */
  private extractDialogueFingerprints(recentChapters: string, _storyBible: string): string {
    if (!recentChapters) return "";

    // Match dialogue patterns:
    // Chinese: "speaker说道：" or dialogue in ""「」
    // English: "dialogue," speaker said. or "dialogue."
    const dialogueRegex = /(?:(.{1,6})(?:说道|道|喝道|冷声道|笑道|怒道|低声道|大声道|喝骂道|冷笑道|沉声道|喊道|叫道|问道|答道)\s*[：:]\s*["""「]([^"""」]+)["""」])|["""「]([^"""」]{2,})["""」]|"([^"]{2,})"/g;

    const characterDialogues = new Map<string, string[]>();
    let match: RegExpExecArray | null;

    while ((match = dialogueRegex.exec(recentChapters)) !== null) {
      const speaker = match[1]?.trim();
      const line = match[2] ?? match[3] ?? "";
      if (speaker && line.length > 1) {
        const existing = characterDialogues.get(speaker) ?? [];
        characterDialogues.set(speaker, [...existing, line]);
      }
    }

    // Only include characters with >=2 dialogue lines
    const fingerprints: string[] = [];
    for (const [character, lines] of characterDialogues) {
      if (lines.length < 2) continue;

      const avgLen = Math.round(lines.reduce((sum, l) => sum + l.length, 0) / lines.length);
      const isShort = avgLen < 15;

      // Find frequent words/phrases (2+ occurrences)
      const wordCounts = new Map<string, number>();
      for (const line of lines) {
        // Extract 2-3 char segments as "words"
        for (let i = 0; i < line.length - 1; i++) {
          const bigram = line.slice(i, i + 2);
          wordCounts.set(bigram, (wordCounts.get(bigram) ?? 0) + 1);
        }
      }
      const frequentWords = [...wordCounts.entries()]
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([w]) => `「${w}」`);

      // Detect style markers
      const markers: string[] = [];
      if (isShort) markers.push("短句为主");
      else markers.push("长句为主");

      const questionCount = lines.filter((l) => l.includes("？") || l.includes("?")).length;
      if (questionCount > lines.length * 0.3) markers.push("反问多");

      if (frequentWords.length > 0) markers.push(`常用${frequentWords.join("")}`);

      fingerprints.push(`${character}：${markers.join("，")}`);
    }

    return fingerprints.length > 0 ? fingerprints.join("；") : "";
  }

  /**
   * Find relevant chapter summaries based on volume outline context.
   * Extracts character names and hook IDs from the current volume's outline,
   * then searches chapter summaries for matching entries.
   */
  private findRelevantSummaries(
    chapterSummaries: string,
    volumeOutline: string,
    chapterNumber: number,
  ): string {
    if (!chapterSummaries || chapterSummaries === "(文件尚未创建)") return "";
    if (!volumeOutline || volumeOutline === "(文件尚未创建)") return "";

    // Extract character names from volume outline (Chinese name patterns)
    const nameRegex = /[\u4e00-\u9fff]{2,4}(?=[，、。：]|$)/g;
    const outlineNames = new Set<string>();
    let nameMatch: RegExpExecArray | null;
    while ((nameMatch = nameRegex.exec(volumeOutline)) !== null) {
      outlineNames.add(nameMatch[0]);
    }

    // Extract hook IDs from volume outline
    const hookRegex = /H\d{2,}/g;
    const hookIds = new Set<string>();
    let hookMatch: RegExpExecArray | null;
    while ((hookMatch = hookRegex.exec(volumeOutline)) !== null) {
      hookIds.add(hookMatch[0]);
    }

    if (outlineNames.size === 0 && hookIds.size === 0) return "";

    // Search chapter summaries for matching rows
    const rows = chapterSummaries.split("\n").filter((line) =>
      line.startsWith("|") && !line.startsWith("| 章节") && !line.startsWith("|--") && !line.startsWith("| -"),
    );

    const matchedRows = rows.filter((row) => {
      for (const name of outlineNames) {
        if (row.includes(name)) return true;
      }
      for (const hookId of hookIds) {
        if (row.includes(hookId)) return true;
      }
      return false;
    });

    // Skip only the last chapter (its full text is already in context via loadRecentChapters)
    const filteredRows = matchedRows.filter((row) => {
      const chNumMatch = row.match(/\|\s*(\d+)\s*\|/);
      if (!chNumMatch) return true;
      const num = parseInt(chNumMatch[1]!, 10);
      return num < chapterNumber - 1;
    });

    return filteredRows.length > 0 ? filteredRows.join("\n") : "";
  }

  private sanitizeFilename(title: string): string {
    return title
      .replace(/[/\\?%*:|"<>]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 50);
  }
}
