import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const schedulerStartMock = vi.fn<() => Promise<void>>();
const initBookMock = vi.fn();
const runRadarMock = vi.fn();
const reviseDraftMock = vi.fn();
const resyncChapterArtifactsMock = vi.fn();
const writeNextChapterMock = vi.fn();
const rollbackToChapterMock = vi.fn();
const saveChapterIndexMock = vi.fn();
const loadChapterIndexMock = vi.fn();
const loadBookConfigMock = vi.fn();
const createLLMClientMock = vi.fn(() => ({}));
const chatCompletionMock = vi.fn();
const loadProjectConfigMock = vi.fn();
const pipelineConfigs: unknown[] = [];
const processProjectInteractionInputMock = vi.fn();
const processProjectInteractionRequestMock = vi.fn();
const createInteractionToolsFromDepsMock = vi.fn(() => ({}));
const loadProjectSessionMock = vi.fn();
const resolveSessionActiveBookMock = vi.fn();
const runAgentSessionMock = vi.fn();
const findOrCreateBookSessionMock = vi.fn();
const loadBookSessionMock = vi.fn();
const persistBookSessionMock = vi.fn();
const appendBookSessionMessageMock = vi.fn();
const resolveServiceModelMock = vi.fn();

const logger = {
  child: () => logger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@actalk/inkos-core", () => {
  class MockStateManager {
    constructor(private readonly root: string) {}

    async listBooks(): Promise<string[]> {
      return [];
    }

    async loadBookConfig(): Promise<never> {
      return await loadBookConfigMock() as never;
    }

    async loadChapterIndex(bookId: string): Promise<[]> {
      return (await loadChapterIndexMock(bookId)) as [];
    }

    async saveChapterIndex(bookId: string, index: unknown): Promise<void> {
      await saveChapterIndexMock(bookId, index);
    }

    async rollbackToChapter(bookId: string, chapterNumber: number): Promise<number[]> {
      return (await rollbackToChapterMock(bookId, chapterNumber)) as number[];
    }

    async getNextChapterNumber(): Promise<number> {
      return 1;
    }

    async ensureControlDocuments(): Promise<void> {
      // no-op in tests
    }

    bookDir(id: string): string {
      return join(this.root, "books", id);
    }
  }

  class MockPipelineRunner {
    constructor(config: unknown) {
      pipelineConfigs.push(config);
    }

    initBook = initBookMock;
    runRadar = runRadarMock;
    reviseDraft = reviseDraftMock;
    resyncChapterArtifacts = resyncChapterArtifactsMock;
    writeNextChapter = writeNextChapterMock;
  }

  class MockScheduler {
    private running = false;

    constructor(_config: unknown) {}

    async start(): Promise<void> {
      this.running = true;
      await schedulerStartMock();
    }

    stop(): void {
      this.running = false;
    }

    get isRunning(): boolean {
      return this.running;
    }
  }

  return {
    StateManager: MockStateManager,
    PipelineRunner: MockPipelineRunner,
    Scheduler: MockScheduler,
    createLLMClient: createLLMClientMock,
    createLogger: vi.fn(() => logger),
    computeAnalytics: vi.fn(() => ({})),
    chatCompletion: chatCompletionMock,
    loadProjectConfig: loadProjectConfigMock,
    processProjectInteractionInput: processProjectInteractionInputMock,
    processProjectInteractionRequest: processProjectInteractionRequestMock,
    createInteractionToolsFromDeps: createInteractionToolsFromDepsMock,
    loadProjectSession: loadProjectSessionMock,
    resolveSessionActiveBook: resolveSessionActiveBookMock,
    runAgentSession: runAgentSessionMock,
    findOrCreateBookSession: findOrCreateBookSessionMock,
    loadBookSession: loadBookSessionMock,
    persistBookSession: persistBookSessionMock,
    appendBookSessionMessage: appendBookSessionMessageMock,
    resolveServiceModel: resolveServiceModelMock,
    GLOBAL_ENV_PATH: join(tmpdir(), "inkos-global.env"),
  };
});

const projectConfig = {
  name: "studio-test",
  version: "0.1.0",
  language: "zh",
  llm: {
    provider: "openai",
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    model: "gpt-5.4",
    temperature: 0.7,
    maxTokens: 4096,
    stream: false,
  },
  daemon: {
    schedule: {
      radarCron: "0 */6 * * *",
      writeCron: "*/15 * * * *",
    },
    maxConcurrentBooks: 1,
    chaptersPerCycle: 1,
    retryDelayMs: 30000,
    cooldownAfterChapterMs: 0,
    maxChaptersPerDay: 50,
  },
  modelOverrides: {},
  notify: [],
} as const;

function cloneProjectConfig() {
  return structuredClone(projectConfig);
}

describe("createStudioServer daemon lifecycle", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-studio-server-"));
    await writeFile(join(root, "inkos.json"), JSON.stringify(projectConfig, null, 2), "utf-8");
    schedulerStartMock.mockReset();
    initBookMock.mockReset();
    runRadarMock.mockReset();
    reviseDraftMock.mockReset();
    resyncChapterArtifactsMock.mockReset();
    writeNextChapterMock.mockReset();
    rollbackToChapterMock.mockReset();
    saveChapterIndexMock.mockReset();
    loadChapterIndexMock.mockReset();
    loadBookConfigMock.mockReset();
    await mkdir(join(root, "books", "demo-book", "chapters"), { recursive: true });
    await writeFile(join(root, "books", "demo-book", "chapters", "0003_Demo.md"), "# Demo\n\nBody", "utf-8");
    runRadarMock.mockResolvedValue({
      marketSummary: "Fresh market summary",
      recommendations: [],
    });
    reviseDraftMock.mockResolvedValue({
      chapterNumber: 3,
      wordCount: 1800,
      fixedIssues: ["focus restored"],
      applied: true,
      status: "ready-for-review",
    });
    resyncChapterArtifactsMock.mockResolvedValue({
      chapterNumber: 3,
      title: "Synced Chapter",
      wordCount: 1800,
      revised: false,
      status: "ready-for-review",
      auditResult: { passed: true, issues: [], summary: "synced" },
    });
    writeNextChapterMock.mockResolvedValue({
      chapterNumber: 3,
      title: "Rewritten Chapter",
      wordCount: 1800,
      revised: false,
      status: "ready-for-review",
      auditResult: { passed: true, issues: [], summary: "rewritten" },
    });
    createLLMClientMock.mockReset();
    createLLMClientMock.mockReturnValue({});
    chatCompletionMock.mockReset();
    chatCompletionMock.mockResolvedValue({
      content: "pong",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    loadProjectConfigMock.mockReset();
    processProjectInteractionInputMock.mockReset();
    processProjectInteractionRequestMock.mockReset();
    createInteractionToolsFromDepsMock.mockReset();
    loadProjectSessionMock.mockReset();
    resolveSessionActiveBookMock.mockReset();
    createInteractionToolsFromDepsMock.mockReturnValue({});
    processProjectInteractionRequestMock.mockResolvedValue({
      request: { intent: "create_book" },
      session: {
        sessionId: "session-structured",
        projectRoot: root,
        activeBookId: "new-book",
        automationMode: "semi",
        messages: [],
        events: [],
      },
      details: {
        bookId: "new-book",
        outputPath: join(root, "books", "demo-book", "demo-book.txt"),
        chaptersExported: 2,
      },
    });
    loadProjectSessionMock.mockResolvedValue({
      sessionId: "session-1",
      projectRoot: root,
      automationMode: "semi",
      messages: [],
    });
    resolveSessionActiveBookMock.mockResolvedValue(undefined);
    loadProjectConfigMock.mockImplementation(async () => {
      const raw = JSON.parse(await readFile(join(root, "inkos.json"), "utf-8")) as Record<string, unknown>;
      return {
        ...cloneProjectConfig(),
        ...raw,
        llm: {
          ...cloneProjectConfig().llm,
          ...((raw.llm ?? {}) as Record<string, unknown>),
        },
        daemon: {
          ...cloneProjectConfig().daemon,
          ...((raw.daemon ?? {}) as Record<string, unknown>),
        },
        modelOverrides: (raw.modelOverrides ?? {}) as Record<string, unknown>,
        notify: (raw.notify ?? []) as unknown[],
      };
    });
    loadChapterIndexMock.mockResolvedValue([]);
    loadBookConfigMock.mockResolvedValue({
      id: "demo-book",
      title: "Demo Book",
      platform: "qidian",
      genre: "xuanhuan",
      status: "active",
      targetChapters: 100,
      chapterWordCount: 3000,
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:00:00.000Z",
    });
    saveChapterIndexMock.mockResolvedValue(undefined);
    rollbackToChapterMock.mockResolvedValue([]);
    pipelineConfigs.length = 0;
    runAgentSessionMock.mockReset();
    findOrCreateBookSessionMock.mockReset();
    loadBookSessionMock.mockReset();
    persistBookSessionMock.mockReset();
    appendBookSessionMessageMock.mockReset();
    resolveServiceModelMock.mockReset();
    // Default BookSession for agent tests
    const defaultBookSession = {
      sessionId: "agent-session-1",
      projectRoot: root,
      activeBookId: "demo-book",
      messages: [],
      events: [],
    };
    findOrCreateBookSessionMock.mockResolvedValue(defaultBookSession);
    loadBookSessionMock.mockResolvedValue(null);
    persistBookSessionMock.mockResolvedValue(undefined);
    appendBookSessionMessageMock.mockImplementation(
      (session: unknown, _msg: unknown) => session,
    );
    runAgentSessionMock.mockResolvedValue({
      responseText: "Agent response.",
      messages: [],
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns from /api/daemon/start before the first write cycle finishes", async () => {
    let resolveStart: (() => void) | undefined;
    schedulerStartMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStart = resolve;
        }),
    );

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const responseOrTimeout = await Promise.race([
      app.request("http://localhost/api/v1/daemon/start", { method: "POST" }),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 30)),
    ]);

    expect(responseOrTimeout).not.toBe("timeout");

    const response = responseOrTimeout as Response;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, running: true });

    const status = await app.request("http://localhost/api/v1/daemon");
    await expect(status.json()).resolves.toEqual({ running: true });

    resolveStart?.();
  });

  it("rejects book routes with path traversal ids", async () => {
    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/..%2Fetc%2Fpasswd", {
      method: "GET",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_BOOK_ID",
        message: 'Invalid book ID: "../etc/passwd"',
      },
    });
  });

  it("allows reading and updating fixed control truth files", async () => {
    const bookDir = join(root, "books", "demo-book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });
    await Promise.all([
      writeFile(join(storyDir, "author_intent.md"), "# Author Intent\n\nStay cold.\n", "utf-8"),
      writeFile(join(storyDir, "current_focus.md"), "# Current Focus\n\nReturn to the old case.\n", "utf-8"),
    ]);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const readAuthorIntent = await app.request("http://localhost/api/v1/books/demo-book/truth/author_intent.md");
    expect(readAuthorIntent.status).toBe(200);
    await expect(readAuthorIntent.json()).resolves.toMatchObject({
      file: "author_intent.md",
      content: "# Author Intent\n\nStay cold.\n",
    });

    const updateCurrentFocus = await app.request("http://localhost/api/v1/books/demo-book/truth/current_focus.md", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "# Current Focus\n\nPull focus back to the harbor trail.\n" }),
    });
    expect(updateCurrentFocus.status).toBe(200);

    await expect(readFile(join(storyDir, "current_focus.md"), "utf-8")).resolves.toBe(
      "# Current Focus\n\nPull focus back to the harbor trail.\n",
    );
  });

  it("reflects project edits immediately without restarting the studio server", async () => {
    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const save = await app.request("http://localhost/api/v1/project", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language: "en",
        temperature: 0.2,
        maxTokens: 2048,
        stream: true,
      }),
    });

    expect(save.status).toBe(200);

    const project = await app.request("http://localhost/api/v1/project");
    await expect(project.json()).resolves.toMatchObject({
      language: "en",
      temperature: 0.2,
      maxTokens: 2048,
      stream: true,
    });
  });

  it("reloads latest llm config for doctor checks without restarting the studio server", async () => {
    const startupConfig = {
      ...cloneProjectConfig(),
      llm: {
        ...cloneProjectConfig().llm,
        model: "stale-model",
        baseUrl: "https://stale.example.com/v1",
      },
    };

    const freshConfig = {
      ...cloneProjectConfig(),
      llm: {
        ...cloneProjectConfig().llm,
        model: "fresh-model",
        baseUrl: "https://fresh.example.com/v1",
      },
    };
    loadProjectConfigMock.mockResolvedValue(freshConfig);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(startupConfig as never, root);

    const response = await app.request("http://localhost/api/v1/doctor");

    expect(response.status).toBe(200);
    expect(createLLMClientMock).toHaveBeenCalledWith(expect.objectContaining({
      model: "fresh-model",
      baseUrl: "https://fresh.example.com/v1",
    }));
    expect(chatCompletionMock).toHaveBeenCalledWith(
      expect.anything(),
      "fresh-model",
      expect.any(Array),
      expect.objectContaining({ maxTokens: 5 }),
    );
  });

  it("reloads latest llm config for radar scans without restarting the studio server", async () => {
    const startupConfig = {
      ...cloneProjectConfig(),
      llm: {
        ...cloneProjectConfig().llm,
        model: "stale-model",
        baseUrl: "https://stale.example.com/v1",
      },
    };

    const freshConfig = {
      ...cloneProjectConfig(),
      llm: {
        ...cloneProjectConfig().llm,
        model: "fresh-model",
        baseUrl: "https://fresh.example.com/v1",
      },
    };
    loadProjectConfigMock.mockResolvedValue(freshConfig);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(startupConfig as never, root);

    const response = await app.request("http://localhost/api/v1/radar/scan", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(runRadarMock).toHaveBeenCalledTimes(1);
    expect(pipelineConfigs.at(-1)).toMatchObject({
      model: "fresh-model",
      defaultLLMConfig: expect.objectContaining({
        model: "fresh-model",
        baseUrl: "https://fresh.example.com/v1",
      }),
    });
  });

  it("updates the first-run language immediately after the language selector saves", async () => {
    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const save = await app.request("http://localhost/api/v1/project/language", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "en" }),
    });

    expect(save.status).toBe(200);

    const project = await app.request("http://localhost/api/v1/project");
    await expect(project.json()).resolves.toMatchObject({
      language: "en",
      languageExplicit: true,
    });
  });

  it("rejects create requests when a complete book with the same id already exists", async () => {
    await mkdir(join(root, "books", "existing-book", "story"), { recursive: true });
    await writeFile(join(root, "books", "existing-book", "book.json"), JSON.stringify({ id: "existing-book" }), "utf-8");
    await writeFile(join(root, "books", "existing-book", "story", "story_bible.md"), "# existing", "utf-8");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Existing Book",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
      }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('Book "existing-book" already exists'),
    });
    expect(processProjectInteractionRequestMock).not.toHaveBeenCalled();
    await expect(access(join(root, "books", "existing-book", "story", "story_bible.md"))).resolves.toBeUndefined();
  });

  it("reports async create failures through the create-status endpoint", async () => {
    processProjectInteractionRequestMock.mockRejectedValueOnce(new Error("INKOS_LLM_API_KEY not set"));

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Broken Book",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
      }),
    });

    expect(response.status).toBe(200);
    await Promise.resolve();

    const status = await app.request("http://localhost/api/v1/books/broken-book/create-status");
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      status: "error",
      error: "INKOS_LLM_API_KEY not set",
    });
  });

  it("uses rollback semantics for chapter rejection instead of only flipping status", async () => {
    loadChapterIndexMock.mockResolvedValue([
      {
        number: 3,
        title: "Broken Chapter",
        status: "ready-for-review",
        wordCount: 1800,
        createdAt: "2026-04-07T00:00:00.000Z",
        updatedAt: "2026-04-07T00:00:00.000Z",
        auditIssues: ["continuity"],
        lengthWarnings: [],
      },
      {
        number: 4,
        title: "Downstream Chapter",
        status: "ready-for-review",
        wordCount: 1900,
        createdAt: "2026-04-07T00:00:00.000Z",
        updatedAt: "2026-04-07T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      },
    ]);
    rollbackToChapterMock.mockResolvedValue([3, 4]);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/demo-book/chapters/3/reject", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      chapterNumber: 3,
      status: "rejected",
      rolledBackTo: 2,
      discarded: [3, 4],
    });
    expect(rollbackToChapterMock).toHaveBeenCalledWith("demo-book", 2);
    expect(saveChapterIndexMock).not.toHaveBeenCalled();
  });

  it("routes create requests through the shared structured interaction runtime", async () => {
    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "New Book",
        genre: "urban",
        platform: "qidian",
        language: "zh",
        chapterWordCount: 2600,
        targetChapters: 88,
      }),
    });

    expect(response.status).toBe(200);
    expect(createInteractionToolsFromDepsMock).toHaveBeenCalledTimes(1);
    expect(processProjectInteractionRequestMock).toHaveBeenCalledWith(expect.objectContaining({
      projectRoot: root,
      request: {
        intent: "create_book",
        title: "New Book",
        genre: "urban",
        language: "zh",
        platform: "qidian",
        chapterWordCount: 2600,
        targetChapters: 88,
      },
    }));
  });

  it("passes one-off brief into revise requests through pipeline config", async () => {
    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/demo-book/revise/3", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "rewrite", brief: "把注意力拉回师债主线。" }),
    });

    expect(response.status).toBe(200);
    expect(pipelineConfigs.at(-1)).toMatchObject({ externalContext: "把注意力拉回师债主线。" });
    expect(reviseDraftMock).toHaveBeenCalledWith("demo-book", 3, "rewrite");
  });

  it("exposes a resync endpoint for rebuilding latest chapter truth artifacts", async () => {
    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/demo-book/resync/3", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief: "以师债线为准同步状态。" }),
    });

    expect(response.status).toBe(200);
    expect(pipelineConfigs.at(-1)).toMatchObject({ externalContext: "以师债线为准同步状态。" });
    expect(resyncChapterArtifactsMock).toHaveBeenCalledWith("demo-book", 3);
  });

  it("routes export-save through the shared structured interaction runtime", async () => {
    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/demo-book/export-save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "md", approvedOnly: true }),
    });

    expect(response.status).toBe(200);
    expect(processProjectInteractionRequestMock).toHaveBeenCalledWith(expect.objectContaining({
      projectRoot: root,
      activeBookId: "demo-book",
      request: expect.objectContaining({
        intent: "export_book",
        bookId: "demo-book",
        format: "md",
        approvedOnly: true,
      }),
    }));
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      chapters: 2,
    });
  });

  it("routes /api/agent through runAgentSession and returns response + sessionId", async () => {
    runAgentSessionMock.mockResolvedValueOnce({
      responseText: "Completed write_next for demo-book.",
      messages: [
        { role: "user", content: "continue" },
        { role: "assistant", content: "Completed write_next for demo-book." },
      ],
    });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: "continue", activeBookId: "demo-book" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      response: "Completed write_next for demo-book.",
      session: expect.objectContaining({
        sessionId: "agent-session-1",
      }),
    });
    expect(runAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId: "demo-book",
        projectRoot: root,
      }),
      "continue",
      expect.any(Array),
    );
  });

  it("returns 500 with an error payload when the agent session fails", async () => {
    runAgentSessionMock.mockRejectedValueOnce(new Error("boom"));

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: "continue", activeBookId: "demo-book" }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AGENT_ERROR",
        message: "boom",
      },
    });
  });

  it("returns the shared interaction session state", async () => {
    loadProjectSessionMock.mockResolvedValue({
      sessionId: "session-2",
      projectRoot: root,
      activeBookId: "demo-book",
      automationMode: "auto",
      messages: [
        { role: "user", content: "continue", timestamp: 1 },
      ],
    });
    resolveSessionActiveBookMock.mockResolvedValue("demo-book");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/interaction/session");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      session: expect.objectContaining({
        activeBookId: "demo-book",
        automationMode: "auto",
      }),
      activeBookId: "demo-book",
    });
  });

  it("returns creation-draft state through the shared interaction session endpoint", async () => {
    loadProjectSessionMock.mockResolvedValue({
      sessionId: "session-3",
      projectRoot: root,
      automationMode: "semi",
      creationDraft: {
        concept: "港风商战悬疑，主角从灰产洗白。",
        title: "夜港账本",
        nextQuestion: "你更想写长篇连载，还是十来章能收住？",
        missingFields: ["targetChapters"],
        readyToCreate: false,
      },
      messages: [],
    });
    resolveSessionActiveBookMock.mockResolvedValue(undefined);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/interaction/session");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      session: expect.objectContaining({
        creationDraft: expect.objectContaining({
          title: "夜港账本",
          nextQuestion: "你更想写长篇连载，还是十来章能收住？",
        }),
      }),
    });
  });
});
