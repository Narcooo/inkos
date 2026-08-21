export interface AutonomousUsageRecord {
  readonly identity: string;
  readonly role: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly actualCostUsd?: number;
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
  const nextCallConservativeUsd = verifiedCosts.length > 0 ? Math.max(...verifiedCosts) : null;
  const estimatedCostUsd = !allCostVerified && nextCallConservativeUsd !== null
    ? nextCallConservativeUsd * records.length
    : null;
  const costStatus = allCostVerified
    ? "VERIFIED_ACTUAL_COST" as const
    : estimatedCostUsd !== null
      ? "VERIFIED_ESTIMATED_COST" as const
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
    const baseUsd = (effectiveCostUsd / params.completedChapters) * remaining;
    return {
      lowUsd: baseUsd * 0.8,
      baseUsd,
      highUsd: baseUsd * 1.25,
      sampleSize: params.completedChapters,
      confidence: params.completedChapters >= 10 ? "HIGH" : params.completedChapters >= 4 ? "MEDIUM" : "LOW",
    };
  };
  const hardCapReached = effectiveCostUsd !== null && effectiveCostUsd >= params.hardCapUsd;
  const preferredExceeded = effectiveCostUsd !== null && effectiveCostUsd >= params.preferredBudgetUsd;
  const allowNextProviderCall = effectiveCostUsd !== null
    && nextCallConservativeUsd !== null
    && effectiveCostUsd + nextCallConservativeUsd < params.hardCapUsd;

  return {
    actual: {
      providerCalls: records.length,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      costUsd: actualCostUsd,
      estimatedCostUsd,
      costStatus,
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
      allowNextProviderCall,
      ...(!allowNextProviderCall
        ? { reason: costStatus === "COST_UNAVAILABLE"
            ? "COST_GUARD_UNAVAILABLE"
            : "NEXT_PROVIDER_CALL_COULD_REACH_HARD_CAP" }
        : {}),
    },
  };
}
