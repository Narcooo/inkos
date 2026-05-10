import { BookPlus, CheckCircle2 } from "lucide-react";
import type { useColors } from "../../hooks/use-colors";
import type {
  BookCreateFormState,
  PAGE_COPY,
} from "../book-create-state";

type BookCreateColors = ReturnType<typeof useColors>;
type BookCreateCopy = (typeof PAGE_COPY)["zh"];

interface BookCreateBasicFormProps {
  readonly canSubmitForm: boolean;
  readonly copy: BookCreateCopy;
  readonly colors: BookCreateColors;
  readonly creating: boolean;
  readonly form: BookCreateFormState;
  readonly onCreate: () => void;
  readonly platformChoices: ReadonlyArray<{ value: string; label: string }>;
  readonly submitting: boolean;
  readonly updateForm: (patch: Partial<BookCreateFormState>) => void;
}

export function BookCreateBasicForm({
  canSubmitForm,
  copy,
  colors,
  creating,
  form,
  onCreate,
  platformChoices,
  submitting,
  updateForm,
}: BookCreateBasicFormProps) {
  return (
    <section className="rounded-lg border border-border/60 bg-card/80 p-5 space-y-5">
      <div className="space-y-1">
        <div className="text-[11px] uppercase text-muted-foreground font-bold">
          {copy.formHeading}
        </div>
        <p className="text-xs text-muted-foreground leading-6">{copy.formHint}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground">{copy.titleLabel}</span>
          <input
            value={form.title}
            onChange={(event) => updateForm({ title: event.target.value })}
            className={`w-full ${colors.input} rounded-md px-3 py-2.5 focus:outline-none text-sm`}
            placeholder={copy.titlePlaceholder}
          />
        </label>
        <label className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground">{copy.genreLabel}</span>
          <input
            value={form.genre}
            onChange={(event) => updateForm({ genre: event.target.value })}
            className={`w-full ${colors.input} rounded-md px-3 py-2.5 focus:outline-none text-sm`}
            placeholder={copy.genrePlaceholder}
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground">{copy.platformLabel}</span>
          <select
            value={form.platform}
            onChange={(event) => updateForm({ platform: event.target.value })}
            className={`w-full ${colors.input} rounded-md px-3 py-2.5 focus:outline-none text-sm bg-background`}
          >
            {platformChoices.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground">{copy.targetChaptersLabel}</span>
          <input
            type="number"
            min={1}
            value={form.targetChapters}
            onChange={(event) => updateForm({ targetChapters: event.target.value })}
            className={`w-full ${colors.input} rounded-md px-3 py-2.5 focus:outline-none text-sm`}
          />
        </label>
        <label className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground">{copy.chapterWordCountLabel}</span>
          <input
            type="number"
            min={1000}
            value={form.chapterWordCount}
            onChange={(event) => updateForm({ chapterWordCount: event.target.value })}
            className={`w-full ${colors.input} rounded-md px-3 py-2.5 focus:outline-none text-sm`}
          />
        </label>
      </div>

      <label className="space-y-2 block">
        <span className="text-xs font-medium text-muted-foreground">{copy.briefLabel}</span>
        <textarea
          value={form.brief}
          onChange={(event) => updateForm({ brief: event.target.value })}
          rows={9}
          className={`w-full ${colors.input} rounded-md px-3 py-3 focus:outline-none text-sm leading-7 resize-y`}
          placeholder={copy.briefPlaceholder}
        />
      </label>

      {creating && (
        <div className="grid gap-2 sm:grid-cols-3">
          {copy.creationSteps.map((step) => (
            <div key={step} className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
              <CheckCircle2 size={14} />
              <span>{step}</span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={onCreate}
        disabled={!canSubmitForm || creating || submitting}
        className={`inline-flex items-center gap-2 px-5 py-3 ${colors.btnPrimary} rounded-md disabled:opacity-50 font-medium text-sm`}
      >
        <BookPlus size={16} />
        {creating ? copy.creatingBook : copy.createBook}
      </button>
    </section>
  );
}
