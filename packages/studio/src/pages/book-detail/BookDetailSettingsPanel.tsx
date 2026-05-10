import { Save } from "lucide-react";
import type { TFunction } from "../../hooks/use-i18n";
import type { BookStatus } from "../book-detail-state";

interface BookDetailSettingsPanelProps {
  readonly currentStatus: BookStatus;
  readonly currentTargetChapters: number;
  readonly currentWordCount: number;
  readonly onSave: () => void;
  readonly onStatusChange: (status: BookStatus) => void;
  readonly onTargetChaptersChange: (value: number) => void;
  readonly onWordCountChange: (value: number) => void;
  readonly savingSettings: boolean;
  readonly t: TFunction;
}

export function BookDetailSettingsPanel({
  currentStatus,
  currentTargetChapters,
  currentWordCount,
  onSave,
  onStatusChange,
  onTargetChaptersChange,
  onWordCountChange,
  savingSettings,
  t,
}: BookDetailSettingsPanelProps) {
  return (
    <div className="paper-sheet rounded-2xl border border-border/40 shadow-sm p-6">
      <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">{t("book.settings")}</h2>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("create.wordsPerChapter")}</label>
          <input
            type="number"
            value={currentWordCount}
            onChange={(event) => onWordCountChange(Number(event.target.value))}
            className="px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-primary/50 w-32"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("create.targetChapters")}</label>
          <input
            type="number"
            value={currentTargetChapters}
            onChange={(event) => onTargetChaptersChange(Number(event.target.value))}
            className="px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-primary/50 w-32"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("book.status")}</label>
          <select
            value={currentStatus}
            onChange={(event) => onStatusChange(event.target.value as BookStatus)}
            className="px-3 py-2 text-sm rounded-lg border border-border/50 bg-secondary/30 outline-none focus:border-primary/50"
          >
            <option value="active">{t("book.statusActive")}</option>
            <option value="paused">{t("book.statusPaused")}</option>
            <option value="outlining">{t("book.statusOutlining")}</option>
            <option value="completed">{t("book.statusCompleted")}</option>
            <option value="dropped">{t("book.statusDropped")}</option>
          </select>
        </div>
        <button
          onClick={onSave}
          disabled={savingSettings}
          className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-primary text-primary-foreground rounded-lg hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
        >
          {savingSettings ? <div className="w-4 h-4 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" /> : <Save size={14} />}
          {savingSettings ? t("book.saving") : t("book.save")}
        </button>
      </div>
    </div>
  );
}
