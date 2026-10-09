import { mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { RequestedIntent, AgentSessionConfig } from "@actalk/inkos-core";
import { commitAtomicFileSet } from "@actalk/inkos-core";

export type StudioTaskExecutionStatus = "running" | "processing" | "completed" | "error";

export interface StudioTaskExecution {
  readonly deliveryState?:AgentSessionConfig['deliveryState'];
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

function parseStudioTaskSnapshot(value: unknown): StudioTaskSnapshot {
  if (!isRecord(value) || value.version !== 1) throw new Error("Invalid Studio task snapshot version.");
  if (typeof value.sessionId !== "string" || typeof value.requestedIntent !== "string") {
    throw new Error("Invalid Studio task snapshot identity.");
  }
  if (value.sourceRequestId !== undefined && typeof value.sourceRequestId !== "string") {
    throw new Error("Invalid Studio task sourceRequestId.");
  }
  if (typeof value.updatedAt !== "number") throw new Error("Invalid Studio task updatedAt.");
  if (!isRecord(value.execution)) throw new Error("Invalid Studio task execution.");

  const execution = value.execution;
  if (
    typeof execution.id !== "string"
    || typeof execution.tool !== "string"
    || typeof execution.label !== "string"
    || !isExecutionStatus(execution.status)
    || typeof execution.startedAt !== "number"
  ) throw new Error("Invalid Studio task execution identity.");
  if (execution.logs !== undefined && (!Array.isArray(execution.logs) || execution.logs.some((log) => typeof log !== "string"))) {
    throw new Error("Invalid Studio task execution logs.");
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
    await commitAtomicFileSet({rootDir:projectRoot,writes:[{
      relativePath:join(TASKS_DIR,taskFileName(snapshot.sessionId)),content:serialized,
    }]});
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
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function deleteStudioTaskSnapshot(projectRoot: string, sessionId: string): Promise<void> {
  const path = studioTaskSnapshotPath(projectRoot, sessionId);
  await writeQueues.get(path)?.catch(() => undefined);
  await unlink(path).catch(() => undefined);
}
