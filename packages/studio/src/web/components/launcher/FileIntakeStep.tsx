import type { ChangeEvent } from "react";
import type { CreationDraftState } from "../../hooks/useStudioState";

interface FileIntakeStepProps {
  readonly draft: CreationDraftState;
  readonly errors: {
    readonly genre: string | null;
    readonly language: string | null;
    readonly files: string | null;
    readonly summary: string | null;
  };
  readonly onBackHome: () => void;
  readonly onContinue: () => void;
  readonly onParseFiles: () => void;
  readonly onDraftChange: (patch: Partial<CreationDraftState>) => void;
  readonly onResetErrors: () => void;
}

function formatBytes(totalBytes: number): string {
  if (totalBytes < 1024) {
    return `${totalBytes} B`;
  }

  return `${(totalBytes / 1024).toFixed(1)} KB`;
}

export function FileIntakeStep({
  draft,
  errors,
  onBackHome,
  onContinue,
  onParseFiles,
  onDraftChange,
  onResetErrors,
}: FileIntakeStepProps) {
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    onResetErrors();
    onDraftChange({
      files: Array.from(event.target.files ?? []),
      intakeTitle: null,
      normalizedIntake: null,
      parsedConfirmed: false,
    });
  }

  return (
    <div>
      <div className="workspace__topbar">
        <div>
          <p className="panel__kicker">Upload intake</p>
          <h3>Source pack kickoff</h3>
        </div>
      </div>

      <label>
        Genre
        <select
          aria-label="Genre"
          value={draft.genre}
          onChange={(event) => {
            onResetErrors();
            onDraftChange({ genre: event.target.value });
          }}
        >
          <option value="">Select genre</option>
          <option value="fantasy">fantasy</option>
          <option value="sci-fi">sci-fi</option>
          <option value="romance">romance</option>
        </select>
      </label>
      {errors.genre ? <p>{errors.genre}</p> : null}

      <label>
        Language
        <select
          aria-label="Language"
          value={draft.language}
          onChange={(event) => {
            onResetErrors();
            onDraftChange({ language: event.target.value as CreationDraftState["language"] });
          }}
        >
          <option value="">Select language</option>
          <option value="zh">zh</option>
          <option value="en">en</option>
        </select>
      </label>
      {errors.language ? <p>{errors.language}</p> : null}

      <label>
        Upload files
        <input aria-label="Upload files" type="file" multiple onChange={handleFileChange} />
      </label>
      {errors.files ? <p>{errors.files}</p> : null}

      <div className="studio-shell__actions">
        <button type="button" onClick={onParseFiles}>
          Parse files
        </button>
      </div>

      {draft.normalizedIntake?.type === "upload" ? (
        <section>
          <h4>Parsed input summary</h4>
          <p>{draft.normalizedIntake.summary.fileCount} files parsed</p>
          <p>{formatBytes(draft.normalizedIntake.summary.totalBytes)} total</p>
          <div>
            {draft.normalizedIntake.summary.formats.map((entry) => (
              <p key={entry.label}>{entry.label} x{entry.count}</p>
            ))}
            {draft.normalizedIntake.summary.kinds.map((entry) => (
              <p key={entry.label}>{entry.label} x{entry.count}</p>
            ))}
          </div>
          <div>
            <h5>Parsed intake confirmation</h5>
            <p>The launcher will carry this parsed intake summary into setup and the writing desk.</p>
          </div>
          <label>
            <input
              type="checkbox"
              aria-label="I confirm the parsed summary"
              checked={draft.parsedConfirmed}
              onChange={(event) => {
                onResetErrors();
                onDraftChange({ parsedConfirmed: event.target.checked });
              }}
            />
            I confirm the parsed summary
          </label>
        </section>
      ) : null}
      {errors.summary ? <p>{errors.summary}</p> : null}

      <div className="studio-shell__actions">
        <button type="button" onClick={onBackHome}>
          Back to home
        </button>
        <button type="button" onClick={onContinue}>
          Continue
        </button>
      </div>
    </div>
  );
}
