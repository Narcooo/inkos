import { BaseAgent, type AgentContext } from "./base.js";
import type { ScoredReview, ReviewFinding } from "../pipeline/bounded-review.js";

const DIMENSIONS = [
  "opening_hook",
  "pacing_tension",
  "emotional_investment",
  "plot_clarity",
  "dialogue_appeal",
  "western_cultural_naturalness",
  "commercial_appeal",
  "ending_hook",
] as const;
const WEIGHTS: Readonly<Record<(typeof DIMENSIONS)[number], number>> = {
  opening_hook: 15,
  pacing_tension: 20,
  emotional_investment: 20,
  plot_clarity: 10,
  dialogue_appeal: 10,
  western_cultural_naturalness: 10,
  commercial_appeal: 10,
  ending_hook: 5,
};

function invalid(meta: { candidateSha: string; provider: string | null; model: string | null }): ScoredReview {
  return {
    reviewerRole: "commercial-reader",
    provider: meta.provider,
    model: meta.model,
    totalScore: 0,
    dimensionScores: {},
    decision: "INVALID_OUTPUT",
    findings: [{
      findingId: "commercial-reader-invalid-output",
      severity: "CRITICAL",
      evidence: "The commercial review response was empty or not valid JSON.",
      impact: "No independent reader judgement can be trusted.",
      requiredOutcome: "Return the complete review contract as JSON.",
    }],
    reviewedCandidateSha: meta.candidateSha,
    reviewedAt: new Date().toISOString(),
  };
}

export function parseCommercialReaderResponse(
  content: string,
  meta: { candidateSha: string; provider: string | null; model: string | null },
): ScoredReview {
  if (!content.trim()) return invalid(meta);
  try {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start < 0 || end <= start) return invalid(meta);
    const raw = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
    const reportedTotalScore = Number(raw.total_score);
    const rawDimensions = raw.dimension_scores as Record<string, unknown> | undefined;
    if (!Number.isFinite(reportedTotalScore) || reportedTotalScore < 0 || reportedTotalScore > 100 || !rawDimensions) return invalid(meta);
    const dimensionScores: Record<string, number> = {};
    for (const key of DIMENSIONS) {
      const score = Number(rawDimensions[key]);
      if (!Number.isFinite(score) || score < 0 || score > 100) return invalid(meta);
      dimensionScores[key] = score;
    }
    const totalScore = Math.round(DIMENSIONS.reduce(
      (sum, dimension) => sum + dimensionScores[dimension]! * WEIGHTS[dimension] / 100,
      0,
    ));
    const findings = Array.isArray(raw.findings)
      ? raw.findings.map((item, index): ReviewFinding => {
        const finding = item as Record<string, unknown>;
        const severity = finding.severity;
        if (severity !== "CRITICAL" && severity !== "MAJOR" && severity !== "MINOR" && severity !== "NOTE") {
          throw new Error("invalid severity");
        }
        return {
          findingId: String(finding.finding_id ?? `commercial-${index + 1}`),
          severity,
          evidence: String(finding.evidence ?? ""),
          impact: String(finding.impact ?? ""),
          requiredOutcome: String(finding.required_outcome ?? ""),
        };
      })
      : [];
    const decision = raw.decision;
    if (decision !== "APPROVED" && decision !== "APPROVED_WITH_NOTES" && decision !== "REVISION_REQUIRED" && decision !== "HELD") {
      return invalid(meta);
    }
    return {
      reviewerRole: "commercial-reader",
      provider: meta.provider,
      model: meta.model,
      totalScore: Math.round(totalScore),
      dimensionScores,
      decision,
      findings,
      reviewedCandidateSha: meta.candidateSha,
      reviewedAt: new Date().toISOString(),
    };
  } catch {
    return invalid(meta);
  }
}

export class CommercialReaderAgent extends BaseAgent {
  get name(): string {
    return "commercial-reader";
  }

  constructor(ctx: AgentContext) {
    super(ctx);
  }

  async reviewChapter(params: {
    readonly chapterNumber: number;
    readonly content: string;
    readonly candidateSha: string;
    readonly chapterIntent?: string;
  }): Promise<ScoredReview> {
    const response = await this.chat([
      {
        role: "system",
        content: `You are an independent commercial reader for English-language fiction. Do not alter canon or prose. Score only reader experience and return JSON with reviewer_role, total_score, dimension_scores, decision, and findings. Dimensions and weights: opening_hook 15, pacing_tension 20, emotional_investment 20, plot_clarity 10, dialogue_appeal 10, western_cultural_naturalness 10, commercial_appeal 10, ending_hook 5. Every finding requires finding_id, severity CRITICAL|MAJOR|MINOR|NOTE, evidence, impact, required_outcome. Empty, truncated, or wrong-chapter output is INVALID_OUTPUT.`,
      },
      {
        role: "user",
        content: `Review Chapter ${params.chapterNumber}.\n\nChapter intent:\n${params.chapterIntent ?? "(not supplied)"}\n\nCandidate:\n${params.content}`,
      },
    ], { temperature: 0.2 });
    const result = parseCommercialReaderResponse(response.content, {
      candidateSha: params.candidateSha,
      provider: this.ctx.client.service ?? this.ctx.client.provider,
      model: this.ctx.model,
    });
    return { ...result, tokenUsage: response.usage };
  }
}
