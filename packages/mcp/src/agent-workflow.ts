import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  assertSafeBookId,
  deriveBookIdFromTitle,
  StateManager,
  type BookConfig,
} from "@actalk/inkos-core";
import { parseImportSource } from "./import-service.js";
import {
  appendImportReport,
  countWords,
  exists,
  inferLanguage,
  resolveBookId,
  safeProjectPath,
  writeIfMissing,
} from "./utils.js";
import type {
  AgentCommitBookInput,
  AgentCommitBookResult,
  AgentCommitChapterInput,
  AgentCommitChapterResult,
  AgentContinuePlanInput,
  AgentContinuePlanResult,
  AgentCreateBookPlanInput,
  AgentCreateBookPlanResult,
  AgentFoundationFileName,
  AgentImportPlanInput,
  AgentImportPlanResult,
  AgentTask,
  AgentTruthFileName,
  ContextBundleInput,
  ContextBundleResult,
  ResolvedProject,
  WriteAgentChapterInput,
  WriteAgentChapterResult,
} from "./types.js";

type ContextBundleLoader = (input: ContextBundleInput) => Promise<ContextBundleResult>;
type ChapterWriter = (input: WriteAgentChapterInput) => Promise<WriteAgentChapterResult>;

export async function agentCreateBookPlan(
  project: ResolvedProject,
  input: AgentCreateBookPlanInput,
): Promise<AgentCreateBookPlanResult> {
  const bookId = resolveNewBookId(input.title, input.bookId);
  const state = new StateManager(project.projectRoot);
  if (await exists(join(state.bookDir(bookId), "book.json"))) {
    throw new Error(`Book "${bookId}" already exists.`);
  }
  return {
    summary: `已准备《${input.title}》的外部 agent 建书基础设定任务。`,
    mode: "agent-mediated",
    requiresInkosLlm: false,
    bookId,
    title: input.title,
    agentTask: createBookFoundationTask(input),
    brief: input.brief,
  };
}

export async function agentCommitBook(
  project: ResolvedProject,
  input: AgentCommitBookInput,
): Promise<AgentCommitBookResult> {
  const bookId = resolveNewBookId(input.title, input.bookId);
  const state = new StateManager(project.projectRoot);
  const bookDir = state.bookDir(bookId);
  const dryRun = input.dryRun === true;
  const modifiedFiles = plannedBookFiles(bookId, input.foundationFiles);
  if (await exists(join(bookDir, "book.json"))) {
    throw new Error(`Book "${bookId}" already exists.`);
  }
  if (!dryRun) {
    const now = new Date().toISOString();
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await mkdir(join(bookDir, "story", "state"), { recursive: true });
    const book: BookConfig = {
      id: bookId,
      title: input.title,
      platform: input.platform ?? "other",
      genre: input.genre ?? "other",
      status: "active",
      targetChapters: input.targetChapters ?? 200,
      chapterWordCount: input.chapterWordCount ?? 3000,
      language: input.language ?? "zh",
      createdAt: now,
      updatedAt: now,
    };
    await writeFile(join(bookDir, "book.json"), JSON.stringify(book, null, 2), "utf-8");
    await writeFile(join(bookDir, "chapters", "index.json"), "[]\n", "utf-8");
    await writeFoundationFiles(bookDir, input.foundationFiles);
    await appendImportReport(project.projectRoot, bookId, [
      "## Agent Mediated Book Foundation",
      "",
      "- requires_inkos_llm: false",
      "- generated_by: external MCP agent",
    ]);
  }
  return {
    summary: dryRun ? `Dry run: 将创建《${input.title}》。` : `已创建《${input.title}》。`,
    mode: "agent-mediated",
    requiresInkosLlm: false,
    dryRun,
    bookId,
    modifiedFiles: dryRun ? [] : modifiedFiles,
  };
}

export async function agentImportPlan(
  project: ResolvedProject,
  input: AgentImportPlanInput,
): Promise<AgentImportPlanResult> {
  const bookId = await resolveBookId(project.projectRoot, input.bookId);
  const sourcePath = safeProjectPath(project.projectRoot, input.sourcePath);
  const parsed = await parseImportSource(sourcePath, project.projectRoot, input);
  if (parsed.chapters.length === 0) {
    throw new Error("No chapters recognized. Run inkos_import_preview and adjust splitPattern first.");
  }
  const excerptBudget = input.maxChars ?? 12_000;
  const sourceExcerpt = parsed.chapters
    .map((chapter, index) => `## ${index + 1}. ${chapter.title}\n\n${chapter.content}`)
    .join("\n\n---\n\n")
    .slice(0, excerptBudget);

  return {
    summary: `已准备 ${parsed.chapters.length} 章的外部 agent 导入整理任务。`,
    mode: "agent-mediated",
    requiresInkosLlm: false,
    bookId,
    importMode: input.importMode ?? "continuation",
    agentTask: importSettlementTask(),
    chapters: parsed.chapters.map((chapter, index) => ({
      number: index + 1,
      title: chapter.title,
      wordCount: countWords(chapter.content, inferLanguage(chapter.content)),
      charCount: chapter.content.length,
    })),
    sourceExcerpt,
  };
}

export async function agentContinuePlan(
  project: ResolvedProject,
  input: AgentContinuePlanInput,
  loadContextBundle: ContextBundleLoader,
): Promise<AgentContinuePlanResult> {
  const bookId = await resolveBookId(project.projectRoot, input.bookId);
  const state = new StateManager(project.projectRoot);
  const index = await state.loadChapterIndex(bookId);
  const nextChapterNumber = index.reduce((max, chapter) => Math.max(max, chapter.number), 0) + 1;
  const contextBundle = await loadContextBundle({
    bookId,
    purpose: "continue",
    chapterWindow: input.chapterWindow ?? 3,
    maxChars: input.maxChars ?? 12_000,
  });
  return {
    summary: `已准备第 ${nextChapterNumber} 章的外部 agent 续写任务。`,
    mode: "agent-mediated",
    requiresInkosLlm: false,
    bookId,
    nextChapterNumber,
    agentTask: continueChapterTask(nextChapterNumber),
    contextBundle,
  };
}

export async function agentCommitChapter(
  project: ResolvedProject,
  input: AgentCommitChapterInput,
  writeChapter: ChapterWriter,
): Promise<AgentCommitChapterResult> {
  const written = await writeChapter(input);
  const state = new StateManager(project.projectRoot);
  const bookId = await resolveBookId(project.projectRoot, input.bookId);
  const storyDir = join(state.bookDir(bookId), "story");
  const modified = [...written.modifiedFiles];
  if (input.truthFiles) {
    for (const [name, content] of Object.entries(input.truthFiles) as Array<[AgentTruthFileName, string]>) {
      const rel = truthFilePath(name);
      const target = join(storyDir, rel);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `${content.trimEnd()}\n`, "utf-8");
      modified.push(relative(project.projectRoot, target));
    }
  }
  await writeIfMissing(join(storyDir, "state", "manifest.json"), JSON.stringify({ agentMediated: true }, null, 2));
  const report = await appendImportReport(project.projectRoot, bookId, [
    `## Agent Mediated Chapter ${written.chapterNumber}`,
    "",
    "- requires_inkos_llm: false",
    "- generated_by: external MCP agent",
    `- summary: ${input.summary ?? "(not provided)"}`,
  ]);
  modified.push(report);
  return {
    ...written,
    summary: `已提交外部 agent 生成的第 ${written.chapterNumber} 章和 truth/state 更新。`,
    mode: "agent-mediated",
    requiresInkosLlm: false,
    modifiedFiles: [...new Set(modified)],
  };
}

function importSettlementTask(): AgentTask {
  return {
    kind: "import_settlement",
    instructions: "外部 agent 读取章节摘录与必要 chapter resource，整理可写回 InkOS 的基础设定、当前状态、伏笔、章节摘要和风格说明。不要调用 InkOS 内部 LLM API。",
    expectedOutputSchema: {
      truthFiles: {
        currentState: "string",
        pendingHooks: "string",
        chapterSummaries: "string",
        styleNotes: "string",
        notes: "string",
      },
      recommendedNextAction: "string",
    },
  };
}

function createBookFoundationTask(input: AgentCreateBookPlanInput): AgentTask {
  return {
    kind: "create_book_foundation",
    instructions: [
      "外部 agent 根据用户意图生成 InkOS 建书基础文件；不要调用 InkOS 内部 LLM API。",
      "生成后调用 inkos_agent_commit_book 写入 book.json、章节索引和 story 控制文档。",
      "基础设定应尽量覆盖 Studio 建书时会产生的长期控制信息：作者意图、当前焦点、故事圣经、规则、风格和初始状态。",
    ].join("\n"),
    expectedOutputSchema: {
      title: input.title,
      genre: input.genre ?? "string",
      language: input.language ?? "zh",
      foundationFiles: {
        authorIntent: "string",
        currentFocus: "string",
        storyBible: "string",
        bookRules: "string",
        styleNotes: "string",
        currentState: "string",
        pendingHooks: "string",
        notes: "string",
      },
    },
  };
}

function continueChapterTask(chapterNumber: number): AgentTask {
  return {
    kind: "continue_chapter",
    instructions: `外部 agent 基于 contextBundle 生成第 ${chapterNumber} 章正文，并同时返回摘要和必要 truth/state 增量。生成后调用 inkos_agent_commit_chapter 写回。`,
    expectedOutputSchema: {
      title: "string",
      content: "string",
      summary: "string",
      truthFiles: {
        currentState: "string",
        pendingHooks: "string",
        chapterSummaries: "string",
      },
    },
  };
}

function truthFilePath(name: AgentTruthFileName): string {
  switch (name) {
    case "currentState":
      return "state/current_state.md";
    case "pendingHooks":
      return "pending_hooks.md";
    case "authorIntent":
      return "author_intent.md";
    case "currentFocus":
      return "current_focus.md";
    case "notes":
      return "notes.md";
    case "styleNotes":
      return "style_guide.md";
    case "chapterSummaries":
      return "chapter_summaries.md";
  }
}

function resolveNewBookId(title: string, bookId?: string): string {
  const id = bookId?.trim() || deriveBookIdFromTitle(title);
  assertSafeBookId(id);
  return id;
}

function plannedBookFiles(bookId: string, files?: Partial<Record<AgentFoundationFileName, string>>): ReadonlyArray<string> {
  return [
    `books/${bookId}/book.json`,
    `books/${bookId}/chapters/index.json`,
    `books/${bookId}/story/import-report.md`,
    ...Object.keys(files ?? {}).map((name) => `books/${bookId}/story/${foundationFilePath(name as AgentFoundationFileName)}`),
  ];
}

async function writeFoundationFiles(
  bookDir: string,
  files?: Partial<Record<AgentFoundationFileName, string>>,
): Promise<void> {
  const storyDir = join(bookDir, "story");
  await writeIfMissing(join(storyDir, "author_intent.md"), "# 作者意图\n\n（由外部 agent 或用户补充。）\n");
  await writeIfMissing(join(storyDir, "current_focus.md"), "# 当前聚焦\n\n（由外部 agent 或用户补充。）\n");
  await writeIfMissing(join(storyDir, "notes.md"), "# Notes\n\n");
  await writeIfMissing(join(storyDir, "state", "manifest.json"), JSON.stringify({ agentMediated: true }, null, 2));
  if (!files) return;
  for (const [name, content] of Object.entries(files) as Array<[AgentFoundationFileName, string]>) {
    const target = join(storyDir, foundationFilePath(name));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${content.trimEnd()}\n`, "utf-8");
  }
}

function foundationFilePath(name: AgentFoundationFileName): string {
  switch (name) {
    case "authorIntent":
      return "author_intent.md";
    case "currentFocus":
      return "current_focus.md";
    case "notes":
      return "notes.md";
    case "storyBible":
      return "story_bible.md";
    case "bookRules":
      return "book_rules.md";
    case "styleNotes":
      return "style_guide.md";
    case "currentState":
      return "state/current_state.md";
    case "pendingHooks":
      return "pending_hooks.md";
  }
}
