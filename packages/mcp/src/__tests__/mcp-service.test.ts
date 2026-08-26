import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInkosMcpService } from "../mcp-service.js";

const now = "2026-01-01T00:00:00.000Z";

describe("InkOS MCP external-agent service", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-mcp-test-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reports non-project and project status without writing files", async () => {
    const service = createInkosMcpService({ cwd: root });

    const nonProject = await service.projectStatus();

    expect(nonProject.isInkosProject).toBe(false);
    expect(nonProject.manifestExists).toBe(false);
    expect(nonProject.recommendedActions).toContain("进入已有 InkOS 项目目录，或先用 inkos init 初始化项目。");
    await expect(stat(join(root, "books"))).rejects.toThrow();

    await createProject(root);
    await createBook(root, "river", "河灯", [
      { number: 1, title: "旧港", content: "林月在旧港看见河灯。", status: "imported" },
    ]);

    const project = await service.projectStatus();

    expect(project.isInkosProject).toBe(true);
    expect(project.projectRoot).toBe(root);
    expect(project.booksCount).toBe(1);
    expect(project.books).toEqual([
      expect.objectContaining({ bookId: "river", title: "河灯", chapterCount: 1 }),
    ]);
    expect(project.problems).toEqual([]);
  });

  it("previews a single txt file with Chinese and English chapter headings", async () => {
    await createProject(root);
    const sourcePath = join(root, "novel.txt");
    await writeFile(sourcePath, [
      "第001章 旧港",
      "",
      "林月在旧港看见河灯。",
      "",
      "Chapter 2: Fog",
      "",
      "The fog crossed the bridge.",
    ].join("\n"), "utf-8");
    const service = createInkosMcpService({ cwd: root });

    const preview = await service.importPreview({ sourcePath });

    expect(preview.ok).toBe(true);
    expect(preview.chapterCount).toBe(2);
    expect(preview.chapters.map((chapter) => chapter.title)).toEqual(["旧港", "Fog"]);
    expect(preview.chapters[0]?.wordCount).toBeGreaterThan(0);
    expect(preview.unrecognizedReason).toBeUndefined();
  });

  it("previews a directory of chapter files in natural chapter order", async () => {
    await createProject(root);
    const sourcePath = join(root, "chapters-src");
    await mkdir(sourcePath);
    await writeFile(join(sourcePath, "10_finale.md"), "# 第10章 终局\n\n终局正文。", "utf-8");
    await writeFile(join(sourcePath, "2_middle.txt"), "第2章 中段\n\n中段正文。", "utf-8");
    await writeFile(join(sourcePath, "001_start.txt"), "第一章 开端\n\n开端正文。", "utf-8");
    const service = createInkosMcpService({ cwd: root });

    const preview = await service.importPreview({ sourcePath });

    expect(preview.ok).toBe(true);
    expect(preview.chapters.map((chapter) => chapter.title)).toEqual(["开端", "中段", "终局"]);
    expect(preview.chapters.map((chapter) => chapter.sourceFile)).toEqual([
      "001_start.txt",
      "2_middle.txt",
      "10_finale.md",
    ]);
  });

  it("commits a deterministic no-LLM import that listBooks and inspectBook can read", async () => {
    await createProject(root);
    const sourcePath = join(root, "novel.txt");
    await writeFile(sourcePath, [
      "第1章 旧港",
      "",
      "林月在旧港看见河灯。",
      "",
      "第2章 暗潮",
      "",
      "暗潮从桥底涌来。",
    ].join("\n"), "utf-8");
    const service = createInkosMcpService({ cwd: root });

    const committed = await service.importCommit({
      sourcePath,
      title: "河灯",
      mode: "new-book",
    });

    expect(committed.dryRun).toBe(false);
    expect(committed.importedCount).toBe(2);
    expect(committed.bookId).toBe("河灯");
    expect(committed.modifiedFiles).toEqual(expect.arrayContaining([
      "books/河灯/book.json",
      "books/河灯/chapters/index.json",
      "books/河灯/story/import-report.md",
    ]));

    const listed = await service.listBooks();
    expect(listed.books).toEqual([
      expect.objectContaining({
        bookId: "河灯",
        title: "河灯",
        chapterCount: 2,
        lastChapterNumber: 2,
      }),
    ]);

    const inspected = await service.inspectBook({ bookId: "河灯" });
    expect(inspected.metadata.title).toBe("河灯");
    expect(inspected.chapters.map((chapter) => chapter.title)).toEqual(["旧港", "暗潮"]);
    expect(inspected.controlDocs.author_intent).toBe(true);
    expect(inspected.riskHints).toContain("deterministic_import_needs_agent_settlement");
  });

  it("keeps context bundles within the requested character budget", async () => {
    await createProject(root);
    await createBook(root, "river", "河灯", [
      { number: 1, title: "旧港", content: "一".repeat(200), status: "imported" },
      { number: 2, title: "暗潮", content: "二".repeat(200), status: "imported" },
      { number: 3, title: "桥影", content: "三".repeat(200), status: "imported" },
    ]);
    const service = createInkosMcpService({ cwd: root });

    const bundle = await service.getContextBundle({
      bookId: "river",
      purpose: "continue",
      chapterWindow: 3,
      maxChars: 180,
    });

    expect(bundle.budget.maxChars).toBe(180);
    expect(bundle.budget.usedChars).toBeLessThanOrEqual(180);
    expect(bundle.recentChapters.length).toBeGreaterThan(0);
    expect(bundle.instructions).toContain("external agent");
  });

  it("writes an external-agent chapter and updates the chapter index", async () => {
    await createProject(root);
    await createBook(root, "river", "河灯", [
      { number: 1, title: "旧港", content: "林月在旧港看见河灯。", status: "imported" },
    ]);
    const service = createInkosMcpService({ cwd: root });

    const written = await service.writeAgentChapter({
      bookId: "river",
      title: "新潮",
      content: "新潮推着河灯向城门漂去。",
      summary: "林月发现新的潮水。",
      approve: true,
    });

    expect(written.chapterNumber).toBe(2);
    expect(written.status).toBe("approved");
    expect(written.needsSettlement).toBe(true);
    expect(written.modifiedFiles).toEqual(expect.arrayContaining([
      "books/river/chapters/0002_新潮.md",
      "books/river/chapters/index.json",
      "books/river/story/import-report.md",
    ]));

    const index = JSON.parse(await readFile(join(root, "books", "river", "chapters", "index.json"), "utf-8"));
    expect(index).toEqual(expect.arrayContaining([
      expect.objectContaining({ number: 2, title: "新潮", status: "approved" }),
    ]));
  });

  it("diagnoses and repairs chapter files that exist but are missing from index", async () => {
    await createProject(root);
    await createBook(root, "river", "河灯", [
      { number: 1, title: "旧港", content: "林月在旧港看见河灯。", status: "imported" },
    ]);
    await writeFile(
      join(root, "books", "river", "chapters", "0002_暗潮.md"),
      "# 第2章 暗潮\n\n暗潮从桥底涌来。",
      "utf-8",
    );
    const service = createInkosMcpService({ cwd: root });

    const diagnosis = await service.diagnoseImport({ bookId: "river" });
    expect(diagnosis.unindexedChapterFiles).toEqual([
      expect.objectContaining({ chapterNumber: 2, file: "0002_暗潮.md" }),
    ]);
    expect(diagnosis.recommendedTool).toBe("inkos_repair_project_index");

    const dryRun = await service.repairProjectIndex({ bookId: "river", dryRun: true });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.modifiedFiles).toEqual([]);
    let index = JSON.parse(await readFile(join(root, "books", "river", "chapters", "index.json"), "utf-8"));
    expect(index).toHaveLength(1);

    const repaired = await service.repairProjectIndex({ bookId: "river", dryRun: false });
    expect(repaired.modifiedFiles).toEqual(["books/river/chapters/index.json"]);
    index = JSON.parse(await readFile(join(root, "books", "river", "chapters", "index.json"), "utf-8"));
    expect(index).toEqual(expect.arrayContaining([
      expect.objectContaining({ number: 2, title: "暗潮", status: "imported" }),
    ]));
  });

  it("exports a book through the existing export artifact path", async () => {
    await createProject(root);
    await createBook(root, "river", "河灯", [
      { number: 1, title: "旧港", content: "林月在旧港看见河灯。", status: "approved" },
    ]);
    const service = createInkosMcpService({ cwd: root });

    const exported = await service.exportBook({ bookId: "river", format: "md" });

    expect(exported.format).toBe("md");
    expect(exported.chaptersExported).toBe(1);
    await expect(readFile(exported.outputPath, "utf-8")).resolves.toContain("林月在旧港看见河灯。");
  });

  it("advertises agent-mediated Studio workflows without requiring InkOS LLM config", async () => {
    await createProject(root);
    const service = createInkosMcpService({ cwd: root });

    const started = await service.getStarted();

    expect(started.availableOperations).toEqual(expect.arrayContaining([
      "Agent 代理创建书籍基础设定",
      "Agent 代理导入并整理 truth/state",
      "Agent 代理续写下一章",
    ]));
    expect(started.llmPolicy).toContain("由外部 agent 工具的 LLM 完成");
    expect(started.llmPolicy).not.toContain("需要 InkOS LLM 配置");
  });

  it("prepares and commits an agent-mediated book foundation without InkOS LLM config", async () => {
    await createProject(root);
    const createPipeline = vi.fn();
    const service = createInkosMcpService({
      cwd: root,
      createPipeline,
    });

    const plan = await service.agentCreateBookPlan({
      title: "河灯",
      bookId: "river",
      brief: "水乡悬疑长篇。",
    });

    expect(createPipeline).not.toHaveBeenCalled();
    expect(plan.mode).toBe("agent-mediated");
    expect(plan.requiresInkosLlm).toBe(false);
    expect(plan.agentTask.kind).toBe("create_book_foundation");

    const committed = await service.agentCommitBook({
      title: "河灯",
      bookId: "river",
      foundationFiles: {
        authorIntent: "# 作者意图\n\n写一部水乡悬疑。",
        currentFocus: "# 当前聚焦\n\n第一卷围绕河灯失踪案。",
        storyBible: "# Story Bible\n\n林月是验尸官。",
        currentState: "林月抵达旧港。",
      },
    });

    expect(committed.requiresInkosLlm).toBe(false);
    expect(committed.modifiedFiles).toEqual(expect.arrayContaining([
      "books/river/book.json",
      "books/river/chapters/index.json",
      "books/river/story/author_intent.md",
      "books/river/story/current_focus.md",
      "books/river/story/story_bible.md",
      "books/river/story/state/current_state.md",
    ]));
    const listed = await service.listBooks();
    expect(listed.books).toEqual([
      expect.objectContaining({ bookId: "river", title: "河灯", chapterCount: 0 }),
    ]);
    await expect(readFile(join(root, "books", "river", "story", "story_bible.md"), "utf-8"))
      .resolves.toContain("林月是验尸官");
  });

  it("prepares an agent-mediated import task without creating an InkOS LLM pipeline", async () => {
    await createProject(root);
    await createBook(root, "river", "河灯", []);
    const sourcePath = join(root, "novel.txt");
    await writeFile(sourcePath, "第1章 旧港\n\n林月在旧港看见河灯。", "utf-8");
    const createPipeline = vi.fn();
    const service = createInkosMcpService({
      cwd: root,
      createPipeline,
    });

    const result = await service.agentImportPlan({
      bookId: "river",
      sourcePath,
      importMode: "continuation",
    });

    expect(createPipeline).not.toHaveBeenCalled();
    expect(result.mode).toBe("agent-mediated");
    expect(result.requiresInkosLlm).toBe(false);
    expect(result.agentTask.kind).toBe("import_settlement");
    expect(result.agentTask.instructions).toContain("外部 agent");
    expect(result.chapters).toEqual([{ number: 1, title: "旧港", wordCount: 10, charCount: 10 }]);
  });

  it("prepares agent-mediated continuation context and commits the agent chapter output", async () => {
    await createProject(root);
    await createBook(root, "river", "河灯", [
      { number: 1, title: "旧港", content: "林月在旧港看见河灯。", status: "approved" },
    ]);
    const createPipeline = vi.fn();
    const service = createInkosMcpService({
      cwd: root,
      createPipeline,
    });

    const plan = await service.agentContinuePlan({ bookId: "river", chapterWindow: 1, maxChars: 1200 });
    expect(createPipeline).not.toHaveBeenCalled();
    expect(plan.mode).toBe("agent-mediated");
    expect(plan.agentTask.kind).toBe("continue_chapter");
    expect(plan.nextChapterNumber).toBe(2);

    const committed = await service.agentCommitChapter({
      bookId: "river",
      chapterNumber: 2,
      title: "新潮",
      content: "新潮推着河灯向城门漂去。",
      truthFiles: {
        currentState: "林月追踪河灯，潮水异常。",
        pendingHooks: "- 河灯来源未知。",
      },
      summary: "林月发现新潮。",
    });

    expect(committed.requiresInkosLlm).toBe(false);
    expect(committed.modifiedFiles).toEqual(expect.arrayContaining([
      "books/river/chapters/0002_新潮.md",
      "books/river/chapters/index.json",
      "books/river/story/state/current_state.md",
      "books/river/story/pending_hooks.md",
    ]));
    await expect(readFile(join(root, "books", "river", "story", "state", "current_state.md"), "utf-8"))
      .resolves.toContain("潮水异常");
  });
});

async function createProject(projectRoot: string): Promise<void> {
  await writeFile(join(projectRoot, "inkos.json"), JSON.stringify({
    name: "MCP Test",
    version: "0.1.0",
    language: "zh",
    llm: {
      provider: "custom",
      service: "custom",
      configSource: "studio",
      baseUrl: "https://example.invalid/v1",
      apiKey: "",
      model: "no-llm",
    },
  }, null, 2), "utf-8");
}

async function createBook(
  projectRoot: string,
  bookId: string,
  title: string,
  chapters: ReadonlyArray<{
    readonly number: number;
    readonly title: string;
    readonly content: string;
    readonly status: "imported" | "approved";
  }>,
): Promise<void> {
  const bookDir = join(projectRoot, "books", bookId);
  const chaptersDir = join(bookDir, "chapters");
  const storyDir = join(bookDir, "story");
  await mkdir(chaptersDir, { recursive: true });
  await mkdir(storyDir, { recursive: true });
  await writeFile(join(bookDir, "book.json"), JSON.stringify({
    id: bookId,
    title,
    platform: "other",
    genre: "other",
    status: "active",
    targetChapters: 200,
    chapterWordCount: 3000,
    language: "zh",
    createdAt: now,
    updatedAt: now,
  }, null, 2), "utf-8");
  await writeFile(join(storyDir, "author_intent.md"), "# 作者意图\n\n写一部河灯悬疑。\n", "utf-8");
  await writeFile(join(storyDir, "current_focus.md"), "# 当前聚焦\n\n追踪河灯。\n", "utf-8");
  await writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n- 河灯来源未知。\n", "utf-8");
  await writeFile(join(storyDir, "style_guide.md"), "# Style Notes\n\n克制、悬疑。\n", "utf-8");
  await mkdir(join(storyDir, "state"), { recursive: true });
  await writeFile(join(storyDir, "state", "manifest.json"), JSON.stringify({ version: 1 }, null, 2), "utf-8");
  await writeFile(join(chaptersDir, "index.json"), JSON.stringify(chapters.map((chapter) => ({
    number: chapter.number,
    title: chapter.title,
    status: chapter.status,
    wordCount: chapter.content.length,
    createdAt: now,
    updatedAt: now,
    auditIssues: [],
    lengthWarnings: [],
  })), null, 2), "utf-8");
  for (const chapter of chapters) {
    const file = `${String(chapter.number).padStart(4, "0")}_${chapter.title}.md`;
    await writeFile(join(chaptersDir, file), `# 第${chapter.number}章 ${chapter.title}\n\n${chapter.content}`, "utf-8");
  }
}
