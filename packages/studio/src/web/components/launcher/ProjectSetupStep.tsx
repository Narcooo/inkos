import type { BootstrapStatus, HealthStatus } from "../../../shared/contracts";
import type { CreationDraftState } from "../../hooks/useStudioState";

interface ProjectSetupStepProps {
  readonly draft: CreationDraftState;
  readonly ready: boolean;
  readonly health: HealthStatus | null;
  readonly bootstrapStatus: BootstrapStatus | null;
  readonly onBack: () => void;
  readonly onStartGeneration: () => void;
}

export function ProjectSetupStep({ draft, ready, health, bootstrapStatus, onBack, onStartGeneration }: ProjectSetupStepProps) {
  const readinessMessage = ready
    ? bootstrapStatus?.readiness.code === "PROJECT_NOT_INITIALIZED"
      ? "Studio will create the project and first book when you continue."
      : bootstrapStatus?.readiness.message ?? "Studio is ready for the next step."
    : bootstrapStatus?.readiness.message ?? "Resolve config readiness before generation can start.";

  return (
    <div>
      <div className="workspace__topbar">
        <div>
          <p className="panel__kicker">Setup</p>
          <h3>Project setup</h3>
        </div>
      </div>

      <p>{ready ? "Ready to generate" : "Setup needs config attention"}</p>
      <p>{readinessMessage}</p>
      <p>
        Provider: {health?.provider ?? "Not connected"}
        {health?.model ? ` · ${health.model}` : ""}
      </p>

      <dl aria-label="Setup summary">
        <div>
          <dt>Genre</dt>
          <dd>{draft.genre}</dd>
        </div>
        <div>
          <dt>Language</dt>
          <dd>{draft.language || "Not set"}</dd>
        </div>
        <div>
          <dt>Intake</dt>
          <dd>
            {draft.mode === "idea"
              ? draft.normalizedIntake?.type === "idea"
                ? draft.normalizedIntake.sourceText
                : draft.idea
              : `${draft.normalizedIntake?.type === "upload" ? draft.normalizedIntake.summary.fileCount : draft.files.length} files parsed`}
          </dd>
        </div>
        {draft.mode === "upload" && draft.normalizedIntake?.type === "upload"
          ? draft.normalizedIntake.summary.formats.map((entry) => (
              <div key={`format-${entry.label}`}>
                <dt>Format</dt>
                <dd>{entry.label} x{entry.count}</dd>
              </div>
            ))
          : null}
        {draft.mode === "upload" && draft.normalizedIntake?.type === "upload"
          ? draft.normalizedIntake.summary.kinds.map((entry) => (
              <div key={`kind-${entry.label}`}>
                <dt>Parsed kind</dt>
                <dd>{entry.label} x{entry.count}</dd>
              </div>
            ))
          : null}
      </dl>

      <div className="studio-shell__actions">
        <button type="button" onClick={onBack}>
          Back
        </button>
        <button type="button" onClick={onStartGeneration} disabled={!ready}>
          Start generation
        </button>
      </div>
    </div>
  );
}
