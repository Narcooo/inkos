import type { TruthFileDetail, TruthFileSummary } from "../../../shared/contracts";

interface TruthFilesViewerProps {
  readonly truthFiles: ReadonlyArray<TruthFileSummary>;
  readonly selectedTruthFile: TruthFileSummary | null;
  readonly truthFile: TruthFileDetail | null;
  readonly compact?: boolean;
  readonly showWriteNextPath?: boolean;
  readonly onOpenRuns?: () => void;
  readonly onSelectTruthFile: (name: string) => void;
}

export function TruthFilesViewer({
  truthFiles,
  selectedTruthFile,
  truthFile,
  compact = false,
  showWriteNextPath = false,
  onOpenRuns,
  onSelectTruthFile,
}: TruthFilesViewerProps) {
  const panelClassName = compact ? "panel truth-viewer truth-viewer--secondary truth-viewer--compact" : "panel truth-viewer";
  const layoutClassName = compact ? "truth-viewer__layout truth-viewer__layout--compact" : "truth-viewer__layout";

  return (
    <section className={panelClassName}>
      <div className="panel__header">
        <div>
          <p className="panel__kicker">Read-only context</p>
          <h3>Context</h3>
          <p className="panel__copy">Story memory stays nearby as reference only.</p>
        </div>
      </div>
      <div className={layoutClassName}>
        <div className="truth-viewer__list">
          {truthFiles.map((truth) => (
            <button
              key={truth.name}
              type="button"
              className={truth.name === selectedTruthFile?.name ? "truth-viewer__item truth-viewer__item--selected" : "truth-viewer__item"}
              onClick={() => void onSelectTruthFile(truth.name)}
            >
              <span>{truth.label}</span>
              <span className={truth.available ? "truth-viewer__availability" : "truth-viewer__availability truth-viewer__availability--muted"}>
                {truth.available ? "available" : "unavailable"}
              </span>
            </button>
          ))}
          {truthFiles.length === 0 ? (
            <div className="empty-state">
              <p>{showWriteNextPath ? "No reference files yet. Open Runs to use Write next for chapter one." : "No truth files loaded yet."}</p>
              {showWriteNextPath && onOpenRuns ? (
                <button type="button" onClick={onOpenRuns}>
                  Open runs
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="truth-viewer__content">
          {truthFile ? <pre>{truthFile.content ?? "This truth file exists but has no content yet."}</pre> : null}
          {!truthFile && selectedTruthFile && !selectedTruthFile.available ? (
            <div className="empty-state">{selectedTruthFile.optional ? "This optional truth file has not been generated yet." : "This required truth file is currently unavailable in the workspace."}</div>
          ) : null}
          {!truthFile && (!selectedTruthFile || selectedTruthFile.available) ? (
            <div className="empty-state">
              <p>{showWriteNextPath ? "Write next will create the first chapter before reference notes appear here." : "Choose a truth file to read it without changing the active chapter."}</p>
              {showWriteNextPath && onOpenRuns ? (
                <button type="button" onClick={onOpenRuns}>
                  Open runs
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
