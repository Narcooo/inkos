import type { TFunction } from "../hooks/use-i18n";
import { Check, Download, Eye, FileText, RotateCcw } from "lucide-react";

export interface ChapterMeta {
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly wordCount: number;
}

export interface BookData {
  readonly book: {
    readonly id: string;
    readonly title: string;
    readonly genre: string;
    readonly status: string;
    readonly chapterWordCount: number;
    readonly targetChapters?: number;
    readonly language?: string;
    readonly fanficMode?: string;
  };
  readonly chapters: ReadonlyArray<ChapterMeta>;
  readonly nextChapter: number;
}

export type ReviseMode = "spot-fix" | "polish" | "rewrite" | "rework" | "anti-detect";
export type ExportFormat = "txt" | "md" | "epub";
export type BookStatus = "active" | "paused" | "outlining" | "completed" | "dropped";

export function translateChapterStatus(status: string, t: TFunction): string {
  const map: Record<string, () => string> = {
    "ready-for-review": () => t("chapter.readyForReview"),
    approved: () => t("chapter.approved"),
    drafted: () => t("chapter.drafted"),
    "needs-revision": () => t("chapter.needsRevision"),
    imported: () => t("chapter.imported"),
    "audit-failed": () => t("chapter.auditFailed"),
  };
  return map[status]?.() ?? status;
}

export const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode }> = {
  "ready-for-review": { color: "text-amber-500 bg-amber-500/10", icon: <Eye size={12} /> },
  approved: { color: "text-emerald-500 bg-emerald-500/10", icon: <Check size={12} /> },
  drafted: { color: "text-muted-foreground bg-muted/20", icon: <FileText size={12} /> },
  "needs-revision": { color: "text-destructive bg-destructive/10", icon: <RotateCcw size={12} /> },
  imported: { color: "text-blue-500 bg-blue-500/10", icon: <Download size={12} /> },
};
