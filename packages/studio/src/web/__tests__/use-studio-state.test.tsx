// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
  it("selects the first reviewable chapter when opening a book", async () => {
    const firstBook = createBookSummary({
      id: "book-1",
      title: "Northbound",
      lastChapterNumber: 4,
      chapterCount: 4,
      chapters: 4,
      pendingReview: 2,
      pendingReviewChapters: 2,
    });

    const client = createClient({
      books: [firstBook],
      bookDetails: { "book-1": createBookDetail(firstBook) },
      chapters: {
        "book-1": [
          createChapterSummary({ number: 4, title: "Aftermath", status: "draft" }),
          createChapterSummary({ number: 2, title: "Trial", status: "audit-failed" }),
          createChapterSummary({ number: 3, title: "Signals", status: "ready-for-review" }),
        ],
      },
      chapterDetails: {
        "book-1": {
          2: createChapterDetail(createChapterSummary({ number: 2, title: "Trial", status: "audit-failed" })),
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

    expect(result.current.activeView).toBe("workspace");
    expect(result.current.selectedBook?.id).toBe("book-1");
    expect(result.current.selectedChapter?.number).toBe(2);
    expect(result.current.activeTab).toBe("review");
    expect(result.current.chapter?.number).toBe(2);
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

    expect(result.current.selectedChapter?.number).toBe(2);
    expect(result.current.truthFile?.name).toBe("current_state.md");

    await act(async () => {
      await result.current.openBook("book-2");
    });

    expect(result.current.selectedBook?.id).toBe("book-2");
    expect(result.current.activeTab).toBe("review");
    expect(result.current.selectedChapter?.number).toBe(5);
    expect(result.current.chapter?.number).toBe(5);
    expect(result.current.selectedTruthFile).toBeNull();
    expect(result.current.truthFile).toBeNull();
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
      await result.current.selectChapter(2);
    });

    expect(confirmSpy).toHaveBeenCalledWith("You have unsaved changes for this chapter. Discard them and switch chapters?");
    expect(result.current.selectedChapter?.number).toBe(1);
    expect(result.current.chapter?.number).toBe(1);
    confirmSpy.mockRestore();
  });

  it("warns before leaving the editor tab with unsaved changes", async () => {
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

    expect(confirmSpy).toHaveBeenCalledWith("You have unsaved changes for this chapter. Discard them and switch tabs?");
    expect(result.current.activeTab).toBe("chapters");
    confirmSpy.mockRestore();
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
      await result.current.selectChapter(2);
    });

    expect(result.current.selectedChapter?.number).toBe(1);
    expect(result.current.error).toBe("Please wait for the current save or review update to finish.");

    await act(async () => {
      resolveSave?.();
      await savePromise;
    });
  });
});
