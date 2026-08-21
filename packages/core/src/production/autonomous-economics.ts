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
  const actualCostUsd = allCostVerified
    ? records.reduce((sum, record) => sum + record.actualCostUsd!, 0)
    : null;
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
    if (actualCostUsd === null || params.completedChapters < 1) {
      return { lowUsd: null, baseUsd: null, highUsd: null, sampleSize: params.completedChapters, confidence: "LOW" };
    }
    const baseUsd = (actualCostUsd / params.completedChapters) * remaining;
    return {
      lowUsd: baseUsd * 0.8,
      baseUsd,
      highUsd: baseUsd * 1.25,
      sampleSize: params.completedChapters,
      confidence: params.completedChapters >= 10 ? "HIGH" : params.completedChapters >= 4 ? "MEDIUM" : "LOW",
    };
  };
  const hardCapReached = actualCostUsd !== null && actualCostUsd >= params.hardCapUsd;
  const preferredExceeded = actualCostUsd !== null && actualCostUsd >= params.preferredBudgetUsd;

  return {
    actual: {
      providerCalls: records.length,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      costUsd: actualCostUsd,
      costStatus: allCostVerified ? "ACTUAL" as const : "UNAVAILABLE" as const,
    },
    byRole: roles,
    currentVolumeForecast: forecast(params.currentVolumeRemaining),
    fullBookForecast: forecast(params.fullBookRemaining),
    budget: {
      preferredBudgetUsd: params.preferredBudgetUsd,
      hardCapUsd: params.hardCapUsd,
      preferredExceeded,
      hardCapReached,
      allowNextProviderCall: !hardCapReached,
    },
  };
}
