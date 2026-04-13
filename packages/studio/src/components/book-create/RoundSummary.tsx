import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";

export interface RoundSummaryProps {
  readonly round: { roundId: number; summary: string; userMessage: string };
  readonly expanded: boolean;
  readonly onToggle: () => void;
}

export function RoundSummary({ round, expanded, onToggle }: RoundSummaryProps) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/50 transition-all duration-200">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight
          size={14}
          className={cn(
            "shrink-0 transition-transform duration-200",
            expanded && "rotate-90",
          )}
        />
        <span className="font-medium text-foreground/70">
          {`\u7B2C ${round.roundId} \u8F6E`}
        </span>
        <span className="text-muted-foreground/70 truncate">
          {round.summary || round.userMessage}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 border-t border-border/30 pt-2 text-sm text-muted-foreground leading-7 whitespace-pre-wrap">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-muted-foreground/60 mb-1">
            {"\u7528\u6237\u8F93\u5165"}
          </div>
          {round.userMessage}
        </div>
      )}
    </div>
  );
}
