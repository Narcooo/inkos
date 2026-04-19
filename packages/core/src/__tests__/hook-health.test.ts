import { describe, expect, it } from "vitest";
import type { HookRecord, RuntimeStateDelta } from "../models/runtime-state.js";
import { analyzeHookHealth } from "../utils/hook-health.js";

function createHook(overrides: Partial<HookRecord> = {}): HookRecord {
  return {
    hookId: overrides.hookId ?? "H001",
    startChapter: overrides.startChapter ?? 1,
    type: overrides.type ?? "mystery",
    status: overrides.status ?? "open",
    lastAdvancedChapter: overrides.lastAdvancedChapter ?? 1,
    expectedPayoff: overrides.expectedPayoff ?? "Reveal the hidden ledger",
    payoffTiming: overrides.payoffTiming,
    notes: overrides.notes ?? "Still unresolved",
  };
}

function createDelta(overrides: Partial<RuntimeStateDelta> = {}): RuntimeStateDelta {
  return {
    chapter: overrides.chapter ?? 20,
    hookOps: {
      upsert: overrides.hookOps?.upsert ?? [],
      mention: overrides.hookOps?.mention ?? [],
      resolve: overrides.hookOps?.resolve ?? [],
      defer: overrides.hookOps?.defer ?? [],
    },
    newHookCandidates: overrides.newHookCandidates ?? [],
    subplotOps: [],
    emotionalArcOps: [],
    characterMatrixOps: [],
    notes: [],
  };
}

describe("analyzeHookHealth", () => {
  it("warns when active hook count exceeds the recommended cap", () => {
    const issues = analyzeHookHealth({
      language: "en",
      chapterNumber: 20,
      hooks: [
        createHook({ hookId: "H001" }),
        createHook({ hookId: "H002" }),
        createHook({ hookId: "H003" }),
        createHook({ hookId: "H004" }),
        createHook({ hookId: "H005" }),
      ],
      maxActiveHooks: 4,
    });

    expect(issues.some((issue) => issue.category === "Hook Debt" && issue.description.includes("5 active hooks"))).toBe(true);
  });

  it("warns when a short-payoff hook is already under payoff pressure without real movement", () => {
    const issues = analyzeHookHealth({
      language: "en",
      chapterNumber: 4,
      hooks: [
        createHook({
          hookId: "H001",
          startChapter: 1,
          lastAdvancedChapter: 1,
          payoffTiming: "immediate",
          expectedPayoff: "Reveal the hidden ledger immediately after the theft.",
        }),
      ],
    });

    expect(issues.some((issue) => issue.description.includes("payoff pressure"))).toBe(true);
  });

  it("does not warn when only endgame hooks are dormant before the story reaches late phase", () => {
    const issues = analyzeHookHealth({
      language: "en",
      chapterNumber: 20,
      targetChapters: 40,
      hooks: [
        createHook({
          hookId: "H001",
          startChapter: 10,
          lastAdvancedChapter: 15,
          payoffTiming: "endgame",
          expectedPayoff: "Final reveal in the endgame.",
        }),
      ],
    });

    expect(issues).toHaveLength(0);
  });

  it("warns when stale hooks receive no disposition in the current chapter", () => {
    const issues = analyzeHookHealth({
      language: "en",
      chapterNumber: 20,
      hooks: [
        createHook({ hookId: "H001", lastAdvancedChapter: 5 }),
        createHook({ hookId: "H002", lastAdvancedChapter: 6 }),
      ],
      delta: createDelta({
        chapter: 20,
        hookOps: {
          upsert: [],
          mention: ["H001"],
          resolve: [],
          defer: [],
        },
      }),
      staleAfterChapters: 10,
    });

    expect(issues.some((issue) => issue.description.includes("H001") || issue.description.includes("H002"))).toBe(true);
  });

  it("warns when multiple new hooks open without resolving older debt", () => {
    const issues = analyzeHookHealth({
      language: "en",
      chapterNumber: 20,
      hooks: [
        createHook({ hookId: "old-debt", lastAdvancedChapter: 8 }),
        createHook({ hookId: "new-a", startChapter: 20, lastAdvancedChapter: 20 }),
        createHook({ hookId: "new-b", startChapter: 20, lastAdvancedChapter: 20 }),
      ],
      delta: createDelta({
        chapter: 20,
        hookOps: {
          upsert: [
            createHook({ hookId: "new-a", startChapter: 20, lastAdvancedChapter: 20 }),
            createHook({ hookId: "new-b", startChapter: 20, lastAdvancedChapter: 20 }),
          ],
          mention: [],
          resolve: [],
          defer: [],
        },
      }),
      existingHookIds: ["old-debt"],
      newHookBurstThreshold: 2,
    });

    expect(issues.some((issue) => issue.description.includes("Opened 2 new hooks"))).toBe(true);
  });

  it("does not count absorbed duplicate-family upserts as genuinely new hooks", () => {
    const issues = analyzeHookHealth({
      language: "en",
      chapterNumber: 20,
      hooks: [
        createHook({ hookId: "old-debt", lastAdvancedChapter: 20 }),
      ],
      delta: createDelta({
        chapter: 20,
        hookOps: {
          upsert: [
            createHook({ hookId: "duplicate-restated", lastAdvancedChapter: 20 }),
            createHook({ hookId: "second-duplicate", lastAdvancedChapter: 20 }),
          ],
          mention: [],
          resolve: [],
          defer: [],
        },
      }),
      existingHookIds: ["old-debt"],
      newHookBurstThreshold: 2,
    });

    expect(issues.some((issue) => issue.description.includes("Opened 2 new hooks"))).toBe(false);
  });
});
