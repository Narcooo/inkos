import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AutonomousProductionCard,
  autonomousFallbackPollMs,
  formatRetryCountdown,
  type AutonomousView,
} from "./AutonomousProductionPanel.js";

const blockedView: AutonomousView = {
  title: "The House She Built",
  totalChapters: 156,
  completedChapters: 4,
  nextChapter: 5,
  currentVolume: { volumeId: "volume-001", volumeNumber: 1, title: "The Price of Leaving", startChapter: 1, endChapter: 38, chapterCount: 38 },
  currentVolumeCompleted: 4,
  runtimeStatus: "BLOCKED",
  runtime: null,
  roles: { writer: "gpt", logicAuditor: null, commercialReader: null, reviser: "gpt", observerReflector: null },
  revisionPolicy: { normal: 1, rescue: 1, maximum: 2 },
  budget: { status: "BUDGET_NOT_CONFIGURED" },
  economics: {
    actual: { providerCalls: 4, totalTokens: 100, costUsd: null, estimatedCostUsd: null, costStatus: "COST_UNAVAILABLE" },
    currentVolumeForecast: { lowUsd: null, baseUsd: null, highUsd: null, sampleSize: 4, confidence: "LOW" },
    fullBookForecast: { lowUsd: null, baseUsd: null, highUsd: null, sampleSize: 4, confidence: "LOW" },
    currentVolumeActual: { providerCalls: 4, totalTokens: 100, costUsd: null, estimatedCostUsd: null, costStatus: "COST_UNAVAILABLE" },
    byRole: { writer: { providerCalls: 1, promptTokens: 10, completionTokens: 20, totalTokens: 30, actualCostUsd: null } },
    budget: { guardStatus: "COST_UNAVAILABLE", nextCallConservativeUsd: null, allowNextProviderCall: true },
  },
  runtimeBlockers: ["PENDING_STATE_REPAIR_CHAPTER_4", "LOGIC_AUDITOR_MODEL_NOT_CONFIGURED"],
  startEnabled: false,
};

describe("compact autonomous production card", () => {
  it("shows only operator essentials by default and keeps technical details collapsed", () => {
    const html = renderToStaticMarkup(createElement(AutonomousProductionCard, {
      view: blockedView,
      pending: false,
      error: null,
      onStart: () => undefined,
      onStop: () => undefined,
      onRepair: () => undefined,
      onConfigureModels: () => undefined,
    }));
    expect(html).toContain("Volume I · Chapters 001–038");
    expect(html).toContain("Current Chapter");
    expect(html).toContain("005");
    expect(html).toContain("4 / 38 in volume");
    expect(html).toContain("4 / 156 in book");
    expect(html).toContain("Production role models must be configured before starting.");
    expect(html).toContain("Configure Models");
    expect(html).not.toContain("Repair Chapter 004 State");
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).not.toContain("<table");
  });

  it("does not poll READY or BLOCKED pages and uses a 12 second fallback only while active", () => {
    expect(autonomousFallbackPollMs("READY")).toBeNull();
    expect(autonomousFallbackPollMs("BLOCKED")).toBeNull();
    expect(autonomousFallbackPollMs("RUNNING")).toBe(12_000);
    expect(autonomousFallbackPollMs("REPAIRING")).toBe(12_000);
  });

  it("keeps the compact cost surface truthful and shows the bounded repair forecast", () => {
    const view: AutonomousView = {
      ...blockedView,
      runtimeBlockers: ["PENDING_STATE_REPAIR_CHAPTER_4"],
      economics: {
        ...blockedView.economics,
        historicalRecordedActualUsd: null,
        historicalCalculatedEstimateUsd: 0.42,
        remainingVolumeForecast: { lowUsd: 1, baseUsd: 2, highUsd: 3, sampleSize: 4, confidence: "MEDIUM" },
        currentVolumeEstimatedTotal: { lowUsd: 1.4, baseUsd: 2.4, highUsd: 3.6, sampleSize: 4, confidence: "MEDIUM" },
        fullBookForecast: { lowUsd: 4, baseUsd: 7, highUsd: 12, sampleSize: 4, confidence: "MEDIUM" },
        repairForecast: { lowUsd: 0.05, baseUsd: 0.08, highUsd: 0.16, sampleSize: 1, confidence: "LOW" },
      },
    };
    const html = renderToStaticMarkup(createElement(AutonomousProductionCard, {
      view, pending: false, error: null, onStart: () => undefined, onStop: () => undefined,
      onRepair: () => undefined, onConfigureModels: () => undefined,
    }));
    expect(html).toContain("Current Volume Recorded Actual");
    expect(html).toContain("Current Volume Forecast");
    expect(html.indexOf("Full Book Forecast")).toBeLessThan(html.indexOf("<details"));
    expect(html).toContain("Bounded repair forecast: $0.05–$0.16");
    expect(html).toContain("Historical Recorded Actual: Unavailable");
    expect(html).toContain("Historical Calculated Estimate: $0.42");
    expect(html).not.toContain("<table");
  });

  it("keeps state repair available when its dollar forecast is unavailable", () => {
    const view: AutonomousView = {
      ...blockedView,
      runtimeBlockers: ["PENDING_STATE_REPAIR_CHAPTER_4"],
      economics: {
        ...blockedView.economics,
        repairForecast: { lowUsd: null, baseUsd: null, highUsd: null, sampleSize: 0, confidence: "LOW" },
      },
    };
    const html = renderToStaticMarkup(createElement(AutonomousProductionCard, {
      view, pending: false, error: null, onStart: () => undefined, onStop: () => undefined,
      onRepair: () => undefined, onConfigureModels: () => undefined,
    }));
    expect(html).toContain("Repair Chapter 004 State");
    expect(html).not.toMatch(/<button disabled/);
  });

  it("does not offer state repair again after settlement restored an audit-failed chapter", () => {
    const view: AutonomousView = {
      ...blockedView,
      runtimeStatus: "READY",
      runtimeBlockers: [],
      startEnabled: true,
      chapterAttention: { chapter: 4, status: "AUDIT_FAILED_STATE_SETTLED" },
    };
    const html = renderToStaticMarkup(createElement(AutonomousProductionCard, {
      view, pending: false, error: null, onStart: () => undefined, onStop: () => undefined,
      onRepair: () => undefined, onConfigureModels: () => undefined,
    }));
    expect(html).toContain("Chapter 004 existing draft will be reused");
    expect(html).toContain("Resume Autonomous Production");
    expect(html).toContain("Not Configured");
    expect(html).not.toContain("Repair Chapter 004 State");
  });

  it("shows the preserved rescue candidate and final-review-only recovery action", () => {
    const view: AutonomousView = {
      ...blockedView,
      runtimeStatus: "RECOVERY_READY_OFFLINE_FINALIZATION",
      runtimeBlockers: [],
      startEnabled: true,
      chapterAttention: { chapter: 4, status: "AUDIT_FAILED_STATE_SETTLED" },
      finalReviewRecovery: {
        chapter: 4,
        rescueCandidate: "PRESERVED",
        rescueGeneration: "REUSED",
        rescueArtifactIdentity: "VERIFIED_CHAPTER_004",
        finalReview: "PRESERVED",
        finalReviewDecision: "PASSED_WITH_NONBLOCKING_FINDINGS",
        writerRegeneration: false,
        normalRevisionRegeneration: false,
        rescueRevisionRegeneration: false,
        nextAction: "FINALIZE_CHAPTER_004_AND_CONTINUE",
        additionalWriterCalls: 0,
        additionalReviserCalls: 0,
        additionalReviewerCalls: 0,
        additionalRevisionAllowed: false,
      },
    };
    const html = renderToStaticMarkup(createElement(AutonomousProductionCard, {
      view, pending: false, error: null, onStart: () => undefined, onStop: () => undefined,
      onRepair: () => undefined, onConfigureModels: () => undefined,
    }));
    expect(html).toContain("RECOVERY_READY_OFFLINE_FINALIZATION");
    expect(html).toContain("Rescue candidate: PRESERVED");
    expect(html).toContain("Rescue artifact identity: VERIFIED_CHAPTER_004");
    expect(html).toContain("Decision: PASSED_WITH_NONBLOCKING_FINDINGS");
    expect(html).toContain("Next action: FINALIZE_CHAPTER_004_AND_CONTINUE");
    expect(html).toContain("Writer / Reviser / Reviewer calls: 0 / 0 / 0");
    expect(html).toContain("Resume Autonomous Production");
  });

  it("shows a local retry countdown and disables Resume while the durable job waits", () => {
    const view: AutonomousView = {
      ...blockedView,
      runtimeStatus: "WAITING_PROVIDER_RETRY",
      runtimeBlockers: [],
      startEnabled: false,
      runtime: {
        status: "WAITING_PROVIDER_RETRY",
        phase: "LOGIC_REVIEW",
        activeRole: "auditor",
        activeProvider: "openrouter",
        activeModel: "provider/model",
        nextRetryAt: "2026-08-23T00:05:00.000Z",
        attempt: 1,
        maxAttempts: 3,
        lastHttpStatus: 429,
        responseArtifactStatus: "NONE",
      },
    };
    const html = renderToStaticMarkup(createElement(AutonomousProductionCard, {
      view, pending: false, error: null, onStart: () => undefined, onStop: () => undefined,
      onRepair: () => undefined, onConfigureModels: () => undefined,
    }));
    expect(html).toContain("Provider temporary interruption");
    expect(html).toContain("Next retry");
    expect(html).toMatch(/<button disabled=""/);
    expect(autonomousFallbackPollMs("WAITING_PROVIDER_RETRY")).toBe(12_000);
    expect(formatRetryCountdown("2026-08-23T00:05:00.000Z", Date.parse("2026-08-23T00:00:01.000Z"))).toBe("4m 59s");
  });

  it("warns that an ambiguous Provider outcome may have incurred cost and does not auto-retry", () => {
    const view: AutonomousView = {
      ...blockedView,
      runtimeStatus: "PAUSED_AMBIGUOUS_PROVIDER_OUTCOME",
      runtimeBlockers: [],
      startEnabled: true,
      runtime: { status: "PAUSED_AMBIGUOUS_PROVIDER_OUTCOME", attempt: 1 },
    };
    const html = renderToStaticMarkup(createElement(AutonomousProductionCard, {
      view, pending: false, error: null, onStart: () => undefined, onStop: () => undefined,
      onRepair: () => undefined, onConfigureModels: () => undefined,
    }));
    expect(html).toContain("Provider outcome is ambiguous");
    expect(html).toContain("may have incurred cost");
    expect(html).toContain("check Provider logs before choosing Resume");
    expect(autonomousFallbackPollMs(view.runtimeStatus)).toBeNull();
  });
});
