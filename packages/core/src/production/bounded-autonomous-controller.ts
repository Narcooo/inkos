import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { resolveProductionScope, type BookProductionMap, type ProductionMode } from "./book-production-map.js";
import type { ChapterMeta } from "../models/chapter.js";

export type AutonomousRunStatus =
  | "RUNNING"
  | "VOLUME_COMPLETE"
  | "BOOK_COMPLETE"
  | "PAUSED_BY_USER"
  | "REVIEW_EXHAUSTED"
  | "HELD_AFTER_TWO_REVISIONS";

export interface AutonomousRunProgress {
  readonly jobId: string;
  readonly status: AutonomousRunStatus;
  readonly mode: ProductionMode;
  readonly volumeId: string;
  readonly startChapter: number;
  readonly targetChapter: number;
  readonly nextChapter: number;
  readonly completedThisRun: number;
  readonly reason?: string;
}

export function autonomousProductionStatePath(projectRoot: string, bookId: string): string {
  return join(projectRoot, "books", bookId, "story", "runtime", "bounded-autonomous", "production-state.json");
}

export interface AutonomousJobClaim {
  readonly jobId: string;
  readonly claimId: string;
  readonly ownerPid: number;
}

function autonomousProductionLeasePath(projectRoot: string, bookId: string): string {
  return join(projectRoot, "books", bookId, "story", "runtime", "bounded-autonomous", "active-job.json");
}

const AUTONOMOUS_HEARTBEAT_STALE_MS = 5 * 60_000;
const execFileAsync = promisify(execFile);
let currentProcessIdentity: Promise<string | null> | undefined;

async function queryProcessIdentity(pid: number): Promise<string | null> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$p = Get-Process -Id ${pid} -ErrorAction Stop; [Console]::Out.Write($p.StartTime.ToUniversalTime().Ticks)`,
      ], { windowsHide: true });
      return `win32:${pid}:${stdout.trim()}`;
    }
    if (process.platform === "linux") {
      const raw = await readFile(`/proc/${pid}/stat`, "utf-8");
      const fields = raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\s+/);
      return `linux:${pid}:${fields[19] ?? ""}`;
    }
    const { stdout } = await execFileAsync("ps", ["-o", "lstart=", "-p", String(pid)]);
    return `${process.platform}:${pid}:${stdout.trim()}`;
  } catch {
    return null;
  }
}

function defaultProcessIdentity(pid: number): Promise<string | null> {
  if (pid !== process.pid) return queryProcessIdentity(pid);
  currentProcessIdentity ??= queryProcessIdentity(pid);
  return currentProcessIdentity;
}

function autonomousHeartbeatPath(leasePath: string, claimId: string): string {
  return `${leasePath}.heartbeat.${claimId}`;
}

function defaultProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function claimIsActive(
  leasePath: string,
  claim: AutonomousJobClaim,
  isProcessAlive: (pid: number) => boolean,
): Promise<boolean> {
  if (!isProcessAlive(claim.ownerPid)) return false;
  try {
    const heartbeat = JSON.parse(await readFile(autonomousHeartbeatPath(leasePath, claim.claimId), "utf-8")) as { updatedAt?: string };
    const updatedAt = Date.parse(heartbeat.updatedAt ?? "");
    return Number.isFinite(updatedAt) && Date.now() - updatedAt <= AUTONOMOUS_HEARTBEAT_STALE_MS;
  } catch {
    return false;
  }
}

const localLeaseGuardQueues = new Map<string, Promise<void>>();

async function withAutonomousLeaseGuardUnqueued<T>(
  leasePath: string,
  task: () => Promise<T>,
  isProcessAlive: (pid: number) => boolean = defaultProcessAlive,
  getProcessIdentity: (pid: number) => Promise<string | null> = defaultProcessIdentity,
): Promise<T> {
  interface GuardParticipant {
    readonly token: string;
    readonly ownerPid: number;
    readonly ownerIdentity: string;
    readonly ticket: number | null;
    readonly choosing: boolean;
    readonly updatedAt: string;
  }
  const guardDir = `${leasePath}.reclaim-contenders`;
  const token = randomUUID();
  const participantPath = join(guardDir, `${token}.json`);
  await mkdir(guardDir, { recursive: true });
  const ownerIdentity = await getProcessIdentity(process.pid);
  if (!ownerIdentity) throw new Error("AUTONOMOUS_JOB_PROCESS_IDENTITY_UNAVAILABLE");

  const writeParticipant = async (participant: GuardParticipant): Promise<void> => {
    const temp = `${participantPath}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify(participant)}\n`, "utf-8");
    await rename(temp, participantPath);
  };
  const readParticipants = async (): Promise<Array<{ path: string; participant: GuardParticipant | null; active: boolean }>> => {
    const entries = await readdir(guardDir);
    return Promise.all(entries.filter((entry) => entry.endsWith(".json")).map(async (entry) => {
      const path = join(guardDir, entry);
      try {
        const [raw, metadata] = await Promise.all([readFile(path, "utf-8"), stat(path)]);
        try {
          const participant = JSON.parse(raw) as GuardParticipant;
          const updatedAt = Date.parse(participant.updatedAt);
          const valid = typeof participant.token === "string"
            && Number.isInteger(participant.ownerPid)
            && typeof participant.ownerIdentity === "string"
            && participant.ownerIdentity.length > 0
            && (participant.ticket === null || Number.isInteger(participant.ticket))
            && typeof participant.choosing === "boolean"
            && Number.isFinite(updatedAt);
          const ownerIsAlive = valid && isProcessAlive(participant.ownerPid);
          const liveIdentity = ownerIsAlive
            ? await getProcessIdentity(participant.ownerPid)
            : null;
          return {
            path,
            participant: valid ? participant : null,
            active: valid
              ? ownerIsAlive && (liveIdentity === null || liveIdentity === participant.ownerIdentity)
              : Date.now() - metadata.mtimeMs <= AUTONOMOUS_HEARTBEAT_STALE_MS,
          };
        } catch {
          return { path, participant: null, active: Date.now() - metadata.mtimeMs <= AUTONOMOUS_HEARTBEAT_STALE_MS };
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path, participant: null, active: false };
        throw error;
      }
    }));
  };

  const initialHandle = await open(participantPath, "wx");
  await initialHandle.writeFile(`${JSON.stringify({ token, ownerPid: process.pid, ownerIdentity, ticket: null, choosing: true, updatedAt: new Date().toISOString() })}\n`, "utf-8");
  await initialHandle.close();
  try {
    const observed = await readParticipants();
    if (observed.some((contender) => contender.active && !contender.participant)) {
      throw new Error("AUTONOMOUS_JOB_RECLAIM_CONFLICT");
    }
    const ticket = 1 + observed.reduce((maximum, contender) => {
      const value = contender.active ? contender.participant?.ticket : null;
      return typeof value === "number" ? Math.max(maximum, value) : maximum;
    }, 0);
    await writeParticipant({ token, ownerPid: process.pid, ownerIdentity, ticket, choosing: false, updatedAt: new Date().toISOString() });

    let acquired = false;
    for (let attempt = 0; attempt < 3_000 && !acquired; attempt += 1) {
      const contenders = await readParticipants();
      if (contenders.some((contender) => contender.active && !contender.participant)) {
        throw new Error("AUTONOMOUS_JOB_RECLAIM_CONFLICT");
      }
      const choosing = contenders.some((contender) => {
        if (!contender.active || contender.participant?.token === token) return false;
        if (!contender.participant || contender.participant.choosing || contender.participant.ticket === null) return true;
        return false;
      });
      if (choosing) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        continue;
      }
      const blocked = contenders.some((contender) => {
        if (!contender.active || contender.participant?.token === token || !contender.participant || contender.participant.ticket === null) return false;
        return contender.participant.ticket < ticket
          || (contender.participant.ticket === ticket && contender.participant.token < token);
      });
      if (blocked) throw new Error("AUTONOMOUS_JOB_RECLAIM_CONFLICT");
      acquired = true;
    }
    if (!acquired) throw new Error("AUTONOMOUS_JOB_RECLAIM_CONFLICT");
    await writeParticipant({ token, ownerPid: process.pid, ownerIdentity, ticket, choosing: false, updatedAt: new Date().toISOString() });
    return await task();
  } finally {
    await unlink(participantPath).catch(() => undefined);
  }
}

async function withAutonomousLeaseGuard<T>(
  leasePath: string,
  task: () => Promise<T>,
  isProcessAlive: (pid: number) => boolean = defaultProcessAlive,
  getProcessIdentity: (pid: number) => Promise<string | null> = defaultProcessIdentity,
): Promise<T> {
  const previous = localLeaseGuardQueues.get(leasePath) ?? Promise.resolve();
  let unlock!: () => void;
  const held = new Promise<void>((resolve) => { unlock = resolve; });
  const tail = previous.catch(() => undefined).then(() => held);
  localLeaseGuardQueues.set(leasePath, tail);
  await previous.catch(() => undefined);
  try {
    return await withAutonomousLeaseGuardUnqueued(leasePath, task, isProcessAlive, getProcessIdentity);
  } finally {
    unlock();
    if (localLeaseGuardQueues.get(leasePath) === tail) localLeaseGuardQueues.delete(leasePath);
  }
}

async function writeAutonomousHeartbeat(leasePath: string, claim: AutonomousJobClaim): Promise<void> {
  const path = autonomousHeartbeatPath(leasePath, claim.claimId);
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify({ ...claim, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf-8");
  await rename(temp, path);
}

/** Atomically grants the single cross-process right to run one book job. */
export async function claimAutonomousJob(params: {
  readonly projectRoot: string;
  readonly bookId: string;
  readonly jobId: string;
  readonly ownerPid?: number;
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly getProcessIdentity?: (pid: number) => Promise<string | null>;
}): Promise<AutonomousJobClaim> {
  const path = autonomousProductionLeasePath(params.projectRoot, params.bookId);
  const ownerPid = params.ownerPid ?? process.pid;
  const isProcessAlive = params.isProcessAlive ?? defaultProcessAlive;
  const getProcessIdentity = params.getProcessIdentity ?? defaultProcessIdentity;
  await mkdir(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const claim: AutonomousJobClaim = { jobId: params.jobId, claimId: randomUUID(), ownerPid };
    await writeAutonomousHeartbeat(path, claim);
    try {
      const handle = await open(path, "wx");
      try {
        await handle.writeFile(`${JSON.stringify({ ...claim, acquiredAt: new Date().toISOString() }, null, 2)}\n`, "utf-8");
      } finally {
        await handle.close();
      }
      return claim;
    } catch (error) {
      await unlink(autonomousHeartbeatPath(path, claim.claimId)).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    let existing: AutonomousJobClaim;
    try {
      existing = JSON.parse(await readFile(path, "utf-8")) as AutonomousJobClaim;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error("AUTONOMOUS_JOB_LEASE_INVALID", { cause: error });
    }
    if (await claimIsActive(path, existing, isProcessAlive)) {
      throw new Error("AUTONOMOUS_JOB_ALREADY_RUNNING");
    }
    await withAutonomousLeaseGuard(path, async () => {
      let current: AutonomousJobClaim;
      try {
        current = JSON.parse(await readFile(path, "utf-8")) as AutonomousJobClaim;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      if (current.claimId !== existing.claimId || current.jobId !== existing.jobId || current.ownerPid !== existing.ownerPid) {
        throw new Error("AUTONOMOUS_JOB_RECLAIM_CONFLICT");
      }
      if (await claimIsActive(path, current, isProcessAlive)) throw new Error("AUTONOMOUS_JOB_ALREADY_RUNNING");
      await rename(path, `${path}.stale.${current.claimId}.${randomUUID()}`);
    }, isProcessAlive, getProcessIdentity);
  }
  throw new Error("AUTONOMOUS_JOB_CLAIM_CONFLICT");
}

export async function refreshAutonomousJobClaim(
  projectRoot: string,
  bookId: string,
  claim: AutonomousJobClaim,
): Promise<void> {
  const path = autonomousProductionLeasePath(projectRoot, bookId);
  await withAutonomousLeaseGuard(path, async () => {
    const current = JSON.parse(await readFile(path, "utf-8")) as AutonomousJobClaim;
    if (current.claimId !== claim.claimId || current.jobId !== claim.jobId || current.ownerPid !== claim.ownerPid) {
      throw new Error("AUTONOMOUS_JOB_CLAIM_LOST");
    }
    await writeAutonomousHeartbeat(path, claim);
  });
}

export function startAutonomousJobHeartbeat(
  projectRoot: string,
  bookId: string,
  claim: AutonomousJobClaim,
  onFailure?: (error: unknown) => void,
): () => void {
  const timer = setInterval(() => {
    void refreshAutonomousJobClaim(projectRoot, bookId, claim).catch((error) => onFailure?.(error));
  }, 30_000);
  timer.unref?.();
  return () => clearInterval(timer);
}

export async function releaseAutonomousJob(
  projectRoot: string,
  bookId: string,
  claim: AutonomousJobClaim,
): Promise<void> {
  const path = autonomousProductionLeasePath(projectRoot, bookId);
  await withAutonomousLeaseGuard(path, async () => {
    let existing: AutonomousJobClaim;
    try {
      existing = JSON.parse(await readFile(path, "utf-8")) as AutonomousJobClaim;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (existing.claimId !== claim.claimId || existing.jobId !== claim.jobId || existing.ownerPid !== claim.ownerPid) return;
    const released = `${path}.released.${claim.claimId}.${randomUUID()}`;
    await rename(path, released);
    await unlink(released);
  });
  await unlink(autonomousHeartbeatPath(path, claim.claimId)).catch(() => undefined);
}

export async function loadAutonomousProductionState<T>(projectRoot: string, bookId: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(autonomousProductionStatePath(projectRoot, bookId), "utf-8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function saveAutonomousProductionState(
  projectRoot: string,
  bookId: string,
  state: object,
): Promise<void> {
  const path = autonomousProductionStatePath(projectRoot, bookId);
  const temp = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temp, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf-8");
  await rename(temp, path);
}

export function deriveAutonomousJobIdentity(params: {
  readonly map: BookProductionMap;
  readonly mode: ProductionMode;
  readonly nextChapter: number;
}): string {
  const scope = resolveProductionScope(params.map, params.nextChapter, params.mode);
const identity = [
    "inkos-autonomous-production-v1",
    params.map.bookId,
    params.mode,
    params.mode === "current-volume" ? scope.currentVolume.volumeId : "full-book",
    scope.targetChapter,
  ].join("\n");
  return `autonomous-${createHash("sha256").update(identity, "utf-8").digest("hex").slice(0, 32)}`;
}

export async function createAutonomousPipelineActions<
  ChapterResult extends { readonly chapterNumber: number; readonly status: string },
  ResumeResult extends { readonly chapterNumber: number; readonly status: string },
>(params: {
  readonly bookId: string;
  readonly state: {
    loadChapterIndex(bookId: string): Promise<ReadonlyArray<ChapterMeta>>;
    saveChapterIndex(bookId: string, chapters: ReadonlyArray<ChapterMeta>): Promise<void>;
  };
  readonly pipeline: {
    writeNextChapter(bookId: string, wordCount?: number): Promise<ChapterResult>;
    resumeAuditFailedChapterBounded(bookId: string, chapterNumber: number): Promise<ResumeResult>;
  };
}) {
  const index = await params.state.loadChapterIndex(params.bookId);
  const pendingChapters = index.filter((chapter) => chapter.status === "audit-failed");
  if (pendingChapters.length > 1) {
    throw new Error("AUTONOMOUS_MULTIPLE_AUDIT_FAILED_CHAPTERS");
  }
  const pending = pendingChapters[0];
  const latest = index.reduce((maximum, chapter) => Math.max(maximum, chapter.number), 0);
  if (pending && pending.number !== latest) {
    throw new Error("AUTONOMOUS_AUDIT_FAILED_CHAPTER_NOT_LATEST");
  }
  const approve = async (chapterNumber: number) => {
    const latest = await params.state.loadChapterIndex(params.bookId);
    const now = new Date().toISOString();
    await params.state.saveChapterIndex(params.bookId, latest.map((chapter) => chapter.number === chapterNumber
      ? { ...chapter, status: "approved" as const, updatedAt: now }
      : chapter));
  };
  return {
    ...(pending ? {
      resumePendingChapter: async () => {
        const result = await params.pipeline.resumeAuditFailedChapterBounded(params.bookId, pending.number);
        if (result.status === "approved") await approve(pending.number);
        return result;
      },
    } : {}),
    runChapter: async (wordCount?: number) => {
      const result = await params.pipeline.writeNextChapter(params.bookId, wordCount);
      if (result.status === "ready-for-review") await approve(result.chapterNumber);
      return result;
    },
  };
}

export async function runBoundedAutonomousScope(params: {
  readonly map: BookProductionMap;
  readonly mode: ProductionMode;
  readonly getNextChapter: () => Promise<number>;
  readonly resumePendingChapter?: () => Promise<{ readonly status: string; readonly chapterNumber: number }>;
  readonly runChapter: () => Promise<{ readonly status: string }>;
  readonly shouldStop: () => boolean;
  readonly persistProgress: (progress: AutonomousRunProgress) => Promise<void>;
}): Promise<AutonomousRunProgress> {
  const initialNext = await params.getNextChapter();
  const scope = resolveProductionScope(params.map, initialNext, params.mode);
  const jobId = deriveAutonomousJobIdentity({ map: params.map, mode: params.mode, nextChapter: initialNext });
  let completedThisRun = 0;

  const project = (status: AutonomousRunStatus, nextChapter: number, reason?: string): AutonomousRunProgress => ({
    jobId,
    status,
    mode: params.mode,
    volumeId: (status === "VOLUME_COMPLETE"
      ? scope.currentVolume
      : params.map.volumes.find((volume) => nextChapter >= volume.startChapter && nextChapter <= volume.endChapter)
        ?? params.map.volumes.at(-1)!).volumeId,
    startChapter: scope.startChapter,
    targetChapter: scope.targetChapter,
    nextChapter,
    completedThisRun,
    ...(reason ? { reason } : {}),
  });

  if (scope.complete) {
    const complete = project("BOOK_COMPLETE", initialNext);
    await params.persistProgress(complete);
    return complete;
  }

  await params.persistProgress(project("RUNNING", initialNext));
  if (params.resumePendingChapter) {
    const resumed = await params.resumePendingChapter();
    if (resumed.status === "held-after-two-revisions" || resumed.status === "review-exhausted") {
      const held = project("REVIEW_EXHAUSTED", initialNext, "REVISION_LIMIT_REACHED");
      await params.persistProgress(held);
      return held;
    }
    await params.persistProgress(project("RUNNING", initialNext));
  }
  while (true) {
    const nextChapter = await params.getNextChapter();
    if (nextChapter > scope.targetChapter) {
      const status = nextChapter > params.map.totalChapters ? "BOOK_COMPLETE" : "VOLUME_COMPLETE";
      const complete = project(status, nextChapter);
      await params.persistProgress(complete);
      return complete;
    }
    if (params.shouldStop()) {
      const paused = project("PAUSED_BY_USER", nextChapter);
      await params.persistProgress(paused);
      return paused;
    }
    const result = await params.runChapter();
    if (result.status === "state-degraded") {
      throw new Error("STATE_SETTLEMENT_FAILED");
    }
    if (result.status === "audit-failed") {
      throw new Error("AUTONOMOUS_REVIEW_DID_NOT_SETTLE");
    }
    if (result.status === "held-after-two-revisions") {
      const heldNext = await params.getNextChapter();
      const held = project("HELD_AFTER_TWO_REVISIONS", heldNext, "REVISION_LIMIT_REACHED");
      await params.persistProgress(held);
      return held;
    }
    completedThisRun += 1;
    const committedNext = await params.getNextChapter();
    await params.persistProgress(project("RUNNING", committedNext));
  }
}
