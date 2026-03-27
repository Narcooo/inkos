import type { PropsWithChildren, ReactNode } from "react";

interface StudioShellProps extends PropsWithChildren {
  readonly subtitle: string;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onOpenDashboard: () => void;
  readonly onOpenHealth: () => void | Promise<void>;
  readonly viewLabel: string;
  readonly metadata?: ReadonlyArray<{ label: string; value: string }>;
  readonly actions?: ReactNode;
}

export function StudioShell({
  subtitle,
  loading,
  error,
  onOpenDashboard,
  onOpenHealth,
  viewLabel,
  metadata = [],
  actions,
  children,
}: StudioShellProps) {
  return (
    <div className="studio-shell">
      <header className="studio-shell__header">
        <div>
          <p className="studio-shell__eyebrow">InkOS Studio</p>
          <h1>Writing studio</h1>
          <p className="studio-shell__subtitle">{subtitle}</p>
          <p className="studio-shell__subtitle">Shelf is close by, but the draft stays front and center.</p>
        </div>
        <div className="studio-shell__header-meta">
          <span className="studio-shell__view-label">{viewLabel}</span>
          {metadata.length > 0 ? (
            <dl className="studio-shell__metadata" aria-label="Workspace context">
              {metadata.map((item) => (
                <div key={item.label} className="studio-shell__metadata-item">
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <div className="studio-shell__actions">
            <button type="button" onClick={onOpenDashboard}>
              Shelf
            </button>
            <button type="button" onClick={() => void onOpenHealth()}>
              System
            </button>
            {actions}
          </div>
        </div>
      </header>
      {error ? <div className="studio-shell__error">{error}</div> : null}
      {loading ? <div className="studio-shell__loading">Loading live studio state...</div> : null}
      <main className="studio-shell__body">{children}</main>
    </div>
  );
}
