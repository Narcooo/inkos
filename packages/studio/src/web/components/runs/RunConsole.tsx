import { useEffect, useMemo, useState } from "react";
import type { RunAction, StudioRun } from "../../../shared/contracts";
import { createStudioApiClient, type StudioApiClient } from "../../api/client";
import { useRunStream } from "../../hooks/useRunStream";

interface RunConsoleProps {
  readonly bookId: string;
  readonly chapterNumber: number | null;
  readonly client?: StudioApiClient;
}

const ACTIONS: ReadonlyArray<{ action: RunAction; label: string }> = [
  { action: "draft", label: "Draft" },
  { action: "audit", label: "Audit" },
  { action: "revise", label: "Revise" },
  { action: "write-next", label: "Write next" },
];

export function RunConsole({ bookId, chapterNumber, client: clientProp }: RunConsoleProps) {
  const client = useMemo(() => clientProp ?? createStudioApiClient(), [clientProp]);
  const [runs, setRuns] = useState<ReadonlyArray<StudioRun>>([]);
  const [selectedRun, setSelectedRun] = useState<StudioRun | null>(null);
  const [submittingAction, setSubmittingAction] = useState<RunAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { run: streamedRun, streamError } = useRunStream(selectedRun);

  useEffect(() => {
    void (async () => {
      try {
        const nextRuns = await client.listRuns();
        const bookRuns = nextRuns.filter((run) => run.bookId === bookId);
        setRuns(bookRuns);
        setSelectedRun(bookRuns[0] ?? null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to load runs.");
      }
    })();
  }, [bookId, client]);

  useEffect(() => {
    if (!streamedRun) {
      return;
    }

    setSelectedRun(streamedRun);
    setRuns((current) => {
      const next = current.filter((run) => run.id !== streamedRun.id);
      return [streamedRun, ...next];
    });
  }, [streamedRun]);

  async function triggerRun(action: RunAction): Promise<void> {
    setSubmittingAction(action);
    setError(null);

    try {
      const run = await client.createRun(bookId, action, chapterNumber ? { chapterNumber } : {});
      setSelectedRun(run);
      setRuns((current) => [run, ...current.filter((entry) => entry.id !== run.id)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start run.");
    } finally {
      setSubmittingAction(null);
    }
  }

  const activeRun = streamedRun ?? selectedRun;

  return (
    <section className="panel runs-panel">
      <div className="panel__header">
        <div>
          <p className="panel__kicker">Runs</p>
          <h3>Execution console</h3>
        </div>
      </div>

      <div className="runs-panel__actions">
        {ACTIONS.map(({ action, label }) => (
          <button key={action} type="button" onClick={() => void triggerRun(action)} disabled={submittingAction !== null}>
            {submittingAction === action ? `${label}...` : label}
          </button>
        ))}
      </div>

      {error || streamError ? <div className="studio-shell__error">{error ?? streamError}</div> : null}

      {activeRun ? (
        <>
          <div className="runs-panel__summary">
            <strong>{activeRun.action}</strong>
            <span>{activeRun.status}</span>
            <span>{activeRun.stage}</span>
            <span>{activeRun.chapterNumber ? `Chapter ${activeRun.chapterNumber}` : "Whole book"}</span>
          </div>
          <div className="runs-panel__result">
            {activeRun.result ? JSON.stringify(activeRun.result) : activeRun.error ?? "Run in progress."}
          </div>
          <div className="runs-panel__logs" aria-label="Run logs">
            {activeRun.logs.length === 0 ? <div className="empty-state">No logs yet.</div> : null}
            {activeRun.logs.map((log, index) => (
              <div key={`${log.timestamp}-${index}`}>
                [{log.level}] {log.message}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="empty-state">Start a run to inspect progress, logs, and the final result.</div>
      )}
    </section>
  );
}
