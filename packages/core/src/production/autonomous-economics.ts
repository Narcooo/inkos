export interface AutonomousUsageRecord {
  readonly identity: string;
  readonly role: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly actualCostUsd?: number;
  /** Catalog-priced token estimate. This is never provider actual cost. */
  readonly calculatedCostUsd?: number;
  /** Conservative upper used only for hard-cap admission. */
  readonly conservativeCostUsd?: number;
}

export interface ForecastRange {
  readonly lowUsd: number | null;
  readonly baseUsd: number | null;
  readonly highUsd: number | null;
  readonly sampleSize: number;
  readonly confidence: "LOW" | "MEDIUM" | "HIGH";
}

export function projectAutonomousEconomics(params: {
  readonly completedChapters: number;
  readonly currentVolumeRemaining: number;
  readonly fullBookRemaining: number;
  readonly preferredBudgetUsd: number;
  readonly hardCapUsd: number;
  readonly records: ReadonlyArray<AutonomousUsageRecord>;
  readonly remainingChapterConservativeUsd?: number;
  readonly nextCallConservativeUsd?: number;
  readonly additionalHistoricalConservativeUsd?: number;
}) {
  const records = [...new Map(params.records.map((record) => [record.identity, record])).values()];
  const allCostVerified = records.length > 0 && records.every((record) =>
    typeof record.actualCostUsd === "number" && Number.isFinite(record.actualCostUsd) && record.actualCostUsd >= 0,
  );
  const verifiedCosts = records
    .map((record) => record.actualCostUsd)
    .filter((cost): cost is number => typeof cost === "number" && Number.isFinite(cost) && cost >= 0);
  const actualCostUsd = allCostVerified
    ? records.reduce((sum, record) => sum + record.actualCostUsd!, 0)
    : null;
  const allCalculated = records.length > 0 && records.every((record) =>
    typeof record.calculatedCostUsd === "number" && Number.isFinite(record.calculatedCostUsd) && record.calculatedCostUsd >= 0,
  );
  const calculatedCosts = records.map((record) => record.calculatedCostUsd)
    .filter((cost): cost is number => typeof cost === "number" && Number.isFinite(cost) && cost >= 0);
  const calculatedCostUsd = allCalculated
    ? records.reduce((sum, record) => sum + record.calculatedCostUsd!, 0)
    : null;
  const allConservative = records.length > 0 && records.every((record) => {
    const value = record.conservativeCostUsd ?? record.calculatedCostUsd;
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
  });
  const conservativeCosts = allConservative
    ? records.map((record) => Math.max(
        record.conservativeCostUsd ?? 0,
        record.calculatedCostUsd ?? 0,
        record.actualCostUsd ?? 0,
      ))
    : [];
  const historicalConservativeUpperUsd = allConservative
    ? conservativeCosts.reduce((sum, cost) => sum + cost, 0) + (params.additionalHistoricalConservativeUsd ?? 0)
    : null;
  const observedConservativeUsd = conservativeCosts.length > 0 ? Math.max(...conservativeCosts) : null;
  const nextCallConservativeUsd = params.nextCallConservativeUsd
    ?? params.remainingChapterConservativeUsd
    ?? observedConservativeUsd;
  const estimatedCostUsd = calculatedCostUsd;
  const costStatus = allCostVerified
    ? "VERIFIED_ACTUAL_COST" as const
    : calculatedCostUsd !== null
      ? "CALCULATED_ESTIMATE" as const
    : "COST_UNAVAILABLE" as const;
  const effectiveCostUsd = actualCostUsd ?? estimatedCostUsd;
  const promptTokens = records.reduce((sum, record) => sum + record.promptTokens, 0);
  const completionTokens = records.reduce((sum, record) => sum + record.completionTokens, 0);
  const roles: Record<string, { providerCalls: number; promptTokens: number; completionTokens: number; totalTokens: number; actualCostUsd: number | null }> = {};
  for (const record of records) {
    const previous = roles[record.role] ?? { providerCalls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, actualCostUsd: 0 };
    const costVerified = previous.actualCostUsd !== null && typeof record.actualCostUsd === "number";
    roles[record.role] = {
      providerCalls: previous.providerCalls + 1,
      promptTokens: previous.promptTokens + record.promptTokens,
      completionTokens: previous.completionTokens + record.completionTokens,
      totalTokens: previous.totalTokens + record.promptTokens + record.completionTokens,
      actualCostUsd: costVerified ? previous.actualCostUsd! + record.actualCostUsd! : null,
    };
  }

  const forecast = (remaining: number): ForecastRange => {
    if (effectiveCostUsd === null || params.completedChapters < 1) {
      return { lowUsd: null, baseUsd: null, highUsd: null, sampleSize: params.completedChapters, confidence: "LOW" };
    }
    const basePerChapterUsd = effectiveCostUsd / params.completedChapters;
    const baseUsd = basePerChapterUsd * remaining;
    const conservativePerChapterUsd = Math.max(
      basePerChapterUsd * 1.25,
      params.remainingChapterConservativeUsd ?? 0,
    );
    return {
      lowUsd: baseUsd * 0.8,
      baseUsd,
      highUsd: conservativePerChapterUsd * remaining,
      sampleSize: params.completedChapters,
      confidence: params.completedChapters >= 10 ? "HIGH" : params.completedChapters >= 4 ? "MEDIUM" : "LOW",
    };
  };
  const hardCapReached = effectiveCostUsd !== null && effectiveCostUsd >= params.hardCapUsd;
  const preferredExceeded = effectiveCostUsd !== null && effectiveCostUsd >= params.preferredBudgetUsd;
  const conservativeVolumeTotalUsd = historicalConservativeUpperUsd !== null && nextCallConservativeUsd !== null
    ? historicalConservativeUpperUsd + (params.currentVolumeRemaining > 0
      ? (forecast(params.currentVolumeRemaining).highUsd ?? nextCallConservativeUsd)
      : nextCallConservativeUsd)
    : null;
  const allowNextProviderCall = effectiveCostUsd !== null
    && nextCallConservativeUsd !== null
    && conservativeVolumeTotalUsd !== null
    && conservativeVolumeTotalUsd < params.hardCapUsd;

  return {
    actual: {
      providerCalls: records.length,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      costUsd: actualCostUsd,
      estimatedCostUsd,
      costStatus,
      historicalCalculatedEstimateUsd: calculatedCostUsd,
      historicalConservativeUpperUsd,
    },
    byRole: roles,
    currentVolumeForecast: forecast(params.currentVolumeRemaining),
    fullBookForecast: forecast(params.fullBookRemaining),
    budget: {
      preferredBudgetUsd: params.preferredBudgetUsd,
      hardCapUsd: params.hardCapUsd,
      preferredExceeded,
      hardCapReached,
      guardStatus: costStatus,
      nextCallConservativeUsd,
      conservativeVolumeTotalUsd,
      allowNextProviderCall,
      ...(!allowNextProviderCall
        ? { reason: costStatus === "COST_UNAVAILABLE"
            ? "COST_GUARD_UNAVAILABLE"
            : "NEXT_PROVIDER_CALL_COULD_REACH_HARD_CAP" }
        : {}),
    },
  };
}
