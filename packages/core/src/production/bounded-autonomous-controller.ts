import { resolveProductionScope, type BookProductionMap, type ProductionMode } from "./book-production-map.js";

export type AutonomousRunStatus =
  | "RUNNING"
  | "VOLUME_COMPLETE"
  | "BOOK_COMPLETE"
  | "PAUSED_BY_USER"
  | "BUDGET_BLOCKED"
  | "HELD_AFTER_TWO_REVISIONS";

export interface AutonomousRunProgress {
  readonly status: AutonomousRunStatus;
  readonly mode: ProductionMode;
  readonly volumeId: string;
  readonly startChapter: number;
  readonly targetChapter: number;
  readonly nextChapter: number;
  readonly completedThisRun: number;
  readonly reason?: string;
}

export async function runBoundedAutonomousScope(params: {
  readonly map: BookProductionMap;
  readonly mode: ProductionMode;
  readonly getNextChapter: () => Promise<number>;
  readonly runChapter: () => Promise<{ readonly status: string }>;
  readonly shouldStop: () => boolean;
  readonly beforeNextProviderCall: () => { readonly allowed: boolean; readonly reason?: string };
  readonly persistProgress: (progress: AutonomousRunProgress) => Promise<void>;
}): Promise<AutonomousRunProgress> {
  const initialNext = await params.getNextChapter();
  const scope = resolveProductionScope(params.map, initialNext, params.mode);
  let completedThisRun = 0;

  const project = (status: AutonomousRunStatus, nextChapter: number, reason?: string): AutonomousRunProgress => ({
    status,
    mode: params.mode,
    volumeId: (params.map.volumes.find((volume) =>
      nextChapter >= volume.startChapter && nextChapter <= volume.endChapter,
    ) ?? params.map.volumes.at(-1)!).volumeId,
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
    const admission = params.beforeNextProviderCall();
    if (!admission.allowed) {
      const blocked = project("BUDGET_BLOCKED", nextChapter, admission.reason ?? "HARD_COST_CAP_REACHED");
      await params.persistProgress(blocked);
      return blocked;
    }

    const result = await params.runChapter();
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
