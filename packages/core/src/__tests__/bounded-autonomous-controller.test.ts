import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimAutonomousJob, correctLegacyPendingChapterArtifactBindings, createAutonomousPipelineActions, createAutonomousProviderExecution, deriveAutonomousJobIdentity, refreshAutonomousJobClaim, releaseAutonomousJob, runBoundedAutonomousScope } from "../production/bounded-autonomous-controller.js";
import { LLMCallExecutionError } from "../llm/provider.js";
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

function providerFailure(params: {
  readonly classification: "RETRYABLE_PROVIDER_HTTP" | "RETRYABLE_PRE_TRANSPORT" | "AMBIGUOUS_PROVIDER_OUTCOME" | "DETERMINISTIC_PROVIDER_ERROR";
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly logicalStepId?: string;
  readonly revisionRound?: number;
}) {
  return new LLMCallExecutionError("safe synthetic provider failure", {
    logicalStepId: params.logicalStepId ?? "step-1",
    inputFingerprint: "a".repeat(64),
    provider: "openrouter",
    model: "provider/model",
    role: "auditor",
    stage: "LOGIC_REVIEW",
    ...(params.revisionRound !== undefined ? { revisionRound: params.revisionRound } : {}),
    classification: params.classification,
    transportStarted: params.classification !== "RETRYABLE_PRE_TRANSPORT",
    transportReturned: params.classification === "RETRYABLE_PROVIDER_HTTP" || params.classification === "DETERMINISTIC_PROVIDER_ERROR",
    ...(params.status ? { httpStatus: params.status } : {}),
    ...(params.retryAfterMs ? { retryAfterMs: params.retryAfterMs } : {}),
  });
}

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

  it("continues automatically after a final review accepts noncritical findings", async () => {
    let next = 5;
    const calls: string[] = [];
    const result = await runBoundedAutonomousScope({
      map,
      mode: "current-volume",
      getNextChapter: async () => next,
      resumePendingChapter: async () => ({ status: "accepted-with-findings", chapterNumber: 4 }),
      runChapter: async () => { calls.push(`write:${next}`); next += 1; return { status: "ready-for-review" }; },
      shouldStop: () => false,
      persistProgress: async () => undefined,
    });
    expect(calls).toEqual(["write:5", "write:6"]);
    expect(result.status).toBe("BOOK_COMPLETE");
  });

  it("uses the pending chapter identity for recovery while preserving the next cursor", async () => {
    let next = 5;
    const executedChapters: number[] = [];
    const progress: Array<{ nextChapter: number }> = [];
    const result = await runBoundedAutonomousScope({
      map,
      mode: "current-volume",
      getNextChapter: async () => next,
      pendingChapterNumber: 4,
      resumePendingChapter: async () => ({ status: "accepted-with-findings", chapterNumber: 4 }),
      runChapter: async () => { next += 1; return { status: "ready-for-review" }; },
      shouldStop: () => false,
      persistProgress: async (entry) => { progress.push(entry); },
      providerRecovery: {
        execute: async (chapterNumber, task) => { executedChapters.push(chapterNumber); return task(); },
        loadPersistedProgress: async () => null,
        now: () => 0,
        sleep: async () => undefined,
      },
    });
    expect(executedChapters[0]).toBe(4);
    expect(progress[0]?.nextChapter).toBe(5);
    expect(result.status).toBe("BOOK_COMPLETE");
  });

  it("stops before the next chapter when final review has critical findings", async () => {
    let next = 5;
    const runChapter = vi.fn();
    const result = await runBoundedAutonomousScope({
      map,
      mode: "current-volume",
      getNextChapter: async () => next,
      resumePendingChapter: async () => ({ status: "blocked-critical-findings", chapterNumber: 4 }),
      runChapter,
      shouldStop: () => false,
      persistProgress: async () => undefined,
    });
    expect(runChapter).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "BLOCKED_CRITICAL_FINDINGS", nextChapter: 5, reason: "FINAL_REVIEW_CRITICAL_FINDINGS" });
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

  it("derives the formal 001-038 stop from its map and never starts chapter 039", async () => {
    const formalShape: BookProductionMap = {
      schemaVersion: "1.0", bookId: "formal-shape", authorityBookId: "authority", title: "Formal Shape", totalChapters: 156,
      volumes: [
        { volumeId: "volume-001", volumeNumber: 1, title: "One", startChapter: 1, endChapter: 38, chapterCount: 38 },
        { volumeId: "volume-002", volumeNumber: 2, title: "Two", startChapter: 39, endChapter: 78, chapterCount: 40 },
        { volumeId: "volume-003", volumeNumber: 3, title: "Three", startChapter: 79, endChapter: 118, chapterCount: 40 },
        { volumeId: "volume-004", volumeNumber: 4, title: "Four", startChapter: 119, endChapter: 156, chapterCount: 38 },
      ],
    };
    let next = 5;
    const calls: number[] = [];
    const result = await runBoundedAutonomousScope({
      map: formalShape,
      mode: "current-volume",
      getNextChapter: async () => next,
      runChapter: async () => { calls.push(next); next += 1; return { status: "ready-for-review" }; },
      shouldStop: () => false,
      persistProgress: async () => undefined,
    });
    expect(calls.at(0)).toBe(5);
    expect(calls.at(-1)).toBe(38);
    expect(calls).not.toContain(39);
    expect(result).toMatchObject({ status: "VOLUME_COMPLETE", nextChapter: 39, targetChapter: 38 });
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

  it("persists HTTP 429 waiting for at least 300 seconds and retries automatically with a fake clock", async () => {
    let now = Date.parse("2026-08-23T00:00:00.000Z");
    let next = 1;
    let calls = 0;
    const waits: number[] = [];
    const states: Array<{ status: string; nextRetryAt?: string; attempt?: number }> = [];
    const result = await runBoundedAutonomousScope({
      map,
      mode: "current-volume",
      getNextChapter: async () => next,
      runChapter: async () => {
        calls += 1;
        if (calls === 1) throw providerFailure({ classification: "RETRYABLE_PROVIDER_HTTP", status: 429, revisionRound: 1 });
        next += 1;
        return { status: "ready-for-review" };
      },
      shouldStop: () => false,
      persistProgress: async (state) => { states.push(state); },
      providerRecovery: {
        execute: async (_chapter, task) => task(),
        loadPersistedProgress: async () => null,
        now: () => now,
        sleep: async (ms) => { waits.push(ms); now += ms; },
      },
    });
    expect(waits[0]).toBe(300_000);
    expect(states).toContainEqual(expect.objectContaining({ status: "WAITING_PROVIDER_RETRY", attempt: 1, revisionRound: 1 }));
    expect(states.find((state) => state.status === "WAITING_PROVIDER_RETRY")?.nextRetryAt).toBe("2026-08-23T00:05:00.000Z");
    expect(calls).toBe(4);
    expect(result.status).toBe("VOLUME_COMPLETE");
  });

  it("uses 300 then 900 seconds for HTTP 503 and pauses after the third failed transport", async () => {
    let now = 0;
    let calls = 0;
    const waits: number[] = [];
    const states: Array<{ status: string; attempt?: number; transportRetryCount?: number }> = [];
    const result = await runBoundedAutonomousScope({
      map,
      mode: "current-volume",
      getNextChapter: async () => 1,
      runChapter: async () => { calls += 1; throw providerFailure({ classification: "RETRYABLE_PROVIDER_HTTP", status: 503 }); },
      shouldStop: () => false,
      persistProgress: async (state) => { states.push(state); },
      providerRecovery: {
        execute: async (_chapter, task) => task(),
        loadPersistedProgress: async () => null,
        now: () => now,
        sleep: async (ms) => { waits.push(ms); now += ms; },
      },
    });
    expect(waits).toEqual([300_000, 900_000]);
    expect(calls).toBe(3);
    expect(result).toMatchObject({ status: "PAUSED_PROVIDER_UNAVAILABLE", attempt: 3, transportRetryCount: 2 });
    expect(states.at(-1)).toMatchObject({ status: "PAUSED_PROVIDER_UNAVAILABLE", attempt: 3, transportRetryCount: 2 });
    expect((result as any).providerAttemptHistory).toHaveLength(3);
    expect(new Set((result as any).providerAttemptHistory.map((entry: any) => entry.transportAttemptId)).size).toBe(3);
    expect((result as any).providerAttemptHistory.map((entry: any) => entry.attempt)).toEqual([1, 2, 3]);
  });

  it.each([
    { retryAfterMs: 600_000, expected: 600_000 },
    { retryAfterMs: 10_000, expected: 300_000 },
  ])("applies Retry-After against the first retry lower bound", async ({ retryAfterMs, expected }) => {
    let now = 0;
    let next = 1;
    let calls = 0;
    const waits: number[] = [];
    await runBoundedAutonomousScope({
      map,
      mode: "current-volume",
      getNextChapter: async () => next,
      runChapter: async () => {
        calls += 1;
        if (calls === 1) throw providerFailure({ classification: "RETRYABLE_PROVIDER_HTTP", status: 429, retryAfterMs });
        next = 4;
        return { status: "ready-for-review" };
      },
      shouldStop: () => false,
      persistProgress: async () => undefined,
      providerRecovery: { execute: async (_chapter, task) => task(), loadPersistedProgress: async () => null, now: () => now, sleep: async (ms) => { waits.push(ms); now += ms; } },
    });
    expect(waits).toEqual([expected]);
  });

  it.each([
    { retryAfterMs: 1_200_000, expectedSecondWait: 1_200_000 },
    { retryAfterMs: 10_000, expectedSecondWait: 900_000 },
  ])("applies Retry-After against the second retry lower bound", async ({ retryAfterMs, expectedSecondWait }) => {
    let now = 0;
    let next = 1;
    let calls = 0;
    const waits: number[] = [];
    await runBoundedAutonomousScope({
      map,
      mode: "current-volume",
      getNextChapter: async () => next,
      runChapter: async () => {
        calls += 1;
        if (calls === 1) throw providerFailure({ classification: "RETRYABLE_PROVIDER_HTTP", status: 503 });
        if (calls === 2) throw providerFailure({ classification: "RETRYABLE_PROVIDER_HTTP", status: 503, retryAfterMs });
        next = 4;
        return { status: "ready-for-review" };
      },
      shouldStop: () => false,
      persistProgress: async () => undefined,
      providerRecovery: { execute: async (_chapter, task) => task(), loadPersistedProgress: async () => null, now: () => now, sleep: async (ms) => { waits.push(ms); now += ms; } },
    });
    expect(waits).toEqual([300_000, expectedSecondWait]);
  });

  it("reloads one waiting job after a simulated server restart and continues without another click", async () => {
    let persisted: any = null;
    let now = 0;
    await expect(runBoundedAutonomousScope({
      map,
      mode: "current-volume",
      getNextChapter: async () => 1,
      runChapter: async () => { throw providerFailure({ classification: "RETRYABLE_PROVIDER_HTTP", status: 503 }); },
      shouldStop: () => false,
      persistProgress: async (state) => { persisted = state; },
      providerRecovery: {
        execute: async (_chapter, task) => task(), loadPersistedProgress: async () => null, now: () => now,
        sleep: async () => { throw new Error("SIMULATED_SERVER_RESTART"); },
      },
    })).rejects.toThrow("SIMULATED_SERVER_RESTART");
    expect(persisted).toMatchObject({ status: "WAITING_PROVIDER_RETRY", attempt: 1 });

    now = Date.parse(persisted.nextRetryAt);
    let next = 1;
    let resumedCalls = 0;
    const resumed = await runBoundedAutonomousScope({
      map,
      mode: "current-volume",
      getNextChapter: async () => next,
      runChapter: async () => { resumedCalls += 1; next = 4; return { status: "ready-for-review" }; },
      shouldStop: () => false,
      persistProgress: async (state) => { persisted = state; },
      providerRecovery: {
        execute: async (_chapter, task) => task(), loadPersistedProgress: async () => persisted, now: () => now,
        sleep: async (ms) => { now += ms; },
      },
    });
    expect(resumed.jobId).toBe(persisted.jobId);
    expect(resumedCalls).toBe(1);
    expect(resumed.status).toBe("VOLUME_COMPLETE");
  });

  it("fails closed without retry when the provider outcome may be ambiguous", async () => {
    let calls = 0;
    const sleep = vi.fn();
    const result = await runBoundedAutonomousScope({
      map,
      mode: "current-volume",
      getNextChapter: async () => 1,
      runChapter: async () => { calls += 1; throw providerFailure({ classification: "AMBIGUOUS_PROVIDER_OUTCOME" }); },
      shouldStop: () => false,
      persistProgress: async () => undefined,
      providerRecovery: { execute: async (_chapter, task) => task(), loadPersistedProgress: async () => null, now: () => 0, sleep },
    });
    expect(result).toMatchObject({ status: "PAUSED_AMBIGUOUS_PROVIDER_OUTCOME", attempt: 1 });
    expect(calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403])("does not retry deterministic HTTP %s", async (status) => {
    const sleep = vi.fn();
    let calls = 0;
    const result = await runBoundedAutonomousScope({
      map,
      mode: "current-volume",
      getNextChapter: async () => 1,
      runChapter: async () => { calls += 1; throw providerFailure({ classification: "DETERMINISTIC_PROVIDER_ERROR", status }); },
      shouldStop: () => false,
      persistProgress: async () => undefined,
      providerRecovery: { execute: async (_chapter, task) => task(), loadPersistedProgress: async () => null, now: () => 0, sleep },
    });
    expect(result.status).toBe("PAUSED_DETERMINISTIC_PROVIDER_ERROR");
    expect(calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("pauses a deterministic parser or business failure without a technical retry", async () => {
    const sleep = vi.fn();
    let calls = 0;
    const result = await runBoundedAutonomousScope({
      map,
      mode: "current-volume",
      getNextChapter: async () => 1,
      runChapter: async () => { calls += 1; throw new Error("DETERMINISTIC_PARSER_FAILURE"); },
      shouldStop: () => false,
      persistProgress: async () => undefined,
      providerRecovery: { execute: async (_chapter, task) => task(), loadPersistedProgress: async () => null, now: () => 0, sleep },
    });
    expect(result).toMatchObject({
      status: "PAUSED_DETERMINISTIC_PROVIDER_ERROR",
      checkpoint: "DETERMINISTIC_PIPELINE_ERROR",
      lastErrorClassification: "DETERMINISTIC_PIPELINE_ERROR",
    });
    expect(calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("atomically reuses a saved response artifact without a second transport or duplicate usage identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-autonomous-response-artifact-"));
    try {
      let transportCalls = 0;
      const runtimeDir = join(root, "books", "book", "story", "runtime", "bounded-autonomous");
      await mkdir(runtimeDir, { recursive: true });
      await writeFile(join(runtimeDir, "production-state.json"), JSON.stringify({
        jobId: "job", status: "RUNNING", mode: "current-volume", volumeId: "volume-001",
        startChapter: 4, targetChapter: 4, nextChapter: 4, completedThisRun: 0,
      }), "utf-8");
      const stages = { stage: "LOGIC_REVIEW", role: "auditor", provider: "openrouter", model: "provider/model", revisionRound: 0, reviewRound: 1 } as const;
      const execution = createAutonomousProviderExecution({ projectRoot: root, bookId: "book", jobId: "job", getActiveStage: () => stages });
      const run = () => execution.runProviderCall(4, async () => {
        transportCalls += 1;
        return { content: "synthetic result", usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 } };
      }, { provider: "openrouter", model: "provider/model", inputFingerprint: "b".repeat(64) });
      const first = await run();
      const second = await run();
      expect(second).toEqual(first);
      expect(transportCalls).toBe(1);
      const artifact = JSON.parse(await readFile(execution.responseArtifactPath("b".repeat(64), "openrouter", "provider/model", 4), "utf-8"));
      expect(artifact).toMatchObject({ response_artifact_status: "COMPLETE", usage_identity: artifact.logical_step_id });
      const runtime = JSON.parse(await readFile(join(runtimeDir, "production-state.json"), "utf-8"));
      expect(runtime).toMatchObject({
        responseArtifactStatus: "COMPLETE",
        checkpoint: "RESPONSE_ARTIFACT_PERSISTED",
        attempt: 1,
      });
      expect(runtime.providerAttemptHistory).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not replay or bind an unreferenced next-cursor artifact through runProviderCall", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-autonomous-unreferenced-runtime-replay-"));
    try {
      const runtimeDir = join(root, "books", "book", "story", "runtime", "bounded-autonomous");
      const responseDir = join(runtimeDir, "provider-responses");
      const evidenceDir = join(runtimeDir, "chapter-0004");
      await mkdir(responseDir, { recursive: true });
      await mkdir(evidenceDir, { recursive: true });
      await writeFile(join(runtimeDir, "production-state.json"), JSON.stringify({
        jobId: "job", status: "REVIEW_EXHAUSTED", mode: "current-volume", volumeId: "volume-002",
        startChapter: 4, targetChapter: 6, nextChapter: 5, chapterNumber: 5, completedThisRun: 0,
        responseArtifactStatus: "COMPLETE",
      }), "utf-8");
      await writeFile(join(evidenceDir, "resume-review.json"), JSON.stringify({
        schema_version: "1.0", chapter_number: 4, status: "REVIEW_EXHAUSTED", modelOutcomes: [],
      }), "utf-8");
      const stages = { stage: "RESCUE_REVISING_2", role: "reviser", provider: "openrouter", model: "provider/model", revisionRound: 2 } as const;
      const execution = createAutonomousProviderExecution({ projectRoot: root, bookId: "book", jobId: "job", getActiveStage: () => stages });
      const fingerprint = "e".repeat(64);
      const legacyPath = execution.responseArtifactPath(fingerprint, "openrouter", "provider/model", 5);
      const legacyLogicalStepId = legacyPath.split(/[\\\\/]/).at(-1)!.replace(/\.json$/, "");
      const legacyContent = "=== REVISED_CONTENT ===\nUnreferenced next-cursor artifact.";
      const { createHash } = await import("node:crypto");
      await writeFile(legacyPath, `${JSON.stringify({
        schema_version: "1.0", job_id: "job", logical_step_id: legacyLogicalStepId,
        usage_identity: legacyLogicalStepId, chapter_number: 5, role: "reviser", stage: "RESCUE_REVISING_2",
        provider: "openrouter", requested_model: "provider/model", input_fingerprint: fingerprint,
        response_artifact_status: "COMPLETE", content_sha256: createHash("sha256").update(legacyContent).digest("hex"),
        response: { content: legacyContent }, completed_at: "2026-08-23T00:00:00.000Z",
      }, null, 2)}\n`, "utf-8");
      const freshResponse = { content: "fresh transport result", usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 } };
      let transportCalls = 0;

      const result = await execution.runProviderCall(4, async () => {
        transportCalls += 1;
        return freshResponse;
      }, { provider: "openrouter", model: "provider/model", inputFingerprint: fingerprint });

      expect(result).toEqual(freshResponse);
      expect(transportCalls).toBe(1);
      await expect(readFile(execution.responseArtifactBindingPath(fingerprint, "openrouter", "provider/model", 4)))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("corrected-binds a legacy next-cursor artifact to the pending chapter without copying its response", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-autonomous-corrected-binding-"));
    try {
      const runtimeDir = join(root, "books", "book", "story", "runtime", "bounded-autonomous");
      const responseDir = join(runtimeDir, "provider-responses");
      const evidenceDir = join(runtimeDir, "chapter-0004");
      await mkdir(responseDir, { recursive: true });
      await mkdir(evidenceDir, { recursive: true });
      await writeFile(join(runtimeDir, "production-state.json"), JSON.stringify({
        jobId: "job", status: "REVIEW_EXHAUSTED", mode: "current-volume", volumeId: "volume-002",
        startChapter: 4, targetChapter: 6, nextChapter: 5, chapterNumber: 5, completedThisRun: 0,
        responseArtifactStatus: "COMPLETE",
      }), "utf-8");
      const stages = { stage: "RESCUE_REVISING_2", role: "reviser", provider: "openrouter", model: "provider/model", revisionRound: 2 } as const;
      const execution = createAutonomousProviderExecution({ projectRoot: root, bookId: "book", jobId: "job", getActiveStage: () => stages });
      const fingerprint = "c".repeat(64);
      const legacyPath = execution.responseArtifactPath(fingerprint, "openrouter", "provider/model", 5);
      const legacyLogicalStepId = legacyPath.split(/[\\/]/).at(-1)!.replace(/\.json$/, "");
      const finalStages = { stage: "LOGIC_REVIEW", role: "logicAuditor", provider: "openrouter", model: "provider/model", reviewRound: 2 } as const;
      const finalExecution = createAutonomousProviderExecution({ projectRoot: root, bookId: "book", jobId: "job", getActiveStage: () => finalStages });
      const finalFingerprint = "f".repeat(64);
      const finalLegacyPath = finalExecution.responseArtifactPath(finalFingerprint, "openrouter", "provider/model", 5);
      const finalLegacyLogicalStepId = finalLegacyPath.split(/[\\/]/).at(-1)!.replace(/\.json$/, "");
      await writeFile(join(evidenceDir, "resume-review.json"), JSON.stringify({
        schema_version: "1.0",
        chapter_number: 4,
        status: "REVIEW_EXHAUSTED",
        modelOutcomes: [{ modelCallId: legacyLogicalStepId }, { modelCallId: finalLegacyLogicalStepId }],
      }), "utf-8");
      const response = { content: "=== REVISED_CONTENT ===\nSynthetic Chapter 004 rescue.", usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 } };
      const finalResponse = { content: JSON.stringify({
        passed: true,
        overall_score: 92,
        dimension_scores: {
          blueprint_transition: 95, causal_logic: 90, canon_continuity: 92, character_motivation: 95,
          state_inheritance: 95, hooks_disclosure: 95, narrative_clarity: 93,
        },
        issues: [{ severity: "warning", category: "causal_logic", description: "Synthetic.", suggestion: "Track.", repair_scope: "structural" }],
        summary: "Passed with findings.",
      }), usage: { promptTokens: 4, completionTokens: 3, totalTokens: 7 } };
      const { createHash } = await import("node:crypto");
      await writeFile(legacyPath, `${JSON.stringify({
        schema_version: "1.0", job_id: "job", logical_step_id: legacyLogicalStepId,
        usage_identity: legacyLogicalStepId, chapter_number: 5, role: "reviser", stage: "RESCUE_REVISING_2",
        provider: "openrouter", requested_model: "provider/model", input_fingerprint: fingerprint,
        response_artifact_status: "COMPLETE", content_sha256: createHash("sha256").update(response.content).digest("hex"),
        response, completed_at: "2026-08-23T00:00:00.000Z",
      }, null, 2)}\n`, "utf-8");
      await writeFile(finalLegacyPath, `${JSON.stringify({
        schema_version: "1.0", job_id: "job", logical_step_id: finalLegacyLogicalStepId,
        usage_identity: finalLegacyLogicalStepId, chapter_number: 5, role: "logicAuditor", stage: "LOGIC_REVIEW",
        provider: "openrouter", requested_model: "provider/model", input_fingerprint: finalFingerprint,
        response_artifact_status: "COMPLETE", content_sha256: createHash("sha256").update(finalResponse.content).digest("hex"),
        response: finalResponse, completed_at: "2026-08-23T00:00:00.000Z",
      }, null, 2)}\n`, "utf-8");
      const unreferencedFingerprint = "d".repeat(64);
      const unreferencedPath = execution.responseArtifactPath(unreferencedFingerprint, "openrouter", "provider/model", 5);
      const unreferencedLogicalStepId = unreferencedPath.split(/[\\/]/).at(-1)!.replace(/\.json$/, "");
      const unreferencedContent = "=== REVISED_CONTENT ===\nUnreferenced next-cursor artifact.";
      await writeFile(unreferencedPath, `${JSON.stringify({
        schema_version: "1.0", job_id: "job", logical_step_id: unreferencedLogicalStepId,
        usage_identity: unreferencedLogicalStepId, chapter_number: 5, role: "reviser", stage: "RESCUE_REVISING_2",
        provider: "openrouter", requested_model: "provider/model", input_fingerprint: unreferencedFingerprint,
        response_artifact_status: "COMPLETE", content_sha256: createHash("sha256").update(unreferencedContent).digest("hex"),
        response: { content: unreferencedContent }, completed_at: "2026-08-23T00:00:00.000Z",
      }, null, 2)}\n`, "utf-8");
      const original = await readFile(legacyPath);
      const finalOriginal = await readFile(finalLegacyPath);
      const corrected = await correctLegacyPendingChapterArtifactBindings({ projectRoot: root, bookId: "book", jobId: "job", pendingChapterNumber: 4 });
      expect(corrected).toHaveLength(2);
      await expect(readFile(execution.responseArtifactBindingPath(unreferencedFingerprint, "openrouter", "provider/model", 4)))
        .rejects.toMatchObject({ code: "ENOENT" });
      const runtimeBeforeReplay = await readFile(join(runtimeDir, "production-state.json"));
      let transportCalls = 0;
      let modelCalls = 0;
      const replayed = await execution.runProviderCall(4, async () => {
        transportCalls += 1;
        modelCalls += 1;
        return { content: "must not run", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
      }, { provider: "openrouter", model: "provider/model", inputFingerprint: fingerprint });
      expect(replayed).toEqual(response);
      expect(transportCalls).toBe(0);
      expect(await readFile(legacyPath)).toEqual(original);
      const replayedFinal = await finalExecution.runProviderCall(4, async () => {
        transportCalls += 1;
        modelCalls += 1;
        return { content: "must not run", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
      }, { provider: "openrouter", model: "provider/model", inputFingerprint: finalFingerprint });
      expect(replayedFinal).toEqual(finalResponse);
      expect(transportCalls).toBe(0);
      expect(modelCalls).toBe(0);
      expect(await readFile(finalLegacyPath)).toEqual(finalOriginal);
      expect(await readFile(join(runtimeDir, "production-state.json"))).toEqual(runtimeBeforeReplay);
      const replayRuntime = JSON.parse(await readFile(join(runtimeDir, "production-state.json"), "utf-8"));
      expect(replayRuntime.providerAttemptHistory ?? []).toEqual([]);
      expect((replayRuntime.providerAttemptHistory ?? []).filter((attempt: { transportStarted?: boolean }) => attempt.transportStarted)).toHaveLength(0);
      const binding = JSON.parse(await readFile(execution.responseArtifactBindingPath(fingerprint, "openrouter", "provider/model", 4), "utf-8"));
      expect(binding).toMatchObject({
        chapter_number: 4,
        source_chapter_number: 5,
        source_logical_step_id: legacyLogicalStepId,
        source_artifact_sha256: createHash("sha256").update(original).digest("hex"),
      });
      expect(binding).not.toHaveProperty("response");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed when formal pending evidence references the wrong legacy role, stage, or response type", async () => {
    const cases = [
      { label: "wrong rescue role", role: "auditor", stage: "RESCUE_REVISING_2", content: "=== REVISED_CONTENT ===\nSynthetic rescue." },
      { label: "wrong rescue stage", role: "reviser", stage: "LOGIC_REVIEW", content: "=== REVISED_CONTENT ===\nSynthetic rescue." },
      { label: "non-audit final review", role: "logicAuditor", stage: "LOGIC_REVIEW", content: JSON.stringify({ passed: true, message: "not an audit result" }) },
      { label: "content SHA mismatch", role: "reviser", stage: "RESCUE_REVISING_2", content: "=== REVISED_CONTENT ===\nSynthetic rescue.", contentSha: "0".repeat(64), expectedError: "AUTONOMOUS_PROVIDER_RESPONSE_ARTIFACT_IDENTITY_MISMATCH" },
    ] as const;
    const { createHash } = await import("node:crypto");
    for (const [index, scenario] of cases.entries()) {
      const root = await mkdtemp(join(tmpdir(), `inkos-autonomous-invalid-binding-${index}-`));
      try {
        const runtimeDir = join(root, "books", "book", "story", "runtime", "bounded-autonomous");
        const responseDir = join(runtimeDir, "provider-responses");
        const evidenceDir = join(runtimeDir, "chapter-0004");
        await mkdir(responseDir, { recursive: true });
        await mkdir(evidenceDir, { recursive: true });
        await writeFile(join(runtimeDir, "production-state.json"), JSON.stringify({
          jobId: "job", status: "REVIEW_EXHAUSTED", mode: "current-volume", volumeId: "volume-002",
          startChapter: 4, targetChapter: 6, nextChapter: 5, chapterNumber: 5, completedThisRun: 0,
          responseArtifactStatus: "COMPLETE",
        }), "utf-8");
        const id = `provider-step-${String(index + 1).repeat(64)}`;
        await writeFile(join(evidenceDir, "resume-review.json"), JSON.stringify({
          schema_version: "1.0", chapter_number: 4, status: "REVIEW_EXHAUSTED", modelOutcomes: [{ modelCallId: id }],
        }), "utf-8");
        await writeFile(join(responseDir, `${id}.json`), JSON.stringify({
          schema_version: "1.0", job_id: "job", logical_step_id: id, usage_identity: id,
          chapter_number: 5, role: scenario.role, stage: scenario.stage,
          provider: "openrouter", requested_model: "provider/model", input_fingerprint: "e".repeat(64),
          response_artifact_status: "COMPLETE", content_sha256: "contentSha" in scenario ? scenario.contentSha : createHash("sha256").update(scenario.content).digest("hex"),
          response: { content: scenario.content }, completed_at: "2026-08-23T00:00:00.000Z",
        }), "utf-8");
        await expect(correctLegacyPendingChapterArtifactBindings({
          projectRoot: root, bookId: "book", jobId: "job", pendingChapterNumber: 4,
        }), scenario.label).rejects.toThrow("expectedError" in scenario ? scenario.expectedError : "AUTONOMOUS_PROVIDER_RESPONSE_ARTIFACT_SEMANTIC_MISMATCH");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
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
