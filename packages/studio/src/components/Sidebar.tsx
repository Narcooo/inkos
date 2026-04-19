import { useEffect, useMemo, useState } from "react";
import { useApi } from "../hooks/use-api";
import type { SSEMessage } from "../hooks/use-sse";
import { shouldRefetchBookCollections, shouldRefetchDaemonStatus } from "../hooks/use-book-activity";
import type { TFunction } from "../hooks/use-i18n";
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
  ScrollText,
  Boxes,
  Wand2,
  FileInput,
  TrendingUp,
  Stethoscope,
  FolderOpen,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";

interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly chaptersWritten: number;
}

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
  toBookCreate: () => void;
  toServices: () => void;
  toDaemon: () => void;
  toLogs: () => void;
  toGenres: () => void;
  toStyle: () => void;
  toImport: () => void;
  toRadar: () => void;
  toDoctor: () => void;
}

export function Sidebar({ nav, activePage, sse, t }: {
  nav: Nav;
  activePage: string;
  sse: { messages: ReadonlyArray<SSEMessage> };
  t: TFunction;
}) {
  const { data, refetch: refetchBooks } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
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
  const [renameTarget, setRenameTarget] = useState<{ sessionId: string; currentTitle: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ sessionId: string; title: string } | null>(null);
  const [expandedBooks, setExpandedBooks] = useState<Set<string>>(new Set());

  const books = data?.books ?? [];

  useEffect(() => {
    const recent = sse.messages.at(-1);
    if (!recent) return;
    if (shouldRefetchBookCollections(recent)) {
      refetchBooks();
    }
    if (shouldRefetchDaemonStatus(recent)) {
      refetchDaemon();
    }
  }, [refetchBooks, refetchDaemon, sse.messages]);

  // bookDataVersion 变化（外部数据信号）时才重拉当前已展开书的 session 列表；
  // 展开/折叠本身不触发请求（展开由 toggleBook 驱动，已带"首次加载"判断）。
  useEffect(() => {
    for (const bookId of expandedBooks) {
      void loadSessionList(bookId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookDataVersion, loadSessionList]);

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
    activateSession(sessionId);
    nav.toBook(bookId);
    void loadSessionDetail(sessionId);
  };

  const handleCreateSession = (bookId: string) => {
    // 前端创建草稿会话：对话区立即变空，但 session 文件不落盘；
    // 发第一条消息时 sendMessage 会调 POST /sessions 真正创建。
    setExpandedBooks((prev) => new Set(prev).add(bookId));
    createDraftSession(bookId);
    nav.toBook(bookId);
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
          className="group flex items-center gap-2 hover:opacity-80 transition-all duration-300"
        >
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20 group-hover:scale-105 transition-transform">
            <ScrollText size={18} />
          </div>
          <div className="flex flex-col">
            <span className="font-serif text-xl leading-none italic font-medium">InkOS</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold mt-1">Studio</span>
          </div>
        </button>
      </div>

      {/* Main Navigation */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-6">
        {/* Books Section */}
        <div>
          <div className="px-3 mb-3 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-bold">
              {t("nav.books")}
            </span>
            <button
              onClick={nav.toBookCreate}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
            >
              <Plus size={12} />
              <span>{t("nav.newBook")}</span>
            </button>
          </div>

          <div className="space-y-0.5">
            {books.map((book) => {
              const bookSessions = sessionsByBook[book.id] ?? [];
              const isActiveBook = activePage === `book:${book.id}`;
              const isExpanded = expandedBooks.has(book.id);
              return (
                <div key={book.id}>
                  {/* 书名行：点击展开折叠，双击进入书 */}
                  <div className="group/book flex items-center">
                    <button
                      type="button"
                      onClick={() => toggleBook(book.id)}
                      className={`flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 rounded-md text-sm transition-colors ${
                        isActiveBook ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-secondary/30"
                      }`}
                    >
                      <ChevronRight
                        size={12}
                        className={`shrink-0 text-muted-foreground/60 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      />
                      <FolderOpen size={14} className="shrink-0 text-muted-foreground/60" />
                      <span className="truncate flex-1 text-left">{book.title}</span>
                    </button>
                  </div>

                  {/* 展开后才显示 session 列表 + 新建按钮 */}
                  {isExpanded && (
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
                              className="flex min-w-0 flex-1 items-center gap-2 pl-9 pr-2 py-1 text-left text-[13px] transition-colors"
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
                        onClick={() => void handleCreateSession(book.id)}
                        className="w-full flex items-center gap-2 pl-9 pr-2 py-1 text-xs text-muted-foreground/50 hover:text-foreground transition-colors"
                      >
                        <Plus size={12} />
                        <span>新建会话</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {books.length === 0 && (
              <div className="px-3 py-6 text-xs text-muted-foreground/50 italic text-center">
                {t("dash.noBooks")}
              </div>
            )}
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
{/*            <SidebarItem
              label={t("nav.daemon")}
              icon={<Zap size={16} />}
              active={activePage === "daemon"}
              onClick={nav.toDaemon}
              badge={daemon?.running ? t("nav.running") : undefined}
              badgeColor={daemon?.running ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"}
            />*/}
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
              label={t("nav.style")}
              icon={<Wand2 size={16} />}
              active={activePage === "style"}
              onClick={nav.toStyle}
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
