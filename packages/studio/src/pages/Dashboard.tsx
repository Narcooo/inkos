import { fetchJson, useApi, postApi } from "../hooks/use-api";
import { useEffect, useMemo, useState, useRef } from "react";
import { useServiceStore } from "../store/service";
import type { SSEMessage } from "../hooks/use-sse";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
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

const DASHBOARD_LOG_LABELS_KO: Record<string, string> = {
  "生成基础设定": "기초 설정 생성",
  "审核基础设定": "기초 설정 검토",
  "保存书籍配置": "작품 설정 저장",
  "写入基础设定文件": "기초 설정 파일 작성",
  "初始化控制文档": "제어 문서 초기화",
  "创建初始快照": "초기 스냅샷 생성",
  "准备章节输入": "챕터 입력 준비",
  "撰写章节草稿": "챕터 초안 작성",
  "审计草稿": "초안 검토",
  "文字层润色": "문장 다듬기",
  "落盘最终章节": "최종 챕터 저장",
  "生成最终真相文件": "최종 기준 문서 생성",
  "校验真相文件变更": "기준 문서 변경 검증",
  "同步记忆索引": "기억 색인 동기화",
  "更新章节索引与快照": "챕터 색인 및 스냅샷 갱신",
};

function localizeDashboardLogMessage(message: string | undefined, language: "zh" | "en" | "ko"): string {
  if (!message || language !== "ko") return message ?? "";
  const postWrite = message.match(/^Post-write:\s*(\d+)\s*errors?,\s*(\d+)\s*warnings?\s*in chapter\s*(\d+)/i);
  if (postWrite) return `작성 후 검증: ${postWrite[3]}장 오류 ${postWrite[1]}개, 경고 ${postWrite[2]}개`;
  const aiTell = message.match(/^AI-tell check:\s*(\d+)\s*issues?\s*in chapter\s*(\d+)/i);
  if (aiTell) return `AI 문체 검사: ${aiTell[2]}장 문제 ${aiTell[1]}개`;
  const normalize = message.match(/^审计前字数归一化：第(\d+)章\s*(\d+)\s*->\s*(\d+)/u);
  if (normalize) return `감사 전 분량 정규화: ${normalize[1]}장 ${normalize[2]} -> ${normalize[3]}`;
  const repairRound = message.match(/^(?:阶段：)?修复轮次\s*(\d+)\/(\d+)（当前\s*(\d+)\s*分）/u);
  if (repairRound) return `${message.startsWith("阶段：") ? "단계: " : ""}수정 라운드 ${repairRound[1]}/${repairRound[2]} (현재 ${repairRound[3]}점)`;
  const noImprovement = message.match(/^(?:阶段：)?修复轮次\s*(\d+)\s*未净提升（(\d+)\s*→\s*(\d+)），退出循环/u);
  if (noImprovement) return `수정 라운드 ${noImprovement[1]}에서 점수가 개선되지 않았습니다 (${noImprovement[2]} -> ${noImprovement[3]}). 반복을 종료합니다`;
  let localized = message.replace(/^阶段：/, "단계: ");
  for (const [source, target] of Object.entries(DASHBOARD_LOG_LABELS_KO)) {
    localized = localized.replace(source, target);
  }
  localized = localized.replace(/第(\d+)轮/g, "$1차");
  localized = localized.replace(/修复轮次\s*(\d+)\/(\d+)/g, "수정 라운드 $1/$2");
  localized = localized.replace(/当前\s*(\d+)\s*分/g, "현재 $1점");
  return localized;
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

export function Dashboard({ nav, sse, theme, t }: { nav: Nav; sse: { messages: ReadonlyArray<SSEMessage> }; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const uiLanguage = t("nav.connected") === "연결됨" ? "ko" : t("nav.connected") === "Connected" ? "en" : "zh";
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
      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      <span className="text-sm text-muted-foreground animate-pulse">
        {uiLanguage === "ko" ? "원고를 불러오는 중..." : uiLanguage === "en" ? "Gathering manuscripts..." : "正在整理书稿..."}
      </span>
    </div>
  );

  if (error) return (
    <div className="flex flex-col items-center justify-center py-20 bg-destructive/5 border border-destructive/20 rounded-2xl">
      <AlertCircle className="text-destructive mb-4" size={32} />
      <h2 className="text-lg font-semibold text-destructive">
        {uiLanguage === "ko" ? "작품 목록을 불러오지 못했습니다" : uiLanguage === "en" ? "Failed to load library" : "加载书库失败"}
      </h2>
      <p className="text-sm text-muted-foreground mt-1">{error}</p>
    </div>
  );

  if (!data?.books.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center fade-in">
        <div className="w-20 h-20 rounded-full bg-primary/5 flex items-center justify-center mb-8">
          <BookOpen size={40} className="text-primary/20" />
        </div>
        <h2 className="font-serif text-3xl italic text-foreground/80 mb-3">{t("dash.noBooks")}</h2>
        <p className="text-sm text-muted-foreground max-w-xs leading-relaxed mb-10">
          {t("dash.createFirst")}
        </p>
        <button
          onClick={nav.toBookCreate}
          className="group flex items-center gap-2 px-8 py-3.5 rounded-xl text-sm font-bold bg-primary text-primary-foreground hover:scale-105 active:scale-95 transition-all shadow-lg shadow-primary/20"
        >
          <Plus size={18} />
          {t("nav.newBook")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      {!hasServices && (
        <div className="rounded-lg border border-border/60 bg-card px-5 py-4 mb-8 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">{t("dash.noModelTitle")}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{t("dash.noModelBody")}</div>
          </div>
          <button
            onClick={nav.toServices}
            className="px-4 py-2 text-xs rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors shrink-0"
          >
            {t("dash.configureModel")}
          </button>
        </div>
      )}
      <div className="flex items-end justify-between border-b border-border/40 pb-8">
        <div>
          <h1 className="font-serif text-4xl mb-2">{t("dash.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("dash.subtitle")}</p>
        </div>
        <button
          onClick={nav.toBookCreate}
          className="group flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-primary text-primary-foreground hover:scale-105 active:scale-95 transition-all shadow-lg shadow-primary/20"
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
              className={`paper-sheet group relative rounded-2xl fade-in ${staggerClass} ${menuOpenBookId === book.id ? "z-50" : ""}`}
            >
              <div className="p-8 flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="p-2 rounded-lg bg-primary/5 text-primary">
                      <BookOpen size={20} />
                    </div>
                    <button
                      onClick={() => nav.toBook(book.id)}
                      className="font-serif text-2xl hover:text-primary transition-all text-left truncate block font-medium hover:underline underline-offset-4 decoration-primary/30"
                    >
                      {book.title}
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-y-2 gap-x-4 text-[13px] text-muted-foreground font-medium">
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-secondary/50">
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
                      catch (e) { alert(e instanceof Error ? e.message : uiLanguage === "ko" ? "집필 실패" : uiLanguage === "en" ? "Write failed" : "写作失败"); }
                    }}
                    disabled={isWriting}
                    className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all shadow-sm ${
                      isWriting
                        ? "bg-primary/20 text-primary cursor-wait animate-pulse"
                        : "bg-secondary text-foreground hover:bg-primary hover:text-primary-foreground hover:shadow-lg hover:shadow-primary/20 hover:scale-105 active:scale-95"
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
                    className="p-3 rounded-xl bg-secondary text-muted-foreground hover:text-primary hover:bg-primary/10 hover:border-primary/30 hover:shadow-md hover:scale-105 active:scale-95 transition-all border border-border/50 shadow-sm"
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
        <div className="glass-panel rounded-2xl p-8 border-primary/20 bg-primary/[0.02] shadow-2xl shadow-primary/5 fade-in">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/20">
                <Flame size={18} className="animate-pulse" />
              </div>
              <div>
                <h3 className="text-sm font-bold uppercase tracking-widest text-primary">
                  {uiLanguage === "ko" ? "원고 생성 진행" : uiLanguage === "en" ? "Manuscript Foundry" : "书稿工坊"}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {uiLanguage === "ko" ? "실시간 LLM 생성 추적" : uiLanguage === "en" ? "Real-time LLM generation tracking" : "实时 LLM 生成追踪"}
                </p>
              </div>
            </div>
            {progressEvent && (
              <div className="flex items-center gap-4 text-xs font-bold text-primary px-4 py-2 rounded-full bg-primary/10 border border-primary/20">
                <div className="flex items-center gap-2">
                  <Clock size={12} />
                  <span>{Math.round(((progressEvent.data as { elapsedMs?: number })?.elapsedMs ?? 0) / 1000)}s</span>
                </div>
                <div className="w-px h-3 bg-primary/20" />
                <div className="flex items-center gap-2">
                  <Zap size={12} />
                  <span>
                    {((progressEvent.data as { totalChars?: number })?.totalChars ?? 0).toLocaleString()} {uiLanguage === "ko" ? "자" : uiLanguage === "en" ? "Chars" : "字"}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2 font-mono text-xs bg-black/5 dark:bg-black/20 p-6 rounded-xl border border-border/50 max-h-[200px] overflow-y-auto scrollbar-thin">
            {logEvents.map((msg, i) => {
              const d = msg.data as { tag?: string; message?: string };
              const message = localizeDashboardLogMessage(d.message, uiLanguage);
              return (
                <div key={i} className="flex gap-3 leading-relaxed animate-in fade-in slide-in-from-left-2 duration-300">
                  <span className="text-primary/60 font-bold shrink-0">[{d.tag}]</span>
                  <span className="text-muted-foreground">{message}</span>
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
