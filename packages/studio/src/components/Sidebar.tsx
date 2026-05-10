import { useEffect, useMemo, useState } from "react";
import { useApi } from "../hooks/use-api";
import { applyBookCollectionEvent, shouldRefetchBookCollections, shouldRefetchDaemonStatus } from "../hooks/use-book-activity";
import { useChatStore } from "../store/chat";
import {
  Boxes,
  FileInput,
  Settings,
  Stethoscope,
  Terminal,
  TrendingUp,
  Wand2,
} from "lucide-react";
import { SidebarBooksSection } from "./sidebar-shell/SidebarBooksSection";
import { SidebarHeader } from "./sidebar-shell/SidebarHeader";
import { SidebarNavSection } from "./sidebar-shell/SidebarNavSection";
import { SidebarStatus } from "./sidebar-shell/SidebarStatus";
import { SessionDialogs } from "./sidebar-shell/SessionDialogs";
import type {
  DeleteTarget,
  RenameTarget,
  SidebarBookSummary,
  SidebarProps,
  SidebarSession,
} from "./sidebar-shell/types";

export function Sidebar({ nav, activePage, sse, t }: SidebarProps) {
  const { data, refetch: refetchBooks, mutate: mutateBooks } =
    useApi<{ books: ReadonlyArray<SidebarBookSummary> }>("/books");
  const { data: daemon, refetch: refetchDaemon } = useApi<{ running: boolean }>("/daemon");
  const sessions = useChatStore((s) => s.sessions);
  const sessionIdsByBook = useChatStore((s) => s.sessionIdsByBook);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const bookDataVersion = useChatStore((s) => s.bookDataVersion);
  const loadSessionList = useChatStore((s) => s.loadSessionList);
  const loadSessionDetail = useChatStore((s) => s.loadSessionDetail);
  const activateSession = useChatStore((s) => s.activateSession);
  const createDraftSession = useChatStore((s) => s.createDraftSession);
  const renameSession = useChatStore((s) => s.renameSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [expandedBooks, setExpandedBooks] = useState<Set<string>>(new Set());

  const books = data?.books ?? [];

  useEffect(() => {
    const recent = sse.messages.at(-1);
    if (!recent) return;
    if (shouldRefetchBookCollections(recent)) {
      let appliedIncrementally = false;
      mutateBooks((current) => {
        const updatedBooks = applyBookCollectionEvent(current?.books ?? [], recent);
        if (!updatedBooks) return current;
        appliedIncrementally = true;
        return { books: updatedBooks };
      });
      if (!appliedIncrementally) {
        refetchBooks();
      }
    }
    if (shouldRefetchDaemonStatus(recent)) {
      refetchDaemon();
    }
  }, [mutateBooks, refetchBooks, refetchDaemon, sse.messages]);

  useEffect(() => {
    for (const bookId of expandedBooks) {
      void loadSessionList(bookId);
    }
    // Expanded book ids intentionally drive this refresh only through book data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookDataVersion, loadSessionList]);

  const sessionsByBook = useMemo(
    () =>
      Object.fromEntries(
        books.map((book) => [
          book.id,
          (sessionIdsByBook[book.id] ?? [])
            .map((sessionId) => sessions[sessionId])
            .filter(Boolean),
        ]),
      ) as Record<string, ReadonlyArray<SidebarSession>>,
    [books, sessionIdsByBook, sessions],
  );

  const systemItems = useMemo(
    () => [
      {
        label: t("create.genre"),
        icon: <Boxes size={16} />,
        active: activePage === "genres",
        onClick: nav.toGenres,
      },
      {
        label: t("nav.config"),
        icon: <Settings size={16} />,
        active: activePage === "services",
        onClick: nav.toServices,
      },
      {
        label: t("nav.logs"),
        icon: <Terminal size={16} />,
        active: activePage === "logs",
        onClick: nav.toLogs,
      },
    ],
    [activePage, nav.toGenres, nav.toLogs, nav.toServices, t],
  );

  const toolItems = useMemo(
    () => [
      {
        label: t("nav.style"),
        icon: <Wand2 size={16} />,
        active: activePage === "style",
        onClick: nav.toStyle,
      },
      {
        label: t("nav.import"),
        icon: <FileInput size={16} />,
        active: activePage === "import",
        onClick: nav.toImport,
      },
      {
        label: t("nav.radar"),
        icon: <TrendingUp size={16} />,
        active: activePage === "radar",
        onClick: nav.toRadar,
      },
      {
        label: t("nav.doctor"),
        icon: <Stethoscope size={16} />,
        active: activePage === "doctor",
        onClick: nav.toDoctor,
      },
    ],
    [activePage, nav.toDoctor, nav.toImport, nav.toRadar, nav.toStyle, t],
  );

  const toggleBook = (bookId: string) => {
    setExpandedBooks((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) {
        next.delete(bookId);
        return next;
      }
      next.add(bookId);
      if (sessionIdsByBook[bookId] === undefined) {
        void loadSessionList(bookId);
      }
      return next;
    });
  };

  const openSession = (bookId: string, sessionId: string) => {
    activateSession(sessionId);
    nav.toBook(bookId);
    void loadSessionDetail(sessionId);
  };

  const handleCreateSession = (bookId: string) => {
    setExpandedBooks((prev) => new Set(prev).add(bookId));
    createDraftSession(bookId);
    nav.toBook(bookId);
  };

  const handleRenameStart = (target: RenameTarget) => {
    setRenameTarget(target);
    setRenameValue(sessions[target.sessionId]?.title ?? "");
  };

  const handleRenameCancel = () => {
    setRenameTarget(null);
    setRenameValue("");
  };

  const handleRenameConfirm = async () => {
    if (!renameTarget) return;
    const nextTitle = renameValue.trim();
    if (!nextTitle) return;
    await renameSession(renameTarget.sessionId, nextTitle);
    handleRenameCancel();
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    await deleteSession(deleteTarget.sessionId);
    setDeleteTarget(null);
  };

  return (
    <aside className="relative z-10 w-[82px] shrink-0 ios-glass rounded-[24px] flex flex-col h-full overflow-hidden select-none lg:w-[274px] lg:rounded-[28px]">
      <SidebarHeader nav={nav} />

      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-5">
        <SidebarBooksSection
          activePage={activePage}
          activeSessionId={activeSessionId}
          books={books}
          expandedBooks={expandedBooks}
          onCreateSession={handleCreateSession}
          onDeleteSession={setDeleteTarget}
          onNewBook={nav.toBookCreate}
          onOpenSession={openSession}
          onRenameSession={handleRenameStart}
          onToggleBook={toggleBook}
          sessionsByBook={sessionsByBook}
          t={t}
        />
        <SidebarNavSection title={t("nav.system")} items={systemItems} />
        <SidebarNavSection title={t("nav.tools")} items={toolItems} />
      </div>

      <SidebarStatus running={daemon?.running === true} t={t} />
      <SessionDialogs
        deleteTarget={deleteTarget}
        onCancelDelete={() => setDeleteTarget(null)}
        onCancelRename={handleRenameCancel}
        onConfirmDelete={() => void handleDeleteConfirm()}
        onConfirmRename={() => void handleRenameConfirm()}
        renameTarget={renameTarget}
        renameValue={renameValue}
        setRenameValue={setRenameValue}
      />
    </aside>
  );
}
