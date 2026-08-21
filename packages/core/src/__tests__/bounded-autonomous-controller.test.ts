import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimAutonomousJob, createAutonomousPipelineActions, deriveAutonomousJobIdentity, refreshAutonomousJobClaim, releaseAutonomousJob, runBoundedAutonomousScope } from "../production/bounded-autonomous-controller.js";
import type { BookProductionMap } from "../production/book-production-map.js";
import type { ChapterMeta } from "../models/chapter.js";

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
  it("derives one stable job identity for the same book, mode, and dynamic volume", () => {
    const first = deriveAutonomousJobIdentity({ map, mode: "current-volume", nextChapter: 1 });
    const resumed = deriveAutonomousJobIdentity({ map, mode: "current-volume", nextChapter: 3 });
    expect(first).toBe(resumed);
    expect(deriveAutonomousJobIdentity({ map, mode: "full-book", nextChapter: 3 })).not.toBe(first);
  });

  it("resumes a settled audit-failed draft before generating the next chapter", async () => {
    let next = 5;
    const calls: string[] = [];
    let chapters: ChapterMeta[] = [
      { number: 4, title: "Four", status: "audit-failed" as const, wordCount: 1, createdAt: "now", updatedAt: "now", auditIssues: ["[warning] fix"], lengthWarnings: [] },
    ];
    const actions = await createAutonomousPipelineActions({
      bookId: "book",
      state: {
        loadChapterIndex: async () => chapters,
        saveChapterIndex: async (_bookId, updated) => { chapters = [...updated]; },
      },
      pipeline: {
        resumeAuditFailedChapterBounded: async () => { calls.push("resume:4"); return { status: "approved", chapterNumber: 4 }; },
        writeNextChapter: async () => { calls.push(`write:${next}`); const chapterNumber = next; next += 1; return { status: "ready-for-review", chapterNumber }; },
      },
    });
    const result = await runBoundedAutonomousScope({
      map,
      mode: "current-volume",
      getNextChapter: async () => next,
      resumePendingChapter: actions.resumePendingChapter,
      runChapter: actions.runChapter,
      shouldStop: () => false,
      persistProgress: async () => undefined,
    });
    expect(calls).toEqual(["resume:4", "write:5", "write:6"]);
    expect(chapters[0]?.status).toBe("approved");
    expect(result.status).toBe("BOOK_COMPLETE");
  });

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
      persistProgress: async () => undefined,
    });
    expect(result.status).toBe("HELD_AFTER_TWO_REVISIONS");
    expect(result.nextChapter).toBe(1);
  });

  it("does not consult dollar-cost admission when budget is not configured", async () => {
    let next = 1;
    let calls = 0;
    const result = await runBoundedAutonomousScope({
      map,
      mode: "current-volume",
      getNextChapter: async () => next,
      runChapter: async () => { calls += 1; next += 1; return { status: "ready-for-review" }; },
      shouldStop: () => false,
      persistProgress: async () => undefined,
    });
    expect(calls).toBe(3);
    expect(result.status).toBe("VOLUME_COMPLETE");
  });

  it("grants one durable cross-process claim and rejects a concurrent owner", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-autonomous-claim-"));
    try {
      const first = await claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job", ownerPid: 101, isProcessAlive: () => true });
      await expect(claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job", ownerPid: 202, isProcessAlive: () => true }))
        .rejects.toThrow("AUTONOMOUS_JOB_ALREADY_RUNNING");
      await releaseAutonomousJob(root, "book", first);
      const second = await claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job", ownerPid: 202, isProcessAlive: () => true });
      await releaseAutonomousJob(root, "book", second);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reclaims only a dead owner's durable claim", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-autonomous-reclaim-"));
    try {
      const stale = await claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job", ownerPid: 101, isProcessAlive: () => true });
      const replacement = await claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job", ownerPid: 202, isProcessAlive: (pid) => pid !== 101 });
      await releaseAutonomousJob(root, "book", stale);
      await expect(claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job", ownerPid: 303, isProcessAlive: () => true }))
        .rejects.toThrow("AUTONOMOUS_JOB_ALREADY_RUNNING");
      await releaseAutonomousJob(root, "book", replacement);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("grants exactly one successor when two processes race to reclaim the same dead claim", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-autonomous-reclaim-race-"));
    try {
      await claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job", ownerPid: 101, isProcessAlive: () => true });
      const attempts = await Promise.allSettled([
        claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job", ownerPid: 202, isProcessAlive: (pid) => pid !== 101 }),
        claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job", ownerPid: 303, isProcessAlive: (pid) => pid !== 101 }),
      ]);
      const granted = attempts.filter((attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof claimAutonomousJob>>> => attempt.status === "fulfilled");
      expect(granted).toHaveLength(1);
      await releaseAutonomousJob(root, "book", granted[0]!.value);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reclaims a stale heartbeat even when the operating system has reused the owner PID", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-autonomous-pid-reuse-"));
    try {
      const stale = await claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job", ownerPid: 101, isProcessAlive: () => true });
      const lease = join(root, "books", "book", "story", "runtime", "bounded-autonomous", "active-job.json");
      await writeFile(`${lease}.heartbeat.${stale.claimId}`, JSON.stringify({ ...stale, updatedAt: "2000-01-01T00:00:00.000Z" }), "utf-8");
      const replacement = await claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job", ownerPid: 101, isProcessAlive: () => true });
      expect(replacement.claimId).not.toBe(stale.claimId);
      await releaseAutonomousJob(root, "book", replacement);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("recovers an abandoned reclaim guard left by a crashed owner", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-autonomous-abandoned-guard-"));
    try {
      const stale = await claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job", ownerPid: 101, isProcessAlive: () => true });
      const lease = join(root, "books", "book", "story", "runtime", "bounded-autonomous", "active-job.json");
      await writeFile(`${lease}.heartbeat.${stale.claimId}`, JSON.stringify({ ...stale, updatedAt: "2000-01-01T00:00:00.000Z" }), "utf-8");
      const contenders = `${lease}.reclaim-contenders`;
      await mkdir(contenders, { recursive: true });
      await writeFile(join(contenders, "crashed-guard.json"), JSON.stringify({ token: "crashed-guard", ownerPid: 101, ownerIdentity: "old-101", ticket: 1, choosing: false, updatedAt: "2000-01-01T00:00:00.000Z" }), "utf-8");

      const replacement = await claimAutonomousJob({
        projectRoot: root,
        bookId: "book",
        jobId: "job",
        ownerPid: 202,
        isProcessAlive: (pid) => pid !== 101,
      });

      expect(replacement.ownerPid).toBe(202);
      await releaseAutonomousJob(root, "book", replacement);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("grants exactly one successor when two processes race past an abandoned reclaim guard", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-autonomous-abandoned-guard-race-"));
    try {
      const stale = await claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job", ownerPid: 101, isProcessAlive: () => true });
      const lease = join(root, "books", "book", "story", "runtime", "bounded-autonomous", "active-job.json");
      await writeFile(`${lease}.heartbeat.${stale.claimId}`, JSON.stringify({ ...stale, updatedAt: "2000-01-01T00:00:00.000Z" }), "utf-8");
      const contenders = `${lease}.reclaim-contenders`;
      await mkdir(contenders, { recursive: true });
      await writeFile(join(contenders, "crashed-guard.json"), JSON.stringify({ token: "crashed-guard", ownerPid: 101, ownerIdentity: "old-101", ticket: 1, choosing: false, updatedAt: "2000-01-01T00:00:00.000Z" }), "utf-8");

      const attempts = await Promise.allSettled([
        claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job", ownerPid: 202, isProcessAlive: (pid) => pid !== 101 }),
        claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job", ownerPid: 303, isProcessAlive: (pid) => pid !== 101 }),
      ]);
      const granted = attempts.filter((attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof claimAutonomousJob>>> => attempt.status === "fulfilled");
      expect(granted).toHaveLength(1);
      await releaseAutonomousJob(root, "book", granted[0]!.value);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("recovers an old truncated reclaim guard without treating a fresh partial write as abandoned", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-autonomous-truncated-guard-"));
    try {
      await claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job", ownerPid: 101, isProcessAlive: () => true });
      const lease = join(root, "books", "book", "story", "runtime", "bounded-autonomous", "active-job.json");
      const contenders = `${lease}.reclaim-contenders`;
      await mkdir(contenders, { recursive: true });
      const guard = join(contenders, "truncated-guard.json");
      await writeFile(guard, "{", "utf-8");
      await expect(claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job", ownerPid: 202, isProcessAlive: (pid) => pid !== 101 }))
        .rejects.toThrow("AUTONOMOUS_JOB_RECLAIM_CONFLICT");
      await utimes(guard, new Date("2000-01-01T00:00:00.000Z"), new Date("2000-01-01T00:00:00.000Z"));
      const replacement = await claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job", ownerPid: 202, isProcessAlive: (pid) => pid !== 101 });
      await releaseAutonomousJob(root, "book", replacement);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not expire a live contender when its process generation still matches", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-autonomous-suspended-guard-"));
    try {
      const stale = await claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job", ownerPid: 101, isProcessAlive: () => true });
      const lease = join(root, "books", "book", "story", "runtime", "bounded-autonomous", "active-job.json");
      await writeFile(`${lease}.heartbeat.${stale.claimId}`, JSON.stringify({ ...stale, updatedAt: "2000-01-01T00:00:00.000Z" }), "utf-8");
      const contenders = `${lease}.reclaim-contenders`;
      await mkdir(contenders, { recursive: true });
      await writeFile(join(contenders, "suspended.json"), JSON.stringify({ token: "suspended", ownerPid: 101, ownerIdentity: "generation-101", ticket: 1, choosing: false, updatedAt: "2000-01-01T00:00:00.000Z" }), "utf-8");
      await expect(claimAutonomousJob({
        projectRoot: root,
        bookId: "book",
        jobId: "job",
        ownerPid: 202,
        isProcessAlive: () => true,
        getProcessIdentity: async (pid) => pid === 101 ? "generation-101" : "current-generation",
      })).rejects.toThrow("AUTONOMOUS_JOB_RECLAIM_CONFLICT");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("recovers a live PID whose process generation no longer matches", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-autonomous-guard-pid-reuse-"));
    try {
      const stale = await claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job", ownerPid: 101, isProcessAlive: () => true });
      const lease = join(root, "books", "book", "story", "runtime", "bounded-autonomous", "active-job.json");
      await writeFile(`${lease}.heartbeat.${stale.claimId}`, JSON.stringify({ ...stale, updatedAt: "2000-01-01T00:00:00.000Z" }), "utf-8");
      const contenders = `${lease}.reclaim-contenders`;
      await mkdir(contenders, { recursive: true });
      await writeFile(join(contenders, "old-generation.json"), JSON.stringify({ token: "old-generation", ownerPid: 101, ownerIdentity: "old-101", ticket: 1, choosing: false, updatedAt: new Date().toISOString() }), "utf-8");
      const replacement = await claimAutonomousJob({
        projectRoot: root,
        bookId: "book",
        jobId: "job",
        ownerPid: 202,
        isProcessAlive: () => true,
        getProcessIdentity: async (pid) => pid === 101 ? "new-101" : "current-generation",
      });
      await releaseAutonomousJob(root, "book", replacement);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("serializes an owner heartbeat refresh against stale-claim reclamation", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-autonomous-refresh-reclaim-race-"));
    try {
      const original = await claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job", ownerPid: process.pid });
      const lease = join(root, "books", "book", "story", "runtime", "bounded-autonomous", "active-job.json");
      await writeFile(`${lease}.heartbeat.${original.claimId}`, JSON.stringify({ ...original, updatedAt: "2000-01-01T00:00:00.000Z" }), "utf-8");

      const outcomes = await Promise.allSettled([
        refreshAutonomousJobClaim(root, "book", original),
        claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job", ownerPid: 202, isProcessAlive: () => true }),
      ]);
      const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
      expect(fulfilled).toHaveLength(1);
      if (outcomes[1]!.status === "fulfilled") {
        await releaseAutonomousJob(root, "book", outcomes[1].value);
      } else {
        await releaseAutonomousJob(root, "book", original);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("drains same-owner refreshes before releasing the durable claim", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-autonomous-refresh-release-"));
    try {
      const claim = await claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job" });
      const refreshes = Array.from({ length: 8 }, () => refreshAutonomousJobClaim(root, "book", claim));
      const release = releaseAutonomousJob(root, "book", claim);
      const outcomes = await Promise.allSettled([...refreshes, release]);
      expect(outcomes.every((outcome) => outcome.status === "fulfilled")).toBe(true);
      const replacement = await claimAutonomousJob({ projectRoot: root, bookId: "book", jobId: "job" });
      await releaseAutonomousJob(root, "book", replacement);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
