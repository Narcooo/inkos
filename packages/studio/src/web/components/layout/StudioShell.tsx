import type { PropsWithChildren, ReactNode } from "react";

interface StudioShellProps extends PropsWithChildren {
  readonly subtitle: string;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onOpenDashboard: () => void;
  readonly onOpenHealth: () => void | Promise<void>;
  readonly viewLabel: string;
  readonly actions?: ReactNode;
}

export function StudioShell({
  subtitle,
  loading,
  error,
  onOpenDashboard,
  onOpenHealth,
  viewLabel,
  actions,
  children,
}: StudioShellProps) {
  return (
    <div className="studio-shell">
      <header className="studio-shell__header">
        <div>
          <p className="studio-shell__eyebrow">InkOS Studio</p>
          <h1>Editorial workbench</h1>
          <p className="studio-shell__subtitle">{subtitle}</p>
          <p className="studio-shell__subtitle">Local-only workspace with live run streaming.</p>
        </div>
        <div className="studio-shell__header-meta">
          <span className="studio-shell__view-label">{viewLabel}</span>
          <div className="studio-shell__actions">
            <button type="button" onClick={onOpenDashboard}>
              Books
            </button>
            <button type="button" onClick={() => void onOpenHealth()}>
              Health
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
