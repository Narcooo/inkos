import { BaseAgent } from "./base.js";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import { readGenreProfile, readBookRules } from "./rules-reader.js";
import { parseWriterOutput, type ParsedWriterOutput } from "./writer-parser.js";
import { resolveLengthCountingMode } from "../utils/length-metrics.js";
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

    // Read current truth files (same set as writer.ts)
    const [
      currentState, ledger, hooks,
      chapterSummaries, subplotBoard, emotionalArcs, characterMatrix,
      storyBible, volumeOutline,
    ] = await Promise.all([
      this.readFileOrDefault(join(bookDir, "story/current_state.md")),
      this.readFileOrDefault(join(bookDir, "story/particle_ledger.md")),
      this.readFileOrDefault(join(bookDir, "story/pending_hooks.md")),
      this.readFileOrDefault(join(bookDir, "story/chapter_summaries.md")),
      this.readFileOrDefault(join(bookDir, "story/subplot_board.md")),
      this.readFileOrDefault(join(bookDir, "story/emotional_arcs.md")),
      this.readFileOrDefault(join(bookDir, "story/character_matrix.md")),
      this.readFileOrDefault(join(bookDir, "story/story_bible.md")),
      this.readFileOrDefault(join(bookDir, "story/volume_outline.md")),
    ]);

    const { profile: genreProfile, body: genreBody } =
      await readGenreProfile(this.ctx.projectRoot, book.genre);
    const parsedBookRules = await readBookRules(bookDir);
    const bookRulesBody = parsedBookRules?.body ?? "";

    const systemPrompt = this.buildSystemPrompt(book, genreProfile, genreBody, bookRulesBody);

    const userPrompt = this.buildUserPrompt({
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
    if (output.title === `第${chapterNumber}章` && chapterTitle) {
      return { ...output, title: chapterTitle };
    }

    return output;
  }

  private buildSystemPrompt(
    book: BookConfig,
    genreProfile: GenreProfile,
    genreBody: string,
    bookRulesBody: string,
  ): string {
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

  private async readFileOrDefault(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return "(文件尚未创建)";
    }
  }
}
