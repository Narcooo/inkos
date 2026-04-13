import { ArrowUp, Loader2 } from "lucide-react";
import type { Theme } from "../../hooks/use-theme";

export interface ComposerBarProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly disabled: boolean;
  readonly placeholder: string;
  readonly theme: Theme;
}

export function ComposerBar({ value, onChange, onSubmit, disabled, placeholder }: ComposerBarProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim()) {
        onSubmit();
      }
    }
  };

  return (
    <div className="sticky bottom-0 bg-background/95 backdrop-blur-sm border-t border-border/40 px-4 py-3">
      <div className="flex items-end gap-2 rounded-xl bg-secondary/30 border border-border/40 px-3 py-2 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 transition-all">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="flex-1 bg-transparent text-sm leading-6 placeholder:text-muted-foreground/50 outline-none ring-0 shadow-none disabled:opacity-50 resize-none min-h-[24px] max-h-[120px]"
          style={{ outline: "none", boxShadow: "none", fieldSizing: "content" } as React.CSSProperties}
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
          className="w-8 h-8 shrink-0 rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:scale-105 active:scale-95 transition-all disabled:opacity-20 disabled:scale-100 shadow-sm shadow-primary/20"
        >
          {disabled ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <ArrowUp size={14} strokeWidth={2.5} />
          )}
        </button>
      </div>
    </div>
  );
}
