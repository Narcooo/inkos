// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BookDetail,
  BookSummary,
  ChapterDetail,
  StudioRun,
  ReviewActionPayload,
  ChapterSummary,
  HealthStatus,
  TruthFileDetail,
  TruthFileSummary,
} from "../../shared/contracts";
import { useStudioState } from "../hooks/useStudioState";
import type { StudioApiClient } from "../api/client";

const LAST_ACTIVE_BOOK_STORAGE_KEY = "inkos.studio.last-active-book-id";
const LAST_ACTIVE_CHAPTER_STORAGE_KEY = "inkos.studio.last-active-chapter";

function createBookSummary(overrides: Partial<BookSummary>): BookSummary {
  return {
    id: overrides.id ?? "book-1",
    title: overrides.title ?? "Book 1",
    status: overrides.status ?? "draft",
    platform: overrides.platform ?? "web",
    genre: overrides.genre ?? "fantasy",
    targetChapters: overrides.targetChapters ?? 12,
    chapters: overrides.chapters ?? 3,
    chapterCount: overrides.chapterCount ?? 3,
    lastChapterNumber: overrides.lastChapterNumber ?? 3,
    totalWords: overrides.totalWords ?? 1200,
    approvedChapters: overrides.approvedChapters ?? 0,
    pendingReview: overrides.pendingReview ?? 0,
    pendingReviewChapters: overrides.pendingReviewChapters ?? 0,
    failedReview: overrides.failedReview ?? 0,
    failedChapters: overrides.failedChapters ?? 0,
    recentRunStatus: overrides.recentRunStatus ?? null,
    updatedAt: overrides.updatedAt ?? "2026-03-26T00:00:00.000Z",
  };
}

function createBookDetail(summary: BookSummary, overrides: Partial<BookDetail> = {}): BookDetail {
  return {
    ...summary,
    createdAt: overrides.createdAt ?? "2026-03-01T00:00:00.000Z",
    chapterWordCount: overrides.chapterWordCount ?? 400,
    language: overrides.language ?? "en",
  };
}

function createChapterSummary(overrides: Partial<ChapterSummary>): ChapterSummary {
  return {
    number: overrides.number ?? 1,
    title: overrides.title ?? "Chapter",
    status: overrides.status ?? "draft",
    wordCount: overrides.wordCount ?? 400,
    auditIssueCount: overrides.auditIssueCount ?? 0,
    updatedAt: overrides.updatedAt ?? "2026-03-26T00:00:00.000Z",
    fileName: overrides.fileName ?? "0001_chapter.md",
  };
}

function createChapterDetail(summary: ChapterSummary): ChapterDetail {
  return {
    ...summary,
    auditIssues: [],
    content: `# ${summary.title}`,
  };
}

function createHealthStatus(): HealthStatus {
  return {
    status: "ok",
    projectRoot: "/project",
    projectConfigFound: true,
    envFound: true,
    projectEnvFound: true,
    globalConfigFound: false,
    bookCount: 2,
    provider: "openai",
    model: "gpt-4.1",
  };
}

function createRun(overrides: Partial<StudioRun> = {}): StudioRun {
  return {
    id: overrides.id ?? "run-1",
    bookId: overrides.bookId ?? "book-1",
    chapter: overrides.chapter ?? overrides.chapterNumber ?? 1,
    chapterNumber: overrides.chapterNumber ?? 1,
    action: overrides.action ?? "audit",
    status: overrides.status ?? "succeeded",
    stage: overrides.stage ?? "Completed",
    createdAt: overrides.createdAt ?? "2026-03-26T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-26T00:00:00.000Z",
    startedAt: overrides.startedAt ?? "2026-03-26T00:00:01.000Z",
    finishedAt: overrides.finishedAt ?? "2026-03-26T00:00:02.000Z",
    logs: overrides.logs ?? [],
    ...(overrides.result !== undefined ? { result: overrides.result } : {}),
    ...(overrides.error !== undefined ? { error: overrides.error } : {}),
  };
}

function createClient(data: {
  books: ReadonlyArray<BookSummary>;
  bookDetails: Record<string, BookDetail>;
  chapters: Record<string, ReadonlyArray<ChapterSummary>>;
  chapterDetails: Record<string, Record<number, ChapterDetail>>;
  truthFiles?: Record<string, ReadonlyArray<TruthFileSummary>>;
  truthFileDetails?: Record<string, Record<string, TruthFileDetail>>;
  health?: HealthStatus;
}): StudioApiClient {
  return {
    listBooks: async () => data.books,
    getBook: async (bookId) => data.bookDetails[bookId],
    listChapters: async (bookId) => data.chapters[bookId] ?? [],
    getChapter: async (bookId, chapterNumber) => data.chapterDetails[bookId]?.[chapterNumber],
    listTruthFiles: async (bookId) => data.truthFiles?.[bookId] ?? [],
    getTruthFile: async (bookId, name) => {
      const truthFile = data.truthFileDetails?.[bookId]?.[name];
      if (!truthFile) {
        throw new Error(`Missing truth file ${name} for ${bookId}`);
      }
      return truthFile;
    },
    getHealth: async () => data.health ?? createHealthStatus(),
    saveChapter: async (bookId, chapterNumber, content) => {
      const chapter = data.chapterDetails[bookId]?.[chapterNumber];
      if (!chapter) {
        throw new Error(`Missing chapter ${chapterNumber} for ${bookId}`);
      }

      return {
        ...chapter,
        title: content.match(/^#\s+(.+)$/m)?.[1] ?? chapter.title,
        content,
      };
    },
    approveReview: async (bookId, payload) => {
      const chapter = data.chapterDetails[bookId]?.[payload.chapterNumber];
      if (!chapter) {
        throw new Error(`Missing chapter ${payload.chapterNumber} for ${bookId}`);
      }

      return {
        ...chapter,
        status: "approved",
      };
    },
    rejectReview: async (bookId, payload) => {
      const chapter = data.chapterDetails[bookId]?.[payload.chapterNumber];
      if (!chapter) {
        throw new Error(`Missing chapter ${payload.chapterNumber} for ${bookId}`);
      }

      return {
        ...chapter,
        status: "rejected",
        reviewNote: payload.reason ?? "Rejected without reason",
      };
    },
    createRun: async (bookId, action, payload) => createRun({ bookId, action, chapterNumber: payload?.chapterNumber ?? null }),
    listRuns: async () => [createRun()],
  };
}

describe("useStudioState", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("opens a single-book project directly into the writing desk", async () => {
    const book = createBookSummary({
      id: "book-1",
      title: "Northbound",
      lastChapterNumber: 4,
      chapterCount: 4,
      chapters: 4,
      pendingReview: 2,
      pendingReviewChapters: 2,
    });

    const latestChapter = createChapterSummary({ number: 4, title: "Aftermath", status: "draft" });
    const reviewableChapter = createChapterSummary({ number: 2, title: "Trial", status: "audit-failed" });

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: {
        "book-1": [latestChapter, reviewableChapter, createChapterSummary({ number: 3, title: "Signals", status: "ready-for-review" })],
      },
      chapterDetails: {
        "book-1": {
          4: createChapterDetail(latestChapter),
        },
      },
    });

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.activeView).toBe("workspace");
    });

    expect(result.current.selectedBook?.id).toBe("book-1");
    expect(result.current.selectedChapter?.number).toBe(4);
    expect(result.current.activeTab).toBe("chapters");
    expect(result.current.chapter?.number).toBe(4);
    expect(result.current.chapters.some((chapter) => chapter.number === reviewableChapter.number)).toBe(true);
  });

  it("prefers the remembered book and last edited chapter when opening the app", async () => {
    const firstBook = createBookSummary({
      id: "book-1",
      title: "Northbound",
      lastChapterNumber: 4,
      chapterCount: 4,
      chapters: 4,
      pendingReview: 2,
      pendingReviewChapters: 2,
    });
    const secondBook = createBookSummary({
      id: "book-2",
      title: "Southbound",
      lastChapterNumber: 5,
      chapterCount: 5,
      chapters: 5,
    });

    window.localStorage.setItem(LAST_ACTIVE_BOOK_STORAGE_KEY, "book-1");
    window.localStorage.setItem(LAST_ACTIVE_CHAPTER_STORAGE_KEY, JSON.stringify({ bookId: "book-1", chapterNumber: 3 }));

    const client = createClient({
      books: [secondBook, firstBook],
      bookDetails: {
        "book-1": createBookDetail(firstBook),
        "book-2": createBookDetail(secondBook),
      },
      chapters: {
        "book-1": [
          createChapterSummary({ number: 4, title: "Aftermath", status: "draft" }),
          createChapterSummary({ number: 2, title: "Trial", status: "audit-failed" }),
          createChapterSummary({ number: 3, title: "Signals", status: "ready-for-review" }),
        ],
        "book-2": [createChapterSummary({ number: 5, title: "Wake", status: "draft" })],
      },
      chapterDetails: {
        "book-1": {
          3: createChapterDetail(createChapterSummary({ number: 3, title: "Signals", status: "ready-for-review" })),
        },
        "book-2": {
          5: createChapterDetail(createChapterSummary({ number: 5, title: "Wake", status: "draft" })),
        },
      },
    });

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.activeView).toBe("workspace");
    });

    expect(result.current.selectedBook?.id).toBe("book-1");
    expect(result.current.selectedChapter?.number).toBe(3);
    expect(result.current.activeTab).toBe("chapters");
    expect(result.current.chapter?.number).toBe(3);
  });

  it("falls back to the first available book and latest chapter when no last active selection is remembered", async () => {
    const firstBook = createBookSummary({
      id: "book-1",
      title: "Northbound",
      lastChapterNumber: 2,
      chapterCount: 2,
      chapters: 2,
    });
    const secondBook = createBookSummary({
      id: "book-2",
      title: "Southbound",
      lastChapterNumber: 4,
      chapterCount: 4,
      chapters: 4,
    });

    const client = createClient({
      books: [firstBook, secondBook],
      bookDetails: {
        "book-1": createBookDetail(firstBook),
        "book-2": createBookDetail(secondBook),
      },
      chapters: {
        "book-1": [
          createChapterSummary({ number: 1, title: "Arrival", status: "ready-for-review" }),
          createChapterSummary({ number: 2, title: "Signal", status: "draft" }),
        ],
        "book-2": [createChapterSummary({ number: 4, title: "Wake", status: "draft" })],
      },
      chapterDetails: {
        "book-1": {
          2: createChapterDetail(createChapterSummary({ number: 2, title: "Signal", status: "draft" })),
        },
        "book-2": {
          4: createChapterDetail(createChapterSummary({ number: 4, title: "Wake", status: "draft" })),
        },
      },
    });

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.activeView).toBe("workspace");
    });

    expect(result.current.selectedBook?.id).toBe("book-1");
    expect(result.current.selectedChapter?.number).toBe(2);
    expect(result.current.activeTab).toBe("chapters");
    expect(result.current.chapter?.number).toBe(2);
  });

  it("keeps a clear empty writing state when the selected book has no chapters", async () => {
    const book = createBookSummary({
      id: "book-1",
      title: "Northbound",
      chapters: 0,
      chapterCount: 0,
      lastChapterNumber: 0,
    });

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [] },
      chapterDetails: { "book-1": {} },
    });

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.activeView).toBe("workspace");
    });

    expect(result.current.selectedBook?.id).toBe("book-1");
    expect(result.current.activeTab).toBe("runs");
    expect(result.current.selectedChapter).toBeNull();
    expect(result.current.chapter).toBeNull();
  });

  it("preserves an actionable path back to runs after switching empty-book tabs", async () => {
    const book = createBookSummary({
      id: "book-1",
      title: "Northbound",
      chapters: 0,
      chapterCount: 0,
      lastChapterNumber: 0,
    });

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [] },
      chapterDetails: { "book-1": {} },
    });

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.activeView).toBe("workspace");
    });

    await act(async () => {
      await result.current.selectTab("review");
    });
    expect(result.current.activeTab).toBe("review");

    await act(async () => {
      await result.current.selectTab("runs");
    });
    expect(result.current.activeTab).toBe("runs");

    await act(async () => {
      await result.current.selectTab("truth-files");
    });
    expect(result.current.activeTab).toBe("truth-files");

    await act(async () => {
      await result.current.selectTab("runs");
    });
    expect(result.current.activeTab).toBe("runs");
  });

  it("writes the remembered chapter only after editing activity", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound", chapters: 2, chapterCount: 2, lastChapterNumber: 1 });
    const chapterOne = createChapterSummary({ number: 1, title: "Arrival", status: "draft" });
    const chapterTwo = createChapterSummary({ number: 2, title: "Signal", status: "draft" });
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [chapterOne, chapterTwo] },
      chapterDetails: {
        "book-1": {
          1: createChapterDetail(chapterOne),
          2: createChapterDetail(chapterTwo),
        },
      },
    });

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.activeView).toBe("workspace");
    });

    expect(window.localStorage.getItem(LAST_ACTIVE_CHAPTER_STORAGE_KEY)).toBeNull();

    await act(async () => {
      await result.current.selectChapter(1);
    });

    expect(window.localStorage.getItem(LAST_ACTIVE_CHAPTER_STORAGE_KEY)).toBeNull();
    expect(
      setItemSpy.mock.calls.some(
        ([key]) => key === LAST_ACTIVE_CHAPTER_STORAGE_KEY,
      ),
    ).toBe(false);

    act(() => {
      result.current.setChapterDirty(true);
    });

    expect(window.localStorage.getItem(LAST_ACTIVE_CHAPTER_STORAGE_KEY)).toBe(
      JSON.stringify({ bookId: "book-1", chapterNumber: 1 }),
    );
    setItemSpy.mockRestore();
  });

  it("keeps the active chapter selected and clears dirty state after saving", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const chapterOne = createChapterSummary({ number: 1, title: "Arrival", status: "draft" });

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [chapterOne] },
      chapterDetails: {
        "book-1": {
          1: createChapterDetail(chapterOne),
        },
      },
    });

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.activeView).toBe("workspace");
    });

    act(() => {
      result.current.setChapterDirty(true);
    });

    await act(async () => {
      await result.current.saveChapter("# Arrival\n\nUpdated body.");
    });

    expect(result.current.selectedChapter?.number).toBe(1);
    expect(result.current.chapter?.number).toBe(1);
    expect(result.current.chapterDirty).toBe(false);
  });

  it("retries auto-open after an empty first load when refresh later returns books", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const chapter = createChapterSummary({ number: 1, title: "Arrival", status: "draft" });
    const listBooks = vi.fn<StudioApiClient["listBooks"]>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([book]);

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [chapter] },
      chapterDetails: {
        "book-1": {
          1: createChapterDetail(chapter),
        },
      },
    });
    client.listBooks = listBooks;

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.books).toHaveLength(0);
    expect(result.current.activeView).toBe("dashboard");

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.activeView).toBe("workspace");
    });

    expect(result.current.selectedBook?.id).toBe("book-1");
    expect(result.current.selectedChapter?.number).toBe(1);
  });

  it("retries auto-open after a failed first open when refresh runs again", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const chapter = createChapterSummary({ number: 1, title: "Arrival", status: "draft" });
    const getBook = vi.fn<StudioApiClient["getBook"]>()
      .mockRejectedValueOnce(new Error("temporary open failure"))
      .mockResolvedValue(createBookDetail(book));

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [chapter] },
      chapterDetails: {
        "book-1": {
          1: createChapterDetail(chapter),
        },
      },
    });
    client.getBook = getBook;

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.error).toBe("temporary open failure");
    });

    expect(result.current.activeView).toBe("dashboard");

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.activeView).toBe("workspace");
    });

    expect(result.current.selectedBook?.id).toBe("book-1");
    expect(result.current.selectedChapter?.number).toBe(1);
  });

  it("refreshes the active workspace book and chapter context", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound", chapters: 2, chapterCount: 2, lastChapterNumber: 2, totalWords: 400 });
    const chapterOne = createChapterSummary({ number: 1, title: "Arrival", status: "draft", wordCount: 400 });
    const chapterTwo = createChapterSummary({ number: 2, title: "Signals", status: "draft", wordCount: 500 });

    let liveBook = createBookDetail(book);
    let liveChapters = [chapterOne, chapterTwo];
    let liveChapter = createChapterDetail(chapterTwo);

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": liveBook },
      chapters: { "book-1": liveChapters },
      chapterDetails: { "book-1": { 2: liveChapter } },
    });

    client.getBook = vi.fn(async () => liveBook);
    client.listChapters = vi.fn(async () => liveChapters);
    client.getChapter = vi.fn(async (_bookId, chapterNumber) => (chapterNumber === 2 ? liveChapter : createChapterDetail(chapterOne)));

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.activeView).toBe("workspace");
    });

    expect(result.current.selectedChapter?.number).toBe(2);
    expect(result.current.chapter?.title).toBe("Signals");

    liveBook = { ...liveBook, totalWords: 900 };
    liveChapters = [chapterOne, { ...chapterTwo, title: "Signals revised", wordCount: 900 }];
    liveChapter = { ...liveChapter, title: "Signals revised", wordCount: 900, content: "# Signals revised\n\nFresh pages" };

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.selectedBook?.totalWords).toBe(900);
    expect(result.current.selectedChapter?.number).toBe(2);
    expect(result.current.selectedChapter?.title).toBe("Signals revised");
    expect(result.current.chapter?.title).toBe("Signals revised");
    expect(result.current.chapter?.content).toContain("Fresh pages");
  });

  it("refreshes truth-file selection and detail when the reference shelf is active", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const chapter = createChapterSummary({ number: 1, title: "Arrival", status: "draft" });
    const truthSummary: TruthFileSummary = {
      name: "current_state.md",
      label: "Current state",
      exists: true,
      path: "truth/current_state.md",
      optional: false,
      available: true,
    };

    let liveTruthSummary = truthSummary;
    let liveTruthDetail: TruthFileDetail = {
      ...truthSummary,
      content: "# Current state\n\nVersion one",
    };

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [chapter] },
      chapterDetails: { "book-1": { 1: createChapterDetail(chapter) } },
      truthFiles: { "book-1": [truthSummary] },
      truthFileDetails: { "book-1": { "current_state.md": liveTruthDetail } },
    });

    client.listTruthFiles = vi.fn(async () => [liveTruthSummary]);
    client.getTruthFile = vi.fn(async () => liveTruthDetail);

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.activeView).toBe("workspace");
    });

    await act(async () => {
      await result.current.selectTab("truth-files");
    });

    expect(result.current.selectedTruthFile?.name).toBe("current_state.md");
    expect(result.current.truthFile?.content).toContain("Version one");

    liveTruthSummary = { ...truthSummary, label: "Current state revised" };
    liveTruthDetail = { ...liveTruthDetail, label: "Current state revised", content: "# Current state\n\nVersion two" };

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.activeTab).toBe("truth-files");
    expect(result.current.selectedTruthFile?.label).toBe("Current state revised");
    expect(result.current.truthFile?.content).toContain("Version two");
  });

  it("falls back to the latest chapter and resets workspace state when switching books", async () => {
    const firstBook = createBookSummary({
      id: "book-1",
      title: "Northbound",
      lastChapterNumber: 3,
      chapterCount: 3,
      chapters: 3,
      pendingReview: 1,
      pendingReviewChapters: 1,
    });
    const secondBook = createBookSummary({
      id: "book-2",
      title: "Southbound",
      lastChapterNumber: 5,
      chapterCount: 5,
      chapters: 5,
      pendingReview: 0,
      pendingReviewChapters: 0,
    });

    const currentStateSummary = {
      name: "current_state.md",
      label: "Current State",
      exists: true,
      path: "story/current_state.md",
      optional: false,
      available: true,
    } satisfies TruthFileSummary;

    window.localStorage.setItem(LAST_ACTIVE_BOOK_STORAGE_KEY, "book-2");
    window.localStorage.setItem(LAST_ACTIVE_CHAPTER_STORAGE_KEY, JSON.stringify({ bookId: "book-1", chapterNumber: 3 }));

    const client = createClient({
      books: [firstBook, secondBook],
      bookDetails: {
        "book-1": createBookDetail(firstBook),
        "book-2": createBookDetail(secondBook),
      },
      chapters: {
        "book-1": [
          createChapterSummary({ number: 1, title: "Arrival", status: "draft" }),
          createChapterSummary({ number: 2, title: "Signal", status: "ready-for-review" }),
          createChapterSummary({ number: 3, title: "Turn", status: "draft" }),
        ],
        "book-2": [
          createChapterSummary({ number: 3, title: "Harbor", status: "draft" }),
          createChapterSummary({ number: 5, title: "Wake", status: "approved" }),
          createChapterSummary({ number: 4, title: "Salt", status: "draft" }),
        ],
      },
      chapterDetails: {
        "book-1": {
          2: createChapterDetail(createChapterSummary({ number: 2, title: "Signal", status: "ready-for-review" })),
        },
        "book-2": {
          5: createChapterDetail(createChapterSummary({ number: 5, title: "Wake", status: "approved" })),
        },
      },
      truthFiles: {
        "book-1": [currentStateSummary],
      },
      truthFileDetails: {
        "book-1": {
          "current_state.md": {
            ...currentStateSummary,
            content: "# Current state",
          },
        },
      },
    });

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(2);
    });

    await act(async () => {
      await result.current.openBook("book-1");
    });

    await act(async () => {
      await result.current.selectTab("truth-files");
    });

    expect(result.current.selectedChapter?.number).toBe(3);
    expect(result.current.truthFile?.name).toBe("current_state.md");

    await act(async () => {
      await result.current.openBook("book-2");
    });

    expect(result.current.selectedBook?.id).toBe("book-2");
    expect(result.current.activeTab).toBe("chapters");
    expect(result.current.selectedChapter?.number).toBe(5);
    expect(result.current.chapter?.number).toBe(5);
    expect(result.current.selectedTruthFile).toBeNull();
    expect(result.current.truthFile).toBeNull();
  });

  it("ignores stale startup chapter persistence on later manual book switches", async () => {
    const firstBook = createBookSummary({ id: "book-1", title: "Northbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const secondBook = createBookSummary({ id: "book-2", title: "Southbound", chapters: 5, chapterCount: 5, lastChapterNumber: 5 });

    window.localStorage.setItem(LAST_ACTIVE_BOOK_STORAGE_KEY, "book-1");
    window.localStorage.setItem(LAST_ACTIVE_CHAPTER_STORAGE_KEY, JSON.stringify({ bookId: "book-1", chapterNumber: 1 }));

    const client = createClient({
      books: [firstBook, secondBook],
      bookDetails: {
        "book-1": createBookDetail(firstBook),
        "book-2": createBookDetail(secondBook),
      },
      chapters: {
        "book-1": [createChapterSummary({ number: 1, title: "Arrival", status: "draft" })],
        "book-2": [
          createChapterSummary({ number: 3, title: "Harbor", status: "draft" }),
          createChapterSummary({ number: 5, title: "Wake", status: "approved" }),
          createChapterSummary({ number: 4, title: "Salt", status: "draft" }),
        ],
      },
      chapterDetails: {
        "book-1": {
          1: createChapterDetail(createChapterSummary({ number: 1, title: "Arrival", status: "draft" })),
        },
        "book-2": {
          5: createChapterDetail(createChapterSummary({ number: 5, title: "Wake", status: "approved" })),
        },
      },
    });

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.activeView).toBe("workspace");
    });

    expect(result.current.selectedBook?.id).toBe("book-1");
    expect(result.current.selectedChapter?.number).toBe(1);

    await act(async () => {
      await result.current.openBook("book-2");
    });

    expect(result.current.selectedBook?.id).toBe("book-2");
    expect(result.current.selectedChapter?.number).toBe(5);
    expect(result.current.chapter?.number).toBe(5);
  });

  it("does not apply stale startup chapter state after switching books without editing and reloading", async () => {
    const firstBook = createBookSummary({ id: "book-1", title: "Northbound", chapters: 2, chapterCount: 2, lastChapterNumber: 2 });
    const secondBook = createBookSummary({ id: "book-2", title: "Southbound", chapters: 5, chapterCount: 5, lastChapterNumber: 5 });

    window.localStorage.setItem(LAST_ACTIVE_BOOK_STORAGE_KEY, "book-1");
    window.localStorage.setItem(LAST_ACTIVE_CHAPTER_STORAGE_KEY, JSON.stringify({ bookId: "book-1", chapterNumber: 1 }));

    const client = createClient({
      books: [firstBook, secondBook],
      bookDetails: {
        "book-1": createBookDetail(firstBook),
        "book-2": createBookDetail(secondBook),
      },
      chapters: {
        "book-1": [
          createChapterSummary({ number: 1, title: "Arrival", status: "draft" }),
          createChapterSummary({ number: 2, title: "Signal", status: "draft" }),
        ],
        "book-2": [
          createChapterSummary({ number: 3, title: "Harbor", status: "draft" }),
          createChapterSummary({ number: 5, title: "Wake", status: "approved" }),
          createChapterSummary({ number: 4, title: "Salt", status: "draft" }),
        ],
      },
      chapterDetails: {
        "book-1": {
          1: createChapterDetail(createChapterSummary({ number: 1, title: "Arrival", status: "draft" })),
        },
        "book-2": {
          5: createChapterDetail(createChapterSummary({ number: 5, title: "Wake", status: "approved" })),
        },
      },
    });

    const firstMount = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(firstMount.result.current.activeView).toBe("workspace");
    });

    expect(firstMount.result.current.selectedBook?.id).toBe("book-1");
    expect(firstMount.result.current.selectedChapter?.number).toBe(1);

    await act(async () => {
      await firstMount.result.current.openBook("book-2");
    });

    expect(firstMount.result.current.selectedBook?.id).toBe("book-2");
    expect(firstMount.result.current.selectedChapter?.number).toBe(5);

    firstMount.unmount();

    const secondMount = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(secondMount.result.current.activeView).toBe("workspace");
    });

    expect(secondMount.result.current.selectedBook?.id).toBe("book-2");
    expect(secondMount.result.current.selectedChapter?.number).toBe(5);
    expect(secondMount.result.current.chapter?.number).toBe(5);
  });

  it("defaults the truth-files tab to the first available file", async () => {
    const book = createBookSummary({
      id: "book-1",
      title: "Northbound",
    });

    const unavailableTruthFile = {
      name: "pending_hooks.md",
      label: "Pending Hooks",
      exists: false,
      path: "story/pending_hooks.md",
      optional: false,
      available: false,
    } satisfies TruthFileSummary;

    const availableTruthFile = {
      name: "current_state.md",
      label: "Current State",
      exists: true,
      path: "story/current_state.md",
      optional: false,
      available: true,
    } satisfies TruthFileSummary;

    const getTruthFile = vi.fn(async (_bookId: string, name: string) => {
      expect(name).toBe("current_state.md");

      return {
        ...availableTruthFile,
        content: "# Current state",
      } satisfies TruthFileDetail;
    });

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: {
        "book-1": [createChapterSummary({ number: 1, title: "Arrival", status: "draft" })],
      },
      chapterDetails: {
        "book-1": {
          1: createChapterDetail(createChapterSummary({ number: 1, title: "Arrival", status: "draft" })),
        },
      },
      truthFiles: {
        "book-1": [unavailableTruthFile, availableTruthFile],
      },
      truthFileDetails: {
        "book-1": {
          "current_state.md": {
            ...availableTruthFile,
            content: "# Current state",
          },
        },
      },
    });

    client.getTruthFile = getTruthFile;

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(1);
    });

    await act(async () => {
      await result.current.openBook("book-1");
    });

    await act(async () => {
      await result.current.selectTab("truth-files");
    });

    expect(result.current.selectedTruthFile?.name).toBe("current_state.md");
    expect(result.current.truthFile?.name).toBe("current_state.md");
    expect(getTruthFile).toHaveBeenCalledTimes(1);
  });

  it("keeps unavailable truth files local without fetching or setting an error", async () => {
    const book = createBookSummary({
      id: "book-1",
      title: "Northbound",
    });

    const unavailableTruthFile = {
      name: "pending_hooks.md",
      label: "Pending Hooks",
      exists: false,
      path: "story/pending_hooks.md",
      optional: false,
      available: false,
    } satisfies TruthFileSummary;

    const getTruthFile = vi.fn(async () => {
      throw new Error("should not fetch unavailable truth files");
    });

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: {
        "book-1": [createChapterSummary({ number: 1, title: "Arrival", status: "draft" })],
      },
      chapterDetails: {
        "book-1": {
          1: createChapterDetail(createChapterSummary({ number: 1, title: "Arrival", status: "draft" })),
        },
      },
      truthFiles: {
        "book-1": [unavailableTruthFile],
      },
    });

    client.getTruthFile = getTruthFile;

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(1);
    });

    await act(async () => {
      await result.current.openBook("book-1");
    });

    await act(async () => {
      await result.current.selectTab("truth-files");
    });

    expect(result.current.selectedTruthFile?.name).toBe("pending_hooks.md");
    expect(result.current.truthFile).toBeNull();
    expect(result.current.error).toBeNull();
    expect(getTruthFile).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.selectTruthFile("pending_hooks.md");
    });

    expect(result.current.selectedTruthFile?.name).toBe("pending_hooks.md");
    expect(result.current.truthFile).toBeNull();
    expect(result.current.error).toBeNull();
    expect(getTruthFile).not.toHaveBeenCalled();
  });

  it("restores a coherent truth-file selection when returning to the reference shelf", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound" });
    const availableTruthFile = {
      name: "current_state.md",
      label: "Current State",
      exists: true,
      path: "story/current_state.md",
      optional: false,
      available: true,
    } satisfies TruthFileSummary;

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: {
        "book-1": [createChapterSummary({ number: 1, title: "Arrival", status: "draft" })],
      },
      chapterDetails: {
        "book-1": {
          1: createChapterDetail(createChapterSummary({ number: 1, title: "Arrival", status: "draft" })),
        },
      },
      truthFiles: {
        "book-1": [availableTruthFile],
      },
      truthFileDetails: {
        "book-1": {
          "current_state.md": {
            ...availableTruthFile,
            content: "# Current state",
          },
        },
      },
    });

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(1);
    });

    await act(async () => {
      await result.current.openBook("book-1");
      await result.current.selectTab("truth-files");
      await result.current.selectTab("review");
      await result.current.selectTab("truth-files");
    });

    expect(result.current.selectedTruthFile?.name).toBe("current_state.md");
    expect(result.current.truthFile?.name).toBe("current_state.md");
  });

  it("keeps truth-file selection and content matched when an invalidated selection resolves late", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound" });
    const currentState = {
      name: "current_state.md",
      label: "Current State",
      exists: true,
      path: "story/current_state.md",
      optional: false,
      available: true,
    } satisfies TruthFileSummary;
    const storyBible = {
      name: "story_bible.md",
      label: "Story Bible",
      exists: true,
      path: "story/story_bible.md",
      optional: false,
      available: true,
    } satisfies TruthFileSummary;

    let resolveStoryBible: (() => void) | undefined;
    const getTruthFile = vi.fn(async (_bookId: string, name: string) => {
      if (name === "story_bible.md") {
        return await new Promise<TruthFileDetail>((resolve) => {
          resolveStoryBible = () =>
            resolve({
              ...storyBible,
              content: "# Story bible",
            });
        });
      }

      return {
        ...currentState,
        content: "# Current state",
      } satisfies TruthFileDetail;
    });

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: {
        "book-1": [createChapterSummary({ number: 1, title: "Arrival", status: "draft" })],
      },
      chapterDetails: {
        "book-1": {
          1: createChapterDetail(createChapterSummary({ number: 1, title: "Arrival", status: "draft" })),
        },
      },
      truthFiles: {
        "book-1": [currentState, storyBible],
      },
      truthFileDetails: {
        "book-1": {
          "current_state.md": {
            ...currentState,
            content: "# Current state",
          },
          "story_bible.md": {
            ...storyBible,
            content: "# Story bible",
          },
        },
      },
    });
    client.getTruthFile = getTruthFile;

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(1);
    });

    await act(async () => {
      await result.current.openBook("book-1");
      await result.current.selectTab("truth-files");
    });

    let selectStoryBiblePromise: Promise<void> | undefined;
    act(() => {
      selectStoryBiblePromise = result.current.selectTruthFile("story_bible.md");
    });

    await act(async () => {
      await result.current.selectTab("review");
    });

    resolveStoryBible?.();
    await act(async () => {
      await selectStoryBiblePromise;
    });

    expect(result.current.activeTab).toBe("review");
    expect(result.current.selectedTruthFile?.name).toBe("current_state.md");
    expect(result.current.truthFile?.name).toBe("current_state.md");
  });

  it("warns before switching chapters with unsaved editor changes", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound", chapters: 2, chapterCount: 2, lastChapterNumber: 2 });
    const chapterOne = createChapterSummary({ number: 1, title: "Arrival", status: "ready-for-review" });
    const chapterTwo = createChapterSummary({ number: 2, title: "Signal", status: "draft" });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [chapterOne, chapterTwo] },
      chapterDetails: {
        "book-1": {
          1: createChapterDetail(chapterOne),
          2: createChapterDetail(chapterTwo),
        },
      },
    });

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(1);
    });

    await act(async () => {
      await result.current.openBook("book-1");
    });

    act(() => {
      result.current.setChapterDirty(true);
    });

    await act(async () => {
      await result.current.selectChapter(1);
    });

    expect(confirmSpy).toHaveBeenCalledWith("You have unsaved changes for this chapter. Discard them and switch chapters?");
    expect(result.current.selectedChapter?.number).toBe(2);
    expect(result.current.chapter?.number).toBe(2);
    confirmSpy.mockRestore();
  });

  it("switches inspector tabs without discarding unsaved manuscript changes", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound", chapters: 2, chapterCount: 2, lastChapterNumber: 2 });
    const chapterOne = createChapterSummary({ number: 1, title: "Arrival", status: "ready-for-review" });
    const chapterTwo = createChapterSummary({ number: 2, title: "Signal", status: "draft" });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [chapterOne, chapterTwo] },
      chapterDetails: {
        "book-1": {
          1: createChapterDetail(chapterOne),
          2: createChapterDetail(chapterTwo),
        },
      },
    });

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(1);
    });

    await act(async () => {
      await result.current.openBook("book-1");
      await result.current.selectTab("chapters");
    });

    act(() => {
      result.current.setChapterDirty(true);
    });

    await act(async () => {
      await result.current.selectTab("review");
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(result.current.activeTab).toBe("review");
    expect(result.current.chapterDirty).toBe(true);
    confirmSpy.mockRestore();
  });

  it("blocks approving review while the manuscript has unsaved edits", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const chapterOne = createChapterSummary({ number: 1, title: "Arrival", status: "ready-for-review" });
    const approveReview = vi.fn<StudioApiClient["approveReview"]>().mockResolvedValue(createChapterDetail(chapterOne));

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [chapterOne] },
      chapterDetails: {
        "book-1": {
          1: createChapterDetail(chapterOne),
        },
      },
    });
    client.approveReview = approveReview;

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(1);
    });

    await act(async () => {
      await result.current.openBook("book-1");
      await result.current.selectTab("review");
    });

    act(() => {
      result.current.setChapterDirty(true);
    });

    await act(async () => {
      await result.current.approveReview();
    });

    expect(approveReview).not.toHaveBeenCalled();
    expect(result.current.chapterDirty).toBe(true);
    expect(result.current.error).toBe("Save or discard manuscript changes before updating review status.");
  });

  it("blocks rejecting review while the manuscript has unsaved edits", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const chapterOne = createChapterSummary({ number: 1, title: "Arrival", status: "ready-for-review" });
    const rejectReview = vi.fn<StudioApiClient["rejectReview"]>().mockResolvedValue({
      ...createChapterDetail(chapterOne),
      status: "rejected",
      reviewNote: "Needs work",
    });

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [chapterOne] },
      chapterDetails: {
        "book-1": {
          1: createChapterDetail(chapterOne),
        },
      },
    });
    client.rejectReview = rejectReview;

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(1);
    });

    await act(async () => {
      await result.current.openBook("book-1");
      await result.current.selectTab("review");
    });

    act(() => {
      result.current.setChapterDirty(true);
    });

    await act(async () => {
      await result.current.rejectReview("Needs work");
    });

    expect(rejectReview).not.toHaveBeenCalled();
    expect(result.current.chapterDirty).toBe(true);
    expect(result.current.error).toBe("Save or discard manuscript changes before updating review status.");
  });

  it("blocks switching inspector tabs while a chapter save is in flight", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const chapterOne = createChapterSummary({ number: 1, title: "Arrival", status: "draft" });

    let resolveSave: (() => void) | undefined;
    const saveChapter = vi.fn(
      async (_bookId: string, _chapterNumber: number, content: string) =>
        await new Promise<ChapterDetail>((resolve) => {
          resolveSave = () => resolve({ ...createChapterDetail(chapterOne), content });
        }),
    );

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [chapterOne] },
      chapterDetails: { "book-1": { 1: createChapterDetail(chapterOne) } },
    });
    client.saveChapter = saveChapter;

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(1);
    });

    await act(async () => {
      await result.current.openBook("book-1");
    });

    act(() => {
      result.current.setChapterDirty(true);
    });

    let savePromise: Promise<void> | undefined;
    await act(async () => {
      savePromise = result.current.saveChapter("# Arrival\n\nUpdated body.");
    });

    await act(async () => {
      await result.current.selectTab("review");
    });

    expect(result.current.activeTab).toBe("chapters");
    expect(result.current.error).toBe("Please wait for the current save or review update to finish.");

    await act(async () => {
      resolveSave?.();
      await savePromise;
    });
  });

  it("blocks switching inspector tabs while a review mutation is in flight", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const chapterOne = createChapterSummary({ number: 1, title: "Arrival", status: "ready-for-review" });

    let resolveApprove: (() => void) | undefined;
    const approveReview = vi.fn(
      async () =>
        await new Promise<ChapterDetail>((resolve) => {
          resolveApprove = () => resolve({ ...createChapterDetail(chapterOne), status: "approved" });
        }),
    );

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [chapterOne] },
      chapterDetails: { "book-1": { 1: createChapterDetail(chapterOne) } },
    });
    client.approveReview = approveReview;

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(1);
    });

    await act(async () => {
      await result.current.openBook("book-1");
      await result.current.selectTab("review");
    });

    let approvePromise: Promise<void> | undefined;
    await act(async () => {
      approvePromise = result.current.approveReview();
    });

    await act(async () => {
      await result.current.selectTab("runs");
    });

    expect(result.current.activeTab).toBe("review");
    expect(result.current.error).toBe("Please wait for the current save or review update to finish.");

    await act(async () => {
      resolveApprove?.();
      await approvePromise;
    });
  });

  it("blocks refresh while a chapter save is in flight", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const chapterOne = createChapterSummary({ number: 1, title: "Arrival", status: "draft" });

    let resolveSave: (() => void) | undefined;
    const saveChapter = vi.fn(
      async (_bookId: string, _chapterNumber: number, content: string) =>
        await new Promise<ChapterDetail>((resolve) => {
          resolveSave = () => resolve({ ...createChapterDetail(chapterOne), content });
        }),
    );
    const listBooks = vi.fn<StudioApiClient["listBooks"]>().mockResolvedValue([book]);

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [chapterOne] },
      chapterDetails: { "book-1": { 1: createChapterDetail(chapterOne) } },
    });
    client.saveChapter = saveChapter;
    client.listBooks = listBooks;

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(1);
    });

    await act(async () => {
      await result.current.openBook("book-1");
    });

    act(() => {
      result.current.setChapterDirty(true);
    });

    let savePromise: Promise<void> | undefined;
    await act(async () => {
      savePromise = result.current.saveChapter("# Arrival\n\nUpdated body.");
    });

    const listBooksCallsBeforeRefresh = listBooks.mock.calls.length;

    await act(async () => {
      await result.current.refresh();
    });

    expect(listBooks).toHaveBeenCalledTimes(listBooksCallsBeforeRefresh);
    expect(result.current.error).toBe("Please wait for the current save or review update to finish.");
    expect(result.current.selectedBook?.id).toBe("book-1");

    await act(async () => {
      resolveSave?.();
      await savePromise;
    });
  });

  it("blocks refresh while a review mutation is in flight", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const chapterOne = createChapterSummary({ number: 1, title: "Arrival", status: "ready-for-review" });

    let resolveApprove: (() => void) | undefined;
    const approveReview = vi.fn(
      async () =>
        await new Promise<ChapterDetail>((resolve) => {
          resolveApprove = () => resolve({ ...createChapterDetail(chapterOne), status: "approved" });
        }),
    );
    const listBooks = vi.fn<StudioApiClient["listBooks"]>().mockResolvedValue([book]);

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [chapterOne] },
      chapterDetails: { "book-1": { 1: createChapterDetail(chapterOne) } },
    });
    client.approveReview = approveReview;
    client.listBooks = listBooks;

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(1);
    });

    await act(async () => {
      await result.current.openBook("book-1");
    });

    let approvePromise: Promise<void> | undefined;
    await act(async () => {
      approvePromise = result.current.approveReview();
    });

    const listBooksCallsBeforeRefresh = listBooks.mock.calls.length;

    await act(async () => {
      await result.current.refresh();
    });

    expect(listBooks).toHaveBeenCalledTimes(listBooksCallsBeforeRefresh);
    expect(result.current.error).toBe("Please wait for the current save or review update to finish.");
    expect(result.current.selectedBook?.id).toBe("book-1");

    await act(async () => {
      resolveApprove?.();
      await approvePromise;
    });
  });

  it("blocks refresh while the active chapter has unsaved draft changes", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const chapterOne = createChapterSummary({ number: 1, title: "Arrival", status: "draft" });
    const listBooks = vi.fn<StudioApiClient["listBooks"]>().mockResolvedValue([book]);
    const getBook = vi.fn<StudioApiClient["getBook"]>().mockResolvedValue(createBookDetail(book));
    const listChapters = vi.fn<StudioApiClient["listChapters"]>().mockResolvedValue([chapterOne]);
    const getChapter = vi.fn<StudioApiClient["getChapter"]>().mockResolvedValue(createChapterDetail(chapterOne));

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [chapterOne] },
      chapterDetails: { "book-1": { 1: createChapterDetail(chapterOne) } },
    });
    client.listBooks = listBooks;
    client.getBook = getBook;
    client.listChapters = listChapters;
    client.getChapter = getChapter;

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.activeView).toBe("workspace");
    });

    act(() => {
      result.current.setChapterDirty(true);
    });

    const listBooksCallsBeforeRefresh = listBooks.mock.calls.length;
    const getBookCallsBeforeRefresh = getBook.mock.calls.length;
    const listChaptersCallsBeforeRefresh = listChapters.mock.calls.length;
    const getChapterCallsBeforeRefresh = getChapter.mock.calls.length;

    await act(async () => {
      await result.current.refresh();
    });

    expect(listBooks).toHaveBeenCalledTimes(listBooksCallsBeforeRefresh);
    expect(getBook).toHaveBeenCalledTimes(getBookCallsBeforeRefresh);
    expect(listChapters).toHaveBeenCalledTimes(listChaptersCallsBeforeRefresh);
    expect(getChapter).toHaveBeenCalledTimes(getChapterCallsBeforeRefresh);
    expect(result.current.error).toBe("Save or discard manuscript changes before refreshing the desk.");
    expect(result.current.selectedChapter?.number).toBe(1);
    expect(result.current.chapter?.content).toBe("# Arrival");
  });

  it("warns before opening another book with unsaved changes", async () => {
    const firstBook = createBookSummary({ id: "book-1", title: "Northbound", chapters: 2, chapterCount: 2, lastChapterNumber: 2 });
    const secondBook = createBookSummary({ id: "book-2", title: "Southbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    const client = createClient({
      books: [firstBook, secondBook],
      bookDetails: {
        "book-1": createBookDetail(firstBook),
        "book-2": createBookDetail(secondBook),
      },
      chapters: {
        "book-1": [createChapterSummary({ number: 1, title: "Arrival", status: "ready-for-review" })],
        "book-2": [createChapterSummary({ number: 1, title: "Wake", status: "draft" })],
      },
      chapterDetails: {
        "book-1": {
          1: createChapterDetail(createChapterSummary({ number: 1, title: "Arrival", status: "ready-for-review" })),
        },
        "book-2": {
          1: createChapterDetail(createChapterSummary({ number: 1, title: "Wake", status: "draft" })),
        },
      },
    });

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(2);
    });

    await act(async () => {
      await result.current.openBook("book-1");
      await result.current.selectTab("chapters");
    });

    act(() => {
      result.current.setChapterDirty(true);
    });

    await act(async () => {
      await result.current.openBook("book-2");
    });

    expect(confirmSpy).toHaveBeenCalledWith("You have unsaved changes for this chapter. Discard them and open another book?");
    expect(result.current.selectedBook?.id).toBe("book-1");
    confirmSpy.mockRestore();
  });

  it("blocks navigation while a chapter save is in flight", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound", chapters: 2, chapterCount: 2, lastChapterNumber: 2 });
    const chapterOne = createChapterSummary({ number: 1, title: "Arrival", status: "ready-for-review" });
    const chapterTwo = createChapterSummary({ number: 2, title: "Signal", status: "draft" });

    let resolveSave: (() => void) | undefined;
    const saveChapter = vi.fn(
      async (_bookId: string, _chapterNumber: number, content: string) =>
        await new Promise<ChapterDetail>((resolve) => {
          resolveSave = () => {
            resolve({
              ...createChapterDetail(chapterOne),
              content,
            });
          };
        }),
    );

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [chapterOne, chapterTwo] },
      chapterDetails: {
        "book-1": {
          1: createChapterDetail(chapterOne),
          2: createChapterDetail(chapterTwo),
        },
      },
    });
    client.saveChapter = saveChapter;

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(1);
    });

    await act(async () => {
      await result.current.openBook("book-1");
      await result.current.selectTab("chapters");
    });

    act(() => {
      result.current.setChapterDirty(true);
    });

    let savePromise: Promise<void> | undefined;
    await act(async () => {
      savePromise = result.current.saveChapter("# Arrival\n\nUpdated body.");
    });

    await act(async () => {
      await result.current.selectChapter(1);
    });

    expect(result.current.selectedChapter?.number).toBe(2);
    expect(result.current.error).toBe("Please wait for the current save or review update to finish.");

    await act(async () => {
      resolveSave?.();
      await savePromise;
    });
  });

  it("ignores stale book loads during rapid book switching", async () => {
    const firstBook = createBookSummary({ id: "book-1", title: "Northbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const secondBook = createBookSummary({ id: "book-2", title: "Southbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const firstChapter = createChapterSummary({ number: 1, title: "Arrival", status: "draft" });
    const secondChapter = createChapterSummary({ number: 1, title: "Wake", status: "draft" });

    let resolveFirstBook: (() => void) | undefined;
    const getBook = vi.fn(async (bookId: string) => {
      if (bookId === "book-1") {
        await new Promise<void>((resolve) => {
          resolveFirstBook = resolve;
        });
        return createBookDetail(firstBook);
      }

      return createBookDetail(secondBook);
    });

    const client = createClient({
      books: [firstBook, secondBook],
      bookDetails: {
        "book-1": createBookDetail(firstBook),
        "book-2": createBookDetail(secondBook),
      },
      chapters: {
        "book-1": [firstChapter],
        "book-2": [secondChapter],
      },
      chapterDetails: {
        "book-1": { 1: createChapterDetail(firstChapter) },
        "book-2": { 1: createChapterDetail(secondChapter) },
      },
    });
    client.getBook = getBook;

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(2);
    });

    let firstOpenPromise: Promise<void> | undefined;
    act(() => {
      firstOpenPromise = result.current.openBook("book-1");
    });

    await act(async () => {
      await result.current.openBook("book-2");
    });

    resolveFirstBook?.();
    await act(async () => {
      await firstOpenPromise;
    });

    expect(result.current.selectedBook?.id).toBe("book-2");
    expect(result.current.selectedChapter?.title).toBe("Wake");
  });

  it("ignores stale health success after the user has already returned elsewhere", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const chapter = createChapterSummary({ number: 1, title: "Arrival", status: "draft" });

    let resolveHealth: (() => void) | undefined;
    const getHealth = vi
      .fn<StudioApiClient["getHealth"]>()
      .mockResolvedValueOnce(createHealthStatus())
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          resolveHealth = resolve;
        });

        return createHealthStatus();
      });

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [chapter] },
      chapterDetails: { "book-1": { 1: createChapterDetail(chapter) } },
    });
    client.getHealth = getHealth;

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(1);
    });

    await act(async () => {
      await result.current.openBook("book-1");
    });

    let healthPromise: Promise<void> | undefined;
    act(() => {
      healthPromise = result.current.showHealth();
    });

    act(() => {
      result.current.showDashboard();
    });

    resolveHealth?.();
    await act(async () => {
      await healthPromise;
    });

    expect(result.current.activeView).toBe("dashboard");
    expect(result.current.loading).toBe(false);
  });

  it("ignores stale rejected health requests without surfacing old errors or keeping loading active", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const chapter = createChapterSummary({ number: 1, title: "Arrival", status: "draft" });

    let rejectHealth: ((error: Error) => void) | undefined;
    const getHealth = vi
      .fn<StudioApiClient["getHealth"]>()
      .mockResolvedValueOnce(createHealthStatus())
      .mockImplementationOnce(
        async () =>
          await new Promise<HealthStatus>((_resolve, reject) => {
            rejectHealth = reject;
          }),
      );

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [chapter] },
      chapterDetails: { "book-1": { 1: createChapterDetail(chapter) } },
    });
    client.getHealth = getHealth;

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(1);
    });

    await act(async () => {
      await result.current.openBook("book-1");
    });

    let healthPromise: Promise<void> | undefined;
    act(() => {
      healthPromise = result.current.showHealth();
    });

    act(() => {
      result.current.showDashboard();
    });

    rejectHealth?.(new Error("stale health failure"));
    await act(async () => {
      await healthPromise;
    });

    expect(result.current.activeView).toBe("dashboard");
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("does not auto-inject a blocked refresh error when save state changes", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const chapter = createChapterSummary({ number: 1, title: "Arrival", status: "draft" });

    let resolveSave: (() => void) | undefined;
    const saveChapter = vi.fn(
      async (_bookId: string, _chapterNumber: number, content: string) =>
        await new Promise<ChapterDetail>((resolve) => {
          resolveSave = () => resolve({ ...createChapterDetail(chapter), content });
        }),
    );

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [chapter] },
      chapterDetails: { "book-1": { 1: createChapterDetail(chapter) } },
    });
    client.saveChapter = saveChapter;

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(1);
    });

    await act(async () => {
      await result.current.openBook("book-1");
    });

    act(() => {
      result.current.setChapterDirty(true);
    });

    let savePromise: Promise<void> | undefined;
    await act(async () => {
      savePromise = result.current.saveChapter("# Arrival\n\nUpdated body.");
    });

    expect(result.current.error).toBeNull();

    await act(async () => {
      resolveSave?.();
      await savePromise;
    });
  });

  it("ignores truth-file bootstrap results after leaving the reference shelf", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const chapter = createChapterSummary({ number: 1, title: "Arrival", status: "draft" });
    const truthSummary = {
      name: "current_state.md",
      label: "Current State",
      exists: true,
      path: "story/current_state.md",
      optional: false,
      available: true,
    } satisfies TruthFileSummary;

    let resolveTruthFile: (() => void) | undefined;
    const getTruthFile = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        resolveTruthFile = resolve;
      });

      return {
        ...truthSummary,
        content: "# Current state",
      } satisfies TruthFileDetail;
    });

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [chapter] },
      chapterDetails: { "book-1": { 1: createChapterDetail(chapter) } },
      truthFiles: { "book-1": [truthSummary] },
      truthFileDetails: {
        "book-1": {
          "current_state.md": {
            ...truthSummary,
            content: "# Current state",
          },
        },
      },
    });
    client.getTruthFile = getTruthFile;

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(1);
    });

    await act(async () => {
      await result.current.openBook("book-1");
    });

    let truthFilesPromise: Promise<void> | undefined;
    act(() => {
      truthFilesPromise = result.current.selectTab("truth-files");
    });

    await act(async () => {
      await result.current.selectTab("review");
    });

    resolveTruthFile?.();
    await act(async () => {
      await truthFilesPromise;
    });

    expect(result.current.activeTab).toBe("review");
    expect(result.current.selectedTruthFile).toBeNull();
    expect(result.current.truthFile).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("retries truth-file bootstrap when the inspector stays on truth-files after invalidation", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const chapter = createChapterSummary({ number: 1, title: "Arrival", status: "draft" });
    const truthSummary = {
      name: "current_state.md",
      label: "Current State",
      exists: true,
      path: "story/current_state.md",
      optional: false,
      available: true,
    } satisfies TruthFileSummary;

    let resolveTruthFile: (() => void) | undefined;
    const getTruthFile = vi
      .fn<StudioApiClient["getTruthFile"]>()
      .mockImplementationOnce(
        async () =>
          await new Promise<TruthFileDetail>((resolve) => {
            resolveTruthFile = () =>
              resolve({
                ...truthSummary,
                content: "# Current state",
              });
          }),
      )
      .mockResolvedValue({
        ...truthSummary,
        content: "# Current state",
      });

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [chapter] },
      chapterDetails: { "book-1": { 1: createChapterDetail(chapter) } },
      truthFiles: { "book-1": [truthSummary] },
      truthFileDetails: {
        "book-1": {
          "current_state.md": {
            ...truthSummary,
            content: "# Current state",
          },
        },
      },
    });
    client.getTruthFile = getTruthFile;

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(1);
    });

    await act(async () => {
      await result.current.openBook("book-1");
    });

    let firstTruthFilesPromise: Promise<void> | undefined;
    act(() => {
      firstTruthFilesPromise = result.current.selectTab("truth-files");
    });

    await act(async () => {
      await result.current.refresh();
    });

    resolveTruthFile?.();
    await act(async () => {
      await firstTruthFilesPromise;
    });

    expect(result.current.activeTab).toBe("truth-files");
    expect(result.current.selectedTruthFile).toBeNull();
    expect(result.current.truthFile).toBeNull();

    await act(async () => {
      await result.current.selectTab("truth-files");
    });

    expect(result.current.selectedTruthFile?.name).toBe("current_state.md");
    expect(result.current.truthFile?.name).toBe("current_state.md");
    expect(getTruthFile).toHaveBeenCalledTimes(2);
  });

  it("ignores a late book load after the user navigates away", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const chapter = createChapterSummary({ number: 1, title: "Arrival", status: "draft" });

    let resolveBook: (() => void) | undefined;
    const getBook = vi.fn<StudioApiClient["getBook"]>(async () => {
      await new Promise<void>((resolve) => {
        resolveBook = resolve;
      });

      return createBookDetail(book);
    });

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [chapter] },
      chapterDetails: { "book-1": { 1: createChapterDetail(chapter) } },
    });
    client.getBook = getBook;

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(1);
    });

    let openBookPromise: Promise<void> | undefined;
    act(() => {
      openBookPromise = result.current.openBook("book-1");
    });

    act(() => {
      result.current.showDashboard();
    });

    resolveBook?.();
    await act(async () => {
      await openBookPromise;
    });

    expect(result.current.activeView).toBe("dashboard");
    expect(result.current.selectedBook).toBeNull();
  });

  it("ignores stale refresh results after showHealth starts", async () => {
    const book = createBookSummary({ id: "book-1", title: "Northbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const chapter = createChapterSummary({ number: 1, title: "Arrival", status: "draft" });

    let resolveRefreshBooks: (() => void) | undefined;
    let resolveRefreshHealth: (() => void) | undefined;
    const listBooks = vi.fn<StudioApiClient["listBooks"]>()
      .mockResolvedValueOnce([book])
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          resolveRefreshBooks = resolve;
        });

        return [];
      });
    const getHealth = vi.fn<StudioApiClient["getHealth"]>()
      .mockResolvedValueOnce(createHealthStatus())
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          resolveRefreshHealth = resolve;
        });

        return createHealthStatus();
      })
      .mockResolvedValue(createHealthStatus());

    const client = createClient({
      books: [book],
      bookDetails: { "book-1": createBookDetail(book) },
      chapters: { "book-1": [chapter] },
      chapterDetails: { "book-1": { 1: createChapterDetail(chapter) } },
    });
    client.listBooks = listBooks;
    client.getHealth = getHealth;

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(1);
    });

    let refreshPromise: Promise<void> | undefined;
    act(() => {
      refreshPromise = result.current.refresh();
    });

    await act(async () => {
      await result.current.showHealth();
    });

    resolveRefreshBooks?.();
    resolveRefreshHealth?.();
    await act(async () => {
      await refreshPromise;
    });

    expect(result.current.activeView).toBe("health");
    expect(result.current.books).toHaveLength(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("ignores stale refresh errors after opening a book", async () => {
    const firstBook = createBookSummary({ id: "book-1", title: "Northbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const secondBook = createBookSummary({ id: "book-2", title: "Southbound", chapters: 1, chapterCount: 1, lastChapterNumber: 1 });
    const firstChapter = createChapterSummary({ number: 1, title: "Arrival", status: "draft" });
    const secondChapter = createChapterSummary({ number: 1, title: "Wake", status: "draft" });

    let rejectRefreshBooks: ((error: Error) => void) | undefined;
    let rejectRefreshHealth: ((error: Error) => void) | undefined;
    const listBooks = vi.fn<StudioApiClient["listBooks"]>()
      .mockResolvedValueOnce([firstBook, secondBook])
      .mockImplementationOnce(
        async () =>
          await new Promise<ReadonlyArray<BookSummary>>((_resolve, reject) => {
            rejectRefreshBooks = reject;
          }),
      );
    const getHealth = vi.fn<StudioApiClient["getHealth"]>()
      .mockResolvedValueOnce(createHealthStatus())
      .mockImplementationOnce(
        async () =>
          await new Promise<HealthStatus>((_resolve, reject) => {
            rejectRefreshHealth = reject;
          }),
      );

    const client = createClient({
      books: [firstBook, secondBook],
      bookDetails: {
        "book-1": createBookDetail(firstBook),
        "book-2": createBookDetail(secondBook),
      },
      chapters: {
        "book-1": [firstChapter],
        "book-2": [secondChapter],
      },
      chapterDetails: {
        "book-1": { 1: createChapterDetail(firstChapter) },
        "book-2": { 1: createChapterDetail(secondChapter) },
      },
    });
    client.listBooks = listBooks;
    client.getHealth = getHealth;

    const { result } = renderHook(() => useStudioState({ client }));

    await waitFor(() => {
      expect(result.current.books).toHaveLength(2);
    });

    let refreshPromise: Promise<void> | undefined;
    act(() => {
      refreshPromise = result.current.refresh();
    });

    await act(async () => {
      await result.current.openBook("book-2");
    });

    rejectRefreshBooks?.(new Error("stale refresh books failure"));
    rejectRefreshHealth?.(new Error("stale refresh health failure"));
    await act(async () => {
      await refreshPromise;
    });

    expect(result.current.activeView).toBe("workspace");
    expect(result.current.selectedBook?.id).toBe("book-2");
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
