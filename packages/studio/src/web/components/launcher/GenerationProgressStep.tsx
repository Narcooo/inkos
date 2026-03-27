import type { CreationBootstrapState, CreationProjectState } from "../../hooks/useStudioState";

interface GenerationProgressStepProps {
  readonly bootstrap: CreationBootstrapState | null;
  readonly project: CreationProjectState | null;
  readonly onEnterDesk: () => void;
}

export function GenerationProgressStep({ bootstrap, project, onEnterDesk }: GenerationProgressStepProps) {
  const stages = bootstrap?.stages ?? [];
  const failed = bootstrap?.status === "failed";
  const canEnterDesk = Boolean(bootstrap?.bookId);

  return (
    <div>
      <div className="workspace__topbar">
        <div>
          <p className="panel__kicker">Progress</p>
          <h3>Bootstrap progress</h3>
        </div>
      </div>

      <ol>
        {stages.map((stage) => (
          <li key={stage.label}>
            {stage.state === "complete"
              ? `${stage.label} complete`
              : stage.state === "running"
                ? `${stage.label} in progress`
                : stage.state === "failed"
                  ? `${stage.label} failed`
                  : stage.label}
          </li>
        ))}
      </ol>

      {failed ? <p>Studio is preserving the bootstrapped book and waiting for a recovery handoff.</p> : <p>Studio is creating the project and preparing the desk.</p>}
      {failed && project ? <p>Bootstrapped book: {project.title}</p> : null}

      <div className="studio-shell__actions">
        <button type="button" onClick={onEnterDesk} disabled={!canEnterDesk}>
          {failed ? "Retry writing desk handoff" : "Enter writing desk"}
        </button>
      </div>
    </div>
  );
}
