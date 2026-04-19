import { describe, expect, it } from "vitest";
import {
  buildPlannerHookAgenda,
  isHookWithinChapterWindow,
} from "../utils/hook-agenda.js";
import type { StoredHook } from "../state/memory-db.js";

function createHook(overrides: Partial<StoredHook> = {}): StoredHook {
  return {
    hookId: overrides.hookId ?? "mentor-oath",
    startChapter: overrides.startChapter ?? 8,
    type: overrides.type ?? "relationship",
    status: overrides.status ?? "open",
    lastAdvancedChapter: overrides.lastAdvancedChapter ?? 9,
    expectedPayoff: overrides.expectedPayoff ?? "Reveal why the mentor broke the oath",
    payoffTiming: overrides.payoffTiming ?? "slow-burn",
    notes: overrides.notes ?? "Long debt should stay visible",
  };
}

describe("hook-agenda", () => {
  it("builds agenda with stalest-first sorting and chapter-window filtering", () => {
    const staleSlowBurn = createHook({
      hookId: "mentor-oath",
      startChapter: 4,
      lastAdvancedChapter: 7,
      notes: "Long debt is stalling",
    });
    const readyMystery = createHook({
      hookId: "ledger-fragment",
      type: "mystery",
      startChapter: 2,
      lastAdvancedChapter: 10,
      payoffTiming: "near-term",
      expectedPayoff: "Reveal the ledger fragment's origin",
      notes: "Ready to cash out",
    });

    const agenda = buildPlannerHookAgenda({
      hooks: [staleSlowBurn, readyMystery],
      chapterNumber: 12,
      targetChapters: 24,
      language: "en",
    });

    expect(agenda.mustAdvance).toContain("mentor-oath");

    expect(isHookWithinChapterWindow(staleSlowBurn, 12, 5)).toBe(true);
    expect(isHookWithinChapterWindow(readyMystery, 12, 5)).toBe(true);
  });
});
