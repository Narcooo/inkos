import { describe, expect, it, vi } from "vitest";
import { classifyFinalAuditDecision, runBoundedReviewCycle, scoredLogicReviewFromAudit, type ScoredReview } from "../pipeline/bounded-review.js";

function review(role: "logic-canon-auditor" | "commercial-reader", score: number, severity?: "CRITICAL" | "MAJOR" | "MINOR" | "NOTE"): ScoredReview {
  return {
    reviewerRole: role,
    provider: role === "logic-canon-auditor" ? "deepseek" : "google",
    model: role === "logic-canon-auditor" ? "deepseek-chat" : "gemini-flash",
    totalScore: score,
    dimensionScores: { one: score, two: score },
    decision: score >= 85 && !severity ? "APPROVED" : "REVISION_REQUIRED",
    findings: severity ? [{ findingId: `${role}-1`, severity, evidence: "synthetic", impact: "synthetic", requiredOutcome: "fix" }] : [],
    reviewedCandidateSha: "bound-by-runner",
    reviewedAt: "2026-08-21T00:00:00.000Z",
    tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  };
}

describe("bounded autonomous chapter review", () => {
  it("requires all seven logic dimensions without promoting a structural warning to MAJOR", () => {
    const valid = scoredLogicReviewFromAudit({
      passed: false,
      overallScore: 10,
      dimensionScores: {
        blueprint_transition: 82,
        causal_logic: 82,
        canon_continuity: 82,
        character_motivation: 82,
        state_inheritance: 82,
        hooks_disclosure: 82,
        narrative_clarity: 82,
      },
      issues: [{ severity: "warning", category: "logic", description: "synthetic", suggestion: "fix", repairScope: "structural" }],
      summary: "review",
    }, { candidateSha: "sha", provider: "deepseek", model: "deepseek-chat" });
    expect(valid.totalScore).toBe(82);
    expect(valid.findings[0]?.severity).toBe("MINOR");
    const incomplete = scoredLogicReviewFromAudit({
      passed: true,
      overallScore: 95,
      dimensionScores: { causal_logic: 95 },
      issues: [],
      summary: "incomplete",
    }, { candidateSha: "sha", provider: "deepseek", model: "deepseek-chat" });
    expect(incomplete.decision).toBe("INVALID_OUTPUT");
  });

  it("accepts a passed final review with score 92 and only nonblocking warning/info findings", () => {
    const result = classifyFinalAuditDecision({
      passed: true,
      overallScore: 92,
      dimensionScores: {
        blueprint_transition: 95,
        causal_logic: 90,
        canon_continuity: 92,
        character_motivation: 95,
        state_inheritance: 95,
        hooks_disclosure: 95,
        narrative_clarity: 93,
      },
      issues: [
        { severity: "warning", category: "causal_logic", description: "synthetic", suggestion: "defer", repairScope: "structural" },
        { severity: "info", category: "canon_continuity", description: "synthetic", suggestion: "track", repairScope: "local" },
      ],
      summary: "passed with findings",
    });
    expect(result).toBe("ACCEPTED_WITH_FINDINGS");
  });

  it("distinguishes explicit blockers, contradictory passes, and hard-dimension failures", () => {
    const dimensions = {
      blueprint_transition: 95,
      causal_logic: 90,
      canon_continuity: 92,
      character_motivation: 95,
      state_inheritance: 95,
      hooks_disclosure: 95,
      narrative_clarity: 93,
    };
    expect(classifyFinalAuditDecision({
      passed: false, overallScore: 70, dimensionScores: dimensions,
      issues: [{ severity: "warning", explicitSeverity: "MAJOR", category: "logic", description: "synthetic", suggestion: "fix" }], summary: "fail",
    })).toBe("BLOCKED_CRITICAL_FINDINGS");
    expect(classifyFinalAuditDecision({
      passed: false, overallScore: 70, dimensionScores: dimensions,
      issues: [{ severity: "warning", blocking: true, category: "logic", description: "synthetic", suggestion: "fix" }], summary: "fail",
    })).toBe("BLOCKED_CRITICAL_FINDINGS");
    expect(classifyFinalAuditDecision({
      passed: true, overallScore: 92, dimensionScores: dimensions,
      issues: [{ severity: "warning", blocking: true, category: "logic", description: "synthetic", suggestion: "fix" }], summary: "contradiction",
    })).toBe("REVIEW_DECISION_CONTRADICTORY");
    expect(classifyFinalAuditDecision({
      passed: false, overallScore: 88, dimensionScores: { ...dimensions, causal_logic: 79 }, issues: [], summary: "hard fail",
    })).toBe("BLOCKED_CRITICAL_FINDINGS");
    expect(classifyFinalAuditDecision({
      passed: true, overallScore: 92, dimensionScores: { ...dimensions, structural_integrity: 79 }, issues: [], summary: "contradictory structural pass",
    })).toBe("REVIEW_DECISION_CONTRADICTORY");
  });

  it("accepts A/B candidates without revision", async () => {
    const revise = vi.fn();
    const stages: string[] = [];
    const result = await runBoundedReviewCycle({
      initialContent: "draft",
      reviewLogic: vi.fn().mockResolvedValue(review("logic-canon-auditor", 92)),
      reviewCommercial: vi.fn().mockResolvedValue(review("commercial-reader", 86)),
      revise,
      onStage: async (stage) => { stages.push(stage); },
    });
    expect(result.status).toBe("APPROVED");
    expect(result.grade).toBe("B");
    expect(result.revisionCount).toBe(0);
    expect(revise).not.toHaveBeenCalled();
    expect(stages).toEqual(["LOGIC_REVIEW", "READER_REVIEW"]);
  });

  it("runs one normal and one rescue revision, then blocks critical findings without a third", async () => {
    const logic = vi.fn()
      .mockResolvedValueOnce(review("logic-canon-auditor", 72, "MAJOR"))
      .mockResolvedValueOnce(review("logic-canon-auditor", 78, "MAJOR"))
      .mockResolvedValueOnce(review("logic-canon-auditor", 81, "MAJOR"));
    const commercial = vi.fn().mockResolvedValue(review("commercial-reader", 90));
    const revise = vi.fn()
      .mockResolvedValueOnce({ content: "revision one", tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
      .mockResolvedValueOnce({ content: "revision two", tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } });
    const result = await runBoundedReviewCycle({ initialContent: "draft", reviewLogic: logic, reviewCommercial: commercial, revise });
    expect(result.status).toBe("BLOCKED_CRITICAL_FINDINGS");
    expect(result.revisionCount).toBe(2);
    expect(result.candidates.map((candidate) => candidate.label)).toEqual(["INITIAL", "REVISION_1", "REVISION_2"]);
    expect(revise).toHaveBeenCalledTimes(2);
    expect(logic).toHaveBeenCalledTimes(3);
    expect(commercial).toHaveBeenCalledTimes(1);
  });

  it("accepts only noncritical findings after the final rescue review without a third revision", async () => {
    const logic = vi.fn()
      .mockResolvedValueOnce(review("logic-canon-auditor", 72, "MINOR"))
      .mockResolvedValueOnce(review("logic-canon-auditor", 78, "MINOR"))
      .mockResolvedValueOnce(review("logic-canon-auditor", 81, "MINOR"));
    const revise = vi.fn()
      .mockResolvedValueOnce({ content: "revision one" })
      .mockResolvedValueOnce({ content: "revision two" });
    const result = await runBoundedReviewCycle({
      initialContent: "draft",
      reviewLogic: logic,
      reviewCommercial: vi.fn().mockResolvedValue(review("commercial-reader", 90)),
      revise,
    });
    expect(result.status).toBe("ACCEPTED_WITH_FINDINGS");
    expect(result.finalContent).toBe("revision two");
    expect(result.revisionCount).toBe(2);
    expect(revise).toHaveBeenCalledTimes(2);
  });

  it("re-reviews both roles when both supplied findings", async () => {
    const logic = vi.fn()
      .mockResolvedValueOnce(review("logic-canon-auditor", 80, "MAJOR"))
      .mockResolvedValueOnce(review("logic-canon-auditor", 92));
    const commercial = vi.fn()
      .mockResolvedValueOnce(review("commercial-reader", 80, "MINOR"))
      .mockResolvedValueOnce(review("commercial-reader", 90));
    const result = await runBoundedReviewCycle({
      initialContent: "draft",
      reviewLogic: logic,
      reviewCommercial: commercial,
      revise: vi.fn().mockResolvedValue({ content: "fixed", tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }),
    });
    expect(result.status).toBe("APPROVED");
    expect(result.revisionCount).toBe(1);
    expect(logic).toHaveBeenCalledTimes(2);
    expect(commercial).toHaveBeenCalledTimes(2);
  });

  it("holds authority blockers without revision", async () => {
    const revise = vi.fn();
    const result = await runBoundedReviewCycle({
      initialContent: "draft",
      reviewLogic: vi.fn().mockResolvedValue({ ...review("logic-canon-auditor", 40, "CRITICAL"), authorityBlocker: true }),
      reviewCommercial: vi.fn().mockResolvedValue(review("commercial-reader", 90)),
      revise,
    });
    expect(result.status).toBe("HELD_AFTER_TWO_REVISIONS");
    expect(result.holdReason).toBe("AUTHORITY_BLOCKER");
    expect(revise).not.toHaveBeenCalled();
  });
});
