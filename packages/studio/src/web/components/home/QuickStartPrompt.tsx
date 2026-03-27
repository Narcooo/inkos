interface QuickStartPromptProps {
  readonly title: string;
  readonly copy: string;
  readonly actionLabel: string;
  readonly onAction: () => void;
}

export function QuickStartPrompt({ title, copy, actionLabel, onAction }: QuickStartPromptProps) {
  return (
    <article className="factory-home__action-card">
      <p className="factory-home__action-kicker">Quick start</p>
      <h3>{title}</h3>
      <p>{copy}</p>
      <button type="button" className="factory-home__action-button" onClick={onAction}>
        {actionLabel}
      </button>
      <span className="factory-home__action-note">Open the launcher and start from a single sentence.</span>
    </article>
  );
}
