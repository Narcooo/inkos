import { describe, expect, it, vi } from "vitest";
import { runBoundedReviewCycle, scoredLogicReviewFromAudit, type ScoredReview } from "../pipeline/bounded-review.js";

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
  it("requires all seven logic dimensions and maps structural warnings to MAJOR", () => {
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
    expect(valid.findings[0]?.severity).toBe("MAJOR");
    const incomplete = scoredLogicReviewFromAudit({
      passed: true,
      overallScore: 95,
      dimensionScores: { causal_logic: 95 },
      issues: [],
      summary: "incomplete",
    }, { candidateSha: "sha", provider: "deepseek", model: "deepseek-chat" });
    expect(incomplete.decision).toBe("INVALID_OUTPUT");
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

  it("runs one normal and one rescue revision, then holds without a third", async () => {
    const logic = vi.fn()
      .mockResolvedValueOnce(review("logic-canon-auditor", 72, "MAJOR"))
      .mockResolvedValueOnce(review("logic-canon-auditor", 78, "MAJOR"))
      .mockResolvedValueOnce(review("logic-canon-auditor", 81, "MAJOR"));
    const commercial = vi.fn().mockResolvedValue(review("commercial-reader", 90));
    const revise = vi.fn()
      .mockResolvedValueOnce({ content: "revision one", tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
      .mockResolvedValueOnce({ content: "revision two", tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } });
    const result = await runBoundedReviewCycle({ initialContent: "draft", reviewLogic: logic, reviewCommercial: commercial, revise });
    expect(result.status).toBe("HELD_AFTER_TWO_REVISIONS");
    expect(result.revisionCount).toBe(2);
    expect(result.candidates.map((candidate) => candidate.label)).toEqual(["INITIAL", "REVISION_1", "REVISION_2"]);
    expect(revise).toHaveBeenCalledTimes(2);
    expect(logic).toHaveBeenCalledTimes(3);
    expect(commercial).toHaveBeenCalledTimes(1);
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
