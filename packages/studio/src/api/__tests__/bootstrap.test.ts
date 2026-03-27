import { GLOBAL_ENV_PATH } from "@actalk/inkos-core";
import { afterEach, describe, expect, it } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createApp } from "../app.js";

describe("bootstrap and intake APIs", () => {
  const tempRoots: string[] = [];
  let globalEnvBackup: string | null | undefined;
  const envBackup = {
    provider: process.env.INKOS_LLM_PROVIDER,
    baseUrl: process.env.INKOS_LLM_BASE_URL,
    apiKey: process.env.INKOS_LLM_API_KEY,
    model: process.env.INKOS_LLM_MODEL,
  };

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
    if (globalEnvBackup === undefined) {
      return;
    }

    if (globalEnvBackup === null) {
      await unlink(GLOBAL_ENV_PATH).catch(() => undefined);
    } else {
      await mkdir(dirname(GLOBAL_ENV_PATH), { recursive: true });
      await writeFile(GLOBAL_ENV_PATH, globalEnvBackup, "utf-8");
    }
    globalEnvBackup = undefined;
    process.env.INKOS_LLM_PROVIDER = envBackup.provider;
    process.env.INKOS_LLM_BASE_URL = envBackup.baseUrl;
    process.env.INKOS_LLM_API_KEY = envBackup.apiKey;
    process.env.INKOS_LLM_MODEL = envBackup.model;
  });

  async function createProjectRoot(): Promise<string> {
    const projectRoot = await mkdtemp(join(tmpdir(), "inkos-studio-bootstrap-"));
    tempRoots.push(projectRoot);
    return projectRoot;
  }

  async function setGlobalEnv(content: string | null): Promise<void> {
    delete process.env.INKOS_LLM_PROVIDER;
    delete process.env.INKOS_LLM_BASE_URL;
    delete process.env.INKOS_LLM_API_KEY;
    delete process.env.INKOS_LLM_MODEL;

    if (globalEnvBackup === undefined) {
      try {
        globalEnvBackup = await readFile(GLOBAL_ENV_PATH, "utf-8");
      } catch {
        globalEnvBackup = null;
      }
    }

    await mkdir(dirname(GLOBAL_ENV_PATH), { recursive: true });
    if (content === null) {
      await unlink(GLOBAL_ENV_PATH).catch(() => undefined);
      return;
    }

    await writeFile(GLOBAL_ENV_PATH, content, "utf-8");
  }

  it("returns a project-not-initialized bootstrap contract for a fresh root", async () => {
    await setGlobalEnv(null);
    const projectRoot = await createProjectRoot();
    const app = createApp({ projectRoot });

    const response = await app.request("/api/bootstrap/status");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      health: {
        status: "ok",
        projectRoot,
        projectConfigFound: false,
        envFound: false,
        projectEnvFound: false,
        globalConfigFound: false,
        configReady: false,
        bookCount: 0,
        provider: null,
        model: null,
      },
      project: {
        initialized: false,
        name: null,
        bookCount: 0,
        firstBookId: null,
      },
      readiness: {
        ready: false,
        code: "PROJECT_NOT_INITIALIZED",
        title: "Create your local studio project",
        message: "Start by creating a project for this workspace.",
        action: "Create project",
      },
    });
  });

  it("returns a config-not-ready bootstrap status after project scaffolding", async () => {
    await setGlobalEnv(null);

    const projectRoot = await createProjectRoot();
    const app = createApp({ projectRoot });

    const createResponse = await app.request("/api/bootstrap/project", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Studio Test", language: "en" }),
    });

    expect(createResponse.status).toBe(201);

    const statusResponse = await app.request("/api/bootstrap/status");

    expect(statusResponse.status).toBe(200);
    await expect(statusResponse.json()).resolves.toEqual({
      health: {
        status: "ok",
        projectRoot,
        projectConfigFound: true,
        envFound: true,
        projectEnvFound: true,
        globalConfigFound: false,
        configReady: false,
        bookCount: 0,
        provider: expect.any(String),
        model: expect.any(String),
      },
      project: {
        initialized: true,
        name: "Studio Test",
        bookCount: 0,
        firstBookId: null,
      },
      readiness: {
        ready: false,
        code: "CONFIG_NOT_READY",
        title: "Finish model setup",
        message: "Add your model connection details to start generation.",
        action: "Open setup",
      },
    });
  });

  it("treats global env configuration as ready setup", async () => {
    await setGlobalEnv([
      "INKOS_LLM_PROVIDER=openai",
      "INKOS_LLM_BASE_URL=https://example.com/v1",
      "INKOS_LLM_API_KEY=test-key",
      "INKOS_LLM_MODEL=gpt-test",
      "",
    ].join("\n"));

    const projectRoot = await createProjectRoot();
    const app = createApp({ projectRoot });

    const createResponse = await app.request("/api/bootstrap/project", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Global Ready", language: "en" }),
    });

    expect(createResponse.status).toBe(201);

    const statusResponse = await app.request("/api/bootstrap/status");

    expect(statusResponse.status).toBe(200);
    await expect(statusResponse.json()).resolves.toEqual({
      health: {
        status: "ok",
        projectRoot,
        projectConfigFound: true,
        envFound: true,
        projectEnvFound: true,
        globalConfigFound: true,
        configReady: true,
        bookCount: 0,
        provider: "openai",
        model: "gpt-test",
      },
      project: {
        initialized: true,
        name: "Global Ready",
        bookCount: 0,
        firstBookId: null,
      },
      readiness: {
        ready: true,
        code: "READY",
        title: "Studio is ready",
        message: "Your project is ready for the next setup step.",
        action: "Continue",
      },
    });
  });

  it("creates a local project scaffold through the bootstrap API", async () => {
    const projectRoot = await createProjectRoot();
    const app = createApp({ projectRoot });

    const response = await app.request("/api/bootstrap/project", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Factory Local", language: "zh" }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      projectRoot,
      project: {
        initialized: true,
        name: "Factory Local",
        language: "zh",
      },
    });

    await expect(access(join(projectRoot, "inkos.json"))).resolves.toBeUndefined();
    await expect(access(join(projectRoot, ".env"))).resolves.toBeUndefined();
    await expect(access(join(projectRoot, "books"))).resolves.toBeUndefined();
  });

  it("normalizes idea intake and creates a bare first book before factory setup-story runs", async () => {
    await setGlobalEnv([
      "INKOS_LLM_PROVIDER=openai",
      "INKOS_LLM_BASE_URL=https://example.com/v1",
      "INKOS_LLM_API_KEY=test-key",
      "INKOS_LLM_MODEL=gpt-test",
      "",
    ].join("\n"));

    const projectRoot = await createProjectRoot();
    const app = createApp({ projectRoot });

    await app.request("/api/bootstrap/project", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Story Foundry", language: "en" }),
    });

    const intakeResponse = await app.request("/api/imports/idea", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea: "  A city speaks through rain, and only one amnesiac swordsman can hear it.  " }),
    });

    expect(intakeResponse.status).toBe(200);
    const intake = await intakeResponse.json() as {
      type: "idea";
      titleSuggestion: string;
      sourceText: string;
      prompt: string;
    };
    expect(intake).toEqual({
      type: "idea",
      titleSuggestion: "A city speaks through rain",
      sourceText: "A city speaks through rain, and only one amnesiac swordsman can hear it.",
      prompt: "A city speaks through rain, and only one amnesiac swordsman can hear it.",
    });

    const createBookResponse = await app.request("/api/bootstrap/book", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Rain Listener",
        genre: "urban-fantasy",
        platform: "other",
        language: "en",
        intake,
      }),
    });

    expect(createBookResponse.status).toBe(201);
    await expect(createBookResponse.json()).resolves.toEqual({
      book: {
        id: "rain-listener",
        title: "Rain Listener",
        status: "outlining",
        platform: "other",
        genre: "urban-fantasy",
        targetChapters: 12,
        chapters: 0,
        chapterCount: 0,
        lastChapterNumber: 0,
        totalWords: 0,
        approvedChapters: 0,
        pendingReview: 0,
        pendingReviewChapters: 0,
        failedReview: 0,
        failedChapters: 0,
        recentRunStatus: null,
        updatedAt: expect.any(String),
        createdAt: expect.any(String),
        chapterWordCount: 2500,
        language: "en",
      },
      intake,
    });

    await expect(
      readFile(join(projectRoot, "books", "rain-listener", "story", "bootstrap_intake.json"), "utf-8").then((raw) => JSON.parse(raw)),
    ).resolves.toEqual(intake);
    await expect(access(join(projectRoot, "books", "rain-listener", "story", "author_intent.md"))).rejects.toBeTruthy();
  });

  it("normalizes uploaded-file intake with content-backed context", async () => {
    const projectRoot = await createProjectRoot();
    const app = createApp({ projectRoot });

    const response = await app.request("/api/imports/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        files: [
          {
            name: "chapter-outline.md",
            type: "text/markdown",
            size: 1200,
            content: "# Chapter 1 Outline\n\nOpening beat\n- Rain falls\n- The city whispers",
          },
          {
            name: "world-notes.txt",
            type: "text/plain",
            size: 800,
            content: "The city stores memories in rainfall and old station bells.",
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      type: "upload",
      titleSuggestion: "Chapter outline intake",
      sourceText: [
        "[Chapter outline] chapter-outline.md",
        "# Chapter 1 Outline Opening beat - Rain falls - The city whispers",
        "[Research notes] world-notes.txt",
        "The city stores memories in rainfall and old station bells.",
      ].join("\n\n"),
      prompt: expect.stringContaining("Use the uploaded materials as bootstrap context"),
      summary: {
        fileCount: 2,
        totalBytes: 2000,
        totalCharacters: 124,
        fileNames: ["chapter-outline.md", "world-notes.txt"],
        formats: [
          { label: "Markdown", count: 1 },
          { label: "Text", count: 1 },
        ],
        kinds: [
          { label: "Chapter outline", count: 1 },
          { label: "Research notes", count: 1 },
        ],
      },
      files: [
        {
          name: "chapter-outline.md",
          size: 1200,
          type: "text/markdown",
          format: "Markdown",
          kind: "Chapter outline",
          contentLength: 65,
          excerpt: "# Chapter 1 Outline Opening beat - Rain falls - The city whispers",
        },
        {
          name: "world-notes.txt",
          size: 800,
          type: "text/plain",
          format: "Text",
          kind: "Research notes",
          contentLength: 59,
          excerpt: "The city stores memories in rainfall and old station bells.",
        },
      ],
    });
  });

  it("returns a product-readable import-failure response shape", async () => {
    const projectRoot = await createProjectRoot();
    const app = createApp({ projectRoot });

    const response = await app.request("/api/imports/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files: [] }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "IMPORT_FAILED",
        message: "Add at least one file before continuing.",
      },
    });
  });
});
