import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RequestedIntent } from "@actalk/inkos-core";

export type StudioTaskExecutionStatus = "running" | "processing" | "completed" | "error";

export interface StudioTaskExecution {
  readonly id: string;
  readonly tool: string;
  readonly agent?: string;
  readonly label: string;
  readonly status: StudioTaskExecutionStatus;
  readonly args?: Record<string, unknown>;
  readonly result?: string;
  readonly details?: unknown;
  readonly error?: string;
  readonly stages?: ReadonlyArray<{
    readonly label: string;
    readonly status: "pending" | "active" | "completed";
  }>;
  readonly logs?: ReadonlyArray<string>;
  readonly startedAt: number;
  readonly completedAt?: number;
}

export interface StudioTaskSnapshot {
  readonly version: 1;
  readonly sessionId: string;
  readonly sourceRequestId?: string;
  readonly requestedIntent: RequestedIntent;
  readonly execution: StudioTaskExecution;
  readonly updatedAt: number;
}

const TASKS_DIR = ".inkos/tasks";
const writeQueues = new Map<string, Promise<void>>();

function taskFileName(sessionId: string): string {
  return `${encodeURIComponent(sessionId)}.json`;
}

export function studioTaskSnapshotPath(projectRoot: string, sessionId: string): string {
  return join(projectRoot, TASKS_DIR, taskFileName(sessionId));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isExecutionStatus(value: unknown): value is StudioTaskExecutionStatus {
  return value === "running" || value === "processing" || value === "completed" || value === "error";
}

function parseStudioTaskSnapshot(value: unknown): StudioTaskSnapshot | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (typeof value.sessionId !== "string" || typeof value.requestedIntent !== "string") return null;
  if (value.sourceRequestId !== undefined && typeof value.sourceRequestId !== "string") return null;
  if (typeof value.updatedAt !== "number") return null;
  if (!isRecord(value.execution)) return null;

  const execution = value.execution;
  if (
    typeof execution.id !== "string"
    || typeof execution.tool !== "string"
    || typeof execution.label !== "string"
    || !isExecutionStatus(execution.status)
    || typeof execution.startedAt !== "number"
  ) return null;
  if (execution.logs !== undefined && (!Array.isArray(execution.logs) || execution.logs.some((log) => typeof log !== "string"))) {
    return null;
  }

  return value as unknown as StudioTaskSnapshot;
}

export async function saveStudioTaskSnapshot(
  projectRoot: string,
  snapshot: StudioTaskSnapshot,
): Promise<void> {
  const path = studioTaskSnapshotPath(projectRoot, snapshot.sessionId);
  const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
  const previous = writeQueues.get(path) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    await mkdir(join(projectRoot, TASKS_DIR), { recursive: true });
    await writeFile(path, serialized, "utf-8");
  });
  writeQueues.set(path, next);
  try {
    await next;
  } finally {
    if (writeQueues.get(path) === next) writeQueues.delete(path);
  }
}

export async function loadStudioTaskSnapshot(
  projectRoot: string,
  sessionId: string,
): Promise<StudioTaskSnapshot | null> {
  const path = studioTaskSnapshotPath(projectRoot, sessionId);
  await writeQueues.get(path)?.catch(() => undefined);
  try {
    return parseStudioTaskSnapshot(JSON.parse(await readFile(path, "utf-8")));
  } catch {
    return null;
  }
}

export async function deleteStudioTaskSnapshot(projectRoot: string, sessionId: string): Promise<void> {
  const path = studioTaskSnapshotPath(projectRoot, sessionId);
  await writeQueues.get(path)?.catch(() => undefined);
  await unlink(path).catch(() => undefined);
}
