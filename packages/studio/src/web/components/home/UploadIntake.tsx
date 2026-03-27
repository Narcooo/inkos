interface UploadIntakeProps {
  readonly title: string;
  readonly copy: string;
  readonly actionLabel: string;
  readonly onAction: () => void;
}

export function UploadIntake({ title, copy, actionLabel, onAction }: UploadIntakeProps) {
  return (
    <article className="factory-home__action-card factory-home__action-card--muted">
      <p className="factory-home__action-kicker">Reference intake</p>
      <h3>{title}</h3>
      <p>{copy}</p>
      <button type="button" className="factory-home__action-button" onClick={onAction}>
        {actionLabel}
      </button>
      <span className="factory-home__action-note">Bring notes, outlines, or canon files into the same launcher shell.</span>
    </article>
  );
}
