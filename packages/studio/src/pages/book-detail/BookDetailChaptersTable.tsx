import {
  Check,
  FileText,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { fetchJson, postApi } from "../../hooks/use-api";
import type { TFunction } from "../../hooks/use-i18n";
import {
  STATUS_CONFIG,
  type BookData,
  type ReviseMode,
  translateChapterStatus,
} from "../book-detail-state";

type BookChapter = BookData["chapters"][number];

interface BookDetailChaptersTableProps {
  readonly bookId: string;
  readonly bookLanguage?: string;
  readonly chapters: ReadonlyArray<BookChapter>;
  readonly latestPersistedChapter: number;
  readonly onChapterClick: (chapterNumber: number) => void;
  readonly onRefetch: () => void;
  readonly onRevise: (chapterNumber: number, mode: ReviseMode) => void;
  readonly onRewrite: (chapterNumber: number) => void;
  readonly onSync: (chapterNumber: number) => void;
  readonly revisingChapters: ReadonlyArray<number>;
  readonly rewritingChapters: ReadonlyArray<number>;
  readonly syncingChapters: ReadonlyArray<number>;
  readonly t: TFunction;
}

export function BookDetailChaptersTable({
  bookId,
  bookLanguage,
  chapters,
  latestPersistedChapter,
  onChapterClick,
  onRefetch,
  onRevise,
  onRewrite,
  onSync,
  revisingChapters,
  rewritingChapters,
  syncingChapters,
  t,
}: BookDetailChaptersTableProps) {
  return (
    <div className="paper-sheet rounded-2xl overflow-hidden border border-border/40 shadow-xl shadow-primary/5">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/30 border-b border-border/50">
              <th className="text-left px-6 py-4 font-bold text-[11px] uppercase tracking-widest text-muted-foreground w-16">#</th>
              <th className="text-left px-6 py-4 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">{t("book.manuscriptTitle")}</th>
              <th className="text-left px-6 py-4 font-bold text-[11px] uppercase tracking-widest text-muted-foreground w-28">{t("book.words")}</th>
              <th className="text-left px-6 py-4 font-bold text-[11px] uppercase tracking-widest text-muted-foreground w-36">{t("book.status")}</th>
              <th className="text-right px-6 py-4 font-bold text-[11px] uppercase tracking-widest text-muted-foreground">{t("book.curate")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {chapters.map((chapter, index) => {
              const staggerClass = `stagger-${Math.min(index + 1, 5)}`;
              return (
                <tr key={chapter.number} className={`group hover:bg-primary/[0.02] transition-colors fade-in ${staggerClass}`}>
                  <td className="px-6 py-4 text-muted-foreground/60 font-mono text-xs">{chapter.number.toString().padStart(2, "0")}</td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => onChapterClick(chapter.number)}
                      className="font-serif text-lg font-medium hover:text-primary transition-colors text-left"
                    >
                      {chapter.title || t("chapter.label").replace("{n}", String(chapter.number))}
                    </button>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground font-medium tabular-nums text-xs">{(chapter.wordCount ?? 0).toLocaleString()}</td>
                  <td className="px-6 py-4">
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-tight ${STATUS_CONFIG[chapter.status]?.color ?? "bg-muted text-muted-foreground"}`}>
                      {STATUS_CONFIG[chapter.status]?.icon}
                      {translateChapterStatus(chapter.status, t)}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      {chapter.status === "ready-for-review" && (
                        <>
                          <button
                            onClick={async () => {
                              try {
                                await postApi(`/books/${bookId}/chapters/${chapter.number}/approve`);
                                onRefetch();
                              } catch (e) {
                                alert(e instanceof Error ? e.message : "Approve failed");
                              }
                            }}
                            className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500 hover:text-white transition-all shadow-sm"
                            title={t("book.approve")}
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                await postApi(`/books/${bookId}/chapters/${chapter.number}/reject`);
                                onRefetch();
                              } catch (e) {
                                alert(e instanceof Error ? e.message : "Reject failed");
                              }
                            }}
                            className="p-2 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive hover:text-white transition-all shadow-sm"
                            title={t("book.reject")}
                          >
                            <X size={14} />
                          </button>
                        </>
                      )}
                      <button
                        onClick={async () => {
                          try {
                            const auditResult = await fetchJson<{ passed?: boolean; issues?: unknown[] }>(
                              `/books/${bookId}/audit/${chapter.number}`,
                              { method: "POST" },
                            );
                            alert(auditResult.passed ? "Audit passed" : `Audit failed: ${auditResult.issues?.length ?? 0} issues`);
                            onRefetch();
                          } catch (e) {
                            alert(e instanceof Error ? e.message : "Audit failed");
                          }
                        }}
                        className="p-2 rounded-lg bg-secondary text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all shadow-sm"
                        title={t("book.audit")}
                      >
                        <ShieldCheck size={14} />
                      </button>
                      <button
                        onClick={() => onRewrite(chapter.number)}
                        disabled={rewritingChapters.includes(chapter.number)}
                        className="p-2 rounded-lg bg-secondary text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all shadow-sm disabled:opacity-50"
                        title={t("book.rewrite")}
                      >
                        {rewritingChapters.includes(chapter.number)
                          ? <div className="w-3.5 h-3.5 border-2 border-muted-foreground/20 border-t-muted-foreground rounded-full animate-spin" />
                          : <RotateCcw size={14} />}
                      </button>
                      <button
                        onClick={() => onSync(chapter.number)}
                        disabled={syncingChapters.includes(chapter.number) || chapter.number !== latestPersistedChapter}
                        className="p-2 rounded-lg bg-secondary text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all shadow-sm disabled:opacity-50"
                        title={bookLanguage === "en" ? "Sync truth/state from edited chapter" : "根据已编辑章节同步 truth/state"}
                      >
                        {syncingChapters.includes(chapter.number)
                          ? <div className="w-3.5 h-3.5 border-2 border-muted-foreground/20 border-t-muted-foreground rounded-full animate-spin" />
                          : <RefreshCw size={14} />}
                      </button>
                      <select
                        disabled={revisingChapters.includes(chapter.number)}
                        value=""
                        onChange={(event) => {
                          const mode = event.target.value as ReviseMode;
                          if (mode) {
                            onRevise(chapter.number, mode);
                          }
                        }}
                        className="px-2 py-1.5 text-[11px] font-bold rounded-lg bg-secondary text-muted-foreground border border-border/50 outline-none hover:text-primary hover:bg-primary/10 transition-all disabled:opacity-50 cursor-pointer"
                        title="Revise with AI"
                      >
                        <option value="" disabled>{revisingChapters.includes(chapter.number) ? t("common.loading") : t("book.curate")}</option>
                        <option value="spot-fix">{t("book.spotFix")}</option>
                        <option value="polish">{t("book.polish")}</option>
                        <option value="rewrite">{t("book.rewrite")}</option>
                        <option value="rework">{t("book.rework")}</option>
                        <option value="anti-detect">{t("book.antiDetect")}</option>
                      </select>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {chapters.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-12 h-12 rounded-full bg-muted/20 flex items-center justify-center mb-4">
            <FileText size={20} className="text-muted-foreground/40" />
          </div>
          <p className="text-sm italic font-serif text-muted-foreground">
            {t("book.noChapters")}
          </p>
        </div>
      )}
    </div>
  );
}
