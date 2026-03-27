import { useEffect, useMemo, useRef, useState } from "react";
import type { RunAction, StudioRun } from "../../../shared/contracts";
import { createStudioApiClient, type StudioApiClient } from "../../api/client";
import { useRunStream } from "../../hooks/useRunStream";

interface RunConsoleProps {
  readonly bookId: string;
  readonly chapterNumber: number | null;
  readonly actionsBlockedReason?: string | null;
  readonly client?: StudioApiClient;
}

const ACTIONS: ReadonlyArray<{ action: RunAction; label: string }> = [
  { action: "draft", label: "Draft" },
  { action: "audit", label: "Audit" },
  { action: "revise", label: "Revise" },
  { action: "write-next", label: "Write next" },
];

const CHAPTER_SCOPED_ACTIONS = new Set<RunAction>(["audit", "revise"]);

function createScopeKey(bookId: string, chapterNumber: number | null): string {
  return `${bookId}:${chapterNumber ?? "all"}`;
}

function isRunInScope(run: StudioRun, bookId: string, chapterNumber: number | null): boolean {
  if (run.bookId !== bookId) {
    return false;
  }

  if ((run.chapterNumber ?? null) === null) {
    return true;
  }

  if (chapterNumber === null) {
    return true;
  }

  return run.chapterNumber === chapterNumber;
}

export function RunConsole({ bookId, chapterNumber, actionsBlockedReason = null, client: clientProp }: RunConsoleProps) {
  const client = useMemo(() => clientProp ?? createStudioApiClient(), [clientProp]);
  const requestVersionRef = useRef(0);
  const scopeKeyRef = useRef(createScopeKey(bookId, chapterNumber));
  const [runs, setRuns] = useState<ReadonlyArray<StudioRun>>([]);
  const [selectedRun, setSelectedRun] = useState<StudioRun | null>(null);
  const [submittingAction, setSubmittingAction] = useState<RunAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { run: streamedRun, streamError } = useRunStream(selectedRun);
  const consoleScopeKey = createScopeKey(bookId, chapterNumber);

  useEffect(() => {
    scopeKeyRef.current = consoleScopeKey;
  }, [consoleScopeKey]);

  useEffect(() => {
    const requestVersion = ++requestVersionRef.current;
    setRuns([]);
    setSelectedRun(null);
    setError(null);

    void (async () => {
      try {
        const nextRuns = await client.listRuns();
        if (requestVersion !== requestVersionRef.current) {
          return;
        }

        const scopedRuns = nextRuns.filter((run) => isRunInScope(run, bookId, chapterNumber));
        setRuns(scopedRuns);
        setSelectedRun(scopedRuns[0] ?? null);
      } catch (cause) {
        if (requestVersion !== requestVersionRef.current) {
          return;
        }

        setError(cause instanceof Error ? cause.message : "Unable to load runs.");
      }
    })();
  }, [bookId, chapterNumber, client]);

  useEffect(() => {
    if (!streamedRun) {
      return;
    }

    if (!isRunInScope(streamedRun, bookId, chapterNumber) || scopeKeyRef.current !== consoleScopeKey) {
      return;
    }

    setSelectedRun(streamedRun);
    setRuns((current) => {
      const next = current.filter((run) => run.id !== streamedRun.id);
      return [streamedRun, ...next];
    });
  }, [streamedRun]);

  async function triggerRun(action: RunAction): Promise<void> {
    if (actionsBlockedReason) {
      setError(actionsBlockedReason);
      return;
    }

    setSubmittingAction(action);
    setError(null);
    const requestVersion = requestVersionRef.current;
    const requestScopeKey = consoleScopeKey;

    try {
      const run = await client.createRun(bookId, action, CHAPTER_SCOPED_ACTIONS.has(action) && chapterNumber ? { chapterNumber } : {});
      if (requestVersion !== requestVersionRef.current || requestScopeKey !== scopeKeyRef.current) {
        return;
      }

      setSelectedRun(run);
      setRuns((current) => [run, ...current.filter((entry) => entry.id !== run.id)]);
    } catch (cause) {
      if (requestVersion !== requestVersionRef.current || requestScopeKey !== scopeKeyRef.current) {
        return;
      }

      setError(cause instanceof Error ? cause.message : "Unable to start run.");
    } finally {
      if (requestVersion === requestVersionRef.current && requestScopeKey === scopeKeyRef.current) {
        setSubmittingAction(null);
      }
    }
  }

  const activeRun = streamedRun && isRunInScope(streamedRun, bookId, chapterNumber) ? streamedRun : selectedRun;

  return (
    <section className="panel runs-panel">
      <div className="panel__header">
        <div>
          <p className="panel__kicker">Support section</p>
          <h3>Runs</h3>
          <p className="panel__copy">Execution console</p>
        </div>
      </div>

      <div className="runs-panel__actions">
        {ACTIONS.map(({ action, label }) => (
          <button
            key={action}
            type="button"
            onClick={() => void triggerRun(action)}
            disabled={submittingAction !== null || Boolean(actionsBlockedReason)}
          >
            {submittingAction === action ? `${label}...` : label}
          </button>
        ))}
      </div>

      {actionsBlockedReason || error || streamError ? <div className="studio-shell__error">{actionsBlockedReason ?? error ?? streamError}</div> : null}

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
