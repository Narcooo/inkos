import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  loadBookProductionMap,
  projectAutonomousEconomics,
  resolveProductionScope,
  type AutonomousRunProgress,
  type AutonomousUsageRecord,
  type BookProductionMap,
  type ProductionMode,
} from "@actalk/inkos-core";

export const DEFAULT_AUTONOMOUS_BUDGET = { preferredUsd: 15, hardCapUsd: 30 } as const;

export interface AutonomousRuntimeProjection {
  readonly status: string;
  readonly mode: ProductionMode;
  readonly nextChapter: number;
  readonly updatedAt: string;
  readonly lastError?: string;
  readonly phase?: string;
  readonly activeRole?: string;
  readonly activeProvider?: string | null;
  readonly activeModel?: string | null;
  readonly budget?: { readonly preferredUsd: number; readonly hardCapUsd: number };
  readonly lastChapter?: {
    readonly number: number;
    readonly grade?: string;
    readonly revisionCount?: number;
  };
}

export class AutonomousJobRegistry {
  private readonly jobs = new Map<string, { stopRequested: boolean }>();

  reserve(bookId: string): boolean {
    if (this.jobs.has(bookId)) return false;
    this.jobs.set(bookId, { stopRequested: false });
    return true;
  }

  isActive(bookId: string): boolean {
    return this.jobs.has(bookId);
  }

  requestStop(bookId: string): boolean {
    const job = this.jobs.get(bookId);
    if (!job) return false;
    job.stopRequested = true;
    return true;
  }

  shouldStop(bookId: string): boolean {
    return this.jobs.get(bookId)?.stopRequested ?? false;
  }

  release(bookId: string): void {
    this.jobs.delete(bookId);
  }
}

interface ChapterProjection {
  readonly number: number;
  readonly status: string;
  readonly tokenUsage?: { readonly promptTokens: number; readonly completionTokens: number; readonly totalTokens: number; readonly actualCostUsd?: number };
  readonly roleUsage?: Readonly<Record<string, { readonly promptTokens: number; readonly completionTokens: number; readonly totalTokens: number; readonly actualCostUsd?: number }>>;
  readonly autonomousReview?: { readonly grade: string; readonly revisionCount: number };
}

interface SafeConfigProjection {
  readonly defaultModel: string | null;
  readonly modelOverrides: Readonly<Record<string, unknown>>;
}

export function autonomousRuntimePath(projectRoot: string, bookId: string): string {
  return join(projectRoot, "books", bookId, "story", "runtime", "bounded-autonomous", "production-state.json");
}

export async function loadAutonomousRuntime(projectRoot: string, bookId: string): Promise<AutonomousRuntimeProjection | null> {
  try {
    return JSON.parse(await readFile(autonomousRuntimePath(projectRoot, bookId), "utf-8")) as AutonomousRuntimeProjection;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function saveAutonomousRuntime(
  projectRoot: string,
  bookId: string,
  progress: AutonomousRunProgress | AutonomousRuntimeProjection,
): Promise<void> {
  const path = autonomousRuntimePath(projectRoot, bookId);
  const temp = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temp, `${JSON.stringify({ ...progress, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf-8");
  await rename(temp, path);
}

function configuredModel(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const model = (value as { model?: unknown }).model;
    return typeof model === "string" && model.trim() ? model : null;
  }
  return null;
}

export function projectAutonomousProductionView(params: {
  readonly map: BookProductionMap;
  readonly targetChapters: number | undefined;
  readonly nextChapter: number;
  readonly chapters: ReadonlyArray<ChapterProjection>;
  readonly config: SafeConfigProjection;
  readonly runtime: AutonomousRuntimeProjection | null;
  readonly active: boolean;
  readonly budget: { readonly preferredUsd: number; readonly hardCapUsd: number };
}) {
  const scope = resolveProductionScope(params.map, params.nextChapter, "current-volume");
  const overrides = params.config.modelOverrides;
  const roles = {
    writer: params.config.defaultModel,
    logicAuditor: configuredModel(overrides.auditor),
    commercialReader: configuredModel(overrides["commercial-reader"]),
    reviser: configuredModel(overrides.reviser) ?? params.config.defaultModel,
    observerReflector: configuredModel(overrides["observer-reflector"]),
  };
  const blockers: string[] = [];
  if (params.targetChapters !== params.map.totalChapters) blockers.push("BOOK_TARGET_CHAPTERS_MISMATCH");
  const degraded = params.chapters.find((chapter) => chapter.status === "state-degraded");
  if (degraded) blockers.push(`PENDING_STATE_REPAIR_CHAPTER_${degraded.number}`);
  if (!roles.writer) blockers.push("WRITER_MODEL_NOT_CONFIGURED");
  if (!roles.logicAuditor) blockers.push("LOGIC_AUDITOR_MODEL_NOT_CONFIGURED");
  if (!roles.commercialReader) blockers.push("COMMERCIAL_READER_MODEL_NOT_CONFIGURED");
  if (!roles.observerReflector) blockers.push("OBSERVER_REFLECTOR_MODEL_NOT_CONFIGURED");
  if (params.active) blockers.push("AUTONOMOUS_JOB_ALREADY_RUNNING");
  const orderedChapterNumbers = params.chapters.map((chapter) => chapter.number).sort((left, right) => left - right);
  if (orderedChapterNumbers.some((number, index) => number !== index + 1) || params.nextChapter !== orderedChapterNumbers.length + 1) {
    blockers.push("CHAPTER_CURSOR_INTEGRITY_MISMATCH");
  }

  const usageRecords: AutonomousUsageRecord[] = [];
  const currentVolumeUsageRecords: AutonomousUsageRecord[] = [];
  for (const chapter of params.chapters) {
    const inCurrentVolume = chapter.number >= scope.currentVolume.startChapter && chapter.number <= scope.currentVolume.endChapter;
    if (chapter.roleUsage) {
      for (const [role, usage] of Object.entries(chapter.roleUsage)) {
        const record = {
          identity: `chapter-${chapter.number}:${role}`,
          role,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          ...(usage.actualCostUsd !== undefined ? { actualCostUsd: usage.actualCostUsd } : {}),
        };
        usageRecords.push(record);
        if (inCurrentVolume) currentVolumeUsageRecords.push(record);
      }
    } else if (chapter.tokenUsage) {
      const record = {
        identity: `chapter-${chapter.number}:legacy-total`,
        role: "legacy-total",
        promptTokens: chapter.tokenUsage.promptTokens,
        completionTokens: chapter.tokenUsage.completionTokens,
        ...(chapter.tokenUsage.actualCostUsd !== undefined ? { actualCostUsd: chapter.tokenUsage.actualCostUsd } : {}),
      };
      usageRecords.push(record);
      if (inCurrentVolume) currentVolumeUsageRecords.push(record);
    }
  }
  const economics = projectAutonomousEconomics({
    completedChapters: params.chapters.length,
    currentVolumeRemaining: Math.max(0, scope.currentVolume.endChapter - params.nextChapter + 1),
    fullBookRemaining: Math.max(0, params.map.totalChapters - params.nextChapter + 1),
    preferredBudgetUsd: params.budget.preferredUsd,
    hardCapUsd: params.budget.hardCapUsd,
    records: usageRecords,
  });
  const currentVolumeEconomics = projectAutonomousEconomics({
    completedChapters: params.chapters.filter((chapter) =>
      chapter.number >= scope.currentVolume.startChapter && chapter.number <= scope.currentVolume.endChapter,
    ).length,
    currentVolumeRemaining: Math.max(0, scope.currentVolume.endChapter - params.nextChapter + 1),
    fullBookRemaining: Math.max(0, scope.currentVolume.endChapter - params.nextChapter + 1),
    preferredBudgetUsd: params.budget.preferredUsd,
    hardCapUsd: params.budget.hardCapUsd,
    records: currentVolumeUsageRecords,
  });
  if (!economics.budget.allowNextProviderCall) blockers.push("HARD_COST_CAP_REACHED");

  return {
    bookId: params.map.bookId,
    title: params.map.title,
    totalChapters: params.map.totalChapters,
    completedChapters: params.chapters.length,
    nextChapter: params.nextChapter,
    currentVolume: scope.currentVolume,
    currentVolumeCompleted: params.chapters.filter((chapter) =>
      chapter.number >= scope.currentVolume.startChapter && chapter.number <= scope.currentVolume.endChapter,
    ).length,
    runtimeStatus: params.active
      ? "RUNNING"
      : params.runtime?.status === "RUNNING"
        ? "PAUSED"
        : blockers.length > 0 ? "BLOCKED" : params.runtime?.status ?? "READY",
    runtime: params.runtime,
    roles,
    revisionPolicy: { normal: 1, rescue: 1, maximum: 2 },
    budget: params.budget,
    economics: { ...economics, currentVolumeActual: currentVolumeEconomics.actual },
    runtimeBlockers: blockers,
    startEnabled: blockers.length === 0 && !scope.complete,
  };
}

export async function loadSafeAutonomousConfig(projectRoot: string): Promise<SafeConfigProjection> {
  const raw = JSON.parse(await readFile(join(projectRoot, "inkos.json"), "utf-8")) as Record<string, unknown>;
  const llm = raw.llm && typeof raw.llm === "object" && !Array.isArray(raw.llm)
    ? raw.llm as Record<string, unknown>
    : {};
  return {
    defaultModel: configuredModel(llm.defaultModel) ?? configuredModel(llm.model),
    modelOverrides: raw.modelOverrides && typeof raw.modelOverrides === "object" && !Array.isArray(raw.modelOverrides)
      ? raw.modelOverrides as Record<string, unknown>
      : {},
  };
}

export async function requireBookProductionMap(projectRoot: string, bookId: string): Promise<BookProductionMap> {
  const map = await loadBookProductionMap(projectRoot, bookId);
  if (!map) throw new Error("BLOCKED_BOOK_PRODUCTION_MAP_MISSING");
  return map;
}
