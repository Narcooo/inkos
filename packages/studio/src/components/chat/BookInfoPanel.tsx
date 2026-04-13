import { useEffect, useState } from "react";
import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import { fetchJson } from "../../hooks/use-api";
import { cn } from "../../lib/utils";
import { ChevronDown, Loader2 } from "lucide-react";

// ── Types ──

interface ChapterMeta {
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly wordCount: number;
}

interface BookData {
  readonly book: {
    readonly id: string;
    readonly title: string;
    readonly genre: string;
    readonly status: string;
    readonly chapterWordCount: number;
    readonly targetChapters?: number;
    readonly language?: string;
  };
  readonly chapters: ReadonlyArray<ChapterMeta>;
  readonly nextChapter: number;
}

interface SessionData {
  readonly session?: {
    readonly activeBookId?: string;
    readonly creationDraft?: {
      readonly title?: string;
      readonly genre?: string;
      readonly worldPremise?: string;
      readonly concept?: string;
    };
    readonly currentExecution?: {
      readonly status?: string;
      readonly stageLabel?: string;
    };
  };
}

export interface BookInfoPanelProps {
  bookId: string;
  theme: Theme;
  t: TFunction;
}

// ── Collapsible Section ──

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  readonly title: string;
  readonly defaultOpen?: boolean;
  readonly children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-border/40 bg-card/80 backdrop-blur-sm overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>{title}</span>
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && <div className="px-3 pb-3 text-xs">{children}</div>}
    </div>
  );
}

// ── Status helpers ──

const CHAPTER_STATUS_INDICATOR: Record<
  string,
  { symbol: string; color: string }
> = {
  approved: { symbol: "✓", color: "text-emerald-500" },
  "ready-for-review": { symbol: "◆", color: "text-amber-500" },
  drafted: { symbol: "○", color: "text-muted-foreground" },
  "needs-revision": { symbol: "✕", color: "text-destructive" },
  imported: { symbol: "◇", color: "text-blue-500" },
  "audit-failed": { symbol: "✕", color: "text-destructive" },
};

function chapterIndicator(status: string) {
  return (
    CHAPTER_STATUS_INDICATOR[status] ?? {
      symbol: "○",
      color: "text-muted-foreground",
    }
  );
}

function executionLabel(
  status: string | undefined,
  stageLabel: string | undefined,
  isZh: boolean,
): string {
  if (!status || status === "idle") return isZh ? "就绪" : "Idle";
  if (stageLabel) return stageLabel;
  return status;
}

// ── Component ──

export function BookInfoPanel({ bookId, theme: _theme, t }: BookInfoPanelProps) {
  const [bookData, setBookData] = useState<BookData | null>(null);
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);

  const isZh = t("nav.connected") === "已连接";

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [book, session] = await Promise.all([
          fetchJson<BookData>(`/books/${bookId}`),
          fetchJson<SessionData>("/interaction/session").catch(() => null),
        ]);
        if (cancelled) return;
        setBookData(book);
        setSessionData(session);
      } catch {
        // Silently fail — panel is supplementary
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  if (loading) {
    return (
      <div className="rounded-xl border border-border/40 bg-card/80 backdrop-blur-sm px-3 py-4 flex items-center justify-center">
        <Loader2 size={14} className="text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (!bookData) return null;

  const { chapters } = bookData;
  const execution = sessionData?.session?.currentExecution;
  const draft = sessionData?.session?.creationDraft;
  const isRunning =
    execution?.status !== undefined &&
    execution.status !== "idle" &&
    execution.status !== "completed" &&
    execution.status !== "failed";

  return (
    <>
      {/* Section 1: Chapters */}
      <CollapsibleSection
        title={isZh ? "章节" : "Chapters"}
        defaultOpen={true}
      >
        {chapters.length === 0 ? (
          <p className="text-muted-foreground/60 italic">
            {isZh ? "暂无章节" : "No chapters"}
          </p>
        ) : (
          <ul className="space-y-1 max-h-52 overflow-y-auto">
            {chapters.map((ch) => {
              const ind = chapterIndicator(ch.status);
              return (
                <li
                  key={ch.number}
                  className="flex items-center gap-2 py-0.5 text-muted-foreground"
                >
                  <span className={cn("text-[10px] shrink-0", ind.color)}>
                    {ind.symbol}
                  </span>
                  <span className="truncate flex-1">
                    {ch.number.toString().padStart(2, "0")}{" "}
                    {ch.title ||
                      (isZh
                        ? `第${ch.number}章`
                        : `Chapter ${ch.number}`)}
                  </span>
                  <span className="tabular-nums text-[10px] text-muted-foreground/50 shrink-0">
                    {(ch.wordCount ?? 0).toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CollapsibleSection>

      {/* Section 2: Execution */}
      <CollapsibleSection
        title={isZh ? "执行" : "Execution"}
        defaultOpen={true}
      >
        <div className="flex items-center gap-2">
          {isRunning && (
            <Loader2 size={12} className="text-primary animate-spin shrink-0" />
          )}
          <span
            className={cn(
              isRunning ? "text-primary font-medium" : "text-muted-foreground",
            )}
          >
            {executionLabel(execution?.status, execution?.stageLabel, isZh)}
          </span>
        </div>
      </CollapsibleSection>

      {/* Section 3: Draft (conditional) */}
      {draft && (
        <CollapsibleSection
          title={isZh ? "草案" : "Draft"}
          defaultOpen={false}
        >
          <dl className="space-y-1.5">
            {draft.title && (
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">
                  {isZh ? "书名" : "Title"}
                </dt>
                <dd className="text-muted-foreground">{draft.title}</dd>
              </div>
            )}
            {draft.genre && (
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">
                  {isZh ? "题材" : "Genre"}
                </dt>
                <dd className="text-muted-foreground">{draft.genre}</dd>
              </div>
            )}
            {draft.worldPremise && (
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">
                  {isZh ? "世界前提" : "World Premise"}
                </dt>
                <dd className="text-muted-foreground line-clamp-3">
                  {draft.worldPremise}
                </dd>
              </div>
            )}
          </dl>
        </CollapsibleSection>
      )}
    </>
  );
}
