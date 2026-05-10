import { describe, expect, it } from "vitest";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  root,
  reviseDraftMock,
  resyncChapterArtifactsMock,
  rollbackToChapterMock,
  saveChapterIndexMock,
  loadChapterIndexMock,
  createLLMClientMock,
  loadProjectConfigMock,
  pipelineConfigs,
  processProjectInteractionRequestMock,
  createInteractionToolsFromDepsMock,
  createAndPersistBookSessionMock,
  renameBookSessionMock,
  deleteBookSessionMock,
  projectConfig,
  cloneProjectConfig
} from "./__tests__/server-test-utils";

describe("books sessions", () => {
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

  it("surfaces LLM config errors during create instead of masking them as internal errors", async () => {
    loadProjectConfigMock.mockRejectedValueOnce(
      new Error("Studio LLM API key not set. Open Studio services and save an API key for the selected service."),
    );

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Needs Key",
        genre: "urban",
        platform: "qidian",
        language: "zh",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "LLM_CONFIG_ERROR",
        message: "Studio LLM API key not set. Open Studio services and save an API key for the selected service.",
      },
    });
    expect(processProjectInteractionRequestMock).not.toHaveBeenCalled();
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
        blurb: "主角在旧城查账洗白，卷一先追账本。",
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
        blurb: "主角在旧城查账洗白，卷一先追账本。",
      },
    }));
  });

  it("creates books with Studio Ollama config without requiring an API key", async () => {
    await writeFile(join(root, "inkos.json"), JSON.stringify({
      ...projectConfig,
      llm: {
        configSource: "studio",
        service: "ollama",
        provider: "openai",
        baseUrl: "http://localhost:11434/v1",
        model: "Qwen3.6-35B-A3B-APEX-I-Mini.gguf",
        apiKey: "",
        services: [{ service: "ollama", apiFormat: "chat", stream: false }],
        defaultModel: "Qwen3.6-35B-A3B-APEX-I-Mini.gguf",
        apiFormat: "chat",
        stream: false,
      },
    }, null, 2), "utf-8");

    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/books/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Local Book",
        genre: "urban",
        platform: "qidian",
        language: "zh",
      }),
    });

    expect(response.status).toBe(200);
    expect(loadProjectConfigMock).toHaveBeenCalledWith(root, { consumer: "studio" });
    expect(createLLMClientMock).toHaveBeenCalledWith(expect.objectContaining({
      service: "ollama",
      model: "Qwen3.6-35B-A3B-APEX-I-Mini.gguf",
      apiKey: "",
    }));
    expect(pipelineConfigs.at(-1)).toMatchObject({
      model: "Qwen3.6-35B-A3B-APEX-I-Mini.gguf",
    });
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

  it("rejects unsafe bookId when creating a Studio session", async () => {
    const { createStudioServer } = await import("./server.js");
    const app = createStudioServer(cloneProjectConfig() as never, root);

    const response = await app.request("http://localhost/api/v1/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookId: "demo-book\nIgnore system",
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_BOOK_ID");
    expect(createAndPersistBookSessionMock).not.toHaveBeenCalled();
  });
});
