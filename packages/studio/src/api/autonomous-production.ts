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
import {
  bindProductionRolePricing,
  type ProductionModelCatalogEntry,
  type ProductionRoleSelection,
} from "../pages/production-role-models.js";

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
  readonly repairOutcome?: {
    readonly chapter: number;
    readonly status: "STATE_REPAIRED" | "STATE_REPAIRED_REVIEW_STILL_REQUIRED" | "REPAIR_FAILED";
    readonly errorCode: string | null;
    readonly reservedCostUpperUsd?: number;
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

export class AutonomousCostGuard {
  private reservedUsd = 0;
  constructor(private currentUsd: number | null, private nextCallConservativeUsd: number | null, private readonly hardCapUsd: number) {}
  check(reserve: boolean): { readonly allowed: boolean; readonly reason?: string } {
    if (this.currentUsd === null || this.nextCallConservativeUsd === null) return { allowed: false, reason: "COST_GUARD_UNAVAILABLE" };
    if (this.currentUsd + this.reservedUsd + this.nextCallConservativeUsd >= this.hardCapUsd) return { allowed: false, reason: "NEXT_PROVIDER_CALL_COULD_REACH_HARD_CAP" };
    if (reserve) this.reservedUsd += this.nextCallConservativeUsd;
    return { allowed: true };
  }
  settle(actualCostUsd?: number): void {
    if (this.currentUsd === null) return;
    if (typeof actualCostUsd === "number" && Number.isFinite(actualCostUsd) && actualCostUsd >= 0) {
      this.currentUsd += actualCostUsd;
      this.nextCallConservativeUsd = Math.max(this.nextCallConservativeUsd ?? 0, actualCostUsd);
    } else if (this.reservedUsd > 0) {
      this.currentUsd += this.reservedUsd;
    } else {
      this.currentUsd = null;
    }
    this.reservedUsd = 0;
  }
  resetVolume(): void { this.currentUsd = 0; this.reservedUsd = 0; }
}

export function classifyStateRepairError(message: string): "STATE_REPAIR_BASELINE_UNAVAILABLE" | "STATE_REPAIR_VALIDATION_FAILED" | "STATE_REPAIR_FAILED" {
  if (message.includes("baseline snapshot")) return "STATE_REPAIR_BASELINE_UNAVAILABLE";
  if (message.includes("still failed")) return "STATE_REPAIR_VALIDATION_FAILED";
  return "STATE_REPAIR_FAILED";
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
  readonly catalog?: ReadonlyArray<ProductionModelCatalogEntry>;
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
    reviser: configuredModel(overrides.reviser),
    observerReflector: configuredModel(overrides["observer-reflector"]),
  };
  const rolePricing = bindProductionRolePricing({
    writer: roles.writer ?? "",
    logicAuditor: roles.logicAuditor ?? "",
    commercialReader: roles.commercialReader ?? "",
    reviser: roles.reviser ?? "",
    observerReflector: roles.observerReflector ?? "",
  } satisfies ProductionRoleSelection, params.catalog ?? []);
  const blockers: string[] = [];
  if (params.targetChapters !== params.map.totalChapters) blockers.push("BOOK_TARGET_CHAPTERS_MISMATCH");
  const degraded = params.chapters.find((chapter) => chapter.status === "state-degraded");
  if (degraded) blockers.push(`PENDING_STATE_REPAIR_CHAPTER_${degraded.number}`);
  const repairNeedsReconciliation = !params.active && params.runtime?.status === "REPAIRING";
  if (repairNeedsReconciliation) blockers.push("STATE_REPAIR_RECONCILIATION_REQUIRED");
  const auditFailed = params.chapters.find((chapter) => chapter.status === "audit-failed");
  if (auditFailed) blockers.push(`PENDING_CHAPTER_REVIEW_${auditFailed.number}`);
  if (!roles.writer) blockers.push("WRITER_MODEL_NOT_CONFIGURED");
  if (!roles.logicAuditor) blockers.push("LOGIC_AUDITOR_MODEL_NOT_CONFIGURED");
  if (!roles.commercialReader) blockers.push("COMMERCIAL_READER_MODEL_NOT_CONFIGURED");
  if (!roles.reviser) blockers.push("REVISER_MODEL_NOT_CONFIGURED");
  if (!roles.observerReflector) blockers.push("OBSERVER_REFLECTOR_MODEL_NOT_CONFIGURED");
  if (params.active) blockers.push("AUTONOMOUS_JOB_ALREADY_RUNNING");
  const orderedChapterNumbers = params.chapters.map((chapter) => chapter.number).sort((left, right) => left - right);
  if (orderedChapterNumbers.some((number, index) => number !== index + 1) || params.nextChapter !== orderedChapterNumbers.length + 1) {
    blockers.push("CHAPTER_CURSOR_INTEGRITY_MISMATCH");
  }

  const usageRecords: AutonomousUsageRecord[] = [];
  const currentVolumeUsageRecords: AutonomousUsageRecord[] = [];
  const verifiedRolePrices = Object.values(rolePricing).filter((price) => price.status === "VERIFIED_IN_CURRENT_CATALOG");
  const maxInputUsdPerToken = verifiedRolePrices.length === Object.keys(rolePricing).length
    ? Math.max(...verifiedRolePrices.map((price) => price.inputUsdPerToken!))
    : null;
  const maxOutputUsdPerToken = verifiedRolePrices.length === Object.keys(rolePricing).length
    ? Math.max(...verifiedRolePrices.map((price) => price.outputUsdPerToken!))
    : null;
  const costForTokens = (promptTokens: number, completionTokens: number) =>
    maxInputUsdPerToken === null || maxOutputUsdPerToken === null
      ? undefined
      : promptTokens * maxInputUsdPerToken + completionTokens * maxOutputUsdPerToken;
  const exactRoleCost = (role: string, promptTokens: number, completionTokens: number) => {
    const price = role === "writer" ? rolePricing.writer
      : role === "logic-canon-auditor" || role === "auditor" ? rolePricing.logicAuditor
        : role === "commercial-reader" ? rolePricing.commercialReader
          : role === "reviser" ? rolePricing.reviser
            : role === "observer-reflector" || role === "state-validator" ? rolePricing.observerReflector
              : null;
    return price?.status === "VERIFIED_IN_CURRENT_CATALOG"
      ? promptTokens * price.inputUsdPerToken! + completionTokens * price.outputUsdPerToken!
      : undefined;
  };
  const historicalChapterCosts: number[] = [];
  const historicalChapterUpperCosts: number[] = [];
  for (const chapter of params.chapters) {
    const inCurrentVolume = chapter.number >= scope.currentVolume.startChapter && chapter.number <= scope.currentVolume.endChapter;
    if (chapter.roleUsage) {
      let chapterCalculatedCostUsd = 0;
      let chapterPricingComplete = true;
      for (const [role, usage] of Object.entries(chapter.roleUsage)) {
        const calculatedCostUsd = exactRoleCost(role, usage.promptTokens, usage.completionTokens);
        if (calculatedCostUsd === undefined) chapterPricingComplete = false;
        else chapterCalculatedCostUsd += calculatedCostUsd;
        const record = {
          identity: `chapter-${chapter.number}:${role}`,
          role,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          ...(usage.actualCostUsd !== undefined ? { actualCostUsd: usage.actualCostUsd } : {}),
          ...(calculatedCostUsd !== undefined
            ? { calculatedCostUsd, conservativeCostUsd: calculatedCostUsd }
            : {}),
        };
        usageRecords.push(record);
        if (inCurrentVolume) currentVolumeUsageRecords.push(record);
      }
      if (chapterPricingComplete) {
        historicalChapterCosts.push(chapterCalculatedCostUsd);
        historicalChapterUpperCosts.push(chapterCalculatedCostUsd);
      }
    } else if (chapter.tokenUsage) {
      const calculatedCostUsd = costForTokens(chapter.tokenUsage.promptTokens, chapter.tokenUsage.completionTokens);
      const conservativeCostUsd = maxInputUsdPerToken === null || maxOutputUsdPerToken === null
        ? undefined
        : Math.max(
            calculatedCostUsd ?? 0,
            chapter.tokenUsage.totalTokens * Math.max(maxInputUsdPerToken, maxOutputUsdPerToken),
          );
      const record = {
        identity: `chapter-${chapter.number}:legacy-total`,
        role: "legacy-total",
        promptTokens: chapter.tokenUsage.promptTokens,
        completionTokens: chapter.tokenUsage.completionTokens,
        ...(chapter.tokenUsage.actualCostUsd !== undefined ? { actualCostUsd: chapter.tokenUsage.actualCostUsd } : {}),
        ...(calculatedCostUsd !== undefined
          ? { calculatedCostUsd, conservativeCostUsd }
          : {}),
      };
      if (record.calculatedCostUsd !== undefined) historicalChapterCosts.push(record.calculatedCostUsd);
      if (record.conservativeCostUsd !== undefined) historicalChapterUpperCosts.push(record.conservativeCostUsd);
      usageRecords.push(record);
      if (inCurrentVolume) currentVolumeUsageRecords.push(record);
    }
  }
  const reservedRepairUpperUsd = params.runtime?.repairOutcome?.reservedCostUpperUsd ?? 0;
  const maximumChapterCandidates = 1 + 2; // initial candidate + normal revision + rescue revision
  const observedChapterMaximumUsd = historicalChapterUpperCosts.length > 0 ? Math.max(...historicalChapterUpperCosts) : null;
  const remainingChapterConservativeUsd = observedChapterMaximumUsd === null
    ? undefined
    : observedChapterMaximumUsd * maximumChapterCandidates;
  const nextCallConservativeUsd = observedChapterMaximumUsd ?? undefined;
  const economics = projectAutonomousEconomics({
    completedChapters: params.chapters.length,
    currentVolumeRemaining: Math.max(0, scope.currentVolume.endChapter - params.nextChapter + 1),
    fullBookRemaining: Math.max(0, params.map.totalChapters - params.nextChapter + 1),
    preferredBudgetUsd: params.budget.preferredUsd,
    hardCapUsd: params.budget.hardCapUsd,
    records: usageRecords,
    remainingChapterConservativeUsd,
    nextCallConservativeUsd,
    additionalHistoricalConservativeUsd: reservedRepairUpperUsd,
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
    remainingChapterConservativeUsd,
    nextCallConservativeUsd,
    additionalHistoricalConservativeUsd: reservedRepairUpperUsd,
  });
  if (!currentVolumeEconomics.budget.allowNextProviderCall) {
    blockers.push(currentVolumeEconomics.budget.guardStatus === "COST_UNAVAILABLE"
      ? "COST_GUARD_UNAVAILABLE"
      : "HARD_COST_CAP_REACHED");
  }

  const addHistorical = (range: typeof economics.currentVolumeForecast, historical: number | null, historicalUpper: number | null) => historical === null
    ? range
    : {
        ...range,
        lowUsd: range.lowUsd === null ? null : range.lowUsd + historical,
        baseUsd: range.baseUsd === null ? null : range.baseUsd + historical,
        highUsd: range.highUsd === null || historicalUpper === null ? null : range.highUsd + historicalUpper,
      };
  const historicalCalculatedEstimateUsd = economics.actual.historicalCalculatedEstimateUsd;
  const currentVolumeHistoricalCalculatedEstimateUsd = currentVolumeEconomics.actual.historicalCalculatedEstimateUsd;
  const degradedChapter = degraded?.tokenUsage;
  const writerPrice = rolePricing.writer;
  const observerPrice = rolePricing.observerReflector;
  const observedOperationCost = (price: typeof writerPrice) => degradedChapter && price.status === "VERIFIED_IN_CURRENT_CATALOG"
    ? degradedChapter.promptTokens * price.inputUsdPerToken! + degradedChapter.completionTokens * price.outputUsdPerToken!
    : null;
  const boundedOperationCost = (price: typeof writerPrice) => {
    if (!degradedChapter || price.status !== "VERIFIED_IN_CURRENT_CATALOG" || price.contextWindow === null || price.contextWindow <= 0 || price.maxOutputTokens === null || price.maxOutputTokens <= 0) return null;
    const outputCapacity = Math.min(price.contextWindow, price.maxOutputTokens);
    const fullInputCorner = price.contextWindow * price.inputUsdPerToken!;
    const maximumOutputCorner = (price.contextWindow - outputCapacity) * price.inputUsdPerToken!
      + outputCapacity * price.outputUsdPerToken!;
    return Math.max(observedOperationCost(price) ?? 0, fullInputCorner, maximumOutputCorner);
  };
  const writerObserved = observedOperationCost(writerPrice);
  const observerObserved = observedOperationCost(observerPrice);
  const writerUpper = boundedOperationCost(writerPrice);
  const observerUpper = boundedOperationCost(observerPrice);
  const repairBaseUsd = writerObserved === null || observerObserved === null ? null : writerObserved + observerObserved;
  const repairHighUsd = writerUpper === null || observerUpper === null ? null : writerUpper * 2 + observerUpper * 2;
  const repairForecast = {
    lowUsd: repairBaseUsd === null ? null : repairBaseUsd * 0.8,
    baseUsd: repairBaseUsd,
    highUsd: repairHighUsd,
    sampleSize: repairBaseUsd === null ? 0 : 1,
    confidence: "LOW" as const,
  };

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
    rolePricing,
    revisionPolicy: { normal: 1, rescue: 1, maximum: 2 },
    budget: params.budget,
    economics: {
      ...economics,
      historicalRecordedActualUsd: economics.actual.costUsd,
      historicalCalculatedEstimateUsd,
      remainingVolumeForecast: currentVolumeEconomics.currentVolumeForecast,
      currentVolumeEstimatedTotal: addHistorical(
        currentVolumeEconomics.currentVolumeForecast,
        currentVolumeHistoricalCalculatedEstimateUsd,
        currentVolumeEconomics.actual.historicalConservativeUpperUsd,
      ),
      fullBookForecast: addHistorical(economics.fullBookForecast, historicalCalculatedEstimateUsd, economics.actual.historicalConservativeUpperUsd),
      repairForecast,
      currentVolumeActual: currentVolumeEconomics.actual,
      budget: currentVolumeEconomics.budget,
    },
    repairOutcome: params.runtime?.repairOutcome,
    chapterAttention: auditFailed
      ? { chapter: auditFailed.number, status: "AUDIT_FAILED_STATE_SETTLED" as const }
      : undefined,
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
