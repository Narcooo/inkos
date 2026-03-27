import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BookDetail,
  BookSummary,
  ChapterDetail,
  ReviewActionPayload,
  ChapterSummary,
  HealthStatus,
  TruthFileDetail,
  TruthFileSummary,
} from "../../shared/contracts";
import { createStudioApiClient, type StudioApiClient } from "../api/client";

export type StudioView = "dashboard" | "workspace" | "health";
export type WorkspaceTab = "review" | "chapters" | "truth-files" | "runs";

export interface UseStudioStateOptions {
  readonly client?: StudioApiClient;
}

export interface StudioState {
  readonly activeView: StudioView;
  readonly activeTab: WorkspaceTab;
  readonly books: ReadonlyArray<BookSummary>;
  readonly selectedBook: BookDetail | null;
  readonly chapters: ReadonlyArray<ChapterSummary>;
  readonly selectedChapter: ChapterSummary | null;
  readonly chapter: ChapterDetail | null;
  readonly truthFiles: ReadonlyArray<TruthFileSummary>;
  readonly selectedTruthFile: TruthFileSummary | null;
  readonly truthFile: TruthFileDetail | null;
  readonly health: HealthStatus | null;
  readonly chapterDirty: boolean;
  readonly chapterDraftWordCount: number | null;
  readonly chapterSaving: boolean;
  readonly reviewSubmitting: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  readonly showDashboard: () => void;
  readonly showHealth: () => Promise<void>;
  readonly openBook: (bookId: string) => Promise<void>;
  readonly selectChapter: (chapterNumber: number) => Promise<void>;
  readonly setChapterDirty: (dirty: boolean) => void;
  readonly setChapterDraftWordCount: (wordCount: number | null) => void;
  readonly saveChapter: (content: string) => Promise<void>;
  readonly approveReview: () => Promise<void>;
  readonly rejectReview: (reason?: string) => Promise<void>;
  readonly selectTab: (tab: WorkspaceTab) => Promise<void>;
  readonly selectTruthFile: (name: string) => Promise<void>;
}

const LAST_ACTIVE_BOOK_STORAGE_KEY = "inkos.studio.last-active-book-id";
const LAST_ACTIVE_CHAPTER_STORAGE_KEY = "inkos.studio.last-active-chapter";

interface StoredLastActiveChapter {
  readonly bookId: string;
  readonly chapterNumber: number;
}

function sortChapters(chapters: ReadonlyArray<ChapterSummary>): Array<ChapterSummary> {
  return [...chapters].sort((left, right) => left.number - right.number);
}

function getDefaultChapter(
  chapters: ReadonlyArray<ChapterSummary>,
  preferredChapterNumber?: number | null,
): ChapterSummary | null {
  const sorted = sortChapters(chapters);
  if (preferredChapterNumber !== undefined && preferredChapterNumber !== null) {
    const preferredChapter = sorted.find((chapter) => chapter.number === preferredChapterNumber);
    if (preferredChapter) {
      return preferredChapter;
    }
  }

  return sorted.at(-1) ?? null;
}

function getDefaultTruthFile(truthFiles: ReadonlyArray<TruthFileSummary>): TruthFileSummary | null {
  return truthFiles.find((truthFile) => truthFile.available) ?? truthFiles[0] ?? null;
}

function confirmDiscardChapterChanges(action: string): boolean {
  return window.confirm(`You have unsaved changes for this chapter. Discard them and ${action}?`);
}

function getStoredValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStoredValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore browser storage failures and keep state in memory.
  }
}

function getStoredBookId(books: ReadonlyArray<BookSummary>): string | null {
  const storedBookId = getStoredValue(LAST_ACTIVE_BOOK_STORAGE_KEY);
  if (!storedBookId) {
    return null;
  }

  return books.some((book) => book.id === storedBookId) ? storedBookId : null;
}

function getStoredChapter(): StoredLastActiveChapter | null {
  const storedValue = getStoredValue(LAST_ACTIVE_CHAPTER_STORAGE_KEY);
  if (!storedValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(storedValue) as Partial<StoredLastActiveChapter>;
    if (typeof parsed.bookId !== "string" || typeof parsed.chapterNumber !== "number") {
      return null;
    }

    return {
      bookId: parsed.bookId,
      chapterNumber: parsed.chapterNumber,
    };
  } catch {
    return null;
  }
}

function rememberBook(bookId: string): void {
  setStoredValue(LAST_ACTIVE_BOOK_STORAGE_KEY, bookId);
}

function rememberChapter(bookId: string, chapterNumber: number): void {
  setStoredValue(LAST_ACTIVE_CHAPTER_STORAGE_KEY, JSON.stringify({ bookId, chapterNumber }));
}

async function resolveTruthFileSelection(
  client: StudioApiClient,
  bookId: string,
  truthFileSummary: TruthFileSummary | null,
): Promise<TruthFileDetail | null> {
  if (!truthFileSummary || !truthFileSummary.available) {
    return null;
  }

  return client.getTruthFile(bookId, truthFileSummary.name);
}

export function useStudioState(options: UseStudioStateOptions = {}): StudioState {
  const client = useMemo(() => options.client ?? createStudioApiClient(), [options.client]);
  const lastAutoOpenAttemptRefreshCycle = useRef(-1);
  const bookLoadRequestIdRef = useRef(0);
  const chapterLoadRequestIdRef = useRef(0);
  const truthFilesLoadRequestIdRef = useRef(0);
  const truthFileLoadRequestIdRef = useRef(0);
  const workspaceReloadRequestIdRef = useRef(0);
  const healthViewRequestIdRef = useRef(0);
  const uiRequestVersionRef = useRef(0);
  const activeViewRef = useRef<StudioView>("dashboard");
  const activeTabRef = useRef<WorkspaceTab>("chapters");
  const selectedBookRef = useRef<BookDetail | null>(null);
  const selectedChapterRef = useRef<ChapterSummary | null>(null);
  const chapterRef = useRef<ChapterDetail | null>(null);
  const truthFilesRef = useRef<ReadonlyArray<TruthFileSummary>>([]);
  const selectedTruthFileRef = useRef<TruthFileSummary | null>(null);
  const truthFileRef = useRef<TruthFileDetail | null>(null);
  const chaptersRef = useRef<ReadonlyArray<ChapterSummary>>([]);
  const [activeView, setActiveView] = useState<StudioView>("dashboard");
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("chapters");
  const [books, setBooks] = useState<ReadonlyArray<BookSummary>>([]);
  const [selectedBook, setSelectedBook] = useState<BookDetail | null>(null);
  const [chapters, setChapters] = useState<ReadonlyArray<ChapterSummary>>([]);
  const [selectedChapter, setSelectedChapter] = useState<ChapterSummary | null>(null);
  const [chapter, setChapter] = useState<ChapterDetail | null>(null);
  const [truthFiles, setTruthFiles] = useState<ReadonlyArray<TruthFileSummary>>([]);
  const [selectedTruthFile, setSelectedTruthFile] = useState<TruthFileSummary | null>(null);
  const [truthFile, setTruthFile] = useState<TruthFileDetail | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [chapterDirty, setChapterDirtyState] = useState(false);
  const [chapterDraftWordCount, setChapterDraftWordCountState] = useState<number | null>(null);
  const [chapterSaving, setChapterSaving] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshCycle, setRefreshCycle] = useState(0);
  const chapterSavingRef = useRef(chapterSaving);
  const reviewSubmittingRef = useRef(reviewSubmitting);
  const chapterDirtyRef = useRef(chapterDirty);

  useEffect(() => {
    chapterSavingRef.current = chapterSaving;
  }, [chapterSaving]);

  useEffect(() => {
    chapterDirtyRef.current = chapterDirty;
  }, [chapterDirty]);

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    selectedBookRef.current = selectedBook;
  }, [selectedBook]);

  useEffect(() => {
    chaptersRef.current = chapters;
  }, [chapters]);

  useEffect(() => {
    selectedChapterRef.current = selectedChapter;
  }, [selectedChapter]);

  useEffect(() => {
    chapterRef.current = chapter;
  }, [chapter]);

  useEffect(() => {
    truthFilesRef.current = truthFiles;
  }, [truthFiles]);

  useEffect(() => {
    selectedTruthFileRef.current = selectedTruthFile;
  }, [selectedTruthFile]);

  useEffect(() => {
    truthFileRef.current = truthFile;
  }, [truthFile]);

  useEffect(() => {
    reviewSubmittingRef.current = reviewSubmitting;
  }, [reviewSubmitting]);

  const reloadWorkspace = useCallback(
    async (bookId: string, chapterNumber: number | null) => {
      const requestId = ++workspaceReloadRequestIdRef.current;
      const [book, nextChapters] = await Promise.all([client.getBook(bookId), client.listChapters(bookId)]);
      const sortedChapters = sortChapters(nextChapters);
      const nextSelectedChapter =
        chapterNumber === null ? null : sortedChapters.find((entry) => entry.number === chapterNumber) ?? null;
      const nextChapter = nextSelectedChapter ? await client.getChapter(bookId, nextSelectedChapter.number) : null;

      if (requestId !== workspaceReloadRequestIdRef.current) {
        return;
      }

      setSelectedBook(book);
      setChapters(sortedChapters);
      setSelectedChapter(nextSelectedChapter);
      setChapter(nextChapter);
      setChapterDraftWordCountState(nextChapter?.wordCount ?? nextSelectedChapter?.wordCount ?? null);
    },
    [client],
  );

  const invalidateUiRequests = useCallback(() => {
    uiRequestVersionRef.current += 1;
    bookLoadRequestIdRef.current += 1;
    chapterLoadRequestIdRef.current += 1;
    truthFilesLoadRequestIdRef.current += 1;
    truthFileLoadRequestIdRef.current += 1;
    workspaceReloadRequestIdRef.current += 1;
    healthViewRequestIdRef.current += 1;
    return uiRequestVersionRef.current;
  }, []);

  const refresh = useCallback(async () => {
    if (chapterSavingRef.current || reviewSubmittingRef.current) {
      setError("Please wait for the current save or review update to finish.");
      return;
    }

    if (chapterDirtyRef.current) {
      setError("Save or discard manuscript changes before refreshing the desk.");
      return;
    }

    const requestVersion = invalidateUiRequests();
    setLoading(true);
    setError(null);

    try {
      const [nextBooks, nextHealth] = await Promise.all([client.listBooks(), client.getHealth()]);

      if (requestVersion !== uiRequestVersionRef.current) {
        return;
      }

      let nextSelectedBook = selectedBookRef.current;
      let nextChapters = chaptersRef.current;
      let nextSelectedChapter = selectedChapterRef.current;
      let nextChapter = chapterRef.current;
      let nextTruthFiles = truthFilesRef.current;
      let nextSelectedTruthFile = selectedTruthFileRef.current;
      let nextTruthFile = truthFileRef.current;

      if (activeViewRef.current === "workspace" && selectedBookRef.current) {
        const activeBook = selectedBookRef.current;
        const activeChapter = selectedChapterRef.current;
        const activeTruthFile = selectedTruthFileRef.current;
        const selectedBookStillExists = nextBooks.some((book) => book.id === activeBook.id);

        if (selectedBookStillExists) {
          const refreshedBook = await client.getBook(activeBook.id);
          const refreshedChapters = sortChapters(await client.listChapters(activeBook.id));
          const preferredChapterNumber = activeChapter?.number ?? null;
          const coherentSelectedChapter = getDefaultChapter(refreshedChapters, preferredChapterNumber);
          const refreshedChapter = coherentSelectedChapter
            ? await client.getChapter(activeBook.id, coherentSelectedChapter.number)
            : null;

          nextSelectedBook = refreshedBook;
          nextChapters = refreshedChapters;
          nextSelectedChapter = coherentSelectedChapter;
          nextChapter = refreshedChapter;

          if (
            activeTabRef.current === "truth-files" &&
            (truthFilesRef.current.length > 0 || selectedTruthFileRef.current !== null || truthFileRef.current !== null)
          ) {
            const refreshedTruthFiles = await client.listTruthFiles(activeBook.id);
            const refreshedSelectedTruthFile =
              refreshedTruthFiles.find((entry) => entry.name === activeTruthFile?.name) ?? getDefaultTruthFile(refreshedTruthFiles);
            const refreshedTruthFile = await resolveTruthFileSelection(client, activeBook.id, refreshedSelectedTruthFile);

            nextTruthFiles = refreshedTruthFiles;
            nextSelectedTruthFile = refreshedSelectedTruthFile;
            nextTruthFile = refreshedTruthFile;
          }
        } else {
          nextSelectedBook = null;
          nextChapters = [];
          nextSelectedChapter = null;
          nextChapter = null;
          nextTruthFiles = [];
          nextSelectedTruthFile = null;
          nextTruthFile = null;
        }
      }

      setBooks(nextBooks);
      setHealth(nextHealth);
      setSelectedBook(nextSelectedBook);
      setChapters(nextChapters);
      setSelectedChapter(nextSelectedChapter);
      setChapter(nextChapter);
      setChapterDraftWordCountState(nextChapter?.wordCount ?? nextSelectedChapter?.wordCount ?? null);
      setTruthFiles(nextTruthFiles);
      setSelectedTruthFile(nextSelectedTruthFile);
      setTruthFile(nextTruthFile);
    } catch (cause) {
      if (requestVersion !== uiRequestVersionRef.current) {
        return;
      }

      setError(cause instanceof Error ? cause.message : "Unable to load studio state.");
    } finally {
      if (requestVersion === uiRequestVersionRef.current) {
        setLoading(false);
        setRefreshCycle((current) => current + 1);
      }
    }
  }, [client, invalidateUiRequests]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const guardWorkspaceTransition = useCallback(
    (action: string) => {
      if (chapterSaving || reviewSubmitting) {
        setError("Please wait for the current save or review update to finish.");
        return false;
      }

      if (!chapterDirty) {
        return true;
      }

      const shouldDiscard = confirmDiscardChapterChanges(action);
      if (!shouldDiscard) {
        return false;
      }

      setChapterDirtyState(false);
      return true;
    },
    [chapterDirty, chapterSaving, reviewSubmitting],
  );

  const setChapterDirty = useCallback(
    (dirty: boolean) => {
      setChapterDirtyState(dirty);

      if (dirty && selectedBook && selectedChapter) {
        rememberChapter(selectedBook.id, selectedChapter.number);
      }
    },
    [selectedBook, selectedChapter],
  );

  const setChapterDraftWordCount = useCallback((wordCount: number | null) => {
    setChapterDraftWordCountState(wordCount);
  }, []);

  const showDashboard = useCallback(() => {
    if (activeView === "workspace" && !guardWorkspaceTransition("leave the workspace")) {
      return;
    }

    invalidateUiRequests();
    setLoading(false);
    setActiveView("dashboard");
  }, [activeView, guardWorkspaceTransition, invalidateUiRequests]);

  const showHealth = useCallback(async () => {
    if (activeView === "workspace" && !guardWorkspaceTransition("open the health view")) {
      return;
    }

      const requestVersion = invalidateUiRequests();
      const requestId = healthViewRequestIdRef.current;
      setLoading(true);
      setError(null);

      try {
        const nextHealth = await client.getHealth();

        if (requestId !== healthViewRequestIdRef.current || requestVersion !== uiRequestVersionRef.current) {
          return;
        }

        setHealth(nextHealth);
        setActiveView("health");
      } catch (cause) {
        if (requestId !== healthViewRequestIdRef.current || requestVersion !== uiRequestVersionRef.current) {
          return;
        }

        setError(cause instanceof Error ? cause.message : "Unable to load health view.");
      } finally {
        if (requestId === healthViewRequestIdRef.current && requestVersion === uiRequestVersionRef.current) {
          setLoading(false);
        }
      }
  }, [activeView, client, guardWorkspaceTransition, invalidateUiRequests]);

  const selectChapter = useCallback(
    async (chapterNumber: number) => {
      if (!selectedBook) {
        return;
      }

      if (selectedChapter?.number === chapterNumber) {
        return;
      }

      if (!guardWorkspaceTransition("switch chapters")) {
        return;
      }

      const nextSelectedChapter = chapters.find((entry) => entry.number === chapterNumber) ?? null;
      if (!nextSelectedChapter) {
        return;
      }

      const requestVersion = invalidateUiRequests();
      const requestId = chapterLoadRequestIdRef.current;

      setLoading(true);
      setError(null);

      try {
        const nextChapter = await client.getChapter(selectedBook.id, chapterNumber);

        if (requestId !== chapterLoadRequestIdRef.current || requestVersion !== uiRequestVersionRef.current) {
          return;
        }

        setSelectedChapter(nextSelectedChapter);
        setChapter(nextChapter);
        setChapterDraftWordCountState(nextChapter?.wordCount ?? nextSelectedChapter?.wordCount ?? null);
          setChapterDirtyState(false);
      } catch (cause) {
        if (requestId !== chapterLoadRequestIdRef.current || requestVersion !== uiRequestVersionRef.current) {
          return;
        }

        setError(cause instanceof Error ? cause.message : "Unable to load chapter.");
      } finally {
        if (requestId === chapterLoadRequestIdRef.current && requestVersion === uiRequestVersionRef.current) {
          setLoading(false);
        }
      }
    },
    [chapters, client, guardWorkspaceTransition, selectedBook, selectedChapter],
  );

  const selectTruthFile = useCallback(
    async (name: string) => {
      if (!selectedBook) {
        return;
      }

      const nextSelectedTruthFile = truthFiles.find((entry) => entry.name === name) ?? null;
      if (!nextSelectedTruthFile) {
        return;
      }

      const requestVersion = invalidateUiRequests();
      const requestId = truthFileLoadRequestIdRef.current;

      setLoading(true);
      setError(null);

      try {
        if (!nextSelectedTruthFile.available) {
          setSelectedTruthFile(nextSelectedTruthFile);
          setTruthFile(null);
          return;
        }

        const nextTruthFile = await resolveTruthFileSelection(client, selectedBook.id, nextSelectedTruthFile);

        if (requestId !== truthFileLoadRequestIdRef.current || requestVersion !== uiRequestVersionRef.current) {
          return;
        }

        setSelectedTruthFile(nextSelectedTruthFile);
        setTruthFile(nextTruthFile);
      } catch (cause) {
        if (requestId !== truthFileLoadRequestIdRef.current || requestVersion !== uiRequestVersionRef.current) {
          return;
        }

        setError(cause instanceof Error ? cause.message : "Unable to load truth file.");
      } finally {
        if (requestId === truthFileLoadRequestIdRef.current && requestVersion === uiRequestVersionRef.current) {
          setLoading(false);
        }
      }
    },
    [client, selectedBook, truthFiles],
  );

  const selectTab = useCallback(
    async (tab: WorkspaceTab) => {
      const shouldRetryTruthFilesBootstrap =
        tab === "truth-files" &&
        activeTab === "truth-files" &&
        selectedBook !== null &&
        truthFiles.length === 0 &&
        selectedTruthFile === null &&
        truthFile === null;

      if (tab === activeTab && !shouldRetryTruthFilesBootstrap) {
        return;
      }

      if (chapterSaving || reviewSubmitting) {
        setError("Please wait for the current save or review update to finish.");
        return;
      }

      if (activeTab === "truth-files" && tab !== "truth-files") {
        truthFilesLoadRequestIdRef.current += 1;
        truthFileLoadRequestIdRef.current += 1;
        setLoading(false);
      }

      setActiveTab(tab);

      if (tab !== "truth-files" || !selectedBook) {
        return;
      }

      if (truthFiles.length > 0) {
        const coherentSelection = selectedTruthFile && truthFile && selectedTruthFile.name === truthFile.name;

        if (coherentSelection) {
          return;
        }

        const nextSelectedTruthFile = selectedTruthFile ?? getDefaultTruthFile(truthFiles);
        if (!nextSelectedTruthFile) {
          return;
        }

        await selectTruthFile(nextSelectedTruthFile.name);
        return;
      }

      const requestVersion = invalidateUiRequests();
      const requestId = truthFilesLoadRequestIdRef.current;

      setLoading(true);
      setError(null);

      try {
        const nextTruthFiles = await client.listTruthFiles(selectedBook.id);
        const defaultTruthFile = getDefaultTruthFile(nextTruthFiles);
        const nextTruthFile = await resolveTruthFileSelection(client, selectedBook.id, defaultTruthFile);

        if (requestId !== truthFilesLoadRequestIdRef.current || requestVersion !== uiRequestVersionRef.current) {
          return;
        }

        setTruthFiles(nextTruthFiles);
        setSelectedTruthFile(defaultTruthFile);
        setTruthFile(nextTruthFile);
      } catch (cause) {
        if (requestId !== truthFilesLoadRequestIdRef.current || requestVersion !== uiRequestVersionRef.current) {
          return;
        }

        setError(cause instanceof Error ? cause.message : "Unable to load truth files.");
      } finally {
        if (requestId === truthFilesLoadRequestIdRef.current && requestVersion === uiRequestVersionRef.current) {
          setLoading(false);
        }
      }
    },
    [activeTab, chapterSaving, client, reviewSubmitting, selectTruthFile, selectedBook, selectedTruthFile, truthFile, truthFiles],
  );

  const loadBook = useCallback(
    async (bookId: string, preferredChapterNumber?: number | null) => {
      if (selectedBook?.id === bookId && activeView === "workspace") {
        return;
      }

      if ((activeView === "workspace" || selectedBook) && !guardWorkspaceTransition("open another book")) {
        return;
      }

      const requestVersion = invalidateUiRequests();
      const requestId = bookLoadRequestIdRef.current;
      setLoading(true);
      setError(null);
      setActiveTab("chapters");

      try {
        const [book, nextChapters] = await Promise.all([client.getBook(bookId), client.listChapters(bookId)]);
        const defaultChapter = getDefaultChapter(nextChapters, preferredChapterNumber);
        const nextChapter = defaultChapter ? await client.getChapter(bookId, defaultChapter.number) : null;

        if (requestId !== bookLoadRequestIdRef.current || requestVersion !== uiRequestVersionRef.current) {
          return;
        }

        setSelectedBook(book);
        setChapters(sortChapters(nextChapters));
        setSelectedChapter(defaultChapter);
        setChapter(nextChapter);
        setChapterDraftWordCountState(nextChapter?.wordCount ?? defaultChapter?.wordCount ?? null);
        setChapterDirtyState(false);
        setTruthFiles([]);
        setSelectedTruthFile(null);
        setTruthFile(null);
        setActiveTab(defaultChapter ? "chapters" : "runs");
        setActiveView("workspace");
        rememberBook(bookId);
      } catch (cause) {
        if (requestId !== bookLoadRequestIdRef.current || requestVersion !== uiRequestVersionRef.current) {
          return;
        }

        setError(cause instanceof Error ? cause.message : "Unable to open book.");
      } finally {
        if (requestId === bookLoadRequestIdRef.current && requestVersion === uiRequestVersionRef.current) {
          setLoading(false);
        }
      }
    },
    [activeView, client, guardWorkspaceTransition, invalidateUiRequests, selectedBook],
  );

  const openBook = useCallback(
    async (bookId: string) => {
      await loadBook(bookId);
    },
    [loadBook],
  );

  useEffect(() => {
    if (loading || activeView === "workspace" || selectedBook) {
      return;
    }

    const defaultBookId = getStoredBookId(books) ?? books[0]?.id;
    if (!defaultBookId) {
      return;
    }

    if (lastAutoOpenAttemptRefreshCycle.current === refreshCycle) {
      return;
    }

    lastAutoOpenAttemptRefreshCycle.current = refreshCycle;

    const storedChapter = getStoredChapter();
    const preferredChapterNumber = storedChapter?.bookId === defaultBookId ? storedChapter.chapterNumber : null;
    void loadBook(defaultBookId, preferredChapterNumber);
  }, [activeView, books, loadBook, loading, refreshCycle, selectedBook]);

  const saveChapter = useCallback(
    async (content: string) => {
      if (!selectedBook || !selectedChapter) {
        return;
      }

      setChapterSaving(true);
      setError(null);

      try {
        await client.saveChapter(selectedBook.id, selectedChapter.number, content);
        await reloadWorkspace(selectedBook.id, selectedChapter.number);
        setChapterDirtyState(false);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to save chapter.");
      } finally {
        setChapterSaving(false);
      }
    },
    [client, reloadWorkspace, selectedBook, selectedChapter],
  );

  const runReviewAction = useCallback(
    async (action: (bookId: string, payload: ReviewActionPayload) => Promise<ChapterDetail>, reason?: string) => {
      if (!selectedBook || !selectedChapter) {
        return;
      }

      if (chapterDirty) {
        setError("Save or discard manuscript changes before updating review status.");
        return;
      }

      setReviewSubmitting(true);
      setError(null);

      try {
        await action(selectedBook.id, {
          chapterNumber: selectedChapter.number,
          ...(reason ? { reason } : {}),
        });
        await reloadWorkspace(selectedBook.id, selectedChapter.number);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to update review state.");
      } finally {
        setReviewSubmitting(false);
      }
    },
    [chapterDirty, reloadWorkspace, selectedBook, selectedChapter],
  );

  const approveReview = useCallback(async () => {
    await runReviewAction(client.approveReview);
  }, [client.approveReview, runReviewAction]);

  const rejectReview = useCallback(
    async (reason?: string) => {
      await runReviewAction(client.rejectReview, reason);
    },
    [client.rejectReview, runReviewAction],
  );

  return {
    activeView,
    activeTab,
    books,
    selectedBook,
    chapters,
    selectedChapter,
    chapter,
    truthFiles,
    selectedTruthFile,
    truthFile,
    health,
    chapterDirty,
    chapterDraftWordCount,
    chapterSaving,
    reviewSubmitting,
    loading,
    error,
    refresh,
    showDashboard,
    showHealth,
    openBook,
    selectChapter,
    setChapterDirty,
    setChapterDraftWordCount,
    saveChapter,
    approveReview,
    rejectReview,
    selectTab,
    selectTruthFile,
  };
}
