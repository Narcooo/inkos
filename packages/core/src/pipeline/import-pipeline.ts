/**
 * Import Pipeline — Operaciones de importación extraídas de runner.ts.
 *
 * Responsabilidades:
 * - generateStyleGuide: generación de guía de estilo vía LLM
 * - importCanon: importación de canon de libro padre para spinoffs
 * - importChapters: importación de capítulos existentes vía replay secuencial
 *
 * Usa PipelineContext para resolución de overrides (sin duplicar lógica de runner.ts).
 */

import { chatCompletion } from "../llm/provider.js";
import type { ChapterMeta } from "../models/chapter.js";
import { ArchitectAgent } from "../agents/architect.js";
import { WriterAgent } from "../agents/writer.js";
import { ChapterAnalyzerAgent } from "../agents/chapter-analyzer.js";
import { readGenreProfile } from "../agents/rules-reader.js";
import { StateManager } from "../state/manager.js";
import { PipelineContext, type PipelineContextConfig } from "./pipeline-context.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface ImportChaptersInput {
  readonly bookId: string;
  readonly chapters: ReadonlyArray<{ readonly title: string; readonly content: string }>;
  readonly resumeFrom?: number;
}

export interface ImportChaptersResult {
  readonly bookId: string;
  readonly importedCount: number;
  readonly totalWords: number;
  readonly nextChapter: number;
}

export class ImportPipeline {
  private readonly state: StateManager;
  private readonly pctx: PipelineContext;
  private readonly config: PipelineContextConfig;

  constructor(config: PipelineContextConfig) {
    this.config = config;
    this.state = new StateManager(config.projectRoot);
    this.pctx = new PipelineContext(config);
  }

  // ---------------------------------------------------------------------------
  // Style guide generation
  // ---------------------------------------------------------------------------

  /**
   * Generate a qualitative style guide from reference text via LLM.
   * Also saves the statistical style_profile.json.
   */
  async generateStyleGuide(bookId: string, referenceText: string, sourceName?: string): Promise<string> {
    if (referenceText.length < 500) {
      throw new Error(`Reference text too short (${referenceText.length} chars, minimum 500). Provide at least 2000 chars for reliable style extraction.`);
    }

    const { analyzeStyle } = await import("../agents/style-analyzer.js");
    const bookDir = this.state.bookDir(bookId);
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    // Huella estadística
    const profile = analyzeStyle(referenceText, sourceName);
    await writeFile(join(storyDir, "style_profile.json"), JSON.stringify(profile, null, 2), "utf-8");

    // Extracción cualitativa vía LLM
    const response = await chatCompletion(this.config.client, this.config.model, [
      {
        role: "system",
        content: `你是一位文学风格分析专家。分析参考文本的写作风格，提取可供模仿的定性特征。

输出格式（Markdown）：
## 叙事声音与语气
（冷峻/热烈/讽刺/温情/...，附1-2个原文例句）

## 对话风格
（角色说话的共性特征：句子长短、口头禅倾向、方言痕迹、对话节奏）

## 场景描写特征
（五感偏好、意象选择、描写密度、环境与情绪的关联方式）

## 转折与衔接手法
（场景如何切换、时间跳跃的处理方式、段落间的过渡特征）

## 节奏特征
（长短句分布、段落长度偏好、高潮/舒缓的交替方式）

## 词汇偏好
（高频特色用词、比喻/修辞倾向、口语化程度）

## 情绪表达方式
（直白抒情 vs 动作外化、内心独白的频率和风格）

## 独特习惯
（任何值得模仿的个人写作习惯）

分析必须基于原文实际特征，不要泛泛而谈。每个部分用1-2个原文例句佐证。`,
      },
      {
        role: "user",
        content: `分析以下参考文本的写作风格：\n\n${referenceText.slice(0, 20000)}`,
      },
    ], { temperature: 0.3, maxTokens: 4096 });

    await writeFile(join(storyDir, "style_guide.md"), response.content, "utf-8");
    return response.content;
  }

  // ---------------------------------------------------------------------------
  // Canon import (for spinoff writing)
  // ---------------------------------------------------------------------------

  /**
   * Import canon from parent book for spinoff writing.
   * Reads parent's truth files, uses LLM to generate parent_canon.md in target book.
   */
  async importCanon(targetBookId: string, parentBookId: string): Promise<string> {
    const bookIds = await this.state.listBooks();
    if (!bookIds.includes(parentBookId)) {
      throw new Error(`Parent book "${parentBookId}" not found. Available: ${bookIds.join(", ") || "(none)"}`);
    }
    if (!bookIds.includes(targetBookId)) {
      throw new Error(`Target book "${targetBookId}" not found. Available: ${bookIds.join(", ") || "(none)"}`);
    }

    const parentDir = this.state.bookDir(parentBookId);
    const targetDir = this.state.bookDir(targetBookId);
    const storyDir = join(targetDir, "story");
    await mkdir(storyDir, { recursive: true });

    const readSafe = async (path: string): Promise<string> => {
      try { return await readFile(path, "utf-8"); } catch { return "(无)"; }
    };

    const parentBook = await this.state.loadBookConfig(parentBookId);

    const [storyBible, currentState, ledger, hooks, summaries, subplots, emotions, matrix] =
      await Promise.all([
        readSafe(join(parentDir, "story/story_bible.md")),
        readSafe(join(parentDir, "story/current_state.md")),
        readSafe(join(parentDir, "story/particle_ledger.md")),
        readSafe(join(parentDir, "story/pending_hooks.md")),
        readSafe(join(parentDir, "story/chapter_summaries.md")),
        readSafe(join(parentDir, "story/subplot_board.md")),
        readSafe(join(parentDir, "story/emotional_arcs.md")),
        readSafe(join(parentDir, "story/character_matrix.md")),
      ]);

    const response = await chatCompletion(this.config.client, this.config.model, [
      {
        role: "system",
        content: `你是一位网络小说架构师。基于正传的全部设定和状态文件，生成一份完整的"正传正典参照"文档，供番外写作和审计使用。

输出格式（Markdown）：
# 正传正典（《{正传书名}》）

## 世界规则（完整，来自正传设定）
（力量体系、地理设定、阵营关系、核心规则——完整复制，不压缩）

## 正典约束（不可违反的事实）
| 约束ID | 类型 | 约束内容 | 严重性 |
|---|---|---|---|
| C01 | 人物存亡 | ... | critical |
（列出所有硬性约束：谁活着、谁死了、什么事件已经发生、什么规则不可违反）

## 角色快照
| 角色 | 当前状态 | 性格底色 | 对话特征 | 已知信息 | 未知信息 |
|---|---|---|---|---|---|
（从状态卡和角色矩阵中提取每个重要角色的完整快照）

## 角色双态处理原则
- 未来会变强的角色：写潜力暗示
- 未来会黑化的角色：写微小裂痕
- 未来会死的角色：写导致死亡的性格底色

## 关键事件时间线
| 章节 | 事件 | 涉及角色 | 对番外的约束 |
|---|---|---|---|
（从章节摘要中提取关键事件）

## 伏笔状态
| Hook ID | 类型 | 状态 | 内容 | 预期回收 |
|---|---|---|---|---|

## 资源账本快照
（当前资源状态）

---
meta:
  parentBookId: "{parentBookId}"
  parentTitle: "{正传书名}"
  generatedAt: "{ISO timestamp}"

要求：
1. 世界规则完整复制，不压缩——准确性优先
2. 正典约束必须穷尽，遗漏会导致番外与正传矛盾
3. 角色快照必须包含信息边界（已知/未知），防止番外中角色引用不该知道的信息`,
      },
      {
        role: "user",
        content: `正传书名：${parentBook.title}
正传ID：${parentBookId}

## 正传世界设定
${storyBible}

## 正传当前状态卡
${currentState}

## 正传资源账本
${ledger}

## 正传伏笔池
${hooks}

## 正传章节摘要
${summaries}

## 正传支线进度
${subplots}

## 正传情感弧线
${emotions}

## 正传角色矩阵
${matrix}`,
      },
    ], { temperature: 0.3, maxTokens: 16384 });

    // Agrega bloque meta determinístico (el LLM puede alucinar timestamps)
    const metaBlock = [
      "",
      "---",
      "meta:",
      `  parentBookId: "${parentBookId}"`,
      `  parentTitle: "${parentBook.title}"`,
      `  generatedAt: "${new Date().toISOString()}"`,
    ].join("\n");
    const canon = response.content + metaBlock;

    await writeFile(join(storyDir, "parent_canon.md"), canon, "utf-8");
    return canon;
  }

  // ---------------------------------------------------------------------------
  // Chapter import (for continuation writing from existing chapters)
  // ---------------------------------------------------------------------------

  /**
   * Import existing chapters into a book. Reverse-engineers all truth files
   * via sequential replay so the Writer and Auditor can continue naturally.
   */
  async importChapters(input: ImportChaptersInput): Promise<ImportChaptersResult> {
    const releaseLock = await this.state.acquireBookLock(input.bookId);
    try {
      const book = await this.state.loadBookConfig(input.bookId);
      const bookDir = this.state.bookDir(input.bookId);
      const { profile: gp } = await readGenreProfile(this.config.projectRoot, book.genre);

      const startFrom = input.resumeFrom ?? 1;

      const log = this.config.logger?.child("import");

      // Paso 1: generar fundación en primera ejecución (no en resume)
      if (startFrom === 1) {
        log?.info(`Step 1: Generating foundation from ${input.chapters.length} chapters...`);
        const allText = input.chapters.map((c, i) =>
          `第${i + 1}章 ${c.title}\n\n${c.content}`,
        ).join("\n\n---\n\n");

        const architect = new ArchitectAgent(this.pctx.agentCtxFor("architect", input.bookId));
        const foundation = await architect.generateFoundationFromImport(book, allText);
        await architect.writeFoundationFiles(bookDir, foundation, gp.numericalSystem);
        await this.state.saveChapterIndex(input.bookId, []);
        log?.info("Foundation generated.");
      }

      // Paso 2: replay secuencial
      log?.info(`Step 2: Sequential replay from chapter ${startFrom}...`);
      const analyzer = new ChapterAnalyzerAgent(this.pctx.agentCtxFor("chapter-analyzer", input.bookId));
      const writer = new WriterAgent(this.pctx.agentCtxFor("writer", input.bookId));
      let totalWords = 0;

      for (let i = startFrom - 1; i < input.chapters.length; i++) {
        const ch = input.chapters[i]!;
        const chapterNumber = i + 1;

        log?.info(`Analyzing chapter ${chapterNumber}/${input.chapters.length}: ${ch.title}...`);

        const output = await analyzer.analyzeChapter({
          book,
          bookDir,
          chapterNumber,
          chapterContent: ch.content,
          chapterTitle: ch.title,
        });

        await writer.saveChapter(bookDir, {
          ...output,
          postWriteErrors: [],
          postWriteWarnings: [],
        }, gp.numericalSystem);

        await writer.saveNewTruthFiles(bookDir, {
          ...output,
          postWriteErrors: [],
          postWriteWarnings: [],
        });

        const existingIndex = await this.state.loadChapterIndex(input.bookId);
        const now = new Date().toISOString();
        const newEntry: ChapterMeta = {
          number: chapterNumber,
          title: output.title,
          status: "imported",
          wordCount: ch.content.length,
          createdAt: now,
          updatedAt: now,
          auditIssues: [],
        };
        const existingIdx = existingIndex.findIndex((e) => e.number === chapterNumber);
        const updatedIndex = existingIdx >= 0
          ? existingIndex.map((e, idx) => idx === existingIdx ? newEntry : e)
          : [...existingIndex, newEntry];
        await this.state.saveChapterIndex(input.bookId, updatedIndex);

        await this.state.snapshotState(input.bookId, chapterNumber);

        totalWords += ch.content.length;
      }

      const nextChapter = input.chapters.length + 1;
      log?.info(`Done. ${input.chapters.length} chapters imported, ${totalWords} chars. Next chapter: ${nextChapter}`);

      return {
        bookId: input.bookId,
        importedCount: input.chapters.length,
        totalWords,
        nextChapter,
      };
    } finally {
      await releaseLock();
    }
  }
}
