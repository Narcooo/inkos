import { fetchJson, useApi, postApi } from "../hooks/use-api";
import { useEffect, useMemo, useState, useRef } from "react";
import { useServiceStore } from "../store/service";
import type { SSEMessage } from "../hooks/use-sse";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { deriveActiveBookIds, shouldRefetchBookCollections } from "../hooks/use-book-activity";
import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  Plus,
  BookOpen,
  BarChart2,
  Zap,
  Clock,
  CheckCircle2,
  AlertCircle,
  MoreVertical,
  ChevronRight,
  Flame,
  Trash2,
  Settings,
  Download,
  FileInput,
  Sparkles,
  Cpu,
  Library,
  Radio,
  ArrowUpRight,
} from "lucide-react";

interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly chaptersWritten: number;
  readonly language?: string;
  readonly fanficMode?: string;
}

interface Nav {
  toBook: (id: string) => void;
  toBookSettings: (id: string) => void;
  toAnalytics: (id: string) => void;
  toBookCreate: () => void;
  toServices: () => void;
}

function BookMenu({ bookId, bookTitle, nav, t, onDelete, onOpenChange }: {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly nav: Nav;
  readonly t: TFunction;
  readonly onDelete: () => void;
  readonly onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenRaw] = useState(false);
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    setOpenRaw((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      onOpenChange?.(value);
      return value;
    });
  };
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleDelete = async () => {
    setConfirmDelete(false);
    setOpen(false);
    await fetchJson(`/books/${bookId}`, { method: "DELETE" });
    onDelete();
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="p-3 rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 hover:scale-105 active:scale-95 transition-all cursor-pointer"
      >
        <MoreVertical size={18} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-card border border-border rounded-xl shadow-lg shadow-primary/5 py-1 z-50 fade-in">
          <button
            onClick={() => { setOpen(false); nav.toBookSettings(bookId); }}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-secondary/50 transition-colors cursor-pointer"
          >
            <Settings size={14} className="text-muted-foreground" />
            {t("book.settings")}
          </button>
          <a
            href={`/api/v1/books/${bookId}/export?format=txt`}
            download
            onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-secondary/50 transition-colors cursor-pointer"
          >
            <Download size={14} className="text-muted-foreground" />
            {t("book.export")}
          </a>
          <div className="border-t border-border/50 my-1" />
          <button
            onClick={() => { setOpen(false); setConfirmDelete(true); }}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
          >
            <Trash2 size={14} />
            {t("book.deleteBook")}
          </button>
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={t("book.deleteBook")}
        message={`${t("book.confirmDelete")}\n\n"${bookTitle}"`}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

export function Dashboard({ nav, sse, t }: { nav: Nav; sse: { messages: ReadonlyArray<SSEMessage> }; theme: Theme; t: TFunction }) {
  const [menuOpenBookId, setMenuOpenBookId] = useState<string | null>(null);
  const { data, loading, error, refetch } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const writingBooks = useMemo(() => deriveActiveBookIds(sse.messages), [sse.messages]);
  const serviceStoreServices = useServiceStore((s) => s.services);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  useEffect(() => { void fetchServices(); }, [fetchServices]);
  const hasServices = serviceStoreServices.some((s) => s.connected);

  const logEvents = sse.messages.filter((m) => m.event === "log").slice(-8);
  const progressEvent = sse.messages.filter((m) => m.event === "llm:progress").slice(-1)[0];

  useEffect(() => {
    const recent = sse.messages.at(-1);
    if (!recent) return;
    if (shouldRefetchBookCollections(recent)) {
      refetch();
    }
  }, [refetch, sse.messages]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-32 space-y-4">
      <div className="ios-card flex h-16 w-16 items-center justify-center rounded-[24px]">
        <div className="w-7 h-7 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
      <span className="text-sm text-muted-foreground animate-pulse">正在整理创作空间...</span>
    </div>
  );

  if (error) return (
    <div className="ios-card flex flex-col items-center justify-center py-20 border-destructive/20">
      <AlertCircle className="text-destructive mb-4" size={32} />
      <h2 className="text-lg font-semibold text-destructive">书库载入失败</h2>
      <p className="text-sm text-muted-foreground mt-1">{error}</p>
    </div>
  );

  if (!data?.books.length) {
    return (
      <div className="grid min-h-[68vh] place-items-center fade-in">
        <div className="ios-card relative w-full max-w-3xl overflow-hidden px-8 py-10 text-center md:px-12 md:py-14">
          <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent" />
          <div className="mx-auto mb-7 grid h-20 w-20 place-items-center rounded-[28px] bg-[linear-gradient(135deg,oklch(0.65_0.17_242),oklch(0.75_0.13_176))] text-white shadow-xl shadow-primary/20">
            <BookOpen size={34} />
          </div>
          <h2 className="text-3xl font-semibold tracking-normal text-foreground md:text-4xl">{t("dash.noBooks")}</h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
            {t("dash.createFirst")}。InkOS 会把世界观、章节、会话和模型配置集中在一个清爽的写作工作台里。
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              onClick={nav.toBookCreate}
              className="ios-button-primary group inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-all hover:scale-[1.02] active:scale-[0.99]"
            >
              <Plus size={18} />
              {t("nav.newBook")}
            </button>
            <button
              onClick={nav.toServices}
              className="ios-button-secondary inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-card/80"
            >
              <Cpu size={17} />
              配置模型
            </button>
          </div>
          <div className="mt-10 grid gap-3 text-left sm:grid-cols-3">
            {[
              { icon: <Library size={16} />, label: "项目书库", value: "0 本书" },
              { icon: <Sparkles size={16} />, label: "创作流水线", value: "待启动" },
              { icon: <Radio size={16} />, label: "模型连接", value: hasServices ? "已配置" : "未配置" },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-border/55 bg-card/35 px-4 py-3">
                <div className="flex items-center gap-2 text-muted-foreground">
                  {item.icon}
                  <span className="text-xs font-medium">{item.label}</span>
                </div>
                <div className="mt-2 text-sm font-semibold text-foreground">{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {!hasServices && (
        <div className="ios-card flex items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-amber-400/15 text-amber-600 dark:text-amber-300">
              <Cpu size={18} />
            </div>
            <div>
              <div className="text-sm font-semibold">还没有配置 AI 模型</div>
              <div className="text-xs text-muted-foreground mt-0.5">配好一个服务商才能开始创作</div>
            </div>
          </div>
          <button
            onClick={nav.toServices}
            className="ios-button-primary inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition-transform hover:scale-[1.02]"
          >
            去配置
            <ArrowUpRight size={13} />
          </button>
        </div>
      )}
      <div className="flex items-end justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/35 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_16px_oklch(0.72_0.18_150)]" />
            InkOS Workspace
          </div>
          <h1 className="text-4xl font-semibold tracking-normal">{t("dash.title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">集中管理书籍、模型、会话和自动写作状态</p>
        </div>
        <button
          onClick={nav.toBookCreate}
          className="ios-button-primary group flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-all hover:scale-[1.02]"
        >
          <Plus size={16} />
          {t("nav.newBook")}
        </button>
      </div>

      <div className="grid gap-6">
        {data.books.map((book, index) => {
          const isWriting = writingBooks.has(book.id);
          const staggerClass = `stagger-${Math.min(index + 1, 5)}`;
          return (
            <div
              key={book.id}
              className={`ios-card group relative overflow-hidden fade-in transition-all hover:-translate-y-0.5 hover:shadow-3d-hover ${staggerClass} ${menuOpenBookId === book.id ? "z-50" : ""}`}
            >
              <div className="p-6 flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary">
                      <BookOpen size={20} />
                    </div>
                    <button
                      onClick={() => nav.toBook(book.id)}
                      className="block truncate text-left text-2xl font-semibold tracking-normal transition-all hover:text-primary"
                    >
                      {book.title}
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-y-2 gap-x-4 text-[13px] text-muted-foreground font-medium">
                    <div className="ios-pill flex items-center gap-1.5 px-2.5 py-1">
                      <span className="uppercase tracking-wider">{book.genre}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock size={14} />
                      <span>{book.chaptersWritten} {t("dash.chapters")}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${
                        book.status === "active" ? "bg-emerald-500" :
                        book.status === "paused" ? "bg-amber-500" :
                        "bg-muted-foreground"
                      }`} />
                      <span>{
                        book.status === "active" ? t("book.statusActive") :
                        book.status === "paused" ? t("book.statusPaused") :
                        book.status === "outlining" ? t("book.statusOutlining") :
                        book.status === "completed" ? t("book.statusCompleted") :
                        book.status === "dropped" ? t("book.statusDropped") :
                        book.status
                      }</span>
                    </div>
                    {book.language === "en" && (
                      <span className="px-1.5 py-0.5 rounded border border-primary/20 text-primary text-[10px] font-bold">EN</span>
                    )}
                    {book.fanficMode && (
                      <span className="flex items-center gap-1 text-purple-500">
                        <Zap size={12} />
                        <span className="italic">{book.fanficMode}</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 ml-6">
                  <button
                    onClick={async () => {
                      try { await postApi(`/books/${book.id}/write-next`); }
                      catch (e) { alert(e instanceof Error ? e.message : "Write failed"); }
                    }}
                    disabled={isWriting}
                    className={`flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition-all ${
                      isWriting
                        ? "bg-primary/15 text-primary cursor-wait animate-pulse"
                        : "ios-button-secondary text-foreground hover:bg-primary hover:text-primary-foreground hover:scale-[1.02]"
                    }`}
                  >
                    {isWriting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                        {t("dash.writing")}
                      </>
                    ) : (
                      <>
                        <Zap size={16} />
                        {t("dash.writeNext")}
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => nav.toAnalytics(book.id)}
                    className="ios-button-secondary p-3 rounded-full text-muted-foreground hover:text-primary hover:scale-[1.02] transition-all"
                    title={t("dash.stats")}
                  >
                    <BarChart2 size={18} />
                  </button>
                  <BookMenu
                    bookId={book.id}
                    bookTitle={book.title}
                    nav={nav}
                    t={t}
                    onDelete={() => refetch()}
                    onOpenChange={(isOpen) => setMenuOpenBookId(isOpen ? book.id : null)}
                  />
                </div>
              </div>

              {/* Enhanced progress indicator */}
              {isWriting && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-secondary overflow-hidden">
                   <div className="h-full bg-primary w-1/3 animate-[progress_2s_ease-in-out_infinite]" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modern writing progress panel */}
      {writingBooks.size > 0 && logEvents.length > 0 && (
        <div className="ios-card p-7 border-primary/20 fade-in">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
                <Flame size={18} className="animate-pulse" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-primary">实时写作流水线</h3>
                <p className="text-xs text-muted-foreground mt-0.5">LLM 生成进度与事件追踪</p>
              </div>
            </div>
            {progressEvent && (
              <div className="ios-pill flex items-center gap-4 px-4 py-2 text-xs font-semibold text-primary">
                <div className="flex items-center gap-2">
                  <Clock size={12} />
                  <span>{Math.round(((progressEvent.data as { elapsedMs?: number })?.elapsedMs ?? 0) / 1000)}s</span>
                </div>
                <div className="w-px h-3 bg-primary/20" />
                <div className="flex items-center gap-2">
                  <Zap size={12} />
                  <span>{((progressEvent.data as { totalChars?: number })?.totalChars ?? 0).toLocaleString()} Chars</span>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2 font-mono text-xs bg-black/5 dark:bg-black/20 p-5 rounded-2xl border border-border/50 max-h-[200px] overflow-y-auto scrollbar-thin">
            {logEvents.map((msg, i) => {
              const d = msg.data as { tag?: string; message?: string };
              return (
                <div key={i} className="flex gap-3 leading-relaxed animate-in fade-in slide-in-from-left-2 duration-300">
                  <span className="text-primary/60 font-bold shrink-0">[{d.tag}]</span>
                  <span className="text-muted-foreground">{d.message}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <style>{`
        @keyframes progress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  );
}
