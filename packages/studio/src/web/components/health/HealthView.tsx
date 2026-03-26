import type { HealthStatus } from "../../../shared/contracts";

interface HealthViewProps {
  readonly health: HealthStatus | null;
}

export function HealthView({ health }: HealthViewProps) {
  if (!health) {
    return <section className="panel empty-state">Health data is not available yet.</section>;
  }

  return (
    <section className="panel health-view">
      <div className="panel__header">
        <div>
          <p className="panel__kicker">Health</p>
          <h2>Project readiness</h2>
        </div>
        <span className="status-pill status-pill--ok">{health.status}</span>
      </div>
      <dl className="health-view__grid">
        <div>
          <dt>Project root</dt>
          <dd>{health.projectRoot}</dd>
        </div>
        <div>
          <dt>Books</dt>
          <dd>{health.bookCount}</dd>
        </div>
        <div>
          <dt>Provider</dt>
          <dd>{health.provider ?? "not configured"}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{health.model ?? "not configured"}</dd>
        </div>
        <div>
          <dt>Project config</dt>
          <dd>{health.projectConfigFound ? "present" : "missing"}</dd>
        </div>
        <div>
          <dt>Environment</dt>
          <dd>{health.envFound ? "detected" : "missing"}</dd>
        </div>
      </dl>
    </section>
  );
}
