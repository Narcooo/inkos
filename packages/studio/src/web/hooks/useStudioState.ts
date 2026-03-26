import { useCallback, useEffect, useMemo, useState } from "react";
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
  readonly saveChapter: (content: string) => Promise<void>;
  readonly approveReview: () => Promise<void>;
  readonly rejectReview: (reason?: string) => Promise<void>;
  readonly selectTab: (tab: WorkspaceTab) => Promise<void>;
  readonly selectTruthFile: (name: string) => Promise<void>;
}

function sortChapters(chapters: ReadonlyArray<ChapterSummary>): Array<ChapterSummary> {
  return [...chapters].sort((left, right) => left.number - right.number);
}

function getDefaultChapter(chapters: ReadonlyArray<ChapterSummary>): ChapterSummary | null {
  const sorted = sortChapters(chapters);
  const reviewable = sorted.find(
    (chapter) => chapter.status === "ready-for-review" || chapter.status === "audit-failed",
  );
  if (reviewable) {
    return reviewable;
  }

  return sorted.at(-1) ?? null;
}

function getDefaultTruthFile(truthFiles: ReadonlyArray<TruthFileSummary>): TruthFileSummary | null {
  return truthFiles.find((truthFile) => truthFile.available) ?? truthFiles[0] ?? null;
}

function confirmDiscardChapterChanges(action: string): boolean {
  return window.confirm(`You have unsaved changes for this chapter. Discard them and ${action}?`);
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
  const [activeView, setActiveView] = useState<StudioView>("dashboard");
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("review");
  const [books, setBooks] = useState<ReadonlyArray<BookSummary>>([]);
  const [selectedBook, setSelectedBook] = useState<BookDetail | null>(null);
  const [chapters, setChapters] = useState<ReadonlyArray<ChapterSummary>>([]);
  const [selectedChapter, setSelectedChapter] = useState<ChapterSummary | null>(null);
  const [chapter, setChapter] = useState<ChapterDetail | null>(null);
  const [truthFiles, setTruthFiles] = useState<ReadonlyArray<TruthFileSummary>>([]);
  const [selectedTruthFile, setSelectedTruthFile] = useState<TruthFileSummary | null>(null);
  const [truthFile, setTruthFile] = useState<TruthFileDetail | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [chapterDirty, setChapterDirty] = useState(false);
  const [chapterSaving, setChapterSaving] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reloadWorkspace = useCallback(
    async (bookId: string, chapterNumber: number | null) => {
      const [book, nextChapters] = await Promise.all([client.getBook(bookId), client.listChapters(bookId)]);
      const sortedChapters = sortChapters(nextChapters);
      const nextSelectedChapter =
        chapterNumber === null ? null : sortedChapters.find((entry) => entry.number === chapterNumber) ?? null;
      const nextChapter = nextSelectedChapter ? await client.getChapter(bookId, nextSelectedChapter.number) : null;

      setSelectedBook(book);
      setChapters(sortedChapters);
      setSelectedChapter(nextSelectedChapter);
      setChapter(nextChapter);
    },
    [client],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [nextBooks, nextHealth] = await Promise.all([client.listBooks(), client.getHealth()]);
      setBooks(nextBooks);
      setHealth(nextHealth);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load studio state.");
    } finally {
      setLoading(false);
    }
  }, [client]);

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

      setChapterDirty(false);
      return true;
    },
    [chapterDirty, chapterSaving, reviewSubmitting],
  );

  const showDashboard = useCallback(() => {
    if (activeView === "workspace" && !guardWorkspaceTransition("leave the workspace")) {
      return;
    }

    setActiveView("dashboard");
  }, [activeView, guardWorkspaceTransition]);

  const showHealth = useCallback(async () => {
    if (activeView === "workspace" && !guardWorkspaceTransition("open the health view")) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const nextHealth = await client.getHealth();
      setHealth(nextHealth);
      setActiveView("health");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load health view.");
    } finally {
      setLoading(false);
    }
  }, [activeView, client, guardWorkspaceTransition]);

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

      setLoading(true);
      setError(null);

      try {
        const nextChapter = await client.getChapter(selectedBook.id, chapterNumber);
        setSelectedChapter(nextSelectedChapter);
        setChapter(nextChapter);
        setChapterDirty(false);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to load chapter.");
      } finally {
        setLoading(false);
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

      setLoading(true);
      setError(null);

      try {
        setSelectedTruthFile(nextSelectedTruthFile);
        const nextTruthFile = await resolveTruthFileSelection(client, selectedBook.id, nextSelectedTruthFile);
        setTruthFile(nextTruthFile);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to load truth file.");
      } finally {
        setLoading(false);
      }
    },
    [client, selectedBook, truthFiles],
  );

  const selectTab = useCallback(
    async (tab: WorkspaceTab) => {
      if (tab === activeTab) {
        return;
      }

      if (!guardWorkspaceTransition("switch tabs")) {
        return;
      }

      setActiveTab(tab);

      if (tab !== "truth-files" || !selectedBook || truthFiles.length > 0) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const nextTruthFiles = await client.listTruthFiles(selectedBook.id);
        const defaultTruthFile = getDefaultTruthFile(nextTruthFiles);

        setTruthFiles(nextTruthFiles);
        setSelectedTruthFile(defaultTruthFile);
        setTruthFile(await resolveTruthFileSelection(client, selectedBook.id, defaultTruthFile));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to load truth files.");
      } finally {
        setLoading(false);
      }
    },
    [activeTab, client, guardWorkspaceTransition, selectedBook, truthFiles],
  );

  const openBook = useCallback(
    async (bookId: string) => {
      if (selectedBook?.id === bookId && activeView === "workspace") {
        return;
      }

      if ((activeView === "workspace" || selectedBook) && !guardWorkspaceTransition("open another book")) {
        return;
      }

      setLoading(true);
      setError(null);
      setActiveTab("review");

      try {
        const [book, nextChapters] = await Promise.all([client.getBook(bookId), client.listChapters(bookId)]);
        const defaultChapter = getDefaultChapter(nextChapters);
        const nextChapter = defaultChapter ? await client.getChapter(bookId, defaultChapter.number) : null;

        setSelectedBook(book);
        setChapters(sortChapters(nextChapters));
        setSelectedChapter(defaultChapter);
        setChapter(nextChapter);
        setChapterDirty(false);
        setTruthFiles([]);
        setSelectedTruthFile(null);
        setTruthFile(null);
        setActiveView("workspace");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to open book.");
      } finally {
        setLoading(false);
      }
    },
    [activeView, client, guardWorkspaceTransition, selectedBook],
  );

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
        setChapterDirty(false);
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
    [reloadWorkspace, selectedBook, selectedChapter],
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
    saveChapter,
    approveReview,
    rejectReview,
    selectTab,
    selectTruthFile,
  };
}
