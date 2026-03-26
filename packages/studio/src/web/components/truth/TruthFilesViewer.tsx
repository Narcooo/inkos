import type { TruthFileDetail, TruthFileSummary } from "../../../shared/contracts";

interface TruthFilesViewerProps {
  readonly truthFiles: ReadonlyArray<TruthFileSummary>;
  readonly selectedTruthFile: TruthFileSummary | null;
  readonly truthFile: TruthFileDetail | null;
  readonly onSelectTruthFile: (name: string) => void;
}

export function TruthFilesViewer({ truthFiles, selectedTruthFile, truthFile, onSelectTruthFile }: TruthFilesViewerProps) {
  return (
    <section className="panel truth-viewer">
      <div className="panel__header">
        <div>
          <p className="panel__kicker">Truth files</p>
          <h3>Story memory</h3>
        </div>
      </div>
      <div className="truth-viewer__layout">
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
                {truth.available ? "available" : truth.optional ? "optional" : "missing"}
              </span>
            </button>
          ))}
          {truthFiles.length === 0 ? <div className="empty-state">No truth files loaded yet.</div> : null}
        </div>
        <div className="truth-viewer__content">
          {truthFile ? <pre>{truthFile.content ?? "This truth file exists but has no content yet."}</pre> : null}
          {!truthFile && selectedTruthFile && !selectedTruthFile.available ? (
            <div className="empty-state">{selectedTruthFile.optional ? "This optional truth file has not been generated yet." : "This required truth file is currently unavailable in the workspace."}</div>
          ) : null}
          {!truthFile && (!selectedTruthFile || selectedTruthFile.available) ? (
            <div className="empty-state">Choose a truth file to read it without changing the active chapter.</div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
