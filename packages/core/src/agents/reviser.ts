import { BaseAgent } from "./base.js";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";
import type { AuditIssue } from "./continuity.js";
import { readGenreProfile, readBookRules } from "./rules-reader.js";
import { readAllStoryFiles, type StoryFiles } from "../utils/story-files.js";
import { buildSettlerSystemPrompt, buildSettlerUserPrompt } from "./settler-prompts.js";
import { parseSettlementOutput, type SettlementOutput } from "./settler-parser.js";
import { buildParagraphDiff, formatDiffForSettler, shouldUseIncrementalSettle } from "../utils/paragraph-diff.js";
import { join } from "node:path";

export type ReviseMode = "polish" | "rewrite" | "rework" | "anti-detect" | "spot-fix";

export interface ReviseOutput {
  readonly revisedContent: string;
  readonly wordCount: number;
  readonly fixedIssues: ReadonlyArray<string>;
  readonly updatedState: string;
  readonly updatedLedger: string;
  readonly updatedHooks: string;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

/** Salida ligera: solo contiene el texto revisado, sin actualización de truth files. */
export interface ReviseLightOutput {
  readonly revisedContent: string;
  readonly wordCount: number;
  readonly fixedIssues: ReadonlyArray<string>;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

/** Re-exportar para conveniencia de los consumidores. */
export type { SettlementOutput };

const MODE_DESCRIPTIONS: Record<ReviseMode, string> = {
  polish: "润色：只改表达、节奏、段落呼吸，不改事实与剧情结论。禁止：增删段落、改变人名/地名/物品名、增加新情节或新对话、改变因果关系。只允许：替换用词、调整句序、修改标点节奏",
  rewrite: "改写：可改叙述顺序、画面、力度，但保留核心事实与人物动机",
  rework: "重写：可重构场景推进和冲突组织，但不改主设定和大事件结果",
  "anti-detect": `反检测改写：在保持剧情不变的前提下，降低AI生成可检测性。

改写手法（附正例）：
1. 打破句式规律：连续短句 → 长短交替，句式不可预测
2. 口语化替代：✗"然而事情并没有那么简单" → ✓"哪有那么便宜的事"
3. 减少"了"字密度：✗"他走了过去，拿了杯子" → ✓"他走过去，端起杯子"
4. 转折词降频：✗"虽然…但是…" → ✓ 用角色内心吐槽或直接动作切换
5. 情绪外化：✗"他感到愤怒" → ✓"他捏碎了茶杯，滚烫的茶水流过指缝"
6. 删掉叙述者结论：✗"这一刻他终于明白了力量" → ✓ 只写行动，让读者自己感受
7. 群像反应具体化：✗"全场震惊" → ✓"老陈的烟掉在裤子上，烫得他跳起来"
8. 段落长度差异化：不再等长段落，有的段只有一句话，有的段七八行
9. 消灭"不禁""仿佛""宛如"等AI标记词：换成具体感官描写`,
  "spot-fix": "定点修复：只修改审稿意见指出的具体句子或段落，其余所有内容必须原封不动保留。修改范围限定在问题句子及其前后各一句。禁止改动无关段落",
};

export class ReviserAgent extends BaseAgent {
  get name(): string {
    return "reviser";
  }

  async reviseChapter(
    bookDir: string,
    chapterContent: string,
    chapterNumber: number,
    issues: ReadonlyArray<AuditIssue>,
    mode: ReviseMode = "rewrite",
    genre?: string,
    extraContext?: string,
    storyFiles?: StoryFiles,
  ): Promise<ReviseOutput> {
    const sf = storyFiles ?? await readAllStoryFiles(join(bookDir, "story"));
    const currentState = sf.currentState;
    const ledger = sf.particleLedger;
    const hooks = sf.pendingHooks;
    const styleGuideRaw = sf.styleGuide;
    const volumeOutline = sf.volumeOutline;
    const storyBible = sf.storyBible;
    const characterMatrix = sf.characterMatrix;
    const chapterSummaries = sf.chapterSummaries;

    // Load genre profile and book rules
    const genreId = genre ?? "other";
    const { profile: gp } = await readGenreProfile(this.ctx.projectRoot, genreId);
    const parsedRules = await readBookRules(bookDir);
    const bookRules = parsedRules?.rules ?? null;

    // Fallback: use book_rules body when style_guide.md doesn't exist
    const styleGuide = styleGuideRaw !== "(文件不存在)"
      ? styleGuideRaw
      : (parsedRules?.body ?? "(无文风指南)");

    const issueList = issues
      .map((i) => `- [${i.severity}] ${i.category}: ${i.description}\n  建议: ${i.suggestion}`)
      .join("\n");

    const modeDesc = MODE_DESCRIPTIONS[mode];
    const numericalRule = gp.numericalSystem
      ? "\n3. 数值错误必须精确修正，前后对账"
      : "";
    const protagonistBlock = bookRules?.protagonist
      ? `\n\n主角人设锁定：${bookRules.protagonist.name}，${bookRules.protagonist.personalityLock.join("、")}。修改不得违反人设。`
      : "";

    const systemPrompt = `你是一位专业的${gp.name}网络小说修稿编辑。你的任务是根据审稿意见对章节进行修正。${protagonistBlock}

修稿模式：${modeDesc}

修稿原则：
1. 按模式控制修改幅度
2. 修根因，不做表面润色${numericalRule}
4. 伏笔状态必须与伏笔池同步
5. 不改变剧情走向和核心冲突
6. 保持原文的语言风格和节奏
7. 修改后同步更新状态卡${gp.numericalSystem ? "、账本" : ""}、伏笔池

输出格式：

=== FIXED_ISSUES ===
(逐条说明修正了什么，一行一条)

=== REVISED_CONTENT ===
(修正后的完整正文)

=== UPDATED_STATE ===
(更新后的完整状态卡)
${gp.numericalSystem ? "\n=== UPDATED_LEDGER ===\n(更新后的完整资源账本)" : ""}
=== UPDATED_HOOKS ===
(更新后的完整伏笔池)`;

    const ledgerBlock = gp.numericalSystem
      ? `\n## 资源账本\n${ledger}`
      : "";
    const outlineBlock = volumeOutline !== "(文件不存在)"
      ? `\n## 卷纲\n${volumeOutline}\n`
      : "";
    const bibleBlock = storyBible !== "(文件不存在)"
      ? `\n## 世界观设定\n${storyBible}\n`
      : "";
    const matrixBlock = characterMatrix !== "(文件不存在)"
      ? `\n## 角色交互矩阵\n${characterMatrix}\n`
      : "";
    const summariesBlock = chapterSummaries !== "(文件不存在)"
      ? `\n## 章节摘要\n${chapterSummaries}\n`
      : "";

    const extraContextBlock = extraContext?.trim()
      ? `\n## 本次额外修订要求\n${extraContext.trim()}\n`
      : "";

    const userPrompt = `请修正第${chapterNumber}章。

## 审稿问题
${issueList}
${extraContextBlock}
## 当前状态卡
${currentState}
${ledgerBlock}
## 伏笔池
${hooks}
${outlineBlock}${bibleBlock}${matrixBlock}${summariesBlock}
## 文风指南
${styleGuide}

## 待修正章节
${chapterContent}`;

    // Escalar maxTokens según la longitud del capítulo para evitar truncamiento
    const contentTokenEstimate = Math.ceil(chapterContent.length / 1.5);
    const baseMax = mode === "spot-fix" ? 8192 : 16384;
    const maxTokens = Math.max(baseMax, contentTokenEstimate);

    const response = await this.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.3, maxTokens },
    );

    const output = this.parseOutput(response.content, gp);
    return { ...output, tokenUsage: response.usage };
  }

  /**
   * Revisión ligera: solo lleva el texto original del capítulo + instrucciones.
   * No lee truth files, no produce actualizaciones de estado.
   */
  async reviseChapterLight(
    chapterContent: string,
    chapterNumber: number,
    instructions: string,
  ): Promise<ReviseLightOutput> {
    const systemPrompt = `你是一位专业的网络小说编辑。你的任务是根据修订要求对章节进行修改。

修稿原则：
1. 严格按照修订要求执行，不做额外改动
2. 保持原文的语言风格和节奏
3. 不改变剧情走向和核心冲突
4. 未被修订要求提及的内容应原封不动保留

输出格式：

=== FIXED_ISSUES ===
(逐条说明修正了什么，一行一条)

=== REVISED_CONTENT ===
(修正后的完整正文)`;

    const userPrompt = `请修正第${chapterNumber}章。

## 修订要求
${instructions}

## 待修正章节
${chapterContent}`;

    // Escalar maxTokens según la longitud del capítulo
    const contentTokenEstimate = Math.ceil(chapterContent.length / 1.5);
    const maxTokens = Math.max(16384, contentTokenEstimate);

    const response = await this.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.3, maxTokens },
    );

    const output = this.parseOutputLight(response.content);
    return { ...output, tokenUsage: response.usage };
  }

  /**
   * Liquidación posterior: dado un capítulo confirmado, lee los truth files
   * existentes y produce un SettlementOutput completo (estado, hooks, ledger, etc.).
   */
  async settleChapter(
    book: BookConfig,
    bookDir: string,
    chapterContent: string,
    chapterNumber: number,
    chapterTitle: string,
    genre?: string,
    storyFiles?: StoryFiles,
  ): Promise<{ readonly settlement: SettlementOutput; readonly tokenUsage?: { readonly promptTokens: number; readonly completionTokens: number; readonly totalTokens: number } }> {
    const sf = storyFiles ?? await readAllStoryFiles(join(bookDir, "story"));

    const genreId = genre ?? "other";
    const { profile: gp } = await readGenreProfile(this.ctx.projectRoot, genreId);
    const parsedRules = await readBookRules(bookDir);
    const bookRules = parsedRules?.rules ?? null;

    const settlerSystem = buildSettlerSystemPrompt(book, gp, bookRules);
    const settlerUser = buildSettlerUserPrompt({
      chapterNumber,
      title: chapterTitle,
      content: chapterContent,
      currentState: sf.currentState,
      ledger: gp.numericalSystem ? sf.particleLedger : "",
      hooks: sf.pendingHooks,
      chapterSummaries: sf.chapterSummaries,
      subplotBoard: sf.subplotBoard,
      emotionalArcs: sf.emotionalArcs,
      characterMatrix: sf.characterMatrix,
      volumeOutline: sf.volumeOutline,
    });

    // Escalar maxTokens según la longitud del contenido
    const settlerMaxTokens = Math.max(8192, Math.ceil(chapterContent.length * 0.8));

    const response = await this.chat(
      [
        { role: "system", content: settlerSystem },
        { role: "user", content: settlerUser },
      ],
      { maxTokens: settlerMaxTokens, temperature: 0.3 },
    );

    return {
      settlement: parseSettlementOutput(response.content, gp),
      tokenUsage: response.usage,
    };
  }

  /**
   * Liquidación incremental: dado el texto original y revisado, calcula un
   * diff a nivel de párrafo y solo envía los cambios al LLM.
   * Mucho más barato que settleChapter cuando la revisión es menor.
   *
   * Si el diff es grande (≥30% de párrafos cambiados), delega automáticamente
   * al settler completo.
   */
  async settleChapterIncremental(
    book: BookConfig,
    bookDir: string,
    originalContent: string,
    revisedContent: string,
    chapterNumber: number,
    chapterTitle: string,
    genre?: string,
    storyFiles?: StoryFiles,
  ): Promise<{ readonly settlement: SettlementOutput; readonly tokenUsage?: { readonly promptTokens: number; readonly completionTokens: number; readonly totalTokens: number }; readonly mode: "incremental" | "full" }> {
    const diff = buildParagraphDiff(originalContent, revisedContent);

    // Si la revisión cambia mucho, usar settler completo
    if (!shouldUseIncrementalSettle(diff)) {
      const result = await this.settleChapter(
        book, bookDir, revisedContent, chapterNumber, chapterTitle, genre, storyFiles,
      );
      return { ...result, mode: "full" };
    }

    // Settler incremental — solo enviar diff
    const sf = storyFiles ?? await readAllStoryFiles(join(bookDir, "story"));
    const genreId = genre ?? "other";
    const { profile: gp } = await readGenreProfile(this.ctx.projectRoot, genreId);
    const parsedRules = await readBookRules(bookDir);
    const bookRules = parsedRules?.rules ?? null;

    const diffText = formatDiffForSettler(diff);

    const numericalBlock = gp.numericalSystem
      ? `\n- 本题材有数值/资源体系，如果diff中涉及数值变化必须在 UPDATED_LEDGER 中更新`
      : `\n- 本题材无数值系统，UPDATED_LEDGER 留空`;

    const systemPrompt = `你是状态追踪分析师。你将收到一份章节修订的变更摘要（diff），而非完整章节。
你的任务是基于这些变更，对 truth 文件做增量更新。

## 工作模式

1. 仔细阅读 diff 中的变更内容
2. 判断哪些 truth 文件需要更新（可能只有部分需要更新）
3. 对于没有影响的 truth 文件，输出"(无变更)"即可
4. 对于受影响的文件，输出完整的更新后版本

## 书籍信息

- 标题：${book.title}
- 题材：${gp.name}（${book.genre}）
${numericalBlock}

## 输出格式

=== UPDATED_STATE ===
(更新后的完整状态卡，或"(无变更)")
${gp.numericalSystem ? "\n=== UPDATED_LEDGER ===\n(更新后的完整资源账本，或\"(无变更)\")" : ""}
=== UPDATED_HOOKS ===
(更新后的完整伏笔池，或"(无变更)")

=== CHAPTER_SUMMARY ===
(无需更新摘要时写"(无变更)"，否则输出更新后的行)

=== UPDATED_SUBPLOTS ===
(无变更)

=== UPDATED_EMOTIONAL_ARCS ===
(无变更或更新后版本)

=== UPDATED_CHARACTER_MATRIX ===
(无变更或更新后版本)`;

    const ledgerBlock = gp.numericalSystem ? `\n## 当前资源账本\n${sf.particleLedger}` : "";

    const userPrompt = `第${chapterNumber}章「${chapterTitle}」经过修订，以下是变更摘要：

${diffText}

## 当前状态卡
${sf.currentState}
${ledgerBlock}
## 当前伏笔池
${sf.pendingHooks}

请基于以上 diff 做增量更新。对于未受影响的文件直接输出"(无变更)"。`;

    const response = await this.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { maxTokens: 4096, temperature: 0.3 },
    );

    return {
      settlement: parseSettlementOutput(response.content, gp),
      tokenUsage: response.usage,
      mode: "incremental",
    };
  }

  private parseOutput(content: string, gp: GenreProfile): ReviseOutput {
    const extract = (tag: string): string => {
      const regex = new RegExp(
        `=== ${tag} ===\\s*([\\s\\S]*?)(?==== [A-Z_]+ ===|$)`,
      );
      const match = content.match(regex);
      return match?.[1]?.trim() ?? "";
    };

    const revisedContent = extract("REVISED_CONTENT");
    const fixedRaw = extract("FIXED_ISSUES");

    return {
      revisedContent,
      wordCount: revisedContent.length,
      fixedIssues: fixedRaw
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
      updatedState: extract("UPDATED_STATE") || "(状态卡未更新)",
      updatedLedger: gp.numericalSystem
        ? (extract("UPDATED_LEDGER") || "(账本未更新)")
        : "",
      updatedHooks: extract("UPDATED_HOOKS") || "(伏笔池未更新)",
    };
  }

  private parseOutputLight(content: string): ReviseLightOutput {
    const extract = (tag: string): string => {
      const regex = new RegExp(
        `=== ${tag} ===\\s*([\\s\\S]*?)(?==== [A-Z_]+ ===|$)`,
      );
      const match = content.match(regex);
      return match?.[1]?.trim() ?? "";
    };

    const revisedContent = extract("REVISED_CONTENT");
    const fixedRaw = extract("FIXED_ISSUES");

    return {
      revisedContent,
      wordCount: revisedContent.length,
      fixedIssues: fixedRaw
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    };
  }

  // ===========================
  // Layered Pipeline: S5 Tri-Output Settlement
  // ===========================

  /**
   * S5 — Ejecuta settlement con salida tripartita (State / Truth candidatos / View).
   *
   * A diferencia de settleChapter (que mezcla todas las actualizaciones),
   * este método separa las actualizaciones según la clasificación tripartita:
   *
   * A. State writes (escritura directa): estado actual, ganchos, ledger, arcos emocionales
   * B. Truth candidates (requieren Guard): cambios a story_bible, world rules, etc.
   * C. View writes (escritura directa): summaries, subplot board, character matrix
   */
  async settleChapterLayered(input: TriSettlementInput): Promise<TriSettlementOutput> {
    const { approvedContent, chapterNumber, book, stateFiles, viewFiles } = input;

    const { profile: genreProfile } = await readGenreProfile(this.ctx.projectRoot, book.genre);
    const parsedRules = await readBookRules(
      join(this.ctx.projectRoot, "books", book.id),
    );
    const bookRules = parsedRules?.rules ?? null;

    const systemPrompt = buildSettlerSystemPrompt(book, genreProfile, bookRules);
    const userPrompt = buildSettlerUserPrompt({
      chapterNumber,
      title: "(from layered pipeline)",
      content: approvedContent,
      currentState: stateFiles.currentState,
      ledger: genreProfile.numericalSystem ? stateFiles.particleLedger : "",
      hooks: stateFiles.pendingHooks,
      chapterSummaries: viewFiles.chapterSummaries,
      subplotBoard: viewFiles.subplotBoard,
      emotionalArcs: stateFiles.emotionalArcs,
      characterMatrix: viewFiles.characterMatrix,
      volumeOutline: "",
    });

    this.ctx.logger?.info(`S5: tri-settlement for ch${chapterNumber}`);

    const response = await this.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.3, maxTokens: 8192 },
    );

    const parsed = parseSettlementOutput(response.content, genreProfile);

    // B. Truth candidates — extraer si el settlement sugirió cambios a verdad
    return {
      // A. State writes (escritura directa)
      stateWrites: {
        updatedState: parsed.updatedState || "",
        updatedHooks: parsed.updatedHooks || "",
        updatedLedger: genreProfile.numericalSystem
          ? (parsed.updatedLedger || "")
          : "",
        updatedEmotionalArcs: parsed.updatedEmotionalArcs || "",
      },

      // B. Truth candidates
      truthCandidates: this.extractTruthCandidates(parsed, input),

      // C. View writes (escritura directa)
      viewWrites: {
        chapterSummary: parsed.chapterSummary || "",
        updatedSubplots: parsed.updatedSubplots || "",
        updatedCharacterMatrix: parsed.updatedCharacterMatrix || "",
      },

      postSettlement: parsed.postSettlement || "",
      tokenUsage: response.usage
        ? {
            promptTokens: response.usage.promptTokens,
            completionTokens: response.usage.completionTokens,
            totalTokens: response.usage.totalTokens,
          }
        : undefined,
    };
  }

  /**
   * Extrae candidatos a cambios de Truth de la salida del settlement.
   * Compara los ViewFiles (que actúan como Truth dinámico) con la salida propuesta.
   */
  private extractTruthCandidates(
    parsed: SettlementOutput,
    input: TriSettlementInput,
  ): readonly TruthCandidate[] {
    const candidates: TruthCandidate[] = [];

    // Comparar Matrix de personajes (View con alto impacto en Truth)
    const oldMatrix = input.viewFiles.characterMatrix;
    const newMatrix = parsed.updatedCharacterMatrix;
    if (newMatrix && newMatrix !== oldMatrix && !isPlaceholder(newMatrix)) {
      candidates.push({
        file: "character_matrix.md",
        field: "matrix",
        currentValue: oldMatrix,
        proposedValue: newMatrix,
        changeType: isPlaceholder(oldMatrix) ? "NEW" : "MODIFY",
        reason: "Chapter automated settlement proposed character profile updates",
      });
    }

    // Comparar Subplots (View con alto impacto en Truth)
    const oldSubplots = input.viewFiles.subplotBoard;
    const newSubplots = parsed.updatedSubplots;
    if (newSubplots && newSubplots !== oldSubplots && !isPlaceholder(newSubplots)) {
      candidates.push({
        file: "subplot_board.md",
        field: "subplots",
        currentValue: oldSubplots,
        proposedValue: newSubplots,
        changeType: isPlaceholder(oldSubplots) ? "NEW" : "MODIFY",
        reason: "Chapter automated settlement proposed subplot updates",
      });
    }

    return candidates;
  }
}

function isPlaceholder(val: string): boolean {
  return !val || val.includes("未更新") || val.includes("尚未创建") || val.includes("(无变更)");
}

// ===========================
// Layered Settlement Types
// ===========================

import type { ChapterTaskCard, StateFiles, ViewFiles } from "./context-layers.js";

/** Entrada para el S5 del pipeline con capas. */
export interface TriSettlementInput {
  readonly approvedContent: string;
  readonly taskCard: ChapterTaskCard;
  readonly chapterNumber: number;
  readonly book: BookConfig;
  readonly stateFiles: StateFiles;
  readonly viewFiles: ViewFiles;
}

/** Un candidato a cambio de Truth — necesita aprobación del Guard. */
export interface TruthCandidate {
  readonly file: string;
  readonly field: string;
  readonly currentValue: string;
  readonly proposedValue: string;
  readonly changeType: "NEW" | "MODIFY" | "DELETE";
  readonly reason: string;
}

/** Salida del S5 con clasificación tripartita. */
export interface TriSettlementOutput {
  readonly stateWrites: {
    readonly updatedState: string;
    readonly updatedHooks: string;
    readonly updatedLedger: string;
    readonly updatedEmotionalArcs: string;
  };
  readonly truthCandidates: readonly TruthCandidate[];
  readonly viewWrites: {
    readonly chapterSummary: string;
    readonly updatedSubplots: string;
    readonly updatedCharacterMatrix: string;
  };
  readonly postSettlement: string;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}
