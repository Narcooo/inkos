import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AutonomousProductionCard,
  autonomousFallbackPollMs,
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
  budget: { preferredUsd: 15, hardCapUsd: 30 },
  economics: {
    actual: { providerCalls: 4, totalTokens: 100, costUsd: null, estimatedCostUsd: null, costStatus: "COST_UNAVAILABLE" },
    currentVolumeForecast: { lowUsd: null, baseUsd: null, highUsd: null, sampleSize: 4, confidence: "LOW" },
    fullBookForecast: { lowUsd: null, baseUsd: null, highUsd: null, sampleSize: 4, confidence: "LOW" },
    currentVolumeActual: { providerCalls: 4, totalTokens: 100, costUsd: null, estimatedCostUsd: null, costStatus: "COST_UNAVAILABLE" },
    byRole: { writer: { providerCalls: 1, promptTokens: 10, completionTokens: 20, totalTokens: 30, actualCostUsd: null } },
    budget: { guardStatus: "COST_UNAVAILABLE", nextCallConservativeUsd: null, allowNextProviderCall: false },
  },
  runtimeBlockers: ["PENDING_STATE_REPAIR_CHAPTER_4", "LOGIC_AUDITOR_MODEL_NOT_CONFIGURED", "COST_GUARD_UNAVAILABLE"],
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
    expect(html).toContain("Chapter 004 state requires repair before production can continue.");
    expect(html).toContain("Repair Chapter 004 State");
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
});
