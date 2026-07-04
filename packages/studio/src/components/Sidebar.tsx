import { useEffect, useMemo, useState } from "react";
import { useApi } from "../hooks/use-api";
import type { SSEMessage } from "../hooks/use-sse";
import { applyBookCollectionEvent, shouldRefetchBookCollections, shouldRefetchDaemonStatus } from "../hooks/use-book-activity";
import type { TFunction } from "../hooks/use-i18n";
import { setProjectChatSessionId } from "../pages/chat-page-state";
import { useChatStore } from "../store/chat";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Settings,
  Terminal,
  Plus,
  MessageSquare,
  Gamepad2,
  ScrollText,
  BookPlus,
  BookCopy,
  Boxes,
  Feather,
  Wand2,
  FileInput,
  TrendingUp,
  Stethoscope,
  Zap,
  FolderOpen,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
  GitBranch,
  Clapperboard,
  Rows3,
  Film,
  Network,
  CalendarDays,
  Users,
  Archive,
  Sparkles,
  AlertTriangle,
  Globe,
  Upload,
  BarChart3,
  PenLine,
} from "lucide-react";
import { InkosLogo } from "./InkosLogo";

// 历史记录里的会话混装多种类型（chat / short / play / book-create），用图标区分。
function SessionKindIcon({ kind, className }: { readonly kind?: string; readonly className?: string }) {
  const Icon =
    kind === "play" ? Gamepad2
    : kind === "short" ? ScrollText
    : kind === "script" ? Clapperboard
    : kind === "storyboard" ? Rows3
    : kind === "interactive-film" ? Film
    : kind === "book-create" ? BookPlus
    : MessageSquare;
  return <Icon size={13} className={className} />;
}

interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly chaptersWritten: number;
}

export interface Nav {
  toDashboard: () => void;
  toChat: () => void;
  toBook: (id: string) => void;
  toBookCreate: () => void;
  toServices: () => void;
  toProjectSettings: () => void;
  toDaemon: () => void;
  toLogs: () => void;
  toGenres: () => void;
  toStyle: () => void;
  toStyleConsistency: () => void;
  toImport: (tab?: "chapters" | "canon" | "fanfic" | "spinoff" | "imitation") => void;
  toRadar: () => void;
  toDoctor: () => void;
  toRelations: (bookId: string) => void;
  toTimeline: (bookId: string) => void;
  toFilmStudio: (id: string) => void;
  toAgents: () => void;
  toAgentPipeline: () => void;
  toArchive: () => void;
  toSkills: () => void;
  toForeshadowing: (bookId: string) => void;
  toWorlds: () => void;
  toWorldDetail: (worldId: string) => void;
  toWorldMap: (worldId: string) => void;
  toWorldCreate: () => void;
  toPublish: (bookId: string) => void;
  toBookWorlds: (bookId: string) => void;
  toChapterWizard: (bookId: string) => void;
  toBookStyle: (bookId: string) => void;
}

export function Sidebar({ nav, activePage, sse, t }: {
  nav: Nav;
  activePage: string;
  sse: { messages: ReadonlyArray<SSEMessage> };
  t: TFunction;
}) {
  const { data, refetch: refetchBooks, mutate: mutateBooks } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const { data: filmsData, refetch: refetchFilms } = useApi<{ films: ReadonlyArray<{ projectId: string; title: string }> }>("/interactive-films");
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
  const archiveSession = useChatStore((s) => s.archiveSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const setInput = useChatStore((s) => s.setInput);
  const [renameTarget, setRenameTarget] = useState<{ sessionId: string; currentTitle: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ sessionId: string; title: string } | null>(null);
  const [expandedBooks, setExpandedBooks] = useState<Set<string>>(new Set());
  const [projectChatExpanded, setProjectChatExpanded] = useState(true);
  const [myBooksExpanded, setMyBooksExpanded] = useState(true);
  const [filmsExpanded, setFilmsExpanded] = useState(true);

  const books = data?.books ?? [];
  const films = filmsData?.films ?? [];
  const projectChatKey = "__null__";
  const projectChatSessions = useMemo(
    () =>
      (sessionIdsByBook[projectChatKey] ?? [])
        .map((sessionId) => sessions[sessionId])
        .filter((session): session is NonNullable<(typeof sessions)[string]> => {
          if (!session) return false;
          return Boolean(session.title)
            || session.messages.length > 0
            || session.isDraft
            || session.sessionId === activeSessionId;
        }),
    [activeSessionId, sessionIdsByBook, sessions],
  );

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
      if (appliedIncrementally) {
        return;
      }
      refetchBooks();
    }
    if (shouldRefetchDaemonStatus(recent)) {
      refetchDaemon();
    }
  }, [mutateBooks, refetchBooks, refetchDaemon, sse.messages]);

  // bookDataVersion 变化（外部数据信号）时才重拉当前已展开书的 session 列表；
  // 展开/折叠本身不触发请求（展开由 toggleBook 驱动，已带"首次加载"判断）。
  useEffect(() => {
    for (const bookId of expandedBooks) {
      void loadSessionList(bookId);
    }
    if (projectChatExpanded) {
      void loadSessionList(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookDataVersion, loadSessionList, projectChatExpanded]);

  useEffect(() => {
    void refetchFilms();
  }, [bookDataVersion, refetchFilms]);

  useEffect(() => {
    if (activePage === "chat") {
      setProjectChatExpanded(true);
      void loadSessionList(null);
    }
  }, [activePage, loadSessionList]);

  const toggleBook = (bookId: string) => {
    setExpandedBooks((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) {
        next.delete(bookId);
        return next;
      }
      next.add(bookId);
      // 首次展开才拉：已有 sessionIdsByBook 数据就直接用缓存
      if (sessionIdsByBook[bookId] === undefined) {
        void loadSessionList(bookId);
      }
      return next;
    });
  };

  const openBook = (bookId: string) => {
    setInput("");
    setExpandedBooks((prev) => {
      const next = new Set(prev);
      next.add(bookId);
      return next;
    });
    if (sessionIdsByBook[bookId] === undefined) {
      void loadSessionList(bookId);
    }
    nav.toBook(bookId);
  };

  const sessionsByBook = useMemo(
    () =>
      Object.fromEntries(
        books.map((book) => [
          book.id,
          (sessionIdsByBook[book.id] ?? [])
            .map((sessionId) => sessions[sessionId])
            .filter(Boolean),
        ]),
      ) as Record<string, Array<(typeof sessions)[string]>>,
    [books, sessionIdsByBook, sessions],
  );

  const openSession = (bookId: string, sessionId: string) => {
    setInput("");
    activateSession(sessionId);
    nav.toBook(bookId);
    void loadSessionDetail(sessionId);
  };

  const handleCreateSession = (bookId: string) => {
    // 前端创建草稿会话：对话区立即变空，但 session 文件不落盘；
    // 发第一条消息时 sendMessage 会调 POST /sessions 真正创建。
    setExpandedBooks((prev) => new Set(prev).add(bookId));
    setInput("");
    createDraftSession(bookId, "book");
    nav.toBook(bookId);
  };

  const openProjectChatSession = (sessionId: string) => {
    setInput("");
    activateSession(sessionId);
    setProjectChatSessionId(sessionId);
    nav.toChat();
    void loadSessionDetail(sessionId);
  };

  const handleCreateProjectChatSession = () => {
    setProjectChatExpanded(true);
    const sessionId = createDraftSession(null, "chat");
    setProjectChatSessionId(sessionId);
    setInput("");
    nav.toChat();
  };

  const handleOpenBookCreate = () => {
    setInput("");
    nav.toBookCreate();
  };

  const launchProjectMode = (kind: "short" | "play" | "script" | "storyboard" | "interactive-film", playMode?: "guided" | "open") => {
    setProjectChatExpanded(true);
    // Play mode (分支互动 = guided / 自由互动 = open) is now decided here at the
    // launcher, not via an in-chat button.
    const sessionId = createDraftSession(null, kind, playMode);
    setProjectChatSessionId(sessionId);
    setInput("");
    nav.toChat();
  };

  const handleRenameConfirm = async () => {
    if (!renameTarget) return;
    const nextTitle = renameValue.trim();
    if (!nextTitle) return;
    await renameSession(renameTarget.sessionId, nextTitle);
    setRenameTarget(null);
    setRenameValue("");
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    await deleteSession(deleteTarget.sessionId);
    setDeleteTarget(null);
  };

  return (
    <aside className="w-[260px] shrink-0 border-r border-border bg-background/80 backdrop-blur-md flex flex-col h-full overflow-hidden select-none">
      {/* Logo Area */}
      <div className="px-6 py-8">
        <button
          onClick={nav.toDashboard}
          className="group flex items-center gap-3 hover:opacity-80 transition-all duration-300"
        >
          <InkosLogo className="w-11 h-11 shrink-0 group-hover:scale-105 transition-transform" />
          <div className="flex flex-col">
            <span className="font-serif text-[27px] leading-none italic font-medium">InkOS</span>
            <span className="text-[13px] uppercase tracking-[0.22em] text-muted-foreground font-bold mt-1.5">Studio</span>
          </div>
        </button>
      </div>

      {/* Main Navigation */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-6">
        {/* InkOS Create Section — always visible, two columns. */}
        <div>
          <div className="px-3 mb-2.5">
            <span className="text-[16px] leading-6 uppercase tracking-[0.1em] text-muted-foreground font-bold">
              {t("nav.createSection")}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <CreateItem icon={<BookPlus size={16} />} label={t("nav.createNovel")} active={activePage === "book-create"} onClick={handleOpenBookCreate} />
            <CreateItem icon={<ScrollText size={16} />} label={t("nav.createShort")} onClick={() => launchProjectMode("short")} />
            <CreateItem icon={<Clapperboard size={16} />} label={t("nav.createScript")} onClick={() => launchProjectMode("script")} />
            <CreateItem icon={<Rows3 size={16} />} label={t("nav.createStoryboard")} onClick={() => launchProjectMode("storyboard")} />
            <CreateItem icon={<Film size={16} />} label={t("nav.createInteractiveFilm")} onClick={() => launchProjectMode("interactive-film")} />
            <CreateItem icon={<Feather size={16} />} label={t("nav.createFanfic")} onClick={() => nav.toImport("fanfic")} />
            <CreateItem icon={<BookCopy size={16} />} label={t("nav.createSpinoff")} onClick={() => nav.toImport("spinoff")} />
            <CreateItem icon={<Wand2 size={16} />} label={t("nav.createImitation")} onClick={() => nav.toImport("imitation")} />
            <CreateItem icon={<FileInput size={16} />} label={t("nav.createContinuation")} onClick={() => nav.toImport("chapters")} />
            <CreateItem icon={<GitBranch size={16} />} label={t("nav.createBranching")} onClick={() => launchProjectMode("play", "guided")} />
            <CreateItem icon={<Gamepad2 size={16} />} label={t("nav.createFree")} onClick={() => launchProjectMode("play", "open")} />
          </div>
        </div>

        {/* My Bookshelf Section */}
        <div>
          <SectionHeader label={t("nav.myBooks")} expanded={myBooksExpanded} onToggle={() => setMyBooksExpanded((v) => !v)} />
          <Collapse open={myBooksExpanded}>
          <div className="space-y-0.5 pt-1">
            {books.map((book) => {
              const bookSessions = sessionsByBook[book.id] ?? [];
              const isActiveBook = activePage === `book:${book.id}`;
              const isExpanded = expandedBooks.has(book.id);
              return (
                <div key={book.id}>
                  {/* 书名行：箭头展开；标题进入该书，避免聊天区停留在上一本文稿。 */}
                  <div className="group/book flex items-center">
                    <button
                      type="button"
                      aria-label={isExpanded ? `折叠 ${book.title}` : `展开 ${book.title}`}
                      onClick={() => toggleBook(book.id)}
                      className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-secondary/30 hover:text-foreground transition-colors"
                    >
                      <ChevronRight
                        size={12}
                        className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => openBook(book.id)}
                      className={`flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-2 rounded-md text-[15px] leading-6 transition-colors ${
                        isActiveBook ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-secondary/30"
                      }`}
                    >
                      <FolderOpen size={14} className="shrink-0 text-muted-foreground/60" />
                      <span className="truncate flex-1 text-left">{book.title}</span>
                    </button>
                  </div>

                  {/* 展开后才显示 session 列表 + 新建按钮 */}
                  <Collapse open={isExpanded}>
                    <div className="mt-0.5">
                      {bookSessions.map((session) => {
                        const isActiveSession = isActiveBook && activeSessionId === session.sessionId;
                        const label = getSessionLabel(session);
                        return (
                          <div
                            key={session.sessionId}
                            className={`group/session flex items-center rounded-md ${isActiveSession ? "bg-secondary/50" : "hover:bg-secondary/30"}`}
                          >
                            <button
                              type="button"
                              onClick={() => openSession(book.id, session.sessionId)}
                              className="flex min-w-0 flex-1 items-center gap-2 pl-9 pr-2 py-1.5 text-left text-[14px] leading-5 transition-colors"
                            >
                              <span className={`truncate flex-1 ${isActiveSession ? "text-foreground" : "text-muted-foreground group-hover/session:text-foreground"}`}>
                                {label}
                              </span>
                              {session.isStreaming ? (
                                <Loader2 size={12} className="shrink-0 animate-spin text-primary" />
                              ) : (
                                <span className="shrink-0 text-[11px] text-muted-foreground/40">
                                  {formatRelativeTime(session.sessionId)}
                                </span>
                              )}
                            </button>

                            <DropdownMenu>
                              <DropdownMenuTrigger className="flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 group-hover/session:opacity-100 text-muted-foreground hover:text-foreground transition-opacity">
                                <MoreHorizontal size={14} />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent side="right" align="start" className="w-36">
                                <DropdownMenuItem
                                  onClick={() => {
                                    setRenameTarget({ sessionId: session.sessionId, currentTitle: label });
                                    setRenameValue(session.title ?? "");
                                  }}
                                >
                                  <Pencil size={14} />
                                  <span>改名</span>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => void archiveSession(session.sessionId)}>
                                  <Archive size={14} />
                                  <span>归档</span>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => setDeleteTarget({ sessionId: session.sessionId, title: label })}
                                >
                                  <Trash2 size={14} />
                                  <span>删除</span>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => nav.toRelations(book.id)}
                        className="w-full flex items-center gap-2 pl-9 pr-2 py-1.5 text-[13px] text-muted-foreground/50 hover:text-foreground hover:text-primary transition-colors"
                      >
                        <Network size={12} />
                        <span>关系图谱</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => nav.toTimeline(book.id)}
                        className="w-full flex items-center gap-2 pl-9 pr-2 py-1.5 text-[13px] text-muted-foreground/50 hover:text-foreground hover:text-primary transition-colors"
                      >
                        <CalendarDays size={12} />
                        <span>时间线</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => nav.toBookWorlds(book.id)}
                        className="w-full flex items-center gap-2 pl-9 pr-2 py-1.5 text-[13px] text-muted-foreground/50 hover:text-foreground hover:text-primary transition-colors"
                      >
                        <Globe size={12} />
                        <span>本书世界</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => nav.toForeshadowing(book.id)}
                        className="w-full flex items-center gap-2 pl-9 pr-2 py-1.5 text-[13px] text-muted-foreground/50 hover:text-foreground hover:text-primary transition-colors"
                      >
                        <AlertTriangle size={12} />
                        <span>伏笔追踪</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => nav.toPublish(book.id)}
                        className="w-full flex items-center gap-2 pl-9 pr-2 py-1.5 text-[13px] text-muted-foreground/50 hover:text-foreground hover:text-primary transition-colors"
                      >
                        <Upload size={12} />
                        <span>发布</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => nav.toChapterWizard(book.id)}
                        className="w-full flex items-center gap-2 pl-9 pr-2 py-1.5 text-[13px] text-muted-foreground/50 hover:text-foreground hover:text-primary transition-colors"
                      >
                        <Sparkles size={12} />
                        <span>生成章节</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => nav.toBookStyle(book.id)}
                        className="w-full flex items-center gap-2 pl-9 pr-2 py-1.5 text-[13px] text-muted-foreground/50 hover:text-foreground hover:text-primary transition-colors"
                      >
                        <PenLine size={12} />
                        <span>文风检测</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCreateSession(book.id)}
                        className="w-full flex items-center gap-2 pl-9 pr-2 py-1.5 text-[13px] text-muted-foreground/50 hover:text-foreground transition-colors"
                      >
                        <Plus size={12} />
                        <span>新建会话</span>
                      </button>
                    </div>
                  </Collapse>
                </div>
              );
            })}

            {books.length === 0 && (
              <div className="px-3 py-6 text-xs text-muted-foreground/50 italic text-center">
                {t("dash.noBooks")}
              </div>
            )}
          </div>
          </Collapse>
        </div>

        {/* 互动影游 Section */}
        <div data-testid="film-projects-section">
          <SectionHeader label="互动影游" expanded={filmsExpanded} onToggle={() => setFilmsExpanded((v) => !v)} />
          <Collapse open={filmsExpanded}>
            <div className="space-y-0.5 pt-1">
              {films.map((film) => (
                <button
                  key={film.projectId}
                  type="button"
                  data-testid={`film-project-${film.projectId}`}
                  onClick={() => nav.toFilmStudio(film.projectId)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left hover:bg-secondary/30 transition-colors"
                >
                  <Film size={14} className="shrink-0 text-muted-foreground" />
                  <span className="truncate text-[15px] text-foreground">{film.title}</span>
                </button>
              ))}
              {films.length === 0 && (
                <div className="px-3 py-6 text-xs text-muted-foreground/50 italic text-center">
                  还没有互动影游项目
                </div>
              )}
            </div>
          </Collapse>
        </div>

        {/* Sessions Section */}
        <div>
          <SectionHeader
            label={t("nav.history")}
            expanded={projectChatExpanded}
            onToggle={() => {
              const next = !projectChatExpanded;
              setProjectChatExpanded(next);
              if (next) {
                nav.toChat();
                if (sessionIdsByBook[projectChatKey] === undefined) {
                  void loadSessionList(null);
                }
              }
            }}
          />
          <div className="space-y-1">
            <div>
              <Collapse open={projectChatExpanded}>
                <div className="pt-1">
                  {projectChatSessions.map((session) => {
                    const isActiveSession = activePage === "chat" && activeSessionId === session.sessionId;
                    const label = getSessionLabel(session);
                    return (
                      <div
                        key={session.sessionId}
                        className={`group/session flex items-center rounded-md ${isActiveSession ? "bg-secondary/50" : "hover:bg-secondary/30"}`}
                      >
                        <button
                          type="button"
                          onClick={() => openProjectChatSession(session.sessionId)}
                          className="flex min-w-0 flex-1 items-center gap-2 pl-2 pr-2 py-1.5 text-left text-[14px] leading-5 transition-colors"
                        >
                          <SessionKindIcon
                            kind={session.sessionKind}
                            className={`shrink-0 ${isActiveSession ? "text-foreground" : "text-muted-foreground/60 group-hover/session:text-foreground"}`}
                          />
                          <span className={`truncate flex-1 ${isActiveSession ? "text-foreground" : "text-muted-foreground group-hover/session:text-foreground"}`}>
                            {label}
                          </span>
                          {session.isStreaming ? (
                            <Loader2 size={12} className="shrink-0 animate-spin text-primary" />
                          ) : (
                            <span className="shrink-0 text-[11px] text-muted-foreground/40">
                              {formatRelativeTime(session.sessionId)}
                            </span>
                          )}
                        </button>

                        <DropdownMenu>
                          <DropdownMenuTrigger className="flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 group-hover/session:opacity-100 text-muted-foreground hover:text-foreground transition-opacity">
                            <MoreHorizontal size={14} />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent side="right" align="start" className="w-36">
                            <DropdownMenuItem
                              onClick={() => {
                                setRenameTarget({ sessionId: session.sessionId, currentTitle: label });
                                setRenameValue(session.title ?? "");
                              }}
                            >
                              <Pencil size={14} />
                              <span>改名</span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => void archiveSession(session.sessionId)}>
                              <Archive size={14} />
                              <span>归档</span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setDeleteTarget({ sessionId: session.sessionId, title: label })}
                            >
                              <Trash2 size={14} />
                              <span>删除</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={handleCreateProjectChatSession}
                    className="w-full flex items-center gap-2 pl-2 pr-2 py-1.5 text-[13px] text-muted-foreground/50 hover:text-foreground transition-colors"
                  >
                    <Plus size={12} />
                    <span>新建会话</span>
                  </button>
                </div>
              </Collapse>
            </div>
          </div>
        </div>

        {/* System Section */}
        <div>
          <div className="px-3 mb-3">
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-bold">
              {t("nav.system")}
            </span>
          </div>
          <div className="space-y-1">
            <SidebarItem
              label={t("create.genre")}
              icon={<Boxes size={16} />}
              active={activePage === "genres"}
              onClick={nav.toGenres}
            />
            <SidebarItem
              label={t("nav.config")}
              icon={<Settings size={16} />}
              active={activePage === "services"}
              onClick={nav.toServices}
            />
            <SidebarItem
              label={t("nav.projectSettings")}
              icon={<Settings size={16} />}
              active={activePage === "project-settings"}
              onClick={nav.toProjectSettings}
            />
            <SidebarItem
              label={t("nav.daemon")}
              icon={<Zap size={16} />}
              active={activePage === "daemon"}
              onClick={nav.toDaemon}
              badge={daemon?.running ? t("nav.running") : undefined}
              badgeColor={daemon?.running ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"}
            />
            <SidebarItem
              label={t("nav.logs")}
              icon={<Terminal size={16} />}
              active={activePage === "logs"}
              onClick={nav.toLogs}
            />
          </div>
        </div>

        {/* Tools Section */}
        <div>
          <div className="px-3 mb-3">
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-bold">
              {t("nav.tools")}
            </span>
          </div>
          <div className="space-y-1">
            <SidebarItem
              label="Agent Team"
              icon={<Users size={16} />}
              active={activePage === "agents" || activePage === "agent-pipeline"}
              onClick={nav.toAgents}
            />
            <SidebarItem
              label="世界设定"
              icon={<Globe size={16} />}
              active={activePage === "worlds" || activePage === "world-create" || activePage.startsWith("world-detail")}
              onClick={nav.toWorlds}
            />
            <SidebarItem
              label="会话归档"
              icon={<Archive size={16} />}
              active={activePage === "archive"}
              onClick={nav.toArchive}
            />
            <SidebarItem
              label="Skill 库"
              icon={<Sparkles size={16} />}
              active={activePage === "skills"}
              onClick={nav.toSkills}
            />
            <SidebarItem
              label={t("nav.style")}
              icon={<Wand2 size={16} />}
              active={activePage === "style"}
              onClick={nav.toStyle}
            />
            <SidebarItem
              label="文风统一检测"
              icon={<BarChart3 size={16} />}
              active={activePage === "style-consistency"}
              onClick={nav.toStyleConsistency}
            />
            <SidebarItem
              label={t("nav.import")}
              icon={<FileInput size={16} />}
              active={activePage === "import"}
              onClick={nav.toImport}
            />
            <SidebarItem
              label={t("nav.radar")}
              icon={<TrendingUp size={16} />}
              active={activePage === "radar"}
              onClick={nav.toRadar}
            />
            <SidebarItem
              label={t("nav.doctor")}
              icon={<Stethoscope size={16} />}
              active={activePage === "doctor"}
              onClick={nav.toDoctor}
            />
          </div>
        </div>
      </div>

      {/* Footer / Status Area — only show when agent is online */}
      {daemon?.running && (
        <div className="p-4 border-t border-border bg-secondary/40">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-card border border-border shadow-sm">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11px] font-semibold text-foreground/80 uppercase tracking-wider">
              {t("nav.agentOnline")}
            </span>
          </div>
        </div>
      )}

      {/* AGPL-3.0 License Notice — required by AGPL §5(d) and §13 */}
      <div className="px-3 py-2 border-t border-border/20">
        <p className="text-[10px] leading-relaxed text-muted-foreground/40 text-center">
          InkOS is free software under{' '}
          <a
            href="https://www.gnu.org/licenses/agpl-3.0.html"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-muted-foreground/70 transition-colors"
          >
            AGPL-3.0
          </a>
          .{' '}
          <a
            href="https://github.com/Narcooo/inkos"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-muted-foreground/70 transition-colors"
          >
            Source code
          </a>
        </p>
      </div>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null);
            setRenameValue("");
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-[360px] p-4 gap-3"
        >
          <DialogHeader className="space-y-0 gap-0">
            <DialogTitle className="font-sans text-sm font-medium">重命名会话</DialogTitle>
          </DialogHeader>
          <input
            id="session-rename-input"
            autoFocus
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleRenameConfirm();
              }
            }}
            placeholder="输入新标题"
            className="w-full rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm outline-none focus:border-border"
          />
          <DialogFooter className="gap-1 sm:gap-1">
            <button
              type="button"
              onClick={() => {
                setRenameTarget(null);
                setRenameValue("");
              }}
              className="px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleRenameConfirm()}
              disabled={!renameValue.trim()}
              className="px-3 py-1 text-xs font-medium rounded-md bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-30"
            >
              保存
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除会话"
        message={`确认删除“${deleteTarget?.title ?? ""}”吗？该操作只删除这条会话，不影响书籍内容。`}
        confirmLabel="删除"
        cancelLabel="取消"
        variant="danger"
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => setDeleteTarget(null)}
      />
    </aside>
  );
}

function getSessionLabel(session: { sessionId: string; title: string | null; messages: ReadonlyArray<{ role: string; content: string }> }): string {
  if (session.title) return session.title;
  // 后端会在第一条用户消息发送时立即把消息内容持久化为占位标题。
  // 这里处理的是"已有消息但标题还没同步回来"的短暂中间态（乐观显示）。
  const firstUserMsg = session.messages.find((m) => m.role === "user")?.content?.trim();
  if (firstUserMsg) {
    const oneLine = firstUserMsg.replace(/\s+/g, " ");
    return oneLine.length > 20 ? `${oneLine.slice(0, 20)}…` : oneLine;
  }
  return "新会话";
}

function formatRelativeTime(sessionId: string): string {
  const rawTs = Number(sessionId.split("-")[0]);
  if (!Number.isFinite(rawTs)) return "";
  const diff = Date.now() - rawTs;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天`;
  const months = Math.floor(days / 30);
  return `${months} 个月`;
}

// Smooth collapse via grid-template-rows 0fr→1fr (content-height-agnostic, no JS measuring).
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

function SectionHeader({ label, expanded, onToggle }: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="group flex w-full items-center gap-1.5 px-3 py-2 text-left"
    >
      <span className="flex-1 text-[16px] leading-6 uppercase tracking-[0.1em] text-muted-foreground font-bold group-hover:text-foreground transition-colors">
        {label}
      </span>
      <ChevronRight
        size={15}
        className={`text-muted-foreground/50 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
      />
    </button>
  );
}

function CreateItem({ icon, label, active, onClick }: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2.5 text-left text-[16px] leading-6 transition-all ${
        active
          ? "border border-border bg-secondary text-foreground font-medium shadow-sm"
          : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
      }`}
    >
      <span className={`shrink-0 ${active ? "text-primary" : ""}`}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function SidebarItem({ label, icon, active, onClick, badge, badgeColor }: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  badge?: string;
  badgeColor?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full group flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
        active
          ? "bg-secondary text-foreground font-medium shadow-sm border border-border"
          : "text-foreground font-medium hover:text-foreground hover:bg-secondary/50"
      }`}
    >
      <span className={`transition-colors ${active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`}>
        {icon}
      </span>
      <span className="flex-1 text-left">{label}</span>
      {badge && (
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tight ${badgeColor}`}>
          {badge}
        </span>
      )}
    </button>
  );
}
