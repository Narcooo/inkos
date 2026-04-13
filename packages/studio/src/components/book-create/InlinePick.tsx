import { cn } from "../../lib/utils";
import type { Theme } from "../../hooks/use-theme";

export interface InlinePickProps {
  readonly fieldKey: string;
  readonly label: string;
  readonly options: string[];
  readonly selected: string;
  readonly onChange: (key: string, value: string) => void;
  readonly theme: Theme;
}

export function InlinePick({ fieldKey, label, options, selected, onChange }: InlinePickProps) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/70 px-4 py-3 my-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold mb-2">
        {label}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(fieldKey, option)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm transition-all duration-200",
              selected === option
                ? "border-primary bg-primary/10 text-primary font-medium"
                : "border-border bg-secondary/30 text-foreground hover:border-primary/40 hover:bg-primary/5",
            )}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
