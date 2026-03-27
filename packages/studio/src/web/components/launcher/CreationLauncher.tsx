import { useMemo } from "react";
import type { BootstrapStatus, HealthStatus, NormalizedUploadIntake, UploadedFileIntakeSummary } from "../../../shared/contracts";
import type { CreationBootstrapState, CreationDraftState, CreationProjectState } from "../../hooks/useStudioState";
import { FileIntakeStep } from "./FileIntakeStep";
import { GenerationProgressStep } from "./GenerationProgressStep";
import { IdeaIntakeStep } from "./IdeaIntakeStep";
import { ProjectSetupStep } from "./ProjectSetupStep";
import { isStageALauncherReady } from "../../utils/stage-a-readiness";

export type CreationLauncherMode = "idea" | "upload";
export type LauncherLanguage = "zh" | "en";

export interface CreationLauncherProps {
  readonly draft: CreationDraftState;
  readonly health: HealthStatus | null;
  readonly bootstrapStatus: BootstrapStatus | null;
  readonly creationBootstrap: CreationBootstrapState | null;
  readonly creationProject: CreationProjectState | null;
  readonly onBackHome: () => void;
  readonly onDraftChange: (patch: Partial<CreationDraftState>) => void;
  readonly onNormalizeIdea: () => Promise<void>;
  readonly onSummarizeUpload: () => Promise<void>;
  readonly onStartBootstrap: () => Promise<void>;
  readonly onComplete: () => Promise<void>;
}

const INITIAL_ERRORS = {
  genre: null,
  language: null,
  idea: null,
  files: null,
  summary: null,
} as const;

export function CreationLauncher({ draft, health, bootstrapStatus, creationBootstrap, creationProject, onBackHome, onDraftChange, onNormalizeIdea, onSummarizeUpload, onStartBootstrap, onComplete }: CreationLauncherProps) {
  const step = draft.step;
  const currentErrors = draft.errors;
  const setupReady = useMemo(() => isStageALauncherReady(bootstrapStatus), [bootstrapStatus]);

  function updateErrors(next: { [Key in keyof typeof INITIAL_ERRORS]: string | null }) {
    onDraftChange({ errors: next });
  }

  function resetErrors() {
    onDraftChange({ errors: { ...INITIAL_ERRORS } });
  }

  async function handleContinueFromIntake() {
    const nextErrors = {
      genre: draft.genre.trim() ? null : "Genre is required.",
      language: draft.language ? null : "Language is required.",
      idea: draft.mode === "idea" && !draft.idea.trim() ? "One-line idea is required." : null,
      files: draft.mode === "upload" && draft.files.length === 0 ? "Upload at least one file." : null,
      summary:
        draft.mode === "upload"
          ? !draft.normalizedIntake || draft.normalizedIntake.type !== "upload"
            ? "Parse uploaded materials and confirm the summary before continuing."
            : !draft.parsedConfirmed
              ? "Confirm the parsed summary before continuing."
              : null
          : null,
    };

    updateErrors(nextErrors);
    if (Object.values(nextErrors).some((value) => value !== null)) {
      return;
    }

    if (draft.mode === "idea") {
      await onNormalizeIdea();
    }

    onDraftChange({ step: "setup" });
  }

  async function handleParseFiles() {
    if (draft.files.length === 0) {
      updateErrors({ ...currentErrors, files: "Upload at least one file." });
      return;
    }

    await onSummarizeUpload();
    onDraftChange({
      errors: { ...currentErrors, files: null, summary: null },
    });
  }

  return (
    <section className="panel" aria-label="Creation launcher">
      <div className="factory-home__hero">
        <div>
          <p className="panel__kicker">Factory launcher</p>
          <h2>Creation Launcher</h2>
          <p className="panel__copy">
            Move from a spark or a source pack into a guided setup, then hand the project toward the writing desk.
          </p>
        </div>
      </div>

      {step === "intake" && draft.mode === "idea" ? (
        <IdeaIntakeStep
          draft={draft}
          errors={currentErrors}
          onBackHome={onBackHome}
          onContinue={handleContinueFromIntake}
          onDraftChange={onDraftChange}
          onResetErrors={resetErrors}
        />
      ) : null}

      {step === "intake" && draft.mode === "upload" ? (
        <FileIntakeStep
          draft={draft}
          errors={currentErrors}
          onBackHome={onBackHome}
          onContinue={handleContinueFromIntake}
          onDraftChange={onDraftChange}
          onParseFiles={handleParseFiles}
          onResetErrors={resetErrors}
        />
      ) : null}

      {step === "setup" ? (
        <ProjectSetupStep
          draft={draft}
          ready={setupReady}
          health={health}
          bootstrapStatus={bootstrapStatus}
          onBack={() => onDraftChange({ step: "intake" })}
          onStartGeneration={async () => {
            onDraftChange({ step: "progress" });
            await onStartBootstrap();
          }}
        />
      ) : null}

      {step === "progress" ? (
        <GenerationProgressStep bootstrap={creationBootstrap} project={creationProject} onEnterDesk={onComplete} />
      ) : null}
    </section>
  );
}
