// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import type { StudioApiClient } from "../api/client";
import type { BootstrapBookResult, BootstrapProjectResult, BootstrapStatus, BookDetail, BookSummary, ChapterDetail, ChapterSummary, HealthStatus, NormalizedIdeaIntake, NormalizedUploadIntake, StudioRun } from "../../shared/contracts";

const clientRef: { current: StudioApiClient | null } = { current: null };

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");

  return {
    ...actual,
    createStudioApiClient: vi.fn(() => {
      if (!clientRef.current) {
        throw new Error("Test client not configured.");
      }

      return clientRef.current;
    }),
  };
});

function createHealthStatus(overrides: Partial<HealthStatus> = {}): HealthStatus {
  return {
    status: overrides.status ?? "ok",
    projectRoot: overrides.projectRoot ?? "/project",
    bookCount: overrides.bookCount ?? 0,
    provider: overrides.provider ?? "openai",
    model: overrides.model ?? "gpt-5",
    projectConfigFound: overrides.projectConfigFound ?? true,
    envFound: overrides.envFound ?? true,
    projectEnvFound: overrides.projectEnvFound ?? true,
    globalConfigFound: overrides.globalConfigFound ?? true,
    configReady: overrides.configReady ?? true,
  };
}

function createBookSummary(overrides: Partial<BookSummary> = {}): BookSummary {
  return {
    id: overrides.id ?? "book-1",
    title: overrides.title ?? "Northbound",
    status: overrides.status ?? "draft",
    platform: overrides.platform ?? "web",
    genre: overrides.genre ?? "fantasy",
    targetChapters: overrides.targetChapters ?? 12,
    chapters: overrides.chapters ?? 0,
    chapterCount: overrides.chapterCount ?? 0,
    lastChapterNumber: overrides.lastChapterNumber ?? 0,
    totalWords: overrides.totalWords ?? 0,
    approvedChapters: overrides.approvedChapters ?? 0,
    pendingReview: overrides.pendingReview ?? 0,
    pendingReviewChapters: overrides.pendingReviewChapters ?? 0,
    failedReview: overrides.failedReview ?? 0,
    failedChapters: overrides.failedChapters ?? 0,
    recentRunStatus: overrides.recentRunStatus ?? null,
    updatedAt: overrides.updatedAt ?? "2026-03-27T00:00:00.000Z",
  };
}

function createBookDetail(summary: BookSummary, overrides: Partial<BookDetail> = {}): BookDetail {
  return {
    ...summary,
    createdAt: overrides.createdAt ?? "2026-03-27T00:00:00.000Z",
    chapterWordCount: overrides.chapterWordCount ?? 0,
    language: overrides.language ?? "zh",
  };
}

function createChapterSummary(overrides: Partial<ChapterSummary> = {}): ChapterSummary {
  return {
    number: overrides.number ?? 1,
    title: overrides.title ?? "Opening",
    status: overrides.status ?? "draft",
    wordCount: overrides.wordCount ?? 1200,
    auditIssueCount: overrides.auditIssueCount ?? 0,
    updatedAt: overrides.updatedAt ?? "2026-03-27T00:00:00.000Z",
    fileName: overrides.fileName ?? "0001_opening.md",
  };
}

function createChapterDetail(summary: ChapterSummary): ChapterDetail {
  return {
    ...summary,
    auditIssues: [],
    content: `# ${summary.title}`,
  };
}

function createRun(overrides: Partial<StudioRun> = {}): StudioRun {
  return {
    id: overrides.id ?? "run-1",
    bookId: overrides.bookId ?? "book-1",
    chapter: overrides.chapter ?? null,
    chapterNumber: overrides.chapterNumber ?? null,
    action: overrides.action ?? "draft",
    status: overrides.status ?? "queued",
    stage: overrides.stage ?? "Queued",
    createdAt: overrides.createdAt ?? "2026-03-27T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-27T00:00:00.000Z",
    startedAt: overrides.startedAt ?? null,
    finishedAt: overrides.finishedAt ?? null,
    logs: overrides.logs ?? [],
  };
}

function createBootstrapStatus(overrides: Partial<BootstrapStatus> = {}): BootstrapStatus {
  const health = overrides.health ?? createHealthStatus();
  const readiness = overrides.readiness ?? (
    !health.projectConfigFound
      ? {
          ready: false as const,
          code: "PROJECT_NOT_INITIALIZED" as const,
          title: "Create your local studio project",
          message: "Start by creating a project for this workspace.",
          action: "Create project",
        }
      : health.configReady
        ? {
            ready: true as const,
            code: "READY" as const,
            title: "Studio is ready",
            message: "Your project is ready for the next setup step.",
            action: "Continue",
          }
        : {
            ready: false as const,
            code: "CONFIG_NOT_READY" as const,
            title: "Finish model setup",
            message: "Add your model connection details to start generation.",
            action: "Open setup",
          }
  );

  return {
    health,
    project: overrides.project ?? {
      initialized: true,
      name: "Studio Project",
      bookCount: 0,
      firstBookId: null,
    },
    readiness,
  };
}

function createClient(data: {
  books?: ReadonlyArray<BookSummary>;
  bookDetails?: Record<string, BookDetail>;
  chapters?: Record<string, ReadonlyArray<ChapterSummary>>;
  chapterDetails?: Record<string, Record<number, ChapterDetail>>;
  health?: HealthStatus;
  bootstrapStatus?: BootstrapStatus;
  getBootstrapStatus?: StudioApiClient["getBootstrapStatus"];
    createBootstrapProject?: StudioApiClient["createBootstrapProject"];
    createBootstrapBook?: StudioApiClient["createBootstrapBook"];
    setupStory?: StudioApiClient["setupStory"];
    generateOutline?: StudioApiClient["generateOutline"];
    generateFirstChapter?: StudioApiClient["generateFirstChapter"];
    normalizeIdea?: StudioApiClient["normalizeIdea"];
    summarizeUpload?: StudioApiClient["summarizeUpload"];
}): StudioApiClient {
  return {
    listBooks: async () => data.books ?? [],
    getBook: async (bookId) => data.bookDetails?.[bookId] ?? createBookDetail(createBookSummary({ id: bookId })),
    listChapters: async (bookId) => data.chapters?.[bookId] ?? [],
    getChapter: async (bookId, chapterNumber) => {
      const chapter = data.chapterDetails?.[bookId]?.[chapterNumber];
      if (!chapter) {
        throw new Error(`Missing chapter ${chapterNumber} for ${bookId}`);
      }

      return chapter;
    },
    listTruthFiles: async () => [],
    getTruthFile: async () => {
      throw new Error("not used in this test");
    },
    getHealth: async () => data.health ?? createHealthStatus(),
    getBootstrapStatus: data.getBootstrapStatus ?? (async () => data.bootstrapStatus ?? createBootstrapStatus({ health: data.health ?? createHealthStatus() })),
    createBootstrapProject: data.createBootstrapProject ?? (async (payload) => ({
      projectRoot: "/project",
      project: {
        initialized: true,
        name: payload.name,
        language: payload.language,
      },
    } satisfies BootstrapProjectResult)),
    createBootstrapBook: data.createBootstrapBook ?? (async (payload) => ({
      book: createBookDetail(createBookSummary({
        id: "book-bootstrapped",
        title: payload.title,
        genre: payload.genre,
        platform: payload.platform,
        status: "outlining",
        chapters: 0,
        chapterCount: 0,
        lastChapterNumber: 0,
      }), { language: payload.language, chapterWordCount: payload.chapterWordCount ?? 2500 }),
      intake: payload.intake,
    } satisfies BootstrapBookResult)),
    setupStory: data.setupStory ?? (async (bookId) => ({
      book: data.bookDetails?.[bookId] ?? createBookDetail(createBookSummary({ id: bookId })),
    })),
    generateOutline: data.generateOutline ?? (async () => ({
      bookId: "book-bootstrapped",
      chapterNumber: 1,
      intentPath: "runtime/chapter-1.intent.md",
      goal: "Open the novel.",
      conflicts: [],
    })),
    generateFirstChapter: data.generateFirstChapter ?? (async () => ({
      book: createBookDetail(createBookSummary({
        id: "book-bootstrapped",
        title: "Northbound",
        genre: "fantasy",
        platform: "other",
        status: "draft",
        chapters: 1,
        chapterCount: 1,
        lastChapterNumber: 1,
      })),
      chapter: createChapterDetail(createChapterSummary()),
    })),
    normalizeIdea: data.normalizeIdea ?? (async ({ idea }) => ({
      type: "idea",
      titleSuggestion: idea.trim(),
      sourceText: idea.trim(),
      prompt: idea.trim(),
    })),
    summarizeUpload: data.summarizeUpload ?? (async ({ files }) => ({
      type: "upload",
      titleSuggestion: "Brief intake",
      sourceText: files.map((file) => file.content).join("\n\n"),
      prompt: `Use the uploaded materials as bootstrap context. ${files.length} files imported (${files.reduce((total, file) => total + file.size, 0)} bytes total).`,
      summary: {
        fileCount: files.length,
        totalBytes: files.reduce((total, file) => total + file.size, 0),
        totalCharacters: files.reduce((total, file) => total + file.content.length, 0),
        fileNames: files.map((file) => file.name),
        formats: [
          ...(files.some((file) => file.name.endsWith(".md")) ? [{ label: "Markdown", count: files.filter((file) => file.name.endsWith(".md")).length }] : []),
          ...(files.some((file) => file.name.endsWith(".txt")) ? [{ label: "Text", count: files.filter((file) => file.name.endsWith(".txt")).length }] : []),
        ],
        kinds: [
          ...(files.some((file) => file.name.includes("brief")) ? [{ label: "Brief", count: files.filter((file) => file.name.includes("brief")).length }] : []),
          ...(files.some((file) => file.name.includes("chapter")) ? [{ label: "Draft chapter", count: files.filter((file) => file.name.includes("chapter")).length }] : []),
          ...(files.some((file) => file.name.includes("research")) ? [{ label: "Research notes", count: files.filter((file) => file.name.includes("research")).length }] : []),
        ],
      },
      files: files.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type ?? "",
        format: file.name.endsWith(".txt") ? "Text" : "Markdown",
        kind: file.name.includes("brief") ? "Brief" : file.name.includes("chapter") ? "Draft chapter" : file.name.includes("research") ? "Research notes" : "Other",
        contentLength: file.content.length,
        excerpt: file.content,
      })),
    })),
    saveChapter: async (bookId, chapterNumber) => data.chapterDetails?.[bookId]?.[chapterNumber] ?? createChapterDetail(createChapterSummary()),
    approveReview: async (bookId, payload) => data.chapterDetails?.[bookId]?.[payload.chapterNumber] ?? createChapterDetail(createChapterSummary()),
    rejectReview: async (bookId, payload) => data.chapterDetails?.[bookId]?.[payload.chapterNumber] ?? createChapterDetail(createChapterSummary()),
    createRun: async (bookId) => createRun({ bookId }),
    listRuns: async () => [],
  };
}

async function renderApp(client: StudioApiClient) {
  clientRef.current = client;
  render(<App />);

  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "AI Novel Factory" })).toBeTruthy();
  });
}

afterEach(() => {
  cleanup();
  clientRef.current = null;
  vi.useRealTimers();
});

beforeEach(() => {
  window.localStorage.clear();
});

describe("CreationLauncher", () => {
  it("lets both home entrypoints open the same launcher shell", async () => {
    await renderApp(createClient({}));

    fireEvent.click(screen.getByRole("button", { name: "一句话开始创作" }));

    expect(screen.getByRole("heading", { name: "Creation Launcher" })).toBeTruthy();
    expect(screen.getByLabelText("Genre")).toBeTruthy();
    expect(screen.getByLabelText("Language")).toBeTruthy();
    expect(screen.getByLabelText("One-line idea")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back to home" }));
    fireEvent.click(screen.getByRole("button", { name: "上传资料开始创作" }));

    expect(screen.getByRole("heading", { name: "Creation Launcher" })).toBeTruthy();
    expect(screen.getByLabelText("Genre")).toBeTruthy();
    expect(screen.getByLabelText("Language")).toBeTruthy();
    expect(screen.getByLabelText("Upload files")).toBeTruthy();
  });

  it("bootstraps a real idea-led book before handing off into the writing desk", async () => {
    const normalizeIdea = vi.fn(async ({ idea }: { idea: string }) => ({
      type: "idea" as const,
      titleSuggestion: "Rain city",
      sourceText: idea.trim(),
      prompt: idea.trim(),
    } satisfies NormalizedIdeaIntake));
    const createBootstrapBook = vi.fn(async (payload) => ({
      book: createBookDetail(createBookSummary({
        id: "rain-city",
        title: payload.title,
        genre: payload.genre,
        platform: payload.platform,
        status: "outlining",
        chapters: 0,
        chapterCount: 0,
        lastChapterNumber: 0,
      }), { language: payload.language, chapterWordCount: payload.chapterWordCount ?? 2500 }),
      intake: payload.intake,
    } satisfies BootstrapBookResult));
    const setupStory = vi.fn(async () => ({
      book: createBookDetail(createBookSummary({ id: "rain-city", title: "Rain city" }), { language: "zh" }),
    }));
    const generateOutline = vi.fn(async () => ({
      bookId: "rain-city",
      chapterNumber: 1,
      intentPath: "runtime/chapter-1.intent.md",
      goal: "Open in the rain.",
      conflicts: [],
    }));
    const chapterSummary = createChapterSummary({ number: 1, title: "Rain listens" });
    const chapterDetail = createChapterDetail(chapterSummary);
    const generateFirstChapter = vi.fn(async () => ({
      book: createBookDetail(createBookSummary({
        id: "rain-city",
        title: "Rain city",
        genre: "fantasy",
        platform: "other",
        status: "ready-for-review",
        chapters: 1,
        chapterCount: 1,
        lastChapterNumber: 1,
      }), { language: "zh" }),
      chapter: chapterDetail,
    }));
    await renderApp(createClient({
      health: createHealthStatus({ provider: "openai", model: "gpt-5" }),
      normalizeIdea,
      createBootstrapBook,
      setupStory,
      generateOutline,
      generateFirstChapter,
      chapters: { "rain-city": [chapterSummary] },
      chapterDetails: { "rain-city": { 1: chapterDetail } },
      bookDetails: {
        "rain-city": createBookDetail(createBookSummary({
          id: "rain-city",
          title: "Rain city",
          genre: "fantasy",
          platform: "other",
          status: "ready-for-review",
          chapters: 1,
          chapterCount: 1,
          lastChapterNumber: 1,
        }), { language: "zh" }),
      },
    }));

    fireEvent.click(screen.getByRole("button", { name: "一句话开始创作" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Genre is required.")).toBeTruthy();
    expect(screen.getByText("Language is required.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Genre"), { target: { value: "fantasy" } });
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "zh" } });
    fireEvent.change(screen.getByLabelText("One-line idea"), { target: { value: "雨夜里，失忆剑客听见一座城在说话。" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(normalizeIdea).toHaveBeenCalledWith({ idea: "雨夜里，失忆剑客听见一座城在说话。" });
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Project setup" })).toBeTruthy();
    });
    expect(screen.getByText("Ready to generate")).toBeTruthy();
    expect(screen.getAllByText("雨夜里，失忆剑客听见一座城在说话。").length).toBeGreaterThan(0);
    expect(screen.getByText("fantasy")).toBeTruthy();
    expect(screen.getByText("zh")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByRole("heading", { name: "Creation Launcher" })).toBeTruthy();
    expect((screen.getByLabelText("Genre") as HTMLSelectElement).value).toBe("fantasy");
    expect((screen.getByLabelText("Language") as HTMLSelectElement).value).toBe("zh");
    expect((screen.getByLabelText("One-line idea") as HTMLTextAreaElement).value).toBe("雨夜里，失忆剑客听见一座城在说话。");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Project setup" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Start generation" }));

    expect(screen.getByRole("heading", { name: "Bootstrap progress" })).toBeTruthy();

    await waitFor(() => {
      expect(generateFirstChapter).toHaveBeenCalledWith("rain-city");
    }, { timeout: 3000 });

    expect(screen.queryByText("Mock factory steps are progressing locally.")).toBeNull();
    expect(screen.queryByText("Preview workspace")).toBeNull();
    expect(screen.queryByText("Launcher preview keeps backend desk actions disabled until bootstrap APIs land.")).toBeNull();
    expect(createBootstrapBook).toHaveBeenCalledWith(expect.objectContaining({
      title: "Rain city",
      genre: "fantasy",
      platform: "other",
      language: "zh",
      intake: {
        type: "idea",
        titleSuggestion: "Rain city",
        sourceText: "雨夜里，失忆剑客听见一座城在说话。",
        prompt: "雨夜里，失忆剑客听见一座城在说话。",
      },
    }));

    await waitFor(() => {
      expect(screen.getAllByText("Chapter path").length).toBeGreaterThan(0);
    });

    expect(screen.getByText("Writing desk")).toBeTruthy();
    expect(setupStory).toHaveBeenCalledWith("rain-city");
    expect(generateOutline).toHaveBeenCalledWith("rain-city", { context: "雨夜里，失忆剑客听见一座城在说话。" });
    expect(generateFirstChapter).toHaveBeenCalledWith("rain-city");

    fireEvent.click(screen.getByRole("button", { name: "Shelf" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /continue rain city/i })).toBeTruthy();
    });
  });

  it("blocks generation when setup is not ready", async () => {
    const summarizeUpload = vi.fn(async ({ files }: { files: ReadonlyArray<{ name: string; size: number; type?: string; content: string }> }) => ({
      type: "upload" as const,
      titleSuggestion: "Brief intake",
      sourceText: files.map((file) => file.content).join("\n\n"),
      prompt: `Use the uploaded materials as bootstrap context. ${files.length} files imported (31 bytes total).`,
      summary: {
        fileCount: 3,
        totalBytes: 31,
        totalCharacters: files.reduce((total, file) => total + file.content.length, 0),
        fileNames: ["brief.md", "chapter1.md", "research.txt"],
        formats: [{ label: "Markdown", count: 2 }, { label: "Text", count: 1 }],
        kinds: [{ label: "Brief", count: 1 }, { label: "Draft chapter", count: 1 }, { label: "Research notes", count: 1 }],
      },
      files: files.map((file) => ({ name: file.name, size: file.size, type: file.type ?? "", format: file.name.endsWith(".txt") ? "Text" : "Markdown", kind: file.name === "brief.md" ? "Brief" : file.name === "chapter1.md" ? "Draft chapter" : "Research notes", contentLength: file.content.length, excerpt: file.content })),
    }));

    await renderApp(
      createClient({
        health: createHealthStatus({
          bookCount: 1,
          projectConfigFound: false,
          projectEnvFound: false,
          globalConfigFound: false,
          envFound: false,
          configReady: false,
        }),
        summarizeUpload,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "上传资料开始创作" }));

    fireEvent.change(screen.getByLabelText("Genre"), { target: { value: "sci-fi" } });
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "en" } });
    fireEvent.change(screen.getByLabelText("Upload files"), {
      target: {
        files: [
          new File(["story brief"], "brief.md", { type: "text/markdown" }),
          new File(["chapter draft"], "chapter1.md", { type: "text/markdown" }),
          new File(["notes"], "research.txt", { type: "text/plain" }),
        ],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Parse uploaded materials and confirm the summary before continuing.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Parse files" }));

    await waitFor(() => {
      expect(summarizeUpload).toHaveBeenCalledWith({
        files: [
          { name: "brief.md", size: 11, type: "text/markdown", content: "story brief" },
          { name: "chapter1.md", size: 13, type: "text/markdown", content: "chapter draft" },
          { name: "research.txt", size: 5, type: "text/plain", content: "notes" },
        ],
      });
    });

    expect(screen.getByText("Parsed input summary")).toBeTruthy();
    expect(screen.getByText("3 files parsed")).toBeTruthy();
    expect(screen.getByText("Markdown x2")).toBeTruthy();
    expect(screen.getByText("Text x1")).toBeTruthy();
    expect(screen.getByText("Brief x1")).toBeTruthy();
    expect(screen.getByText("Draft chapter x1")).toBeTruthy();
    expect(screen.getByText("Research notes x1")).toBeTruthy();
    expect(screen.getByText("Parsed intake confirmation")) .toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Confirm the parsed summary before continuing.")) .toBeTruthy();

    fireEvent.click(screen.getByLabelText("I confirm the parsed summary"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("heading", { name: "Project setup" })).toBeTruthy();
    expect(screen.getByText("Setup needs config attention")).toBeTruthy();
    expect(screen.getByText("Start by creating a project for this workspace.")).toBeTruthy();

    const startGenerationButton = screen.getByRole("button", { name: "Start generation" });
    expect(startGenerationButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(startGenerationButton);
    expect(screen.queryByRole("heading", { name: "Generation progress" })).toBeNull();
  });

  it("treats global env readiness as sufficient for Stage A launcher progression", async () => {
    await renderApp(
      createClient({
        health: createHealthStatus({
          projectConfigFound: true,
          projectEnvFound: false,
          envFound: true,
          configReady: true,
          provider: "openai",
          model: "gpt-5",
        }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "一句话开始创作" }));
    fireEvent.change(screen.getByLabelText("Genre"), { target: { value: "fantasy" } });
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "zh" } });
    fireEvent.change(screen.getByLabelText("One-line idea"), { target: { value: "群星熄灭后，最后一名抄写员开始重写历史。" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Project setup" })).toBeTruthy();
    });
    expect(screen.getByText("Ready to generate")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start generation" }).hasAttribute("disabled")).toBe(false);
  });

  it("creates a project first for a clean workspace, then opens the real desk", async () => {
    const createBootstrapProject = vi.fn(async (payload) => ({
      projectRoot: "/new-project",
      project: { initialized: true, name: payload.name, language: payload.language },
    } satisfies BootstrapProjectResult));
    const createBootstrapBook = vi.fn(async (payload) => ({
      book: createBookDetail(createBookSummary({
        id: "dust-kingdom",
        title: payload.title,
        genre: payload.genre,
        platform: payload.platform,
        status: "outlining",
        chapters: 0,
        chapterCount: 0,
        lastChapterNumber: 0,
      }), { language: payload.language, chapterWordCount: payload.chapterWordCount ?? 2500 }),
      intake: payload.intake,
    } satisfies BootstrapBookResult));
    const chapterSummary = createChapterSummary({ number: 1, title: "False letter" });
    const chapterDetail = createChapterDetail(chapterSummary);
    await renderApp(
      createClient({
        books: [],
        health: createHealthStatus({
          projectRoot: "/new-project",
          bookCount: 0,
          projectConfigFound: false,
          projectEnvFound: false,
          envFound: true,
          configReady: false,
          provider: "openai",
          model: "gpt-5",
        }),
        bootstrapStatus: createBootstrapStatus({
          health: createHealthStatus({
            projectRoot: "/new-project",
            bookCount: 0,
            projectConfigFound: false,
            projectEnvFound: false,
            envFound: true,
            configReady: false,
            provider: "openai",
            model: "gpt-5",
          }),
          project: {
            initialized: false,
            name: null,
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
        }),
        createBootstrapProject,
        createBootstrapBook,
        setupStory: async () => ({
          book: createBookDetail(createBookSummary({ id: "dust-kingdom", title: "废墟之上，新王国从一封伪造来信开始。" }), { language: "zh" }),
        }),
        generateOutline: async () => ({
          bookId: "dust-kingdom",
          chapterNumber: 1,
          intentPath: "runtime/chapter-1.intent.md",
          goal: "Open on the forged letter.",
          conflicts: [],
        }),
        generateFirstChapter: async () => ({
          book: createBookDetail(createBookSummary({
            id: "dust-kingdom",
            title: "废墟之上，新王国从一封伪造来信开始。",
            genre: "fantasy",
            platform: "other",
            status: "ready-for-review",
            chapters: 1,
            chapterCount: 1,
            lastChapterNumber: 1,
          }), { language: "zh" }),
          chapter: chapterDetail,
        }),
        chapters: { "dust-kingdom": [chapterSummary] },
        chapterDetails: { "dust-kingdom": { 1: chapterDetail } },
        bookDetails: {
          "dust-kingdom": createBookDetail(createBookSummary({ id: "dust-kingdom", title: "废墟之上，新王国从一封伪造来信开始。", genre: "fantasy", platform: "other", chapters: 1, chapterCount: 1, lastChapterNumber: 1 }), { language: "zh" }),
        },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "一句话开始创作" }));
    fireEvent.change(screen.getByLabelText("Genre"), { target: { value: "fantasy" } });
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "zh" } });
    fireEvent.change(screen.getByLabelText("One-line idea"), { target: { value: "废墟之上，新王国从一封伪造来信开始。" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Project setup" })).toBeTruthy();
    });
    expect(screen.getByText("Ready to generate")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start generation" }));

    await waitFor(() => {
      expect(screen.getAllByText("Chapter path").length).toBeGreaterThan(0);
    }, { timeout: 3000 });

    expect(createBootstrapProject).toHaveBeenCalledTimes(1);
    expect(createBootstrapBook).toHaveBeenCalledTimes(1);

  });

  it("opens the desk with a recovery message when chapter generation fails after outline setup", async () => {
    const normalizeIdea = vi.fn(async ({ idea }: { idea: string }) => ({
      type: "idea" as const,
      titleSuggestion: "Rain city",
      sourceText: idea.trim(),
      prompt: idea.trim(),
    } satisfies NormalizedIdeaIntake));
    const createBootstrapBook = vi.fn(async (payload) => ({
      book: createBookDetail(createBookSummary({
        id: "rain-city",
        title: payload.title,
        genre: payload.genre,
        platform: payload.platform,
        status: "outlining",
        chapters: 0,
        chapterCount: 0,
        lastChapterNumber: 0,
      }), { language: payload.language, chapterWordCount: payload.chapterWordCount ?? 2500 }),
      intake: payload.intake,
    } satisfies BootstrapBookResult));
    await renderApp(createClient({
      health: createHealthStatus({ provider: "openai", model: "gpt-5" }),
      normalizeIdea,
      createBootstrapBook,
      setupStory: async () => ({
        book: createBookDetail(createBookSummary({ id: "rain-city", title: "Rain city" }), { language: "zh" }),
      }),
      generateOutline: async () => ({
        bookId: "rain-city",
        chapterNumber: 1,
        intentPath: "runtime/chapter-1.intent.md",
        goal: "Open in the rain.",
        conflicts: [],
      }),
      generateFirstChapter: async () => {
        throw new Error("LLM timeout while drafting chapter 1.");
      },
      bookDetails: {
        "rain-city": createBookDetail(createBookSummary({
          id: "rain-city",
          title: "Rain city",
          genre: "fantasy",
          platform: "other",
          status: "outlining",
          chapters: 0,
          chapterCount: 0,
          lastChapterNumber: 0,
        }), { language: "zh" }),
      },
      chapters: { "rain-city": [] },
      chapterDetails: { "rain-city": {} },
    }));

    fireEvent.click(screen.getByRole("button", { name: "一句话开始创作" }));
    fireEvent.change(screen.getByLabelText("Genre"), { target: { value: "fantasy" } });
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "zh" } });
    fireEvent.change(screen.getByLabelText("One-line idea"), { target: { value: "雨夜里，失忆剑客听见一座城在说话。" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Project setup" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Start generation" }));

    await waitFor(() => {
      expect(screen.getByText("Writing desk")).toBeTruthy();
    });

    expect(screen.getByText("Story foundation and outline are ready, but the first chapter could not be generated. Open Runs to retry chapter generation from the desk.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Runs" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Write next" })).toBeTruthy();
  });

  it("keeps partial success in launcher progress when desk handoff fails after bootstrap succeeds", async () => {
    const createBootstrapBook = vi.fn(async (payload) => ({
      book: createBookDetail(createBookSummary({
        id: "handoff-book",
        title: payload.title,
        genre: payload.genre,
        platform: payload.platform,
        status: "outlining",
        chapters: 0,
        chapterCount: 0,
        lastChapterNumber: 0,
      }), { language: payload.language }),
      intake: payload.intake,
    } satisfies BootstrapBookResult));
    const chapterSummary = createChapterSummary({ number: 1, title: "Open gate" });
    const chapterDetail = createChapterDetail(chapterSummary);
    const getBook = vi.fn<StudioApiClient["getBook"]>()
      .mockRejectedValueOnce(new Error("desk handoff failed"))
      .mockResolvedValue(createBookDetail(createBookSummary({
        id: "handoff-book",
        title: "Handoff book",
        genre: "fantasy",
        platform: "other",
        status: "ready-for-review",
        chapters: 1,
        chapterCount: 1,
        lastChapterNumber: 1,
      }), { language: "zh" }));

    const client = createClient({
      health: createHealthStatus({ provider: "openai", model: "gpt-5" }),
      normalizeIdea: async ({ idea }) => ({ type: "idea", titleSuggestion: "Handoff book", sourceText: idea, prompt: idea }),
      createBootstrapBook,
      setupStory: async () => ({
        book: createBookDetail(createBookSummary({ id: "handoff-book", title: "Handoff book" }), { language: "zh" }),
      }),
      generateOutline: async () => ({
        bookId: "handoff-book",
        chapterNumber: 1,
        intentPath: "runtime/chapter-1.intent.md",
        goal: "Open the handoff.",
        conflicts: [],
      }),
      generateFirstChapter: async () => ({
        book: createBookDetail(createBookSummary({
          id: "handoff-book",
          title: "Handoff book",
          genre: "fantasy",
          platform: "other",
          status: "ready-for-review",
          chapters: 1,
          chapterCount: 1,
          lastChapterNumber: 1,
        }), { language: "zh" }),
        chapter: chapterDetail,
      }),
      chapterDetails: { "handoff-book": { 1: chapterDetail } },
      books: [],
      chapters: { "handoff-book": [chapterSummary] },
      bookDetails: { "handoff-book": createBookDetail(createBookSummary({ id: "handoff-book", title: "Handoff book", genre: "fantasy", platform: "other", chapters: 1, chapterCount: 1, lastChapterNumber: 1 }), { language: "zh" }) },
    });
    client.getBook = getBook;
    client.listChapters = async () => [chapterSummary];
    await renderApp(client);

    fireEvent.click(screen.getByRole("button", { name: "一句话开始创作" }));
    fireEvent.change(screen.getByLabelText("Genre"), { target: { value: "fantasy" } });
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "zh" } });
    fireEvent.change(screen.getByLabelText("One-line idea"), { target: { value: "一扇门拒绝被打开。" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Project setup" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Start generation" }));

    await waitFor(() => {
      expect(screen.getByText("Open writing desk failed")).toBeTruthy();
      expect(screen.getByText("Generate first chapter complete")).toBeTruthy();
    });

    expect(screen.getByText("Studio finished bootstrapping the book, but could not open the writing desk automatically. Retry the desk handoff or return to Shelf to reopen the book.")).toBeTruthy();
    expect(screen.getByText("Bootstrapped book: Handoff book")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry writing desk handoff" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry writing desk handoff" }));

    await waitFor(() => {
      expect(screen.getByText("Writing desk")).toBeTruthy();
    });
  });

  it("uses upload normalization API and opens the real desk without preview copy", async () => {
    const summarizeUpload = vi.fn(async ({ files }: { files: ReadonlyArray<{ name: string; size: number; type?: string; content: string }> }) => ({
      type: "upload" as const,
      titleSuggestion: "Brief intake",
      sourceText: files.map((file) => file.content).join("\n\n"),
      prompt: `Use the uploaded materials as bootstrap context. ${files.length} files imported (29 bytes total).`,
      summary: {
        fileCount: 3,
        totalBytes: 29,
        totalCharacters: files.reduce((total, file) => total + file.content.length, 0),
        fileNames: ["brief.md", "chapter1.md", "research.txt"],
        formats: [{ label: "Markdown", count: 2 }, { label: "Text", count: 1 }],
        kinds: [{ label: "Brief", count: 1 }, { label: "Draft chapter", count: 1 }, { label: "Research notes", count: 1 }],
      },
      files: files.map((file) => ({ name: file.name, size: file.size, type: file.type ?? "", format: file.name.endsWith(".txt") ? "Text" : "Markdown", kind: file.name === "brief.md" ? "Brief" : file.name === "chapter1.md" ? "Draft chapter" : "Research notes", contentLength: file.content.length, excerpt: file.content })),
    } satisfies NormalizedUploadIntake));
    const createBootstrapBook = vi.fn(async (payload) => ({
      book: createBookDetail(createBookSummary({
        id: "brief-intake",
        title: payload.title,
        genre: payload.genre,
        platform: payload.platform,
        status: "outlining",
        chapters: 0,
        chapterCount: 0,
        lastChapterNumber: 0,
      }), { language: payload.language, chapterWordCount: payload.chapterWordCount ?? 2500 }),
      intake: payload.intake,
    } satisfies BootstrapBookResult));
    const chapterSummary = createChapterSummary({ number: 1, title: "Imported opening" });
    const chapterDetail = createChapterDetail(chapterSummary);
    await renderApp(createClient({
      health: createHealthStatus({ projectConfigFound: true, projectEnvFound: true, envFound: true, configReady: true }),
      summarizeUpload,
      createBootstrapBook,
      setupStory: async () => ({
        book: createBookDetail(createBookSummary({ id: "brief-intake", title: "Brief intake" }), { language: "en" }),
      }),
      generateOutline: async () => ({
        bookId: "brief-intake",
        chapterNumber: 1,
        intentPath: "runtime/chapter-1.intent.md",
        goal: "Turn the imported pack into chapter one.",
        conflicts: [],
      }),
      generateFirstChapter: async () => ({
        book: createBookDetail(createBookSummary({
          id: "brief-intake",
          title: "Brief intake",
          genre: "sci-fi",
          platform: "other",
          status: "ready-for-review",
          chapters: 1,
          chapterCount: 1,
          lastChapterNumber: 1,
        }), { language: "en" }),
        chapter: chapterDetail,
      }),
      bookDetails: {
        "brief-intake": createBookDetail(createBookSummary({
          id: "brief-intake",
          title: "Brief intake",
          genre: "sci-fi",
          platform: "other",
          status: "ready-for-review",
          chapters: 1,
          chapterCount: 1,
          lastChapterNumber: 1,
        }), { language: "en" }),
      },
      chapters: { "brief-intake": [chapterSummary] },
      chapterDetails: { "brief-intake": { 1: chapterDetail } },
    }));

    fireEvent.click(screen.getByRole("button", { name: "上传资料开始创作" }));

    fireEvent.change(screen.getByLabelText("Genre"), { target: { value: "sci-fi" } });
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "en" } });
    fireEvent.change(screen.getByLabelText("Upload files"), {
      target: {
        files: [
          new File(["story brief"], "brief.md", { type: "text/markdown" }),
          new File(["chapter draft"], "chapter1.md", { type: "text/markdown" }),
          new File(["notes"], "research.txt", { type: "text/plain" }),
        ],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Parse files" }));
    await waitFor(() => {
      expect(screen.getByText("Parsed input summary")).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText("I confirm the parsed summary"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("button", { name: "Start generation" }).hasAttribute("disabled")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Start generation" }));

    await waitFor(() => {
      expect(screen.getAllByText("Chapter path").length).toBeGreaterThan(0);
    }, { timeout: 3000 });

    expect(createBootstrapBook).toHaveBeenCalledWith(expect.objectContaining({
      title: "Brief intake",
      genre: "sci-fi",
      intake: expect.objectContaining({ type: "upload" }),
    }));
    expect(screen.queryByText("Mock factory steps are progressing locally.")).toBeNull();

    expect(screen.getByText("Writing desk")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Shelf" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "AI Novel Factory" })).toBeTruthy();
    });

    expect(screen.getByRole("button", { name: /continue brief intake/i })).toBeTruthy();
  });
});
