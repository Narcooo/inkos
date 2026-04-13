import { Loader2 } from "lucide-react";
import type { Theme } from "../../hooks/use-theme";
import { useColors } from "../../hooks/use-colors";

export interface DraftReadyBarProps {
  readonly onConfirm: () => void;
  readonly onContinue: () => void;
  readonly creating: boolean;
  readonly theme: Theme;
}

export function DraftReadyBar({ onConfirm, onContinue, creating, theme }: DraftReadyBarProps) {
  const c = useColors(theme);

  return (
    <div className="rounded-xl border-2 border-primary/40 bg-primary/5 px-5 py-4 space-y-3">
      <div className="text-sm font-medium text-foreground">
        {"\u8349\u6848\u5DF2\u5C31\u7EEA\uFF0C\u53EF\u4EE5\u5F00\u59CB\u5199\u4E66\u4E86\u3002"}
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onConfirm}
          disabled={creating}
          className={`px-5 py-2.5 ${c.btnPrimary} rounded-lg disabled:opacity-50 font-medium text-sm flex items-center gap-2`}
        >
          {creating && <Loader2 size={14} className="animate-spin" />}
          {creating ? "\u521B\u5EFA\u4E2D\u2026" : "\u5F00\u59CB\u5199\u8FD9\u672C\u4E66"}
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={creating}
          className="px-5 py-2.5 rounded-lg border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50 font-medium text-sm transition-colors"
        >
          {"\u7EE7\u7EED\u6253\u78E8"}
        </button>
      </div>
    </div>
  );
}
