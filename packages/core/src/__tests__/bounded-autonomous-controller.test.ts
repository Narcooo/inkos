import { describe, expect, it } from "vitest";
import { runBoundedAutonomousScope } from "../production/bounded-autonomous-controller.js";
import type { BookProductionMap } from "../production/book-production-map.js";

const map: BookProductionMap = {
  schemaVersion: "1.0",
  bookId: "book",
  authorityBookId: "authority",
  title: "Book",
  totalChapters: 6,
  volumes: [
    { volumeId: "volume-001", volumeNumber: 1, title: "One", startChapter: 1, endChapter: 3, chapterCount: 3 },
    { volumeId: "volume-002", volumeNumber: 2, title: "Two", startChapter: 4, endChapter: 6, chapterCount: 3 },
  ],
};

describe("bounded autonomous production controller", () => {
  it("runs exactly to the current dynamic volume boundary", async () => {
    let next = 2;
    const calls: number[] = [];
    const states: string[] = [];
    const result = await runBoundedAutonomousScope({
      map,
      mode: "current-volume",
      getNextChapter: async () => next,
      runChapter: async () => {
        calls.push(next);
        next += 1;
        return { status: "ready-for-review" };
      },
      shouldStop: () => false,
      beforeNextProviderCall: () => ({ allowed: true }),
      persistProgress: async (state) => { states.push(state.status); },
    });
    expect(calls).toEqual([2, 3]);
    expect(result.status).toBe("VOLUME_COMPLETE");
    expect(result.nextChapter).toBe(4);
    expect(states.at(-1)).toBe("VOLUME_COMPLETE");
  });

  it("stops after an atomic chapter when stop is requested", async () => {
    let next = 1;
    let stop = false;
    const result = await runBoundedAutonomousScope({
      map,
      mode: "full-book",
      getNextChapter: async () => next,
      runChapter: async () => {
        next += 1;
        stop = true;
        return { status: "ready-for-review" };
      },
      shouldStop: () => stop,
      beforeNextProviderCall: () => ({ allowed: true }),
      persistProgress: async () => undefined,
    });
    expect(result.status).toBe("PAUSED_BY_USER");
    expect(result.nextChapter).toBe(2);
  });

  it("crosses a volume boundary in full-book mode and stops at the mapped final chapter", async () => {
    let next = 1;
    const calls: number[] = [];
    const projectedVolumes: string[] = [];
    const result = await runBoundedAutonomousScope({
      map,
      mode: "full-book",
      getNextChapter: async () => next,
      runChapter: async () => { calls.push(next); next += 1; return { status: "ready-for-review" }; },
      shouldStop: () => false,
      beforeNextProviderCall: () => ({ allowed: true }),
      persistProgress: async (progress) => { projectedVolumes.push(progress.volumeId); },
    });
    expect(calls).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.status).toBe("BOOK_COMPLETE");
    expect(result.nextChapter).toBe(7);
    expect(projectedVolumes).toContain("volume-002");
  });

  it("holds without advancing when two bounded revisions are exhausted", async () => {
    let next = 1;
    const result = await runBoundedAutonomousScope({
      map,
      mode: "full-book",
      getNextChapter: async () => next,
      runChapter: async () => ({ status: "held-after-two-revisions" }),
      shouldStop: () => false,
      beforeNextProviderCall: () => ({ allowed: true }),
      persistProgress: async () => undefined,
    });
    expect(result.status).toBe("HELD_AFTER_TWO_REVISIONS");
    expect(result.nextChapter).toBe(1);
  });

  it("blocks before the next chapter when the hard budget cap is reached", async () => {
    let calls = 0;
    const result = await runBoundedAutonomousScope({
      map,
      mode: "full-book",
      getNextChapter: async () => 1,
      runChapter: async () => { calls += 1; return { status: "ready-for-review" }; },
      shouldStop: () => false,
      beforeNextProviderCall: () => ({ allowed: false, reason: "HARD_COST_CAP_REACHED" }),
      persistProgress: async () => undefined,
    });
    expect(calls).toBe(0);
    expect(result.status).toBe("BUDGET_BLOCKED");
    expect(result.reason).toBe("HARD_COST_CAP_REACHED");
  });
});
