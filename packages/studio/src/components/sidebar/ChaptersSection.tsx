import { useEffect, useState } from "react";
import { fetchJson } from "../../hooks/use-api";
import { useChatStore } from "../../store/chat";
import { SidebarCard } from "./SidebarCard";
import { cn } from "../../lib/utils";

interface ChapterMeta {
  number: number;
  title: string;
  status: string;
  wordCount: number;
}

const STATUS_INDICATOR: Record<string, { symbol: string; color: string }> = {
  approved: { symbol: "✓", color: "text-emerald-500" },
  "ready-for-review": { symbol: "◆", color: "text-amber-500" },
  drafted: { symbol: "○", color: "text-muted-foreground" },
  "needs-revision": { symbol: "✕", color: "text-destructive" },
  imported: { symbol: "◇", color: "text-blue-500" },
};

interface ChaptersSectionProps {
  readonly bookId: string;
  readonly isZh: boolean;
}

export function ChaptersSection({ bookId, isZh }: ChaptersSectionProps) {
  const [chapters, setChapters] = useState<ReadonlyArray<ChapterMeta>>([]);
  const bookDataVersion = useChatStore((s) => s.bookDataVersion);

  useEffect(() => {
    fetchJson<{ chapters: ChapterMeta[] }>(`/books/${bookId}`)
      .then((data) => setChapters(data.chapters))
      .catch(() => setChapters([]));
  }, [bookId, bookDataVersion]);

  return (
    <SidebarCard title={isZh ? "章节" : "Chapters"}>
      {chapters.length === 0 ? (
        <p className="text-xs text-muted-foreground/50 italic">
          {isZh ? "暂无章节" : "No chapters"}
        </p>
      ) : (
        <ul className="space-y-1 max-h-52 overflow-y-auto overflow-x-hidden">
          {chapters.map((ch) => {
            const ind = STATUS_INDICATOR[ch.status] ?? { symbol: "○", color: "text-muted-foreground" };
            return (
              <li
                key={`${ch.number}-${ch.title ?? ""}`}
                onClick={() => useChatStore.getState().openChapterArtifact(ch.number)}
                className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors rounded px-1 -mx-1 hover:bg-secondary/50">
                <span className={cn("text-[10px] shrink-0", ind.color)}>{ind.symbol}</span>
                <span className="truncate flex-1">
                  {String(ch.number).padStart(2, "0")} {ch.title || (isZh ? `第${ch.number}章` : `Chapter ${ch.number}`)}
                </span>
                <span className="tabular-nums text-[10px] text-muted-foreground/50 shrink-0">
                  {(ch.wordCount ?? 0).toLocaleString()}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SidebarCard>
  );
}
