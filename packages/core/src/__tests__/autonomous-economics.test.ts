import { describe, expect, it } from "vitest";
import { projectAutonomousEconomics } from "../production/autonomous-economics.js";

describe("autonomous production economics", () => {
  it("deduplicates actuals and forecasts chapter, volume, and book ranges from samples", () => {
    const result = projectAutonomousEconomics({
      completedChapters: 4,
      currentVolumeRemaining: 34,
      fullBookRemaining: 152,
      preferredBudgetUsd: 15,
      hardCapUsd: 30,
      records: [
        { identity: "writer-1", role: "writer", promptTokens: 1000, completionTokens: 2000, actualCostUsd: 0.3 },
        { identity: "writer-1", role: "writer", promptTokens: 1000, completionTokens: 2000, actualCostUsd: 0.3 },
        { identity: "logic-1", role: "logic-canon-auditor", promptTokens: 1000, completionTokens: 500, actualCostUsd: 0.1 },
      ],
    });
    expect(result.actual.providerCalls).toBe(2);
    expect(result.actual.costUsd).toBeCloseTo(0.4);
    expect(result.byRole.writer.actualCostUsd).toBeCloseTo(0.3);
    expect(result.currentVolumeForecast.baseUsd!).toBeGreaterThan(0);
    expect(result.fullBookForecast.highUsd!).toBeGreaterThan(result.fullBookForecast.baseUsd!);
  });

  it("keeps unverified pricing unavailable instead of inventing actual cost", () => {
    const result = projectAutonomousEconomics({
      completedChapters: 4,
      currentVolumeRemaining: 34,
      fullBookRemaining: 152,
      preferredBudgetUsd: 15,
      hardCapUsd: 30,
      records: [{ identity: "writer-1", role: "writer", promptTokens: 100, completionTokens: 200 }],
    });
    expect(result.actual.costStatus).toBe("COST_UNAVAILABLE");
    expect(result.actual.costUsd).toBeNull();
    expect(result.currentVolumeForecast.baseUsd).toBeNull();
    expect(result.budget.guardStatus).toBe("COST_UNAVAILABLE");
    expect(result.budget.allowNextProviderCall).toBe(false);
  });

  it("pauses before the next call when actual cost reaches the hard cap", () => {
    const result = projectAutonomousEconomics({
      completedChapters: 1,
      currentVolumeRemaining: 1,
      fullBookRemaining: 1,
      preferredBudgetUsd: 15,
      hardCapUsd: 30,
      records: [{ identity: "one", role: "writer", promptTokens: 1, completionTokens: 1, actualCostUsd: 30 }],
    });
    expect(result.budget.hardCapReached).toBe(true);
    expect(result.budget.allowNextProviderCall).toBe(false);
  });

  it("reserves a conservative next-call estimate before the hard cap", () => {
    const allowed = projectAutonomousEconomics({
      completedChapters: 2,
      currentVolumeRemaining: 1,
      fullBookRemaining: 1,
      preferredBudgetUsd: 15,
      hardCapUsd: 30,
      records: [
        { identity: "one", role: "writer", promptTokens: 1, completionTokens: 1, actualCostUsd: 12 },
        { identity: "two", role: "logic", promptTokens: 1, completionTokens: 1, actualCostUsd: 4 },
      ],
    });
    expect(allowed.budget.guardStatus).toBe("VERIFIED_ACTUAL_COST");
    expect(allowed.budget.nextCallConservativeUsd).toBe(12);
    expect(allowed.budget.allowNextProviderCall).toBe(true);

    const blocked = projectAutonomousEconomics({
      completedChapters: 2,
      currentVolumeRemaining: 1,
      fullBookRemaining: 1,
      preferredBudgetUsd: 15,
      hardCapUsd: 25,
      records: [
        { identity: "one", role: "writer", promptTokens: 1, completionTokens: 1, actualCostUsd: 12 },
        { identity: "two", role: "logic", promptTokens: 1, completionTokens: 1, actualCostUsd: 4 },
      ],
    });
    expect(blocked.budget.allowNextProviderCall).toBe(false);
    expect(blocked.budget.reason).toBe("NEXT_PROVIDER_CALL_COULD_REACH_HARD_CAP");
  });

  it("uses a conservative verified estimate when only part of usage reports actual cost", () => {
    const result = projectAutonomousEconomics({
      completedChapters: 2,
      currentVolumeRemaining: 1,
      fullBookRemaining: 1,
      preferredBudgetUsd: 15,
      hardCapUsd: 30,
      records: [
        { identity: "priced", role: "writer", promptTokens: 1, completionTokens: 1, actualCostUsd: 3 },
        { identity: "unpriced", role: "logic", promptTokens: 1, completionTokens: 1 },
      ],
    });
    expect(result.actual.costStatus).toBe("VERIFIED_ESTIMATED_COST");
    expect(result.actual.costUsd).toBeNull();
    expect(result.actual.estimatedCostUsd).toBe(6);
    expect(result.budget.nextCallConservativeUsd).toBe(3);
  });
});
