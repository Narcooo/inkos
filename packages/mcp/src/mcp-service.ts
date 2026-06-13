import { mkdir, readFile, readdir, writeFile, copyFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import {
  assertSafeBookId,
  deriveBookIdFromTitle,
  StateManager,
  writeExportArtifact,
  type ChapterMeta,
  type ChapterStatus,
} from "@actalk/inkos-core";
import {
  agentCommitBook as runAgentCommitBook,
  agentCommitChapter as runAgentCommitChapter,
  agentContinuePlan as runAgentContinuePlan,
  agentCreateBookPlan as runAgentCreateBookPlan,
  agentImportPlan as runAgentImportPlan,
} from "./agent-workflow.js";
import {
  parseImportSource,
  plannedImportFiles,
  toPreviewChapter,
  writeImportedBook,
} from "./import-service.js";
import {
  appendImportReport,
  countWords,
  createBudget,
  exists,
  findDuplicates,
  inferLanguage,
  jsonResource,
  nextIndexNumber,
  parseBookResource,
  resolveBookId,
  safeProjectPath,
  sanitizeTitle,
  stripMarkdownHeading,
  titleFromFile,
  titleFromMarkdown,
  upsertIndex,
} from "./utils.js";
import type {
  Budget,
  BookSummary,
  ChapterFile,
  ChapterInspection,
  ChapterSnippet,
  ContextBundleInput,
  ContextBundleResult,
  ControlDocName,
  DiagnoseImportResult,
  ExportBookInput,
  ExportBookResult,
  ImportCommitInput,
  ImportCommitResult,
  ImportPreviewInput,
  ImportPreviewResult,
  InkosMcpService,
  InkosMcpServiceOptions,
  InspectBookResult,
  ListBooksResult,
  ProjectStatus,
  RepairProjectIndexResult,
  ResolvedProject,
  UpdateControlDocInput,
  UpdateControlDocResult,
  WriteAgentChapterInput,
  WriteAgentChapterResult,
} from "./types.js";

export function createInkosMcpService(options: InkosMcpServiceOptions = {}): InkosMcpService {
  const cwd = resolve(options.cwd ?? process.cwd());

  return {
    getStarted: () => getStarted(cwd),
    projectStatus: () => projectStatus(cwd),
    listBooks: () => listBooks(cwd),
    inspectBook: (input = {}) => inspectBook(cwd, input),
    importPreview: (input) => importPreview(cwd, input),
    importCommit: (input) => importCommit(cwd, input),
    getContextBundle: (input) => getContextBundle(cwd, input),
    updateControlDoc: (input) => updateControlDoc(cwd, input),
    writeAgentChapter: (input) => writeAgentChapter(cwd, input),
    exportBook: (input) => exportBook(cwd, input),
    diagnoseImport: (input = {}) => diagnoseImport(cwd, input),
    repairProjectIndex: (input = {}) => repairProjectIndex(cwd, input),
    agentCreateBookPlan: async (input) => runAgentCreateBookPlan(await requireProject(cwd), input),
    agentCommitBook: async (input) => runAgentCommitBook(await requireProject(cwd), input),
    agentImportPlan: async (input) => runAgentImportPlan(await requireProject(cwd), input),
    agentContinuePlan: async (input) => runAgentContinuePlan(await requireProject(cwd), input, (contextInput) => getContextBundle(cwd, contextInput)),
    agentCommitChapter: async (input) => runAgentCommitChapter(await requireProject(cwd), input, (chapterInput) => writeAgentChapter(cwd, chapterInput)),
    readResource: (uri) => readResource(cwd, uri),
  };
}

async function getStarted(cwd: string): Promise<Record<string, unknown>> {
  const status = await projectStatus(cwd);
  return {
    summary: status.isInkosProject
      ? `已识别 InkOS 项目：${status.booksCount} 本书。`
      : "当前目录不是 InkOS 项目。",
    mode: "external-agent",
    llmPolicy: "MCP 模式中需要 LLM 的生成、分析、settlement 由外部 agent 工具的 LLM 完成；InkOS MCP 不要求 InkOS LLM API Key，也不读取 .inkos/secrets.json。",
    availableOperations: [
      "Agent 代理创建书籍基础设定",
      "Agent 代理导入并整理 truth/state",
      "Agent 代理续写下一章",
      "Agent 代理提交章节和 truth/state",
      "导入已有小说",
      "继续已有项目",
      "查看项目和书籍列表",
      "查看章节",
      "读取续写上下文",
      "更新作者意图 / 当前焦点 / 项目说明",
      "写入外部 agent 生成的新章节",
      "导出作品",
      "诊断项目问题",
      "修复章节索引",
    ],
    projectStatus: status,
    agentMediatedTools: [
      "inkos_agent_create_book_plan",
      "inkos_agent_commit_book",
      "inkos_agent_import_plan",
      "inkos_agent_continue_plan",
      "inkos_agent_commit_chapter",
    ],
    noLlmTools: [
      "inkos_import_preview",
      "inkos_import_commit",
      "inkos_get_context_bundle",
      "inkos_write_agent_chapter",
      "inkos_repair_project_index",
    ],
    recommendedNextActions: status.recommendedActions,
  };
}

async function projectStatus(cwd: string): Promise<ProjectStatus> {
  const project = await resolveProject(cwd);
  if (!project.isInkosProject) {
    return {
      summary: "未发现 inkos.json；当前目录不是 InkOS 项目。",
      projectRoot: project.projectRoot,
      isInkosProject: false,
      manifestExists: false,
      booksCount: 0,
      books: [],
      problems: [],
      recommendedActions: ["进入已有 InkOS 项目目录，或先用 inkos init 初始化项目。"],
    };
  }

  const books = await collectBookSummaries(project.projectRoot);
  const problems = await collectProjectProblems(project.projectRoot, books);
  return {
    summary: `InkOS 项目 ${project.projectRoot}，检测到 ${books.length} 本书。`,
    projectRoot: project.projectRoot,
    isInkosProject: true,
    manifestExists: true,
    booksCount: books.length,
    books,
    problems,
    recommendedActions: recommendProjectActions(books, problems),
  };
}

async function listBooks(cwd: string): Promise<ListBooksResult> {
  const project = await requireProject(cwd);
  const books = await collectBookSummaries(project.projectRoot);
  return {
    summary: books.length > 0 ? `检测到 ${books.length} 本书。` : "当前项目还没有书籍。",
    projectRoot: project.projectRoot,
    books,
  };
}

async function inspectBook(cwd: string, input: { readonly bookId?: string; readonly maxChars?: number }): Promise<InspectBookResult> {
  const project = await requireProject(cwd);
  const state = new StateManager(project.projectRoot);
  const bookId = await resolveBookId(project.projectRoot, input.bookId);
  const book = await state.loadBookConfig(bookId);
  const index = await state.loadChapterIndex(bookId);
  const files = await chapterFileLookup(state.bookDir(bookId));
  const maxChars = input.maxChars ?? 8_000;
  const snippets = await recentSnippets(state.bookDir(bookId), index, files, 3, maxChars);
  const controlDocs = await controlDocPresence(state.bookDir(bookId));
  const storyStateExists = await exists(join(state.bookDir(bookId), "story", "state"));

  return {
    summary: `《${book.title}》包含 ${index.length} 个已登记章节。`,
    metadata: book,
    chapters: index.map((chapter) => ({
      number: chapter.number,
      title: chapter.title,
      status: chapter.status,
      wordCount: chapter.wordCount,
      file: files.get(chapter.number)?.file,
    })),
    recentChapterSnippets: snippets,
    controlDocs,
    storyStateExists,
    riskHints: buildRiskHints(controlDocs, storyStateExists),
  };
}

async function importPreview(cwd: string, input: ImportPreviewInput): Promise<ImportPreviewResult> {
  const project = await requireProject(cwd);
  const sourcePath = safeProjectPath(project.projectRoot, input.sourcePath);
  const parsed = await parseImportSource(sourcePath, project.projectRoot, input);
  const duplicates = findDuplicates(parsed.chapters.map((chapter) => chapter.title));
  const previewChapters = parsed.chapters.map((chapter, index) => toPreviewChapter(chapter, index + 1));
  const shortChapters = previewChapters.filter((chapter) => chapter.tooShort);
  const ok = previewChapters.length > 0;
  const suggestions = ok
    ? ["确认章节识别结果后调用 inkos_import_commit。"]
    : ["检查章节标题是否独占一行，或传入 splitPattern，例如 ^第\\s*\\d+\\s*章。"];

  return {
    summary: ok ? `识别到 ${previewChapters.length} 个章节。` : "未识别到章节。",
    ok,
    sourcePath,
    sourceKind: parsed.sourceKind,
    chapterCount: previewChapters.length,
    chapters: previewChapters,
    anomalies: [
      ...duplicates.map((title) => `重复章节标题：${title}`),
      ...shortChapters.map((chapter) => `章节过短：${chapter.number} ${chapter.title}`),
    ],
    duplicateTitles: duplicates,
    shortChapters,
    unrecognizedReason: ok ? undefined : "没有匹配到支持的章节标题或目录内没有 .txt/.md 文件。",
    suggestions,
  };
}

async function importCommit(cwd: string, input: ImportCommitInput): Promise<ImportCommitResult> {
  const project = await requireProject(cwd);
  const sourcePath = safeProjectPath(project.projectRoot, input.sourcePath);
  const parsed = await parseImportSource(sourcePath, project.projectRoot, input);
  if (parsed.chapters.length === 0) {
    throw new Error("No chapters recognized. Run inkos_import_preview and adjust splitPattern first.");
  }

  const dryRun = input.dryRun === true;
  const state = new StateManager(project.projectRoot);
  const bookId = await resolveImportBookId(project.projectRoot, input, sourcePath);
  assertSafeBookId(bookId);
  const bookDir = state.bookDir(bookId);
  const existingIndex = input.mode === "new-book" ? [] : await state.loadChapterIndex(bookId);
  const startNumber = input.mode === "append" ? nextIndexNumber(existingIndex) : 1;
  const title = input.title?.trim() || input.bookId?.trim() || basename(sourcePath, extname(sourcePath));
  const modifiedFiles = plannedImportFiles(bookId, parsed.chapters.length, startNumber);
  const totalWords = parsed.chapters.reduce((sum, chapter) => sum + countWords(chapter.content, "zh"), 0);

  if (!dryRun) {
    await writeImportedBook({
      projectRoot: project.projectRoot,
      bookId,
      bookDir,
      title,
      mode: input.mode,
      chapters: parsed.chapters,
      startNumber,
      existingIndex,
      sourcePath,
    });
  }

  return {
    summary: dryRun
      ? `Dry run: 将向 ${bookId} 导入 ${parsed.chapters.length} 章。`
      : `已向 ${bookId} 导入 ${parsed.chapters.length} 章。`,
    dryRun,
    bookId,
    mode: input.mode,
    importedCount: parsed.chapters.length,
    totalWords,
    nextChapter: startNumber + parsed.chapters.length,
    needsAgentSettlement: true,
    modifiedFiles: dryRun ? [] : modifiedFiles,
  };
}

async function getContextBundle(cwd: string, input: ContextBundleInput): Promise<ContextBundleResult> {
  const project = await requireProject(cwd);
  const state = new StateManager(project.projectRoot);
  const bookId = await resolveBookId(project.projectRoot, input.bookId);
  const book = (await collectBookSummaries(project.projectRoot)).find((entry) => entry.bookId === bookId);
  if (!book) throw new Error(`Book "${bookId}" not found.`);

  const bookDir = state.bookDir(bookId);
  const budget = createBudget(input.maxChars ?? 12_000);
  const authorIntent = await takeOptionalFile(budget, join(bookDir, "story", "author_intent.md"));
  const currentFocus = await takeOptionalFile(budget, join(bookDir, "story", "current_focus.md"));
  const recentSummaries = await takeOptionalFile(budget, join(bookDir, "story", "chapter_summaries.md"));
  const pendingHooks = await takeOptionalFile(budget, join(bookDir, "story", "pending_hooks.md"));
  const styleNotes = await takeOptionalFile(budget, join(bookDir, "story", "style_guide.md"));
  const index = await state.loadChapterIndex(bookId);
  const files = await chapterFileLookup(bookDir);
  const recentChapters = await budgetedSnippets(budget, bookDir, index, files, input.chapterWindow ?? 3);
  const characterStateFiles = await budgetedStateFiles(budget, bookDir);

  return {
    summary: `已为 ${input.purpose} 整理上下文，预算 ${budget.used}/${budget.max} 字符。`,
    purpose: input.purpose,
    book,
    author_intent: authorIntent,
    current_focus: currentFocus,
    recentSummaries,
    recentChapters,
    characterStateFiles,
    pendingHooks,
    styleNotes,
    recommendedNextAction: input.purpose === "continue"
      ? "外部 agent 生成下一章后调用 inkos_write_agent_chapter 写回。"
      : "按目的读取精确章节 resource，避免一次加载整本书。",
    instructions: "Use this stable bundle as external agent context. Do not call InkOS internal LLM tools; generate or revise text yourself, then write results back through MCP.",
    budget: { maxChars: budget.max, usedChars: budget.used },
  };
}

async function updateControlDoc(cwd: string, input: UpdateControlDocInput): Promise<UpdateControlDocResult> {
  const project = await requireProject(cwd);
  const state = new StateManager(project.projectRoot);
  const bookId = await resolveBookId(project.projectRoot, input.bookId);
  const storyDir = join(state.bookDir(bookId), "story");
  await mkdir(storyDir, { recursive: true });
  const fileName = input.doc === "notes" ? "notes.md" : `${input.doc}.md`;
  const target = join(storyDir, fileName);
  const relTarget = relative(project.projectRoot, target);
  let backupPath: string | undefined;

  if (await exists(target)) {
    backupPath = join(storyDir, ".mcp-backups", `${fileName}.${Date.now()}.bak`);
    await mkdir(dirname(backupPath), { recursive: true });
    await copyFile(target, backupPath);
  }

  const content = input.append && await exists(target)
    ? `${await readFile(target, "utf-8").then((raw) => raw.trimEnd())}\n\n${input.content.trimEnd()}\n`
    : `${input.content.trimEnd()}\n`;
  await writeFile(target, content, "utf-8");

  return {
    summary: `已更新 ${input.doc}。`,
    bookId,
    doc: input.doc,
    path: target,
    backupPath,
    modifiedFiles: [relTarget, ...(backupPath ? [relative(project.projectRoot, backupPath)] : [])],
  };
}

async function writeAgentChapter(cwd: string, input: WriteAgentChapterInput): Promise<WriteAgentChapterResult> {
  const project = await requireProject(cwd);
  const state = new StateManager(project.projectRoot);
  const bookId = await resolveBookId(project.projectRoot, input.bookId);
  const book = await state.loadBookConfig(bookId);
  const index = await state.loadChapterIndex(bookId);
  const chapterNumber = input.chapterNumber ?? nextIndexNumber(index);
  const title = input.title?.trim() || `第${chapterNumber}章`;
  const status: ChapterStatus = input.approve ? "approved" : "ready-for-review";
  const wordCount = countWords(input.content, (book.language ?? "zh") === "en" ? "en" : "zh");
  const bookDir = state.bookDir(bookId);
  const chaptersDir = join(bookDir, "chapters");
  await mkdir(chaptersDir, { recursive: true });
  const filePath = join(chaptersDir, `${String(chapterNumber).padStart(4, "0")}_${sanitizeTitle(title)}.md`);
  const heading = (book.language ?? "zh") === "en" ? `# Chapter ${chapterNumber}: ${title}` : `# 第${chapterNumber}章 ${title}`;
  await writeFile(filePath, `${heading}\n\n${input.content.trimEnd()}\n`, "utf-8");

  const now = new Date().toISOString();
  const entry: ChapterMeta = {
    number: chapterNumber,
    title,
    status,
    wordCount,
    createdAt: now,
    updatedAt: now,
    auditIssues: [],
    lengthWarnings: [],
    reviewNote: "external-agent generated chapter; needs_settlement=true",
  };
  await state.saveChapterIndex(bookId, upsertIndex(index, entry));
  const reportRel = await appendImportReport(project.projectRoot, bookId, [
    `## External Agent Chapter ${chapterNumber}`,
    "",
    `- title: ${title}`,
    `- status: ${status}`,
    `- summary: ${input.summary ?? "(not provided)"}`,
    `- notes: ${input.notes ?? "(not provided)"}`,
    "- needs_settlement: true",
  ]);

  return {
    summary: `已写入外部 agent 章节 ${chapterNumber}。`,
    bookId,
    chapterNumber,
    title,
    wordCount,
    status,
    needsSettlement: true,
    filePath,
    modifiedFiles: [
      relative(project.projectRoot, filePath),
      `books/${bookId}/chapters/index.json`,
      reportRel,
    ],
  };
}

async function exportBook(cwd: string, input: ExportBookInput): Promise<ExportBookResult> {
  const project = await requireProject(cwd);
  const state = new StateManager(project.projectRoot);
  const bookId = await resolveBookId(project.projectRoot, input.bookId);
  const outputPath = input.outputPath
    ? safeProjectPath(project.projectRoot, input.outputPath)
    : join(project.projectRoot, `${bookId}_export.${input.format}`);
  const result = await writeExportArtifact(state, bookId, {
    format: input.format,
    outputPath,
  });
  return {
    summary: `已导出 ${result.chaptersExported} 章。`,
    bookId,
    format: input.format,
    outputPath: result.outputPath,
    chaptersExported: result.chaptersExported,
    totalWords: result.totalWords,
    modifiedFiles: [relative(project.projectRoot, result.outputPath)],
  };
}

async function diagnoseImport(cwd: string, input: { readonly bookId?: string }): Promise<DiagnoseImportResult> {
  const project = await requireProject(cwd);
  const state = new StateManager(project.projectRoot);
  const bookId = await resolveBookId(project.projectRoot, input.bookId);
  const bookDir = state.bookDir(bookId);
  const index = await state.loadChapterIndex(bookId);
  const files = [...(await chapterFileLookup(bookDir)).values()];
  const indexedNumbers = new Set(index.map((chapter) => chapter.number));
  const fileNumbers = new Set(files.map((file) => file.number));
  const unindexed = files
    .filter((file) => !indexedNumbers.has(file.number))
    .map((file) => ({ chapterNumber: file.number, file: file.file }));
  const missingChapterFiles = index
    .filter((chapter) => !fileNumbers.has(chapter.number))
    .map((chapter) => chapter.number);
  const missingFiles = await requiredBookFiles(bookDir);
  const storyStateExists = await exists(join(bookDir, "story", "state"));
  const importReportExists = await exists(join(bookDir, "story", "import-report.md"));

  return {
    summary: unindexed.length > 0
      ? `发现 ${unindexed.length} 个章节文件未登记。`
      : "未发现章节文件未登记问题。",
    bookId,
    missingFiles,
    indexProblems: missingChapterFiles.map((number) => `index references missing chapter file: ${number}`),
    unindexedChapterFiles: unindexed,
    missingChapterFiles,
    importReportExists,
    storyStateExists,
    autoFixable: unindexed.length > 0 ? ["chapter_index_missing_entries"] : [],
    recommendedTool: unindexed.length > 0 ? "inkos_repair_project_index" : undefined,
  };
}

async function repairProjectIndex(cwd: string, input: { readonly bookId?: string; readonly dryRun?: boolean }): Promise<RepairProjectIndexResult> {
  const project = await requireProject(cwd);
  const dryRun = input.dryRun ?? true;
  const state = new StateManager(project.projectRoot);
  const bookId = await resolveBookId(project.projectRoot, input.bookId);
  const bookDir = state.bookDir(bookId);
  const index = await state.loadChapterIndex(bookId);
  const indexedNumbers = new Set(index.map((chapter) => chapter.number));
  const files = [...(await chapterFileLookup(bookDir)).values()].filter((file) => !indexedNumbers.has(file.number));
  const repaired = await Promise.all(files.map((file) => chapterInspectionFromFile(file)));
  const plannedFiles = repaired.length > 0 ? [`books/${bookId}/chapters/index.json`] : [];

  if (!dryRun && repaired.length > 0) {
    const now = new Date().toISOString();
    const additions: ChapterMeta[] = repaired.map((chapter) => ({
      number: chapter.number,
      title: chapter.title,
      status: "imported",
      wordCount: chapter.wordCount,
      createdAt: now,
      updatedAt: now,
      auditIssues: [],
      lengthWarnings: [],
      reviewNote: "repaired by inkos_repair_project_index; needs_settlement=true",
    }));
    await state.saveChapterIndex(bookId, [...index, ...additions].sort((a, b) => a.number - b.number));
  }

  return {
    summary: dryRun
      ? `Dry run: 将修复 ${repaired.length} 个索引条目。`
      : `已修复 ${repaired.length} 个索引条目。`,
    bookId,
    dryRun,
    repairedEntries: repaired,
    plannedFiles,
    modifiedFiles: dryRun ? [] : plannedFiles,
  };
}

async function readResource(cwd: string, uri: string): Promise<{ readonly mimeType: string; readonly text: string }> {
  const project = await requireProject(cwd);
  if (uri === "inkos://project/manifest") {
    return jsonResource(await readFile(join(project.projectRoot, "inkos.json"), "utf-8"));
  }
  if (uri === "inkos://books") {
    return jsonResource(JSON.stringify(await listBooks(cwd), null, 2));
  }
  const parsed = parseBookResource(uri);
  const state = new StateManager(project.projectRoot);
  const bookId = await resolveBookId(project.projectRoot, parsed.bookId);
  if (parsed.kind === "manifest") {
    return jsonResource(await readFile(join(state.bookDir(bookId), "book.json"), "utf-8"));
  }
  if (parsed.kind === "chapters") {
    return jsonResource(JSON.stringify(await state.loadChapterIndex(bookId), null, 2));
  }
  if (parsed.kind === "context") {
    return jsonResource(JSON.stringify(await getContextBundle(cwd, { bookId, purpose: "continue" }), null, 2));
  }
  const files = await chapterFileLookup(state.bookDir(bookId));
  const file = files.get(parsed.chapterNumber);
  if (!file) throw new Error(`Chapter ${parsed.chapterNumber} not found.`);
  return { mimeType: "text/markdown; charset=utf-8", text: await readFile(file.path, "utf-8") };
}

async function resolveProject(cwd: string): Promise<ResolvedProject> {
  let cursor = resolve(cwd);
  while (true) {
    if (await exists(join(cursor, "inkos.json"))) {
      return { cwd, projectRoot: cursor, isInkosProject: true };
    }
    const parent = dirname(cursor);
    if (parent === cursor) {
      return { cwd, projectRoot: cwd, isInkosProject: false };
    }
    cursor = parent;
  }
}

async function requireProject(cwd: string): Promise<ResolvedProject> {
  const project = await resolveProject(cwd);
  if (!project.isInkosProject) {
    throw new Error(`No inkos.json found from ${cwd}. Start inkos-mcp inside an InkOS project.`);
  }
  return project;
}

async function collectBookSummaries(projectRoot: string): Promise<ReadonlyArray<BookSummary>> {
  const state = new StateManager(projectRoot);
  const bookIds = await state.listBooks();
  const books = await Promise.all(bookIds.map(async (bookId) => {
    const book = await state.loadBookConfig(bookId);
    const index = await state.loadChapterIndex(bookId);
    return {
      bookId,
      title: book.title,
      genre: book.genre,
      language: book.language,
      chapterCount: index.length,
      lastChapterNumber: index.reduce((max, chapter) => Math.max(max, chapter.number), 0),
      approximateWordCount: index.reduce((sum, chapter) => sum + chapter.wordCount, 0),
      status: book.status,
    };
  }));
  return books.sort((a, b) => a.bookId.localeCompare(b.bookId, "zh-Hans-CN"));
}

async function collectProjectProblems(projectRoot: string, books: ReadonlyArray<BookSummary>): Promise<ReadonlyArray<string>> {
  const state = new StateManager(projectRoot);
  const problems: string[] = [];
  for (const book of books) {
    const diagnosis = await diagnoseBook(state, book.bookId);
    problems.push(...diagnosis.map((problem) => `${book.bookId}: ${problem}`));
  }
  return problems;
}

async function diagnoseBook(state: StateManager, bookId: string): Promise<ReadonlyArray<string>> {
  const bookDir = state.bookDir(bookId);
  const missing = await requiredBookFiles(bookDir);
  const files = await chapterFileLookup(bookDir);
  const index = await state.loadChapterIndex(bookId);
  const indexed = new Set(index.map((chapter) => chapter.number));
  return [
    ...missing.map((file) => `missing ${file}`),
    ...[...files.values()]
      .filter((file) => !indexed.has(file.number))
      .map((file) => `chapter file not indexed ${file.file}`),
  ];
}

async function requiredBookFiles(bookDir: string): Promise<ReadonlyArray<string>> {
  const required = [
    "book.json",
    "chapters/index.json",
    "story/author_intent.md",
    "story/current_focus.md",
  ];
  const missing: string[] = [];
  for (const rel of required) {
    if (!await exists(join(bookDir, rel))) missing.push(rel);
  }
  return missing;
}

function recommendProjectActions(books: ReadonlyArray<BookSummary>, problems: ReadonlyArray<string>): ReadonlyArray<string> {
  if (problems.length > 0) return ["先调用 inkos_diagnose_import，再按建议调用 inkos_repair_project_index。"];
  if (books.length === 0) return ["调用 inkos_import_preview / inkos_import_commit 导入已有小说，或在 Studio/CLI 新建书籍。"];
  return ["调用 inkos_list_books 查看书籍，或调用 inkos_get_context_bundle 准备续写。"];
}

async function resolveImportBookId(projectRoot: string, input: ImportCommitInput, sourcePath: string): Promise<string> {
  if (input.mode === "new-book") {
    return input.bookId ?? (deriveBookIdFromTitle(input.title ?? basename(sourcePath, extname(sourcePath))) || `book-${Date.now().toString(36)}`);
  }
  return resolveBookId(projectRoot, input.bookId);
}

async function chapterFileLookup(bookDir: string): Promise<ReadonlyMap<number, ChapterFile>> {
  const chaptersDir = join(bookDir, "chapters");
  const files = await readdir(chaptersDir).catch(() => [] as string[]);
  const lookup = new Map<number, ChapterFile>();
  for (const file of files) {
    const match = file.match(/^(\d{4})_.*\.md$/);
    if (!match) continue;
    const number = Number.parseInt(match[1]!, 10);
    lookup.set(number, { number, file, path: join(chaptersDir, file) });
  }
  return lookup;
}

async function recentSnippets(
  bookDir: string,
  index: ReadonlyArray<ChapterMeta>,
  files: ReadonlyMap<number, ChapterFile>,
  window: number,
  maxChars: number,
): Promise<ReadonlyArray<ChapterSnippet>> {
  const budget = createBudget(maxChars);
  return budgetedSnippets(budget, bookDir, index, files, window);
}

async function budgetedSnippets(
  budget: Budget,
  _bookDir: string,
  index: ReadonlyArray<ChapterMeta>,
  files: ReadonlyMap<number, ChapterFile>,
  window: number,
): Promise<ReadonlyArray<ChapterSnippet>> {
  const chapters = [...index].sort((a, b) => a.number - b.number).slice(-Math.max(1, window));
  const snippets: ChapterSnippet[] = [];
  for (const chapter of chapters) {
    const file = files.get(chapter.number);
    if (!file || budget.remaining <= 0) continue;
    const raw = await readFile(file.path, "utf-8");
    const slice = budget.take(raw, Math.min(700, Math.floor(budget.remaining / 2) || budget.remaining));
    if (!slice) continue;
    snippets.push({
      number: chapter.number,
      title: chapter.title,
      head: slice,
      tail: raw.length > slice.length && budget.remaining > 0 ? budget.take(raw.slice(-300), 300) : "",
    });
  }
  return snippets;
}

async function budgetedStateFiles(
  budget: Budget,
  bookDir: string,
): Promise<ReadonlyArray<{ readonly path: string; readonly excerpt: string }>> {
  const stateDir = join(bookDir, "story", "state");
  const files = await readdir(stateDir).catch(() => [] as string[]);
  const result: Array<{ path: string; excerpt: string }> = [];
  for (const file of files.filter((entry) => entry.endsWith(".json") || entry.endsWith(".md")).sort()) {
    if (budget.remaining <= 0) break;
    const fullPath = join(stateDir, file);
    const excerpt = budget.take(await readFile(fullPath, "utf-8"), Math.min(500, budget.remaining));
    if (excerpt) result.push({ path: `story/state/${file}`, excerpt });
  }
  return result;
}

async function takeOptionalFile(budget: Budget, path: string): Promise<string | undefined> {
  if (!await exists(path) || budget.remaining <= 0) return undefined;
  return budget.take(await readFile(path, "utf-8"), Math.min(1_000, budget.remaining));
}

async function chapterInspectionFromFile(file: ChapterFile): Promise<ChapterInspection> {
  const raw = await readFile(file.path, "utf-8");
  return {
    number: file.number,
    title: titleFromMarkdown(raw) || titleFromFile(file.file),
    status: "imported",
    wordCount: countWords(stripMarkdownHeading(raw), inferLanguage(raw)),
    file: file.file,
  };
}

async function controlDocPresence(bookDir: string): Promise<Record<ControlDocName, boolean>> {
  return {
    author_intent: await exists(join(bookDir, "story", "author_intent.md")),
    current_focus: await exists(join(bookDir, "story", "current_focus.md")),
    notes: await exists(join(bookDir, "story", "notes.md")),
  };
}

function buildRiskHints(controlDocs: Record<ControlDocName, boolean>, storyStateExists: boolean): ReadonlyArray<string> {
  const hints = ["deterministic_import_needs_agent_settlement"];
  if (!controlDocs.author_intent) hints.push("missing_author_intent");
  if (!controlDocs.current_focus) hints.push("missing_current_focus");
  if (!storyStateExists) hints.push("missing_structured_story_state");
  return hints;
}
