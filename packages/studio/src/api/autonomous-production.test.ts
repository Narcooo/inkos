import { describe, expect, it } from "vitest";
import { AutonomousJobRegistry, projectAutonomousProductionView } from "./autonomous-production.js";

const map = {
  schemaVersion: "1.0" as const,
  bookId: "book",
  authorityBookId: "authority",
  title: "The House She Built",
  totalChapters: 156,
  volumes: [
    { volumeId: "volume-001", volumeNumber: 1, title: "One", startChapter: 1, endChapter: 38, chapterCount: 38 },
    { volumeId: "volume-002", volumeNumber: 2, title: "Two", startChapter: 39, endChapter: 78, chapterCount: 40 },
    { volumeId: "volume-003", volumeNumber: 3, title: "Three", startChapter: 79, endChapter: 118, chapterCount: 40 },
    { volumeId: "volume-004", volumeNumber: 4, title: "Four", startChapter: 119, endChapter: 156, chapterCount: 38 },
  ],
};

describe("autonomous production Studio projection", () => {
  it("derives current volume and budget without hard-coded chapter boundaries", () => {
    const view = projectAutonomousProductionView({
      map,
      targetChapters: 156,
      nextChapter: 5,
      chapters: [1, 2, 3, 4].map((number) => ({ number, status: "ready-for-review", tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 } })),
      config: {
        defaultModel: "gpt",
        modelOverrides: { auditor: "deepseek", "commercial-reader": "gemini", reviser: "gpt", "observer-reflector": "flash" },
      },
      runtime: null,
      active: false,
      budget: { preferredUsd: 15, hardCapUsd: 30 },
    });
    expect(view.currentVolume).toMatchObject({ volumeId: "volume-001", startChapter: 1, endChapter: 38 });
    expect(view.completedChapters).toBe(4);
    expect(view.budget).toMatchObject({ preferredUsd: 15, hardCapUsd: 30 });
    expect(view.startEnabled).toBe(true);
    expect(view.economics.actual.costStatus).toBe("UNAVAILABLE");
  });

  it("fails closed for state repair and missing independent role configuration", () => {
    const view = projectAutonomousProductionView({
      map,
      targetChapters: 156,
      nextChapter: 5,
      chapters: [{ number: 4, status: "state-degraded" }],
      config: { defaultModel: "gpt", modelOverrides: {} },
      runtime: null,
      active: false,
      budget: { preferredUsd: 15, hardCapUsd: 30 },
    });
    expect(view.startEnabled).toBe(false);
    expect(view.runtimeStatus).toBe("BLOCKED");
    expect(view.runtimeBlockers).toEqual(expect.arrayContaining([
      "PENDING_STATE_REPAIR_CHAPTER_4",
      "LOGIC_AUDITOR_MODEL_NOT_CONFIGURED",
      "COMMERCIAL_READER_MODEL_NOT_CONFIGURED",
    ]));
  });

  it("disables both starts while one job is active", () => {
    const view = projectAutonomousProductionView({
      map,
      targetChapters: 156,
      nextChapter: 39,
      chapters: Array.from({ length: 38 }, (_, index) => ({ number: index + 1, status: "ready-for-review" })),
      config: { defaultModel: "gpt", modelOverrides: { auditor: "deepseek", "commercial-reader": "gemini", "observer-reflector": "flash" } },
      runtime: { status: "RUNNING", mode: "full-book", nextChapter: 39, updatedAt: "2026-08-21T00:00:00.000Z" },
      active: true,
      budget: { preferredUsd: 15, hardCapUsd: 30 },
    });
    expect(view.currentVolume.volumeId).toBe("volume-002");
    expect(view.startEnabled).toBe(false);
    expect(view.runtimeBlockers).toContain("AUTONOMOUS_JOB_ALREADY_RUNNING");
  });

  it("reserves one job synchronously and rejects a double click", () => {
    const jobs = new AutonomousJobRegistry();
    expect(jobs.reserve("book")).toBe(true);
    expect(jobs.reserve("book")).toBe(false);
    expect(jobs.requestStop("book")).toBe(true);
    expect(jobs.shouldStop("book")).toBe(true);
    jobs.release("book");
    expect(jobs.isActive("book")).toBe(false);
  });

  it("projects a persisted RUNNING state as resumable PAUSED after Studio restart", () => {
    const view = projectAutonomousProductionView({
      map,
      targetChapters: 156,
      nextChapter: 39,
      chapters: Array.from({ length: 38 }, (_, index) => ({ number: index + 1, status: "ready-for-review" })),
      config: { defaultModel: "gpt", modelOverrides: { auditor: "deepseek", "commercial-reader": "gemini", "observer-reflector": "flash" } },
      runtime: { status: "RUNNING", mode: "full-book", nextChapter: 39, updatedAt: "2026-08-21T00:00:00.000Z" },
      active: false,
      budget: { preferredUsd: 15, hardCapUsd: 30 },
    });
    expect(view.runtimeStatus).toBe("PAUSED");
    expect(view.startEnabled).toBe(true);
  });
});
