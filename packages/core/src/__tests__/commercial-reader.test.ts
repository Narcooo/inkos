import { describe, expect, it } from "vitest";
import { parseCommercialReaderResponse } from "../agents/commercial-reader.js";

describe("commercial reader", () => {
  it("parses a fully scored review and binds its candidate", () => {
    const result = parseCommercialReaderResponse(JSON.stringify({
      reviewer_role: "commercial-reader",
      total_score: 10,
      dimension_scores: {
        opening_hook: 90,
        pacing_tension: 88,
        emotional_investment: 90,
        plot_clarity: 89,
        dialogue_appeal: 88,
        western_cultural_naturalness: 86,
        commercial_appeal: 90,
        ending_hook: 91,
      },
      decision: "APPROVED",
      findings: [],
    }), { candidateSha: "abc", provider: "google", model: "gemini" });
    expect(result.totalScore).toBe(89);
    expect(result.reviewedCandidateSha).toBe("abc");
    expect(result.decision).toBe("APPROVED");
  });

  it("classifies empty and malformed output as INVALID_OUTPUT", () => {
    expect(parseCommercialReaderResponse("", { candidateSha: "abc", provider: null, model: null }).decision).toBe("INVALID_OUTPUT");
    expect(parseCommercialReaderResponse("not-json", { candidateSha: "abc", provider: null, model: null }).decision).toBe("INVALID_OUTPUT");
  });
});
