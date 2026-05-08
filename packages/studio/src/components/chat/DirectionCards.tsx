import { Compass } from "lucide-react";
import type { StoryDirection } from "@actalk/inkos-core";

export type { StoryDirection };

interface DirectionCardsProps {
  readonly directions: ReadonlyArray<StoryDirection>;
  readonly onSelect: (directionId: string) => void;
  readonly disabled?: boolean;
  readonly isZh: boolean;
}

const BADGE_COLORS = [
  "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  "bg-amber-500/10 text-amber-600 dark:text-amber-400",
];

export function DirectionCards({ directions, onSelect, disabled, isZh }: DirectionCardsProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Compass size={14} className="text-primary" />
        <span>{isZh ? "选择故事方向" : "Choose a story direction"}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {directions.map((dir, index) => (
          <button
            key={dir.id}
            onClick={() => onSelect(dir.id)}
            disabled={disabled}
            className={`text-left rounded-xl border border-border/60 bg-card/60 p-4 cursor-pointer hover:border-primary/40 hover:bg-primary/5 hover:shadow-sm transition-all disabled:opacity-40 disabled:pointer-events-none group`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${BADGE_COLORS[index % BADGE_COLORS.length]}`}>
                {dir.id}
              </span>
              <span className="text-sm font-semibold text-foreground truncate">{dir.title}</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
              {dir.summary}
            </p>
            {dir.hookStrategy && (
              <p className="mt-2 text-[11px] text-muted-foreground/70 line-clamp-1">
                {isZh ? "钩子: " : "Hooks: "}{dir.hookStrategy}
              </p>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
