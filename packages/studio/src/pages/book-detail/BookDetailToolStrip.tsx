import { BarChart2, CheckCheck, Database, Download } from "lucide-react";
import { fetchJson } from "../../hooks/use-api";
import type { TFunction } from "../../hooks/use-i18n";
import type { ExportFormat } from "../book-detail-state";

interface BookDetailToolStripProps {
  readonly bookId: string;
  readonly exportApprovedOnly: boolean;
  readonly exportFormat: ExportFormat;
  readonly onAnalytics: () => void;
  readonly onApproveAll: () => void;
  readonly onExportApprovedOnlyChange: (approvedOnly: boolean) => void;
  readonly onExportFormatChange: (format: ExportFormat) => void;
  readonly onTruth: () => void;
  readonly reviewCount: number;
  readonly t: TFunction;
}

export function BookDetailToolStrip({
  bookId,
  exportApprovedOnly,
  exportFormat,
  onAnalytics,
  onApproveAll,
  onExportApprovedOnlyChange,
  onExportFormatChange,
  onTruth,
  reviewCount,
  t,
}: BookDetailToolStripProps) {
  const handleExport = async () => {
    try {
      const data = await fetchJson<{ path?: string; chapters?: number }>(
        `/books/${bookId}/export-save`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approvedOnly: exportApprovedOnly,
            format: exportFormat,
          }),
        },
      );
      alert(`${t("common.exportSuccess")}\n${data.path}\n(${data.chapters} ${t("dash.chapters")})`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Export failed");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      {reviewCount > 0 && (
        <button
          onClick={onApproveAll}
          className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-emerald-500/10 text-emerald-600 rounded-lg hover:bg-emerald-500/20 transition-all border border-emerald-500/20"
        >
          <CheckCheck size={14} />
          {t("book.approveAll")} ({reviewCount})
        </button>
      )}
      <button
        onClick={onTruth}
        className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary/50 text-muted-foreground rounded-lg hover:text-foreground hover:bg-secondary transition-all border border-border/50"
      >
        <Database size={14} />
        {t("book.truthFiles")}
      </button>
      <button
        onClick={onAnalytics}
        className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary/50 text-muted-foreground rounded-lg hover:text-foreground hover:bg-secondary transition-all border border-border/50"
      >
        <BarChart2 size={14} />
        {t("book.analytics")}
      </button>
      <div className="flex items-center gap-2">
        <select
          value={exportFormat}
          onChange={(event) => onExportFormatChange(event.target.value as ExportFormat)}
          className="px-2 py-2 text-xs font-bold bg-secondary/50 text-muted-foreground rounded-lg border border-border/50 outline-none"
        >
          <option value="txt">TXT</option>
          <option value="md">MD</option>
          <option value="epub">EPUB</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={exportApprovedOnly}
            onChange={(event) => onExportApprovedOnlyChange(event.target.checked)}
            className="rounded border-border/50"
          />
          {t("book.approvedOnly")}
        </label>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary/50 text-muted-foreground rounded-lg hover:text-foreground hover:bg-secondary transition-all border border-border/50"
        >
          <Download size={14} />
          {t("book.export")}
        </button>
      </div>
    </div>
  );
}
