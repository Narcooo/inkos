import { BaseAgent } from "./base.js";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import { readGenreProfile, readBookRules } from "./rules-reader.js";
import { parseWriterOutput, type ParsedWriterOutput } from "./writer-parser.js";
import { resolveLengthCountingMode } from "../utils/length-metrics.js";
import { retrieveMemorySelection } from "../utils/memory-retrieval.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface AnalyzeChapterInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly chapterContent: string;
  readonly chapterTitle?: string;
}

export type AnalyzeChapterOutput = ParsedWriterOutput;

export class ChapterAnalyzerAgent extends BaseAgent {
  get name(): string {
    return "chapter-analyzer";
  }

  async analyzeChapter(input: AnalyzeChapterInput): Promise<AnalyzeChapterOutput> {
    const { book, bookDir, chapterNumber, chapterContent, chapterTitle } = input;
    const { profile: genreProfile, body: genreBody } =
      await readGenreProfile(this.ctx.projectRoot, book.genre);
    const resolvedLanguage = book.language ?? genreProfile.language;

    // Read current truth files (same set as writer.ts)
    const [
      currentState, ledger, hooks,
      subplotBoard, emotionalArcs, characterMatrix,
      storyBible, volumeOutline,
    ] = await Promise.all([
      this.readFileOrDefault(join(bookDir, "story/current_state.md"), resolvedLanguage),
      this.readFileOrDefault(join(bookDir, "story/particle_ledger.md"), resolvedLanguage),
      this.readFileOrDefault(join(bookDir, "story/pending_hooks.md"), resolvedLanguage),
      this.readFileOrDefault(join(bookDir, "story/subplot_board.md"), resolvedLanguage),
      this.readFileOrDefault(join(bookDir, "story/emotional_arcs.md"), resolvedLanguage),
      this.readFileOrDefault(join(bookDir, "story/character_matrix.md"), resolvedLanguage),
      this.readFileOrDefault(join(bookDir, "story/story_bible.md"), resolvedLanguage),
      this.readFileOrDefault(join(bookDir, "story/volume_outline.md"), resolvedLanguage),
    ]);
    const parsedBookRules = await readBookRules(bookDir);
    const bookRulesBody = parsedBookRules?.body ?? "";
    const memorySelection = await retrieveMemorySelection({
      bookDir,
      chapterNumber,
      goal: this.buildMemoryGoal(chapterTitle, chapterContent),
      outlineNode: this.findOutlineNode(volumeOutline, chapterNumber),
    });
    const chapterSummaries = this.renderSummarySnapshot(
      memorySelection.summaries,
      resolvedLanguage,
    );

    const systemPrompt = this.buildSystemPrompt(
      book,
      genreProfile,
      genreBody,
      bookRulesBody,
      resolvedLanguage,
    );

    const userPrompt = this.buildUserPrompt({
      language: resolvedLanguage,
      chapterNumber,
      chapterContent,
      chapterTitle,
      storyBible,
      volumeOutline,
      currentState,
      ledger: genreProfile.numericalSystem ? ledger : "",
      hooks,
      chapterSummaries,
      subplotBoard,
      emotionalArcs,
      characterMatrix,
    });

    const response = await this.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { maxTokens: 16384, temperature: 0.3 },
    );

    const countingMode = resolveLengthCountingMode(book.language ?? genreProfile.language);
    const output = parseWriterOutput(chapterNumber, response.content, genreProfile, countingMode);

    // If LLM didn't return a title, use the one from input or derive from chapter number
    if (
      chapterTitle
      && (
        output.title === this.defaultChapterTitle(chapterNumber, resolvedLanguage)
        || output.title === `第${chapterNumber}章`
      )
    ) {
      return { ...output, title: chapterTitle };
    }

    return output;
  }

  private buildSystemPrompt(
    book: BookConfig,
    genreProfile: GenreProfile,
    genreBody: string,
    bookRulesBody: string,
    language: "zh" | "en",
  ): string {
    if (language === "en") {
      const numericalBlock = genreProfile.numericalSystem
        ? "\n- This genre tracks numerical/resources systems; UPDATED_LEDGER must capture every resource change shown in the chapter."
        : "\n- This genre has no numerical system; leave UPDATED_LEDGER empty.";

      return `【LANGUAGE OVERRIDE】ALL output MUST be in English. The === TAG === markers remain unchanged.

You are a fiction continuity analyst. Analyze a finished chapter, extract every state change, and update the tracking files.

## Working Mode

You are not writing new prose. You are reading completed chapter text and updating the book's truth files.
1. Read the chapter carefully and extract all important facts.
2. Update the existing tracking files incrementally rather than rebuilding them from scratch.
3. Keep the output contract identical to the writer pipeline.

## What To Extract

- Character entrances, exits, injuries, breakthroughs, deaths, and other status changes
- Location movement and scene transitions
- Item or resource gains and losses
- Hook setup, advancement, and payoff
- Emotional arc movement
- Subplot progress
- Relationship changes and information-boundary changes

## Book Information

- Title: ${book.title}
- Genre: ${genreProfile.name} (${book.genre})
- Platform: ${book.platform}
${numericalBlock}

## Genre Guidance

${genreBody}

${bookRulesBody ? `## Book Rules\n\n${bookRulesBody}` : ""}

## Output Format

Use === TAG === delimiters exactly as shown:

=== CHAPTER_TITLE ===
(Extract or infer the chapter title. Output title text only.)

=== CHAPTER_CONTENT ===
(Repeat the original chapter content exactly. Do not rewrite.)

=== PRE_WRITE_CHECK ===
(Leave empty in analysis mode.)

=== POST_SETTLEMENT ===
(Leave empty in analysis mode.)

=== UPDATED_STATE ===
Updated state card as a Markdown table reflecting the end-of-chapter state:
| Field | Value |
| --- | --- |
| Current Chapter | {chapter_number} |
| Current Location | ... |
| Protagonist State | ... |
| Current Goal | ... |
| Current Constraint | ... |
| Current Alliances | ... |
| Current Conflict | ... |

=== UPDATED_LEDGER ===
(If the genre has a numerical system: output the fully updated resource ledger table. Otherwise leave empty.)

=== UPDATED_HOOKS ===
Updated hooks pool as a Markdown table with the latest status of every known hook:
| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | notes |

=== CHAPTER_SUMMARY ===
Single Markdown table row:
| Chapter | Title | Characters | Key Events | State Changes | Hook Activity | Mood | Chapter Type |

=== UPDATED_SUBPLOTS ===
Updated subplot board (Markdown table)

=== UPDATED_EMOTIONAL_ARCS ===
Updated emotional arcs (Markdown table)

=== UPDATED_CHARACTER_MATRIX ===
Updated character interaction matrix (Markdown table)

## Rules

1. UPDATED_STATE and UPDATED_HOOKS must be incremental updates based on the current tracking files.
2. Every factual change in the chapter must appear in the corresponding tracking file.
3. Do not miss resource changes, movement, relationship changes, or information changes.
4. Information boundaries in the character matrix must stay exact: each character only knows what they directly witnessed or learned.`;
    }

    const numericalBlock = genreProfile.numericalSystem
      ? `\n- 本题材有数值/资源体系，你必须在 UPDATED_LEDGER 中追踪正文中出现的所有资源变动`
      : `\n- 本题材无数值系统，UPDATED_LEDGER 留空`;

    return `你是小说连续性分析师。你的任务是分析一章已完成的小说正文，从中提取所有状态变化并更新追踪文件。

## 工作模式

你不是在写作，而是在分析已有正文。你需要：
1. 仔细阅读正文，提取所有关键信息
2. 基于"当前追踪文件"做增量更新
3. 输出格式与写作模块完全一致

## 分析维度

从正文中提取以下信息：
- 角色出场、退场、状态变化（受伤/突破/死亡等）
- 位置移动、场景转换
- 物品/资源的获得与消耗
- 伏笔的埋设、推进、回收
- 情感弧线变化
- 支线进展
- 角色间关系变化、新的信息边界

## 书籍信息

- 标题：${book.title}
- 题材：${genreProfile.name}（${book.genre}）
- 平台：${book.platform}
${numericalBlock}

## 题材特征

${genreBody}

${bookRulesBody ? `## 本书规则\n\n${bookRulesBody}` : ""}

## 输出格式（必须严格遵循）

使用 === TAG === 分隔各部分，与写作模块完全一致：

=== CHAPTER_TITLE ===
（从正文标题行提取或推断章节标题，只输出标题文字）

=== CHAPTER_CONTENT ===
（原样输出正文内容，不做任何修改）

=== PRE_WRITE_CHECK ===
（留空，分析模式不需要写作自检）

=== POST_SETTLEMENT ===
（留空，分析模式不需要写后结算）

=== UPDATED_STATE ===
更新后的状态卡（Markdown表格），反映本章结束时的最新状态：
| 字段 | 值 |
|------|-----|
| 当前章节 | {章节号} |
| 当前位置 | ... |
| 主角状态 | ... |
| 当前目标 | ... |
| 当前限制 | ... |
| 当前敌我 | ... |
| 当前冲突 | ... |

=== UPDATED_LEDGER ===
（如有数值系统：更新后的完整资源账本表格；无则留空）

=== UPDATED_HOOKS ===
更新后的伏笔池（Markdown表格），包含所有已知伏笔的最新状态：
| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |

=== CHAPTER_SUMMARY ===
本章摘要（Markdown表格行）：
| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |

=== UPDATED_SUBPLOTS ===
更新后的支线进度板（Markdown表格）

=== UPDATED_EMOTIONAL_ARCS ===
更新后的情感弧线（Markdown表格）

=== UPDATED_CHARACTER_MATRIX ===
更新后的角色交互矩阵（Markdown表格）

## 关键规则

1. 状态卡和伏笔池必须基于"当前追踪文件"做增量更新，不是从零开始
2. 正文中的每一个事实性变化都必须反映在对应的追踪文件中
3. 不要遗漏细节：数值变化、位置变化、关系变化、信息变化都要记录
4. 角色交互矩阵中的"信息边界"要准确——角色只知道他在场时发生的事`;
  }

  private buildUserPrompt(params: {
    readonly language: "zh" | "en";
    readonly chapterNumber: number;
    readonly chapterContent: string;
    readonly chapterTitle?: string;
    readonly storyBible: string;
    readonly volumeOutline: string;
    readonly currentState: string;
    readonly ledger: string;
    readonly hooks: string;
    readonly chapterSummaries: string;
    readonly subplotBoard: string;
    readonly emotionalArcs: string;
    readonly characterMatrix: string;
  }): string {
    if (params.language === "en") {
      const titleLine = params.chapterTitle
        ? `Chapter Title: ${params.chapterTitle}\n`
        : "";

      const ledgerBlock = params.ledger
        ? `\n## Current Resource Ledger\n${params.ledger}\n`
        : "";

      const summariesBlock = params.chapterSummaries !== this.missingFilePlaceholder("en")
        ? `\n## Existing Chapter Summaries\n${params.chapterSummaries}\n`
        : "";

      const subplotBlock = params.subplotBoard !== this.missingFilePlaceholder("en")
        ? `\n## Current Subplot Board\n${params.subplotBoard}\n`
        : "";

      const emotionalBlock = params.emotionalArcs !== this.missingFilePlaceholder("en")
        ? `\n## Current Emotional Arcs\n${params.emotionalArcs}\n`
        : "";

      const matrixBlock = params.characterMatrix !== this.missingFilePlaceholder("en")
        ? `\n## Current Character Matrix\n${params.characterMatrix}\n`
        : "";

      return `Analyze chapter ${params.chapterNumber} and update all tracking files.
${titleLine}
## Chapter Content

${params.chapterContent}

## Current State
${params.currentState}
${ledgerBlock}
## Current Hooks
${params.hooks}
${summariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}
## Story Bible
${params.storyBible}

## Volume Outline
${params.volumeOutline}

Please return the result strictly in the === TAG === format.`;
    }

    const titleLine = params.chapterTitle
      ? `章节标题：${params.chapterTitle}\n`
      : "";

    const ledgerBlock = params.ledger
      ? `\n## 当前资源账本\n${params.ledger}\n`
      : "";

    const summariesBlock = params.chapterSummaries !== "(文件尚未创建)"
      ? `\n## 已有章节摘要\n${params.chapterSummaries}\n`
      : "";

    const subplotBlock = params.subplotBoard !== "(文件尚未创建)"
      ? `\n## 当前支线进度板\n${params.subplotBoard}\n`
      : "";

    const emotionalBlock = params.emotionalArcs !== "(文件尚未创建)"
      ? `\n## 当前情感弧线\n${params.emotionalArcs}\n`
      : "";

    const matrixBlock = params.characterMatrix !== "(文件尚未创建)"
      ? `\n## 当前角色交互矩阵\n${params.characterMatrix}\n`
      : "";

    return `请分析第${params.chapterNumber}章正文，更新所有追踪文件。
${titleLine}
## 正文内容

${params.chapterContent}

## 当前状态卡
${params.currentState}
${ledgerBlock}
## 当前伏笔池
${params.hooks}
${summariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}
## 世界观设定
${params.storyBible}

## 卷纲
${params.volumeOutline}

请严格按照 === TAG === 格式输出分析结果。`;
  }

  private buildMemoryGoal(chapterTitle: string | undefined, chapterContent: string): string {
    return [chapterTitle ?? "", chapterContent.slice(0, 1500)]
      .filter((part) => part.trim().length > 0)
      .join("\n\n");
  }

  private findOutlineNode(volumeOutline: string, chapterNumber: number): string | undefined {
    if (!volumeOutline || volumeOutline === this.missingFilePlaceholder("zh") || volumeOutline === this.missingFilePlaceholder("en")) {
      return undefined;
    }

    const lines = volumeOutline.split("\n").map((line) => line.trim()).filter(Boolean);
    const chapterPatterns = [
      new RegExp(`^#+\\s*Chapter\\s*${chapterNumber}\\b`, "i"),
      new RegExp(`^#+\\s*第\\s*${chapterNumber}\\s*章`),
    ];

    const heading = lines.find((line) => chapterPatterns.some((pattern) => pattern.test(line)));
    if (!heading) return undefined;

    const headingIndex = lines.indexOf(heading);
    const nextLine = lines[headingIndex + 1];
    return nextLine && !nextLine.startsWith("#") ? nextLine : heading.replace(/^#+\s*/, "");
  }

  private renderSummarySnapshot(
    summaries: ReadonlyArray<{
      chapter: number;
      title: string;
      characters: string;
      events: string;
      stateChanges: string;
      hookActivity: string;
      mood: string;
      chapterType: string;
    }>,
    language: "zh" | "en",
  ): string {
    if (summaries.length === 0) {
      return this.missingFilePlaceholder(language);
    }

    const header = language === "en"
      ? [
          "| Chapter | Title | Characters | Key Events | State Changes | Hook Activity | Mood | Chapter Type |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
      : [
          "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ];

    const rows = summaries.map((summary) => [
      summary.chapter,
      summary.title,
      summary.characters,
      summary.events,
      summary.stateChanges,
      summary.hookActivity,
      summary.mood,
      summary.chapterType,
    ].map((cell) => this.escapeTableCell(String(cell))).join(" | "));

    return [
      ...header,
      ...rows.map((row) => `| ${row} |`),
    ].join("\n");
  }

  private escapeTableCell(value: string): string {
    return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  }

  private async readFileOrDefault(path: string, language: "zh" | "en"): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return this.missingFilePlaceholder(language);
    }
  }

  private missingFilePlaceholder(language: "zh" | "en"): string {
    return language === "en" ? "(file not created yet)" : "(文件尚未创建)";
  }

  private defaultChapterTitle(chapterNumber: number, language: "zh" | "en"): string {
    return language === "en" ? `Chapter ${chapterNumber}` : `第${chapterNumber}章`;
  }
}
