// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { FactoryHome } from "../components/home/FactoryHome";
import { useStudioState, type StudioState } from "../hooks/useStudioState";
import type { StudioApiClient } from "../api/client";
import type { BootstrapStatus, BookDetail, BookSummary, ChapterDetail, ChapterSummary, HealthStatus } from "../../shared/contracts";

vi.mock("../hooks/useStudioState", async () => {
  const actual = await vi.importActual<typeof import("../hooks/useStudioState")>("../hooks/useStudioState");

  return {
    ...actual,
    useStudioState: vi.fn(),
  };
});

const LAST_ACTIVE_BOOK_STORAGE_KEY = "inkos.studio.last-active-book-id";
const LAST_ACTIVE_CHAPTER_STORAGE_KEY = "inkos.studio.last-active-chapter";

function createBookSummary(overrides: Partial<BookSummary> = {}): BookSummary {
  return {
    id: overrides.id ?? "book-1",
    title: overrides.title ?? "Northbound",
    status: overrides.status ?? "draft",
    platform: overrides.platform ?? "web",
    genre: overrides.genre ?? "fantasy",
    targetChapters: overrides.targetChapters ?? 12,
    chapters: overrides.chapters ?? 7,
    chapterCount: overrides.chapterCount ?? 7,
    lastChapterNumber: overrides.lastChapterNumber ?? 7,
    totalWords: overrides.totalWords ?? 18200,
    approvedChapters: overrides.approvedChapters ?? 3,
    pendingReview: overrides.pendingReview ?? 2,
    pendingReviewChapters: overrides.pendingReviewChapters ?? 2,
    failedReview: overrides.failedReview ?? 1,
    failedChapters: overrides.failedChapters ?? 1,
    recentRunStatus: overrides.recentRunStatus ?? "running",
    updatedAt: overrides.updatedAt ?? "2026-03-26T00:00:00.000Z",
  };
}

function createBookDetail(summary: BookSummary): BookDetail {
  return {
    ...summary,
    createdAt: "2026-03-01T00:00:00.000Z",
    chapterWordCount: 2400,
    language: "zh",
  };
}

function createChapterSummary(overrides: Partial<ChapterSummary> = {}): ChapterSummary {
  return {
    number: overrides.number ?? 7,
    title: overrides.title ?? "Harbor",
    status: overrides.status ?? "draft",
    wordCount: overrides.wordCount ?? 2400,
    auditIssueCount: overrides.auditIssueCount ?? 0,
    updatedAt: overrides.updatedAt ?? "2026-03-26T00:00:00.000Z",
    fileName: overrides.fileName ?? "0007_harbor.md",
  };
}

function createChapterDetail(summary: ChapterSummary): ChapterDetail {
  return {
    ...summary,
    auditIssues: [],
    content: `# ${summary.title}`,
  };
}

function createHealthStatus(overrides: Partial<HealthStatus> = {}): HealthStatus {
  return {
    status: overrides.status ?? "ok",
    projectRoot: overrides.projectRoot ?? "/project",
    bookCount: overrides.bookCount ?? 1,
    provider: overrides.provider ?? "openai",
    model: overrides.model ?? "gpt-5",
    projectConfigFound: overrides.projectConfigFound ?? true,
    envFound: overrides.envFound ?? true,
    projectEnvFound: overrides.projectEnvFound ?? true,
    globalConfigFound: overrides.globalConfigFound ?? true,
    configReady: overrides.configReady ?? true,
  };
}

function createState(overrides: Partial<StudioState> = {}): StudioState {
  return {
    activeView: overrides.activeView ?? "dashboard",
    creationLauncherMode: overrides.creationLauncherMode ?? null,
    creationDraft: overrides.creationDraft ?? null,
    creationProject: overrides.creationProject ?? null,
    creationBootstrap: overrides.creationBootstrap ?? null,
    activeTab: overrides.activeTab ?? "chapters",
    books: overrides.books ?? [],
    selectedBook: overrides.selectedBook ?? null,
    chapters: overrides.chapters ?? [],
    selectedChapter: overrides.selectedChapter ?? null,
    chapter: overrides.chapter ?? null,
    truthFiles: overrides.truthFiles ?? [],
    selectedTruthFile: overrides.selectedTruthFile ?? null,
    truthFile: overrides.truthFile ?? null,
    health: overrides.health ?? createHealthStatus(),
    bootstrapStatus: overrides.bootstrapStatus ?? createBootstrapStatus(overrides.health ?? createHealthStatus()),
    chapterDirty: overrides.chapterDirty ?? false,
    chapterDraftWordCount: overrides.chapterDraftWordCount ?? null,
    chapterSaving: overrides.chapterSaving ?? false,
    reviewSubmitting: overrides.reviewSubmitting ?? false,
    loading: overrides.loading ?? false,
    error: overrides.error ?? null,
    refresh: overrides.refresh ?? vi.fn(async () => undefined),
    showDashboard: overrides.showDashboard ?? vi.fn(),
    showHealth: overrides.showHealth ?? vi.fn(async () => undefined),
    startCreationLauncher: overrides.startCreationLauncher ?? vi.fn(),
    exitCreationLauncher: overrides.exitCreationLauncher ?? vi.fn(),
    updateCreationDraft: overrides.updateCreationDraft ?? vi.fn(),
    normalizeIdeaDraft: overrides.normalizeIdeaDraft ?? vi.fn(async () => undefined),
    summarizeUploadDraft: overrides.summarizeUploadDraft ?? vi.fn(async () => undefined),
    startCreationBootstrap: overrides.startCreationBootstrap ?? vi.fn(async () => undefined),
    completeCreationLauncher: overrides.completeCreationLauncher ?? vi.fn(),
    openBook: overrides.openBook ?? vi.fn(async () => undefined),
    selectChapter: overrides.selectChapter ?? vi.fn(async () => undefined),
    setChapterDirty: overrides.setChapterDirty ?? vi.fn(),
    setChapterDraftWordCount: overrides.setChapterDraftWordCount ?? vi.fn(),
    saveChapter: overrides.saveChapter ?? vi.fn(async () => undefined),
    approveReview: overrides.approveReview ?? vi.fn(async () => undefined),
    rejectReview: overrides.rejectReview ?? vi.fn(async () => undefined),
    selectTab: overrides.selectTab ?? vi.fn(async () => undefined),
    selectTruthFile: overrides.selectTruthFile ?? vi.fn(async () => undefined),
  };
}

function createBootstrapStatus(health: HealthStatus): BootstrapStatus {
  return {
    health,
    project: {
      initialized: health.projectConfigFound,
      name: health.projectConfigFound ? "Project" : null,
      bookCount: health.bookCount,
      firstBookId: health.bookCount > 0 ? "book-1" : null,
    },
    readiness: health.configReady || (!health.projectConfigFound && health.bookCount === 0)
      ? {
          ready: true,
          code: "READY",
          title: "Studio is ready",
          message: "Your project is ready for the next setup step.",
          action: "Continue",
        }
      : {
          ready: false,
          code: health.projectConfigFound ? "CONFIG_NOT_READY" : "PROJECT_NOT_INITIALIZED",
          title: health.projectConfigFound ? "Finish model setup" : "Create your local studio project",
          message: health.projectConfigFound ? "Add your model connection details to start generation." : "Start by creating a project for this workspace.",
          action: health.projectConfigFound ? "Open setup" : "Create project",
        },
  };
}

function createClient(data: {
  books: ReadonlyArray<BookSummary>;
  bookDetails: Record<string, BookDetail>;
  chapters: Record<string, ReadonlyArray<ChapterSummary>>;
  chapterDetails: Record<string, Record<number, ChapterDetail>>;
  health?: HealthStatus;
}): StudioApiClient {
  return {
    listBooks: async () => data.books,
    getBook: async (bookId) => data.bookDetails[bookId],
    listChapters: async (bookId) => data.chapters[bookId] ?? [],
    getChapter: async (bookId, chapterNumber) => data.chapterDetails[bookId]?.[chapterNumber],
    listTruthFiles: async () => [],
    getTruthFile: async () => {
      throw new Error("not used in this test");
    },
    getHealth: async () => data.health ?? createHealthStatus(),
    getBootstrapStatus: async () => createBootstrapStatus(data.health ?? createHealthStatus()),
    createBootstrapProject: async () => {
      throw new Error("not used in this test");
    },
    createBootstrapBook: async () => {
      throw new Error("not used in this test");
    },
    setupStory: async () => {
      throw new Error("not used in this test");
    },
    generateOutline: async () => {
      throw new Error("not used in this test");
    },
    generateFirstChapter: async () => {
      throw new Error("not used in this test");
    },
    normalizeIdea: async ({ idea }) => ({ type: "idea", titleSuggestion: idea.trim(), sourceText: idea.trim(), prompt: idea.trim() }),
    summarizeUpload: async ({ files }) => ({
      type: "upload",
      titleSuggestion: "Imported materials intake",
      sourceText: files.map((file) => file.content).join("\n\n"),
      prompt: `${files.length} files imported`,
      summary: { fileCount: files.length, totalBytes: files.reduce((total, file) => total + file.size, 0), totalCharacters: files.reduce((total, file) => total + file.content.length, 0), fileNames: files.map((file) => file.name), formats: [], kinds: [] },
      files: files.map((file) => ({ name: file.name, size: file.size, type: file.type ?? "", format: file.type ?? "", kind: "Other", contentLength: file.content.length, excerpt: file.content })),
    }),
    saveChapter: async (bookId, chapterNumber) => data.chapterDetails[bookId]?.[chapterNumber],
    approveReview: async (bookId, payload) => data.chapterDetails[bookId]?.[payload.chapterNumber],
    rejectReview: async (bookId, payload) => data.chapterDetails[bookId]?.[payload.chapterNumber],
    createRun: async () => {
      throw new Error("not used in this test");
    },
    listRuns: async () => [],
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("FactoryHome", () => {
  it("renders the product-first home with quick-start actions and recent work kept secondary", () => {
    const recentBook = createBookSummary();

    vi.mocked(useStudioState).mockReturnValue(
      createState({
        activeView: "dashboard",
        books: [recentBook],
        selectedBook: createBookDetail(recentBook),
      }),
    );

    render(<App />);

    expect(screen.getByRole("heading", { name: "AI Novel Factory" })).toBeTruthy();
    expect(screen.getAllByText("一句话开始创作").length).toBeGreaterThan(0);
    expect(screen.getAllByText("上传资料开始创作").length).toBeGreaterThan(0);
    expect(screen.getByText("继续上次创作")).toBeTruthy();
    expect(screen.getByRole("button", { name: /continue northbound/i })).toBeTruthy();
    expect(screen.getByText("Studio is ready. OpenAI · gpt-5 is connected for this workspace.")) .toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Library shelf" })).toBeNull();
  });

  it("shows only real recent books when the hydrated selection is no longer in the books list", () => {
    const realBook = createBookSummary({ id: "book-2", title: "Southbound" });
    const staleBook = createBookDetail(createBookSummary({ id: "book-stale", title: "Ghost Draft" }));

    vi.mocked(useStudioState).mockReturnValue(
      createState({
        activeView: "dashboard",
        books: [realBook],
        selectedBook: staleBook,
      }),
    );

    render(<App />);

    expect(screen.getByRole("button", { name: /continue southbound/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /continue ghost draft/i })).toBeNull();
  });

  it("uses the same Stage A readiness semantics as the launcher", () => {
    vi.mocked(useStudioState).mockReturnValue(
      createState({
        health: createHealthStatus({
          bookCount: 0,
          projectConfigFound: false,
          projectEnvFound: false,
          envFound: true,
          globalConfigFound: true,
        }),
      }),
    );

    render(<App />);

    expect(screen.getByText("Studio is ready. OpenAI · gpt-5 is connected for this workspace.")).toBeTruthy();
  });
});

describe("useStudioState home default", () => {
  it("keeps the dashboard home active after loading even when a prior project is stored", async () => {
    const bookSummary = createBookSummary();
    const chapterSummary = createChapterSummary();
    const chapterDetail = createChapterDetail(chapterSummary);
    const client = createClient({
      books: [bookSummary],
      bookDetails: { "book-1": createBookDetail(bookSummary) },
      chapters: { "book-1": [chapterSummary] },
      chapterDetails: { "book-1": { 7: chapterDetail } },
    });
    const { useStudioState: realUseStudioState } = await vi.importActual<typeof import("../hooks/useStudioState")>(
      "../hooks/useStudioState",
    );
    const { renderHook } = await import("@testing-library/react");

    window.localStorage.setItem(LAST_ACTIVE_BOOK_STORAGE_KEY, "book-1");
    window.localStorage.setItem(
      LAST_ACTIVE_CHAPTER_STORAGE_KEY,
      JSON.stringify({ bookId: "book-1", chapterNumber: 7 }),
    );

    const { result } = renderHook(() => realUseStudioState({ client }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.books).toEqual([bookSummary]);
    expect(result.current.activeView).toBe("dashboard");
    expect(result.current.selectedBook?.id).toBe("book-1");
    expect(result.current.selectedChapter?.number).toBe(7);
  });

  it("keeps home as the default surface while continuing the hydrated project into its stored chapter", async () => {
    const bookSummary = createBookSummary({ id: "book-1", chapters: 4, chapterCount: 4, lastChapterNumber: 4 });
    const storedChapter = createChapterSummary({ number: 1, title: "Arrival", status: "draft" });
    const latestChapter = createChapterSummary({ number: 4, title: "Wake", status: "approved" });
    const client = createClient({
      books: [bookSummary],
      bookDetails: { "book-1": createBookDetail(bookSummary) },
      chapters: { "book-1": [storedChapter, latestChapter] },
      chapterDetails: {
        "book-1": {
          1: createChapterDetail(storedChapter),
          4: createChapterDetail(latestChapter),
        },
      },
    });
    const { renderHook } = await import("@testing-library/react");
    const { useStudioState: realUseStudioState } = await vi.importActual<typeof import("../hooks/useStudioState")>(
      "../hooks/useStudioState",
    );

    window.localStorage.setItem(LAST_ACTIVE_BOOK_STORAGE_KEY, "book-1");
    window.localStorage.setItem(
      LAST_ACTIVE_CHAPTER_STORAGE_KEY,
      JSON.stringify({ bookId: "book-1", chapterNumber: 1 }),
    );

    function Harness() {
      const state = realUseStudioState({ client });

      if (state.activeView === "workspace" && state.selectedBook) {
        return (
          <section>
            <h2>{state.selectedBook.title} manuscript</h2>
            <p>{`Chapter ${state.selectedChapter?.number}: ${state.selectedChapter?.title}`}</p>
          </section>
        );
      }

      return (
        <>
          <FactoryHome
            books={state.books}
            selectedBook={state.selectedBook}
            bootstrapStatus={state.bootstrapStatus}
            onOpenBook={(bookId) => void state.openBook(bookId)}
            onStartCreation={state.startCreationLauncher}
          />
          <p>{`Hydrated chapter ${state.selectedChapter?.number ?? "none"}`}</p>
        </>
      );
    }

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "AI Novel Factory" })).toBeTruthy();
      expect(screen.getByText("Hydrated chapter 1")).toBeTruthy();
      expect(screen.getByRole("button", { name: /continue northbound/i })).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /continue northbound/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Northbound manuscript" })).toBeTruthy();
      expect(screen.getByText("Chapter 1: Arrival")).toBeTruthy();
    });
  });
});
