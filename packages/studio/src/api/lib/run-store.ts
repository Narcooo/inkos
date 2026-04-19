/**
 * In-memory event store for run lifecycle tracking.
 * Ported from PR #96 (Te9ui1a) — immutable updates, pub/sub per run.
 */

import { randomUUID } from "node:crypto";
import type {
  RunAction,
  RunLogEntry,
  RunStatus,
  RunStreamEvent,
  StudioRun,
} from "../../shared/contracts.js";

type RunSubscriber = (event: RunStreamEvent) => void;

export class RunStore {
  private readonly runs = new Map<string, StudioRun>();
  private readonly subscribers = new Map<string, Set<RunSubscriber>>();

  create(input: {
    bookId: string;
    chapterNumber?: number;
    action: RunAction;
  }): StudioRun {
    const now = new Date().toISOString();
    const run: StudioRun = {
      id: randomUUID(),
      bookId: input.bookId,
      chapter: input.chapterNumber ?? null,
      chapterNumber: input.chapterNumber ?? null,
      action: input.action,
      status: "queued",
      stage: "Queued",
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      logs: [],
    };

    this.runs.set(run.id, run);
    this.publish(run.id, { type: "snapshot", runId: run.id, run });
    return run;
  }

  list(): ReadonlyArray<StudioRun> {
    return [...this.runs.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  get(runId: string): StudioRun | null {
    return this.runs.get(runId) ?? null;
  }

  findActiveRun(bookId: string): StudioRun | null {
    for (const run of this.runs.values()) {
      if (
        run.bookId === bookId &&
        (run.status === "queued" || run.status === "running")
      ) {
        return run;
      }
    }
    return null;
  }

  markRunning(runId: string, stage: string): StudioRun {
    return this.update(
      runId,
      { status: "running", stage, startedAt: new Date().toISOString() },
      [
        { type: "status", runId, status: "running" },
        { type: "stage", runId, stage },
      ],
    );
  }

  updateStage(runId: string, stage: string): StudioRun {
    return this.update(runId, { stage }, [{ type: "stage", runId, stage }]);
  }

  appendLog(runId: string, log: RunLogEntry): StudioRun {
    return this.update(runId, (run) => ({ logs: [...run.logs, log] }), [
      { type: "log", runId, log },
    ]);
  }

  succeed(runId: string, result: unknown): StudioRun {
    return this.update(
      runId,
      {
        status: "succeeded",
        stage: "Completed",
        finishedAt: new Date().toISOString(),
        result,
        error: undefined,
      },
      [{ type: "status", runId, status: "succeeded", result }],
      true,
    );
  }

  fail(runId: string, error: string): StudioRun {
    return this.update(
      runId,
      {
        status: "failed",
        stage: "Failed",
        finishedAt: new Date().toISOString(),
        error,
      },
      [{ type: "status", runId, status: "failed", error }],
      true,
    );
  }

  subscribe(runId: string, subscriber: RunSubscriber): () => void {
    const current =
      this.subscribers.get(runId) ?? new Set<RunSubscriber>();
    current.add(subscriber);
    this.subscribers.set(runId, current);

    return () => {
      const listeners = this.subscribers.get(runId);
      if (!listeners) return;
      listeners.delete(subscriber);
      if (listeners.size === 0) this.subscribers.delete(runId);
    };
  }

  private update(
    runId: string,
    patch: Partial<StudioRun> | ((run: StudioRun) => Partial<StudioRun>),
    events: ReadonlyArray<RunStreamEvent>,
    publishSnapshot = false,
  ): StudioRun {
    const current = this.runs.get(runId);
    if (!current) throw new Error(`Run ${runId} not found.`);

    const partial = typeof patch === "function" ? patch(current) : patch;
    const next: StudioRun = {
      ...current,
      ...partial,
      updatedAt: new Date().toISOString(),
    };
    this.runs.set(runId, next);

    for (const event of events) {
      this.publish(runId, event);
    }
    if (publishSnapshot) {
      this.publish(runId, { type: "snapshot", runId, run: next });
    }

    return next;
  }

  private publish(runId: string, event: RunStreamEvent): void {
    const listeners = this.subscribers.get(runId);
    if (!listeners || listeners.size === 0) return;

    const payload =
      event.type === "snapshot"
        ? { ...event, run: event.run ?? this.get(runId) ?? undefined }
        : event;

    for (const listener of listeners) {
      listener(payload as RunStreamEvent);
    }
  }
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return status === "succeeded" || status === "failed";
}
