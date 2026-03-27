import type { CreationDraftState } from "../../hooks/useStudioState";

interface IdeaIntakeStepProps {
  readonly draft: CreationDraftState;
  readonly errors: {
    readonly genre: string | null;
    readonly language: string | null;
    readonly idea: string | null;
  };
  readonly onBackHome: () => void;
  readonly onContinue: () => void;
  readonly onDraftChange: (patch: Partial<CreationDraftState>) => void;
  readonly onResetErrors: () => void;
}

export function IdeaIntakeStep({ draft, errors, onBackHome, onContinue, onDraftChange, onResetErrors }: IdeaIntakeStepProps) {
  return (
    <div>
      <div className="workspace__topbar">
        <div>
          <p className="panel__kicker">Idea intake</p>
          <h3>One-line kickoff</h3>
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
        One-line idea
        <textarea
          aria-label="One-line idea"
          value={draft.idea}
          onChange={(event) => {
            onResetErrors();
            onDraftChange({ idea: event.target.value, intakeTitle: null });
          }}
        />
      </label>
      {errors.idea ? <p>{errors.idea}</p> : null}

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
