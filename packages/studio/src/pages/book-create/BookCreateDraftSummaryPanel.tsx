import type { BookCreationDraft } from "@actalk/inkos-core";
import type { PAGE_COPY, buildCreationDraftSummary } from "../book-create-state";
import { canCreateFromDraft } from "../book-create-state";

type BookCreateCopy = (typeof PAGE_COPY)["zh"];
type DraftSummaryRows = ReturnType<typeof buildCreationDraftSummary>;

interface BookCreateDraftSummaryPanelProps {
  readonly copy: BookCreateCopy;
  readonly creating: boolean;
  readonly draft?: BookCreationDraft;
  readonly loadingDraft: boolean;
  readonly onApplyDraft: () => void;
  readonly onCreate: () => void;
  readonly projectLang: "zh" | "en";
  readonly submitting: boolean;
  readonly summaryRows: DraftSummaryRows;
}

export function BookCreateDraftSummaryPanel({
  copy,
  creating,
  draft,
  loadingDraft,
  onApplyDraft,
  onCreate,
  projectLang,
  submitting,
  summaryRows,
}: BookCreateDraftSummaryPanelProps) {
  return (
    <section className="rounded-lg border border-border/60 bg-card/80 p-5 space-y-4">
      <div className="space-y-1">
        <div className="text-[11px] uppercase text-muted-foreground font-bold">
          {copy.draftHeading}
        </div>
        <p className="text-xs text-muted-foreground leading-6">{copy.syncedHint}</p>
      </div>

      {loadingDraft ? (
        <div className="text-sm text-muted-foreground">
          {projectLang === "zh" ? "读取草案中…" : "Loading draft…"}
        </div>
      ) : draft ? (
        <div className="space-y-4">
          {summaryRows.length > 0 ? (
            <div className="space-y-2">
              {summaryRows.map((row) => (
                <div key={row.key} className="rounded-md border border-border/50 bg-background/70 px-3 py-2">
                  <div className="text-[10px] uppercase text-muted-foreground font-semibold">{row.label}</div>
                  <div className="mt-1 text-sm leading-6 whitespace-pre-wrap">{row.value}</div>
                </div>
              ))}
            </div>
          ) : null}

          {draft.missingFields.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs font-medium text-foreground">{copy.missingHeading}</div>
              <div className="flex flex-wrap gap-2">
                {draft.missingFields.map((field) => (
                  <span
                    key={field}
                    className="rounded-md border border-border/70 bg-secondary/50 px-2 py-1 text-xs text-muted-foreground"
                  >
                    {field}
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground leading-6">{copy.missingHint}</p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={onApplyDraft}
              className="px-3 py-2 rounded-md border border-border bg-secondary text-secondary-foreground font-medium text-xs"
            >
              {copy.applyDraft}
            </button>
            <button
              onClick={onCreate}
              disabled={!canCreateFromDraft(draft) || creating || submitting}
              className="px-3 py-2 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 disabled:opacity-50 font-medium text-xs"
            >
              {creating ? copy.creating : copy.create}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border/70 bg-background/50 px-4 py-5">
          <div className="font-medium">{copy.idleTitle}</div>
          <p className="mt-2 text-sm text-muted-foreground leading-7">
            {copy.helperBody}
          </p>
        </div>
      )}
    </section>
  );
}
