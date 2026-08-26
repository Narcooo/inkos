import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAutonomousProviderExecution } from "@actalk/inkos-core";
import { AUTONOMOUS_BUDGET_NOT_CONFIGURED, AutonomousJobRegistry, classifyStateRepairError, projectAutonomousProductionView, verifyOfflineFinalizationEvidence } from "./autonomous-production.js";

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

const catalog = [
  { id: "gpt", name: "GPT", contextWindow: 128_000, maxOutputTokens: 16_000, inputPrice: "0.000001", outputPrice: "0.000004", inputModalities: ["text"], outputModalities: ["text"] },
  { id: "deepseek", name: "DeepSeek", contextWindow: 128_000, maxOutputTokens: 16_000, inputPrice: "0.0000005", outputPrice: "0.000002", inputModalities: ["text"], outputModalities: ["text"] },
  { id: "gemini", name: "Gemini", contextWindow: 128_000, maxOutputTokens: 16_000, inputPrice: "0.0000004", outputPrice: "0.0000015", inputModalities: ["text"], outputModalities: ["text"] },
  { id: "flash", name: "Flash", contextWindow: 128_000, maxOutputTokens: 16_000, inputPrice: "0.0000002", outputPrice: "0.000001", inputModalities: ["text"], outputModalities: ["text"] },
];

describe("autonomous production Studio projection", () => {
  it("verifies preserved rescue and passed final-review artifacts without changing them", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-offline-finalization-view-"));
    const bookDir = join(root, "books", "book");
    const responseDir = join(bookDir, "story", "runtime", "bounded-autonomous", "provider-responses");
    const evidenceDir = join(bookDir, "story", "runtime", "bounded-autonomous", "chapter-0004");
    await mkdir(responseDir, { recursive: true });
    await mkdir(evidenceDir, { recursive: true });
    const dimensions = { blueprint_transition: 95, causal_logic: 90, canon_continuity: 92, character_motivation: 95, state_inheritance: 95, hooks_disclosure: 95, narrative_clarity: 93 };
    const sourceExecution = createAutonomousProviderExecution({
      projectRoot: root, bookId: "book", jobId: "job",
      getActiveStage: () => ({ role: "reviser", stage: "RESCUE_REVISING_2", provider: "openrouter", model: "model" }),
    });
    const fingerprints = ["a".repeat(64), "b".repeat(64)] as const;
    const responses = [
      [sourceExecution.responseArtifactPath(fingerprints[0], "openrouter", "model", 5).split(/[\\/]/).at(-1)!.replace(/\.json$/u, ""), "reviser", "RESCUE_REVISING_2", "=== REVISED_CONTENT ===\nSynthetic Chapter 004 rescue.", fingerprints[0]],
      [sourceExecution.responseArtifactPath(fingerprints[1], "openrouter", "model", 5).split(/[\\/]/).at(-1)!.replace(/\.json$/u, ""), "reviser", "RESCUE_REVISING_2", JSON.stringify({ passed: true, overall_score: 92, dimension_scores: dimensions, issues: [{ severity: "warning", category: "causal_logic", description: "synthetic", suggestion: "defer", repair_scope: "structural" }], summary: "pass" }), fingerprints[1]],
    ] as const;
    try {
      await writeFile(join(bookDir, "story", "runtime", "bounded-autonomous", "production-state.json"), JSON.stringify({
        jobId: "job", status: "REVIEW_EXHAUSTED", nextChapter: 5, chapterNumber: 5, responseArtifactStatus: "COMPLETE",
      }));
      await writeFile(join(evidenceDir, "resume-review.json"), JSON.stringify({ chapter_number: 4, status: "REVIEW_EXHAUSTED", modelOutcomes: responses.map(([modelCallId]) => ({ modelCallId })) }));
      for (const [id, role, stage, content, fingerprint] of responses) {
        await writeFile(join(responseDir, `${id}.json`), JSON.stringify({
          schema_version: "1.0", job_id: "job", logical_step_id: id, usage_identity: id,
          chapter_number: 5, role, stage, provider: "openrouter", requested_model: "model",
          input_fingerprint: fingerprint, response_artifact_status: "COMPLETE",
          content_sha256: createHash("sha256").update(content).digest("hex"), response: { content }, completed_at: "now",
        }));
      }
      const runtime = { jobId: "job", status: "REVIEW_EXHAUSTED", mode: "current-volume", nextChapter: 5, updatedAt: "now", phase: "RESCUE_REVISING_2", responseArtifactStatus: "COMPLETE" } as const;
      const verified = await verifyOfflineFinalizationEvidence({
        projectRoot: root, bookId: "book", pendingChapter: 4, nextChapter: 5,
        runtime,
      });
      expect(verified).toBe(true);
      const view = projectAutonomousProductionView({
        map, targetChapters: 156, nextChapter: 5,
        chapters: [1, 2, 3, 4].map((number) => ({ number, status: number === 4 ? "audit-failed" as const : "approved" as const })),
        config: { defaultModel: "gpt", modelOverrides: { auditor: "deepseek", "commercial-reader": "gemini", reviser: "gpt", "observer-reflector": "flash" } },
        catalog, runtime, offlineFinalizationVerified: verified, active: false, budget: AUTONOMOUS_BUDGET_NOT_CONFIGURED,
      });
      expect(view.runtimeBlockers).not.toContain("REVIEW_EXHAUSTED");
      expect(view.runtimeStatus).toBe("RECOVERY_READY_OFFLINE_FINALIZATION");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects offline finalization evidence when a referenced rescue has the wrong role or stage", async () => {
    const dimensions = { blueprint_transition: 95, causal_logic: 90, canon_continuity: 92, character_motivation: 95, state_inheritance: 95, hooks_disclosure: 95, narrative_clarity: 93 };
    for (const [index, identity] of [
      { role: "auditor", stage: "RESCUE_REVISING_2" },
      { role: "reviser", stage: "LOGIC_REVIEW" },
    ].entries()) {
      const root = await mkdtemp(join(tmpdir(), `inkos-offline-finalization-wrong-identity-${index}-`));
      const bookDir = join(root, "books", "book");
      const responseDir = join(bookDir, "story", "runtime", "bounded-autonomous", "provider-responses");
      const evidenceDir = join(bookDir, "story", "runtime", "bounded-autonomous", "chapter-0004");
      const rescueId = "provider-step-" + String(index + 1).repeat(64);
      const finalId = "provider-step-" + String(index + 3).repeat(64);
      const rescueContent = "=== REVISED_CONTENT ===\nSynthetic Chapter 004 rescue.";
      const finalContent = JSON.stringify({
        passed: true,
        overall_score: 92,
        dimension_scores: dimensions,
        issues: [{ severity: "warning", category: "causal_logic", description: "synthetic", suggestion: "track", repair_scope: "structural" }],
        summary: "pass",
      });
      try {
        await mkdir(responseDir, { recursive: true });
        await mkdir(evidenceDir, { recursive: true });
        await writeFile(join(bookDir, "story", "runtime", "bounded-autonomous", "production-state.json"), JSON.stringify({
          jobId: "job", status: "REVIEW_EXHAUSTED", nextChapter: 5, chapterNumber: 5, responseArtifactStatus: "COMPLETE",
        }));
        await writeFile(join(evidenceDir, "resume-review.json"), JSON.stringify({
          chapter_number: 4, status: "REVIEW_EXHAUSTED", modelOutcomes: [{ modelCallId: rescueId }, { modelCallId: finalId }],
        }));
        for (const artifact of [
          { id: rescueId, role: identity.role, stage: identity.stage, content: rescueContent },
          { id: finalId, role: "logicAuditor", stage: "LOGIC_REVIEW", content: finalContent },
        ]) {
          await writeFile(join(responseDir, `${artifact.id}.json`), JSON.stringify({
            schema_version: "1.0", job_id: "job", logical_step_id: artifact.id, usage_identity: artifact.id,
            chapter_number: 5, role: artifact.role, stage: artifact.stage, provider: "openrouter", requested_model: "model",
            input_fingerprint: "c".repeat(64), response_artifact_status: "COMPLETE",
            content_sha256: createHash("sha256").update(artifact.content).digest("hex"), response: { content: artifact.content }, completed_at: "now",
          }));
        }
        const runtime = { jobId: "job", status: "REVIEW_EXHAUSTED", mode: "current-volume", nextChapter: 5, updatedAt: "now", phase: "RESCUE_REVISING_2", responseArtifactStatus: "COMPLETE" } as const;
        const verified = await verifyOfflineFinalizationEvidence({
          projectRoot: root, bookId: "book", pendingChapter: 4, nextChapter: 5,
          runtime,
        });
        expect(verified).toBe(false);
        const view = projectAutonomousProductionView({
          map, targetChapters: 156, nextChapter: 5,
          chapters: [1, 2, 3, 4].map((number) => ({ number, status: number === 4 ? "audit-failed" as const : "approved" as const })),
          config: { defaultModel: "gpt", modelOverrides: { auditor: "deepseek", "commercial-reader": "gemini", reviser: "gpt", "observer-reflector": "flash" } },
          catalog, runtime, offlineFinalizationVerified: verified, active: false, budget: AUTONOMOUS_BUDGET_NOT_CONFIGURED,
        });
        expect(view.runtimeBlockers).toContain("REVIEW_EXHAUSTED");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });
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
      budget: AUTONOMOUS_BUDGET_NOT_CONFIGURED,
    });
    expect(view.currentVolume).toMatchObject({ volumeId: "volume-001", startChapter: 1, endChapter: 38 });
    expect(view.completedChapters).toBe(4);
    expect(view.budget).toEqual({ status: "BUDGET_NOT_CONFIGURED" });
    expect(view.economics.actual.costStatus).toBe("COST_UNAVAILABLE");
    expect(view.runtimeBlockers).not.toContain("COST_GUARD_UNAVAILABLE");
    expect(view.startEnabled).toBe(true);
  });

  it("keeps unavailable forecast truthful without turning it into an admission blocker", () => {
    const view = projectAutonomousProductionView({
      map,
      targetChapters: 156,
      nextChapter: 5,
      chapters: [1, 2, 3, 4].map((number) => ({ number, status: "ready-for-review", tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 } })),
      config: { defaultModel: "gpt", modelOverrides: { auditor: "deepseek", "commercial-reader": "gemini", reviser: "gpt", "observer-reflector": "flash" } },
      runtime: null,
      active: false,
      budget: AUTONOMOUS_BUDGET_NOT_CONFIGURED,
    });
    expect(view.runtimeBlockers).not.toContain("COST_GUARD_UNAVAILABLE");
    expect(view.economics.budget.guardStatus).toBe("COST_UNAVAILABLE");
    expect(view.economics.budget.status).toBe("BUDGET_NOT_CONFIGURED");
    expect(view.startEnabled).toBe(true);
  });

  it("binds catalog pricing to legacy tokens and projects all required conservative estimates", () => {
    const view = projectAutonomousProductionView({
      map,
      targetChapters: 156,
      nextChapter: 5,
      chapters: [1, 2, 3, 4].map((number) => ({ number, status: number === 4 ? "state-degraded" : "approved", tokenUsage: { promptTokens: 1_000, completionTokens: 2_000, totalTokens: 3_000 } })),
      config: { defaultModel: "gpt", modelOverrides: { auditor: "deepseek", "commercial-reader": "gemini", reviser: "gpt", "observer-reflector": "flash" } },
      catalog,
      runtime: null,
      active: false,
      budget: AUTONOMOUS_BUDGET_NOT_CONFIGURED,
    });

    expect(Object.values(view.rolePricing).every((entry) => entry.status === "VERIFIED_IN_CURRENT_CATALOG")).toBe(true);
    expect(view.economics.actual).toMatchObject({ costUsd: null, costStatus: "CALCULATED_ESTIMATE" });
    expect(view.economics.historicalCalculatedEstimateUsd).toBeGreaterThan(0);
    expect(view.economics.remainingVolumeForecast.highUsd).toBeGreaterThan(0);
    expect(view.economics.currentVolumeEstimatedTotal.highUsd!).toBeGreaterThan(view.economics.remainingVolumeForecast.highUsd!);
    expect(view.economics.fullBookForecast.highUsd!).toBeGreaterThan(view.economics.currentVolumeEstimatedTotal.highUsd!);
    expect(view.economics.repairForecast.highUsd).toBeCloseTo(0.4288, 10);
    expect(view.runtimeBlockers).not.toContain("COST_GUARD_UNAVAILABLE");
    expect(view.runtimeBlockers).toContain("PENDING_STATE_REPAIR_CHAPTER_4");
  });

  it("projects repaired state with its original audit failure truthfully instead of offering another repair", () => {
    const view = projectAutonomousProductionView({
      map,
      targetChapters: 156,
      nextChapter: 5,
      chapters: [1, 2, 3, 4].map((number) => ({ number, status: number === 4 ? "audit-failed" : "approved", tokenUsage: { promptTokens: 1_000, completionTokens: 2_000, totalTokens: 3_000 } })),
      config: { defaultModel: "gpt", modelOverrides: { auditor: "deepseek", "commercial-reader": "gemini", reviser: "gpt", "observer-reflector": "flash" } },
      catalog,
      runtime: { status: "READY", mode: "current-volume", nextChapter: 5, updatedAt: "2026-08-21T08:35:53.107Z", repairOutcome: { chapter: 4, status: "STATE_REPAIRED_REVIEW_STILL_REQUIRED", errorCode: null } },
      active: false,
      budget: AUTONOMOUS_BUDGET_NOT_CONFIGURED,
    });
    expect(view.repairOutcome).toEqual({ chapter: 4, status: "STATE_REPAIRED_REVIEW_STILL_REQUIRED", errorCode: null });
    expect(view.runtimeBlockers).not.toContain("PENDING_STATE_REPAIR_CHAPTER_4");
    expect(view.runtimeBlockers).not.toContain("PENDING_CHAPTER_REVIEW_4");
    expect(view.chapterAttention).toEqual({ chapter: 4, status: "AUDIT_FAILED_STATE_SETTLED" });
    expect(view.startEnabled).toBe(true);
  });

  it("fails closed for repair when catalog context capacity is unavailable", () => {
    const view = projectAutonomousProductionView({
      map,
      targetChapters: 156,
      nextChapter: 5,
      chapters: [1, 2, 3, 4].map((number) => ({ number, status: number === 4 ? "state-degraded" : "approved", tokenUsage: { promptTokens: 1_000, completionTokens: 2_000, totalTokens: 3_000 } })),
      config: { defaultModel: "gpt", modelOverrides: { auditor: "deepseek", "commercial-reader": "gemini", reviser: "gpt", "observer-reflector": "flash" } },
      catalog: catalog.map((entry) => ({ ...entry, contextWindow: 0 })),
      runtime: null,
      active: false,
      budget: AUTONOMOUS_BUDGET_NOT_CONFIGURED,
    });

    expect(view.economics.repairForecast.highUsd).toBeNull();
    expect(view.startEnabled).toBe(false);
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
      budget: AUTONOMOUS_BUDGET_NOT_CONFIGURED,
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
      config: { defaultModel: "gpt", modelOverrides: { auditor: "deepseek", "commercial-reader": "gemini", reviser: "gpt", "observer-reflector": "flash" } },
      runtime: { status: "RUNNING", mode: "full-book", nextChapter: 39, updatedAt: "2026-08-21T00:00:00.000Z" },
      active: true,
      budget: AUTONOMOUS_BUDGET_NOT_CONFIGURED,
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

  it("classifies persisted repair failures without replacing the real message", () => {
    expect(classifyStateRepairError("Cannot repair chapter 4 safely: baseline snapshot 3 is unavailable")).toBe("STATE_REPAIR_BASELINE_UNAVAILABLE");
    expect(classifyStateRepairError("State repair still failed for chapter 4.")).toBe("STATE_REPAIR_VALIDATION_FAILED");
    expect(classifyStateRepairError("provider rejected request")).toBe("STATE_REPAIR_FAILED");
  });

  it("projects a persisted RUNNING state as resumable PAUSED after Studio restart", () => {
    const view = projectAutonomousProductionView({
      map,
      targetChapters: 156,
      nextChapter: 39,
      chapters: Array.from({ length: 38 }, (_, index) => ({ number: index + 1, status: "ready-for-review" })),
      config: { defaultModel: "gpt", modelOverrides: { auditor: "deepseek", "commercial-reader": "gemini", reviser: "gpt", "observer-reflector": "flash" } },
      runtime: { status: "RUNNING", mode: "full-book", nextChapter: 39, updatedAt: "2026-08-21T00:00:00.000Z" },
      active: false,
      budget: AUTONOMOUS_BUDGET_NOT_CONFIGURED,
    });
    expect(view.runtimeStatus).toBe("PAUSED");
    expect(view.startEnabled).toBe(true);
    expect(view.runtimeBlockers).not.toContain("COST_GUARD_UNAVAILABLE");
  });

  it("keeps a durable Provider wait non-resumable by the user while automatic recovery owns it", () => {
    const view = projectAutonomousProductionView({
      map,
      targetChapters: 156,
      nextChapter: 5,
      chapters: [1, 2, 3, 4].map((number) => ({ number, status: number === 4 ? "audit-failed" : "approved" })),
      config: { defaultModel: "gpt", modelOverrides: { auditor: "deepseek", "commercial-reader": "gemini", reviser: "gpt", "observer-reflector": "flash" } },
      catalog,
      runtime: {
        jobId: "autonomous-waiting", status: "WAITING_PROVIDER_RETRY", mode: "current-volume", nextChapter: 5,
        updatedAt: "2026-08-23T00:00:00.000Z", nextRetryAt: "2026-08-23T00:05:00.000Z",
        attempt: 1, maxAttempts: 3, phase: "LOGIC_REVIEW",
      },
      active: true,
      budget: AUTONOMOUS_BUDGET_NOT_CONFIGURED,
    });
    expect(view.runtimeStatus).toBe("WAITING_PROVIDER_RETRY");
    expect(view.startEnabled).toBe(false);
    expect(view.runtimeBlockers).not.toContain("COST_GUARD_UNAVAILABLE");
  });

  it("projects legacy two-revision exhaustion with a complete rescue artifact as final-review recovery", () => {
    const view = projectAutonomousProductionView({
      map,
      targetChapters: 156,
      nextChapter: 5,
      chapters: [1, 2, 3, 4].map((number) => ({ number, status: number === 4 ? "audit-failed" : "approved" })),
      config: { defaultModel: "gpt", modelOverrides: { auditor: "deepseek", "commercial-reader": "gemini", reviser: "gpt", "observer-reflector": "flash" } },
      catalog,
      runtime: { jobId: "autonomous-deadbeef", status: "REVIEW_EXHAUSTED", mode: "current-volume", nextChapter: 5, updatedAt: "2026-08-21T00:00:00.000Z", phase: "RESCUE_REVISING_2", responseArtifactStatus: "COMPLETE" },
      offlineFinalizationVerified: true,
      active: false,
      budget: AUTONOMOUS_BUDGET_NOT_CONFIGURED,
    });
    expect(view.runtimeBlockers).not.toContain("REVIEW_EXHAUSTED");
    expect(view.startEnabled).toBe(true);
    expect(view.runtimeStatus).toBe("RECOVERY_READY_OFFLINE_FINALIZATION");
    expect(view.finalReviewRecovery).toEqual({
      chapter: 4,
      rescueCandidate: "PRESERVED",
      rescueGeneration: "REUSED",
      writerRegeneration: false,
      normalRevisionRegeneration: false,
      rescueRevisionRegeneration: false,
      rescueArtifactIdentity: "VERIFIED_CHAPTER_004",
      finalReview: "PRESERVED",
      finalReviewDecision: "PASSED_WITH_NONBLOCKING_FINDINGS",
      nextAction: "FINALIZE_CHAPTER_004_AND_CONTINUE",
      additionalWriterCalls: 0,
      additionalReviserCalls: 0,
      additionalReviewerCalls: 0,
      additionalRevisionAllowed: false,
    });
  });

  it("keeps a contradictory review decision fail-closed", () => {
    const view = projectAutonomousProductionView({
      map,
      targetChapters: 156,
      nextChapter: 5,
      chapters: [1, 2, 3, 4].map((number) => ({ number, status: number === 4 ? "audit-failed" : "approved" })),
      config: { defaultModel: "gpt", modelOverrides: { auditor: "deepseek", "commercial-reader": "gemini", reviser: "gpt", "observer-reflector": "flash" } },
      catalog,
      runtime: { jobId: "autonomous-contradictory", status: "REVIEW_DECISION_CONTRADICTORY", mode: "current-volume", nextChapter: 5, updatedAt: "2026-08-21T00:00:00.000Z" },
      active: false,
      budget: AUTONOMOUS_BUDGET_NOT_CONFIGURED,
    });
    expect(view.startEnabled).toBe(false);
    expect(view.runtimeBlockers).toContain("REVIEW_DECISION_CONTRADICTORY");
  });
});
