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
const createAndPersistBookSessionMock = vi.fn();
const loadBookSessionMock = vi.fn();
const persistBookSessionMock = vi.fn();
const appendBookSessionMessageMock = vi.fn();
const renameBookSessionMock = vi.fn();
const deleteBookSessionMock = vi.fn();
const migrateBookSessionMock = vi.fn();
const resolveServiceModelMock = vi.fn();
const loadSecretsMock = vi.fn();
const saveSecretsMock = vi.fn();
const getServiceApiKeyMock = vi.fn();
type ServicePresetMock = {
  providerFamily: "openai" | "anthropic";
  baseUrl: string;
  modelsBaseUrl?: string;
  knownModels: string[];
};
const SERVICE_PRESETS_MOCK: Record<string, ServicePresetMock> = {
  openai: { providerFamily: "openai", baseUrl: "https://api.openai.com/v1", modelsBaseUrl: "https://api.openai.com/v1", knownModels: [] as string[] },
  anthropic: { providerFamily: "anthropic", baseUrl: "https://api.anthropic.com", modelsBaseUrl: "https://api.anthropic.com", knownModels: [] as string[] },
  minimax: { providerFamily: "anthropic", baseUrl: "https://api.minimaxi.com/anthropic", modelsBaseUrl: "https://api.minimaxi.com/anthropic", knownModels: [] as string[] },
  bailian: { providerFamily: "anthropic", baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic", modelsBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", knownModels: [] as string[] },
  custom: { providerFamily: "openai", baseUrl: "", knownModels: [] as string[] },
};
const resolveServicePresetMock = vi.fn((service: string) => SERVICE_PRESETS_MOCK[service]);
const resolveServiceProviderFamilyMock = vi.fn((service: string) => resolveServicePresetMock(service)?.providerFamily);
const resolveServiceModelsBaseUrlMock = vi.fn((service: string) => {
  const preset = SERVICE_PRESETS_MOCK[service];
  return preset?.modelsBaseUrl ?? preset?.baseUrl;
});
const listModelsForServiceMock = vi.fn(async (service: string, apiKey?: string) => {
  const preset = resolveServicePresetMock(service);
  if (!preset || service === "custom") return [];
  if (preset.knownModels.length > 0) {
    return preset.knownModels.map((id) => ({ id, name: id, reasoning: false, contextWindow: 0 }));
  }
  const modelsBaseUrl = resolveServiceModelsBaseUrlMock(service);
  if (!apiKey || !modelsBaseUrl) return [];
  const res = await fetch(`${modelsBaseUrl.replace(/\/$/, "")}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const json = await res.json() as { data?: Array<{ id: string }> };
  return (json.data ?? []).map((model) => ({
    id: model.id,
    name: model.id,
    reasoning: false,
    contextWindow: 0,
  }));
});

const logger = {
  child: () => logger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@actalk/inkos-core", () => {
  class MockSessionAlreadyMigratedError extends Error {
    constructor(message = "Session already migrated") {
      super(message);
      this.name = "SessionAlreadyMigratedError";
    }
  }

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
    buildAgentSystemPrompt: vi.fn(() => "You are helpful."),
    createAndPersistBookSession: createAndPersistBookSessionMock,
    loadBookSession: loadBookSessionMock,
    persistBookSession: persistBookSessionMock,
    appendBookSessionMessage: appendBookSessionMessageMock,
    renameBookSession: renameBookSessionMock,
    deleteBookSession: deleteBookSessionMock,
    migrateBookSession: migrateBookSessionMock,
    SessionAlreadyMigratedError: MockSessionAlreadyMigratedError,
    resolveServicePreset: resolveServicePresetMock,
    resolveServiceProviderFamily: resolveServiceProviderFamilyMock,
    resolveServiceModelsBaseUrl: resolveServiceModelsBaseUrlMock,
    resolveServiceModel: resolveServiceModelMock,
    loadSecrets: loadSecretsMock,
    saveSecrets: saveSecretsMock,
    getServiceApiKey: getServiceApiKeyMock,
    listModelsForService: listModelsForServiceMock,
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
    createAndPersistBookSessionMock.mockReset();
    loadBookSessionMock.mockReset();
    persistBookSessionMock.mockReset();
    appendBookSessionMessageMock.mockReset();
    renameBookSessionMock.mockReset();
    deleteBookSessionMock.mockReset();
    migrateBookSessionMock.mockReset();
    resolveServiceModelMock.mockReset();
    loadSecretsMock.mockReset();
    saveSecretsMock.mockReset();
    getServiceApiKeyMock.mockReset();
    resolveServicePresetMock.mockClear();
    resolveServiceProviderFamilyMock.mockClear();
    resolveServiceModelsBaseUrlMock.mockClear();
    listModelsForServiceMock.mockClear();
    // Default BookSession for agent tests
    const defaultBookSession = {
      sessionId: "agent-session-1",
      bookId: "demo-book",
      title: null,
      messages: [],
      events: [],
      draftRounds: [],
      createdAt: 1,
      updatedAt: 1,
    };
    createAndPersistBookSessionMock.mockResolvedValue(defaultBookSession);
    loadBookSessionMock.mockResolvedValue(defaultBookSession);
    persistBookSessionMock.mockResolvedValue(undefined);
    appendBookSessionMessageMock.mockImplementation(
      (session: unknown, _msg: unknown) => session,
    );
    renameBookSessionMock.mockResolvedValue(null);
    deleteBookSessionMock.mockResolvedValue(undefined);
    migrateBookSessionMock.mockImplementation(async (_root: string, _sessionId: string, bookId: string) => ({
      ...defaultBookSession,
      bookId,
    }));
    runAgentSessionMock.mockResolvedValue({
      responseText: "Agent response.",
      messages: [],
    });
    loadSecretsMock.mockResolvedValue({ services: {} });
    saveSecretsMock.mockResolvedValue(undefined);
    getServiceApiKeyMock.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(join(tmpdir(), "inkos-global.env"), { force: true });
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

    // Stub /models so probe doesn't hit the real OpenAI endpoint and short-circuit on 401.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Not Found",
    });
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

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
      expect.objectContaining({ maxTokens: expect.any(Number) }),
    );
  });

  it("auto-falls back to a non-stream probe in doctor checks when the first transport returns empty", async () => {
    const freshConfig = {
      ...cloneProjectConfig(),
      llm: {
        ...cloneProjectConfig().llm,
        model: "claude-sonnet-4-6",
        baseUrl: "https://timesniper.club",
        stream: true,
        apiFormat: "chat",
      },
    };
    loadProjectConfigMock.mockResolvedValue(freshConfig);
    // Stub /models so probe doesn't hit the real OpenAI endpoint and short-circuit on 401.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Not Found",
    });
    vi.stubGlobal("fetch", fetchMock as typeof fetch);
    createLLMClientMock.mockImplementation(((cfg: unknown) => cfg) as any);
    chatCompletionMock.mockImplementation(async (client: any) => {
      if (client.stream === false) {
        return {
          content: "pong",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }
      throw new Error("LLM returned empty response from stream");
    });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(freshConfig as never, root);

    const response = await app.request("http://localhost/api/v1/doctor");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      llmConnected: true,
    });
    expect(createLLMClientMock).toHaveBeenCalledWith(expect.objectContaining({
      stream: true,
      apiFormat: "chat",
    }));
    expect(createLLMClientMock).toHaveBeenCalledWith(expect.objectContaining({
      stream: false,
      apiFormat: "chat",
    }));
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

  it("merges service config patches instead of overwriting existing services", async () => {
    await writeFile(join(root, "inkos.json"), JSON.stringify({
      ...projectConfig,
      llm: {
        services: [
          { service: "moonshot", temperature: 1, maxTokens: 4096, apiFormat: "chat", stream: true },
          { service: "custom", name: "内网GPT", baseUrl: "https://llm.internal.corp/v1", temperature: 0.9, apiFormat: "responses", stream: false },
        ],
        defaultModel: "kimi-k2.5",
      },
    }, null, 2), "utf-8");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const save = await app.request("http://localhost/api/v1/services/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        services: {
          moonshot: {
            temperature: 0.5,
            maxTokens: 2048,
            apiFormat: "responses",
            stream: false,
          },
        },
      }),
    });

    expect(save.status).toBe(200);

    const raw = JSON.parse(await readFile(join(root, "inkos.json"), "utf-8"));
    expect(raw.llm.services).toEqual([
      { service: "moonshot", temperature: 0.5, maxTokens: 2048, apiFormat: "responses", stream: false },
      { service: "custom", name: "内网GPT", baseUrl: "https://llm.internal.corp/v1", temperature: 0.9, apiFormat: "responses", stream: false },
    ]);
  });

  it("reports config source and detected env overrides for Studio switching", async () => {
    await writeFile(join(root, ".env"), [
      "INKOS_LLM_PROVIDER=openai",
      "INKOS_LLM_BASE_URL=https://project.example.com/v1",
      "INKOS_LLM_MODEL=gpt-5.4",
      "INKOS_LLM_API_KEY=sk-project",
    ].join("\n"), "utf-8");
    await writeFile(join(tmpdir(), "inkos-global.env"), [
      "INKOS_LLM_PROVIDER=openai",
      "INKOS_LLM_BASE_URL=https://global.example.com/v1",
      "INKOS_LLM_MODEL=gpt-4o",
      "INKOS_LLM_API_KEY=sk-global",
    ].join("\n"), "utf-8");
    await writeFile(join(root, "inkos.json"), JSON.stringify({
      ...projectConfig,
      llm: {
        ...projectConfig.llm,
        configSource: "env",
      },
    }, null, 2), "utf-8");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/services/config");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      configSource: "env",
      envConfig: {
        effectiveSource: "project",
        project: {
          detected: true,
          baseUrl: "https://project.example.com/v1",
          model: "gpt-5.4",
          hasApiKey: true,
        },
        global: {
          detected: true,
          baseUrl: "https://global.example.com/v1",
          model: "gpt-4o",
          hasApiKey: true,
        },
      },
    });
  });

  it("allows switching config source without overwriting services", async () => {
    await writeFile(join(root, "inkos.json"), JSON.stringify({
      ...projectConfig,
      llm: {
        services: [
          { service: "moonshot", temperature: 1, maxTokens: 4096 },
        ],
        defaultModel: "kimi-k2.5",
        configSource: "env",
      },
    }, null, 2), "utf-8");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const save = await app.request("http://localhost/api/v1/services/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ configSource: "studio" }),
    });

    expect(save.status).toBe(200);

    const raw = JSON.parse(await readFile(join(root, "inkos.json"), "utf-8"));
    expect(raw.llm.configSource).toBe("studio");
    expect(raw.llm.services).toEqual([
      { service: "moonshot", temperature: 1, maxTokens: 4096 },
    ]);
    expect(raw.llm.defaultModel).toBe("kimi-k2.5");
  });

  it("tests and lists models for custom services using baseUrl and stored config", async () => {
    await writeFile(join(root, "inkos.json"), JSON.stringify({
      ...projectConfig,
      llm: {
        services: [
          { service: "custom", name: "内网GPT", baseUrl: "https://llm.internal.corp/v1" },
        ],
        defaultModel: "corp-chat",
      },
    }, null, 2), "utf-8");
    loadSecretsMock.mockResolvedValue({
      services: {
        "custom:内网GPT": { apiKey: "sk-corp" },
      },
    });
    getServiceApiKeyMock.mockResolvedValue("sk-corp");

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: "corp-chat" }] }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: "corp-chat" }] }),
      });
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const testResponse = await app.request("http://localhost/api/v1/services/custom%3A%E5%86%85%E7%BD%91GPT/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-corp", baseUrl: "https://llm.internal.corp/v1" }),
    });
    expect(testResponse.status).toBe(200);
    await expect(testResponse.json()).resolves.toMatchObject({
      ok: true,
      models: [{ id: "corp-chat", name: "corp-chat" }],
    });

    const modelsResponse = await app.request("http://localhost/api/v1/services/custom%3A%E5%86%85%E7%BD%91GPT/models");
    expect(modelsResponse.status).toBe(200);
    await expect(modelsResponse.json()).resolves.toMatchObject({
      models: [{ id: "corp-chat", name: "corp-chat" }],
    });
  });

  it("auto-detects a working custom combination when /models is unavailable", async () => {
    await writeFile(join(root, "inkos.json"), JSON.stringify({
      ...projectConfig,
      llm: {
        configSource: "env",
        services: [
          { service: "custom", name: "MiniMax", baseUrl: "https://api.minimax.com/v1" },
        ],
      },
    }, null, 2), "utf-8");
    await writeFile(join(root, ".env"), [
      "INKOS_LLM_MODEL=MiniMax-M2.7",
      "INKOS_LLM_BASE_URL=https://api.minimax.com/v1",
      "INKOS_LLM_API_KEY=sk-minimax",
    ].join("\n"), "utf-8");

    createLLMClientMock.mockImplementation(((cfg: unknown) => cfg) as any);
    chatCompletionMock.mockImplementation(async (client: any) => {
      if (client.apiFormat === "chat" && client.stream === false) {
        return {
          content: "pong",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }
      throw new Error("LLM returned empty response from stream");
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "404 page not found",
    });
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/services/custom%3AMiniMax/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: "sk-minimax",
        baseUrl: "https://api.minimax.com/v1",
        apiFormat: "chat",
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      selectedModel: "MiniMax-M2.7",
      detected: {
        apiFormat: "chat",
        stream: false,
        modelsSource: "fallback",
      },
      models: [],
    });
  });

  it("falls back to the detected/default model when custom /models is unavailable", async () => {
    await writeFile(join(root, "inkos.json"), JSON.stringify({
      ...projectConfig,
      llm: {
        defaultModel: "MiniMax-M2.7",
        services: [
          { service: "custom", name: "MiniMax", baseUrl: "https://api.minimax.com/v1", apiFormat: "chat", stream: false },
        ],
      },
    }, null, 2), "utf-8");
    getServiceApiKeyMock.mockResolvedValue("sk-minimax");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "404 page not found",
    });
    vi.stubGlobal("fetch", fetchMock as typeof fetch);
    createLLMClientMock.mockImplementation(((cfg: unknown) => cfg) as any);
    chatCompletionMock.mockResolvedValue({
      content: "pong",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/services/custom%3AMiniMax/models");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      models: [],
    });
  });

  it("short-circuits service probe on 401/403 from /models", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });
    vi.stubGlobal("fetch", fetchMock as typeof fetch);
    createLLMClientMock.mockImplementation(((cfg: unknown) => cfg) as any);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/services/openai/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: "sk-invalid",
        apiFormat: "responses",
        stream: false,
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("401"),
    });
    expect(chatCompletionMock).not.toHaveBeenCalled();
  });

  it("uses the MiniMax preset provider family during service probe", async () => {
    await writeFile(join(root, "inkos.json"), JSON.stringify({
      ...projectConfig,
      llm: {
        services: [
          { service: "minimax", apiFormat: "chat", stream: false },
        ],
        defaultModel: "MiniMax-M2.7",
      },
    }, null, 2), "utf-8");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "404 page not found",
    });
    vi.stubGlobal("fetch", fetchMock as typeof fetch);
    createLLMClientMock.mockImplementation(((cfg: unknown) => cfg) as any);
    chatCompletionMock.mockImplementation(async (client: any, model: string) => {
      if (client.provider === "anthropic" && client.baseUrl === "https://api.minimaxi.com/anthropic" && model === "MiniMax-M2.7") {
        return {
          content: "pong",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }
      throw new Error(`unexpected probe route: ${client.provider} ${client.baseUrl} ${model}`);
    });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/services/minimax/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: "sk-minimax",
        apiFormat: "chat",
        stream: false,
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      selectedModel: "MiniMax-M2.7",
      detected: {
        apiFormat: "chat",
        stream: false,
        baseUrl: "https://api.minimaxi.com/anthropic",
      },
    });
  });

  it("uses the preset models baseUrl when listing Bailian models", async () => {
    await writeFile(join(root, "inkos.json"), JSON.stringify({
      ...projectConfig,
      llm: {
        services: [
          { service: "bailian", apiFormat: "chat", stream: false },
        ],
        defaultModel: "qwen-max",
      },
    }, null, 2), "utf-8");
    getServiceApiKeyMock.mockResolvedValue("sk-bailian");

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://dashscope.aliyuncs.com/compatible-mode/v1/models") {
        return {
          ok: true,
          json: async () => ({ data: [{ id: "qwen-max" }] }),
          text: async (): Promise<string> => "",
        };
      }
      return {
        ok: false,
        status: 404,
        text: async () => "404 page not found",
      };
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    createLLMClientMock.mockImplementation(((cfg: unknown) => cfg) as any);
    chatCompletionMock.mockImplementation(async (client: any, model: string) => {
      if (client.provider === "anthropic" && client.baseUrl === "https://dashscope.aliyuncs.com/apps/anthropic" && model === "qwen-max") {
        return {
          content: "pong",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }
      throw new Error(`unexpected bailian route: ${client.provider} ${client.baseUrl} ${model}`);
    });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/services/bailian/models");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      models: [{ id: "qwen-max", name: "qwen-max" }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
      expect.any(Object),
    );
  });

  it("keys cached model lists by baseUrl so custom endpoints do not leak stale results", async () => {
    await writeFile(join(root, "inkos.json"), JSON.stringify({
      ...projectConfig,
      llm: {
        services: [
          { service: "custom", name: "Switcher", baseUrl: "https://a.example.com/v1" },
        ],
      },
    }, null, 2), "utf-8");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://a.example.com/v1/models") {
        return {
          ok: true,
          json: async () => ({ data: [{ id: "model-a" }] }),
          text: async () => "",
        };
      }
      if (url === "https://b.example.com/v1/models") {
        return {
          ok: true,
          json: async () => ({ data: [{ id: "model-b" }] }),
          text: async () => "",
        };
      }
      return {
        ok: false,
        status: 404,
        text: async () => "404 page not found",
      };
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const first = await app.request("http://localhost/api/v1/services/custom%3ASwitcher/models?apiKey=sk-shared-tail");
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      models: [{ id: "model-a", name: "model-a" }],
    });

    await writeFile(join(root, "inkos.json"), JSON.stringify({
      ...projectConfig,
      llm: {
        services: [
          { service: "custom", name: "Switcher", baseUrl: "https://b.example.com/v1" },
        ],
      },
    }, null, 2), "utf-8");

    const second = await app.request("http://localhost/api/v1/services/custom%3ASwitcher/models?apiKey=sk-shared-tail");
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      models: [{ id: "model-b", name: "model-b" }],
    });
  });

  it("returns stored service secret for detail page rehydration", async () => {
    loadSecretsMock.mockResolvedValue({
      services: {
        moonshot: { apiKey: "sk-moon" },
      },
    });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/services/moonshot/secret");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ apiKey: "sk-moon" });
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

  it("creates a fresh book session on POST /api/v1/sessions", async () => {
    createAndPersistBookSessionMock.mockResolvedValueOnce({
      sessionId: "fresh-session",
      bookId: "demo-book",
      title: null,
      messages: [],
      events: [],
      draftRounds: [],
      createdAt: 10,
      updatedAt: 10,
    });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: "demo-book" }),
    });

    expect(response.status).toBe(200);
    expect(createAndPersistBookSessionMock).toHaveBeenCalledWith(root, "demo-book", undefined);
    await expect(response.json()).resolves.toMatchObject({
      session: { sessionId: "fresh-session", bookId: "demo-book", title: null },
    });
  });

  it("renames a session through PUT /api/v1/sessions/:sessionId", async () => {
    renameBookSessionMock.mockResolvedValueOnce({
      sessionId: "agent-session-1",
      bookId: "demo-book",
      title: "新标题",
      messages: [],
      events: [],
      draftRounds: [],
      createdAt: 1,
      updatedAt: 2,
    });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/sessions/agent-session-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "  新标题  " }),
    });

    expect(response.status).toBe(200);
    expect(renameBookSessionMock).toHaveBeenCalledWith(root, "agent-session-1", "新标题");
    await expect(response.json()).resolves.toMatchObject({
      session: { sessionId: "agent-session-1", title: "新标题" },
    });
  });

  it("deletes a session through DELETE /api/v1/sessions/:sessionId", async () => {
    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/sessions/agent-session-1", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(deleteBookSessionMock).toHaveBeenCalledWith(root, "agent-session-1");
    await expect(response.json()).resolves.toEqual({ ok: true });
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
      body: JSON.stringify({ instruction: "continue", activeBookId: "demo-book", sessionId: "agent-session-1" }),
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

  it("allows /api/agent to use explicit service+model when Studio config has no defaultModel", async () => {
    await writeFile(join(root, "inkos.json"), JSON.stringify({
      ...projectConfig,
      llm: {
        configSource: "studio",
        services: [
          { service: "custom", name: "CodexForMe", baseUrl: "https://api-vip.codex-for.me/v1", apiFormat: "responses", stream: false },
        ],
      },
    }, null, 2), "utf-8");
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
    resolveServiceModelMock.mockResolvedValue({
      model: { id: "gpt-5.4", provider: "custom", api: "openai-responses" },
      apiKey: "sk-test",
    });
    runAgentSessionMock.mockResolvedValueOnce({
      responseText: "你好，我在。",
      messages: [
        { role: "user", content: "nihao" },
        { role: "assistant", content: "你好，我在。" },
      ],
    });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instruction: "nihao",
        service: "custom:CodexForMe",
        model: "gpt-5.4",
        sessionId: "agent-session-1",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      response: "你好，我在。",
    });
  });

  it("returns 500 with an error payload when the agent session fails", async () => {
    runAgentSessionMock.mockRejectedValueOnce(new Error("boom"));

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: "continue", activeBookId: "demo-book", sessionId: "agent-session-1" }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AGENT_ERROR",
        message: "boom",
      },
    });
  });

  it("probes the upstream when the agent returns empty text and surfaces the real error", async () => {
    runAgentSessionMock.mockResolvedValueOnce({
      responseText: "",
      messages: [{ role: "user", content: "nihao" }],
    });
    chatCompletionMock.mockRejectedValue(new Error("quota exhausted"));

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: "nihao", activeBookId: "demo-book", sessionId: "agent-session-1" }),
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AGENT_EMPTY_RESPONSE",
        message: "quota exhausted",
      },
      response: "quota exhausted",
    });
  });

  it("falls back to plain chat when the tool-agent returns empty text", async () => {
    runAgentSessionMock.mockResolvedValueOnce({
      responseText: "",
      messages: [{ role: "user", content: "nihao" }],
    });
    chatCompletionMock.mockResolvedValueOnce({
      content: "你好！",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: "nihao", activeBookId: "demo-book", sessionId: "agent-session-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      response: "你好！",
      session: { sessionId: "agent-session-1" },
    });
  });

  it("rejects /api/v1/agent requests without sessionId", async () => {
    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: "continue", activeBookId: "demo-book" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "SESSION_ID_REQUIRED",
        message: "sessionId is required",
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
