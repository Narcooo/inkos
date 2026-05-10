import type { BookCreationDraft } from "@actalk/inkos-core";
import { RotateCcw, Sparkles } from "lucide-react";
import type { useColors } from "../../hooks/use-colors";
import type { PAGE_COPY } from "../book-create-state";

type BookCreateColors = ReturnType<typeof useColors>;
type BookCreateCopy = (typeof PAGE_COPY)["zh"];

interface BookCreateAssistantPanelProps {
  readonly colors: BookCreateColors;
  readonly copy: BookCreateCopy;
  readonly creating: boolean;
  readonly draft?: BookCreationDraft;
  readonly input: string;
  readonly onDiscard: () => void;
  readonly onInputChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly submitting: boolean;
}

export function BookCreateAssistantPanel({
  colors,
  copy,
  creating,
  draft,
  input,
  onDiscard,
  onInputChange,
  onSubmit,
  submitting,
}: BookCreateAssistantPanelProps) {
  return (
    <section className="rounded-lg border border-border/60 bg-card/80 p-5 space-y-4">
      <div className="space-y-1">
        <div className="text-[11px] uppercase text-muted-foreground font-bold">
          {copy.assistantHeading}
        </div>
        <p className="text-xs text-muted-foreground leading-6">{copy.assistantHint}</p>
      </div>

      <textarea
        value={input}
        onChange={(event) => onInputChange(event.target.value)}
        rows={7}
        className={`w-full ${colors.input} rounded-md px-3 py-3 focus:outline-none text-sm leading-7 resize-y`}
        placeholder={draft ? copy.promptPlaceholderFollowup : copy.promptPlaceholder}
      />

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onSubmit}
          disabled={submitting || creating || !input.trim()}
          className={`inline-flex items-center gap-2 px-3 py-2 ${colors.btnPrimary} rounded-md disabled:opacity-50 font-medium text-xs`}
        >
          <Sparkles size={14} />
          {submitting ? copy.submitting : copy.submit}
        </button>
        <button
          onClick={onDiscard}
          disabled={!draft || submitting || creating}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 disabled:opacity-50 font-medium text-xs"
        >
          <RotateCcw size={14} />
          {copy.discard}
        </button>
      </div>
    </section>
  );
}
