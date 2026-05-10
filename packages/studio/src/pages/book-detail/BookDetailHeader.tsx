import type { TFunction } from "../../hooks/use-i18n";
import {
  ChevronLeft,
  FileText,
  Sparkles,
  Trash2,
  Wand2,
  Zap,
} from "lucide-react";
import type { BookData } from "../book-detail-state";

interface BookDetailHeaderProps {
  readonly book: BookData["book"];
  readonly chapterCount: number;
  readonly totalWords: number;
  readonly writing: boolean;
  readonly drafting: boolean;
  readonly deleting: boolean;
  readonly lastError?: string;
  readonly onBack: () => void;
  readonly onWriteNext: () => void;
  readonly onDraft: () => void;
  readonly onDeleteClick: () => void;
  readonly t: TFunction;
}

export function BookDetailHeader({
  book,
  chapterCount,
  totalWords,
  writing,
  drafting,
  deleting,
  lastError,
  onBack,
  onWriteNext,
  onDraft,
  onDeleteClick,
  t,
}: BookDetailHeaderProps) {
  return (
    <>
      <nav className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
        <button
          onClick={onBack}
          className="hover:text-primary transition-colors flex items-center gap-1"
        >
          <ChevronLeft size={14} />
          {t("bread.books")}
        </button>
        <span className="text-border">/</span>
        <span className="text-foreground">{book.title}</span>
      </nav>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-border/40 pb-8">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-4xl font-serif font-medium">{book.title}</h1>
            {book.language === "en" && (
              <span className="px-1.5 py-0.5 rounded border border-primary/20 text-primary text-[10px] font-bold">EN</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground font-medium">
            <span className="px-2 py-0.5 rounded bg-secondary/50 text-foreground/70 uppercase tracking-wider text-xs">{book.genre}</span>
            <div className="flex items-center gap-1.5">
              <FileText size={14} />
              <span>{chapterCount} {t("dash.chapters")}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Zap size={14} />
              <span>{totalWords.toLocaleString()} {t("book.words")}</span>
            </div>
            {book.fanficMode && (
              <span className="flex items-center gap-1 text-purple-500">
                <Sparkles size={12} />
                <span className="italic">fanfic:{book.fanficMode}</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={onWriteNext}
            disabled={writing || drafting}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold bg-primary text-primary-foreground rounded-xl hover:scale-105 active:scale-95 transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
          >
            {writing ? <div className="w-4 h-4 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" /> : <Zap size={16} />}
            {writing ? t("dash.writing") : t("book.writeNext")}
          </button>
          <button
            onClick={onDraft}
            disabled={writing || drafting}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold bg-secondary text-foreground rounded-xl hover:bg-secondary/80 transition-all border border-border/50 disabled:opacity-50"
          >
            {drafting ? <div className="w-4 h-4 border-2 border-muted-foreground/20 border-t-muted-foreground rounded-full animate-spin" /> : <Wand2 size={16} />}
            {drafting ? t("book.drafting") : t("book.draftOnly")}
          </button>
          <button
            onClick={onDeleteClick}
            disabled={deleting}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold bg-destructive/10 text-destructive rounded-xl hover:bg-destructive hover:text-white transition-all border border-destructive/20 disabled:opacity-50"
          >
            {deleting ? <div className="w-4 h-4 border-2 border-destructive/20 border-t-destructive rounded-full animate-spin" /> : <Trash2 size={16} />}
            {deleting ? t("common.loading") : t("book.deleteBook")}
          </button>
        </div>
      </div>

      {(writing || drafting || lastError) && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            lastError
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "border-primary/20 bg-primary/[0.04] text-foreground"
          }`}
        >
          {lastError ? (
            <span>
              {t("book.pipelineFailed")}: {lastError}
            </span>
          ) : writing ? (
            <span>{t("book.pipelineWriting")}</span>
          ) : (
            <span>{t("book.pipelineDrafting")}</span>
          )}
        </div>
      )}
    </>
  );
}
