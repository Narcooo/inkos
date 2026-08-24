import { createHash } from "node:crypto";
import type { AuditResult } from "../agents/continuity.js";

export type ReviewSeverity = "CRITICAL" | "MAJOR" | "MINOR" | "NOTE";
export type ReviewerRole = "logic-canon-auditor" | "commercial-reader";
const LOGIC_DIMENSIONS = [
  "blueprint_transition",
  "causal_logic",
  "canon_continuity",
  "character_motivation",
  "state_inheritance",
  "hooks_disclosure",
  "narrative_clarity",
] as const;
const LOGIC_WEIGHTS: Readonly<Record<(typeof LOGIC_DIMENSIONS)[number], number>> = {
  blueprint_transition: 20,
  causal_logic: 20,
  canon_continuity: 20,
  character_motivation: 15,
  state_inheritance: 10,
  hooks_disclosure: 10,
  narrative_clarity: 5,
};
const HARD_LOGIC_DIMENSIONS = LOGIC_DIMENSIONS.filter((dimension) => dimension !== "narrative_clarity");
const OPTIONAL_HARD_LOGIC_DIMENSIONS = ["structural_integrity"] as const;
const HARD_LOGIC_DIMENSION_MINIMUM = 80;

export type FinalAuditDecision = "APPROVED" | "ACCEPTED_WITH_FINDINGS" | "BLOCKED_CRITICAL_FINDINGS" | "REVIEW_DECISION_CONTRADICTORY";

export function classifyFinalAuditDecision(audit: AuditResult): FinalAuditDecision {
  const explicitBlocking = audit.issues.some((issue) => issue.blocking === true
    || issue.severity === "critical" || issue.explicitSeverity === "CRITICAL" || issue.explicitSeverity === "MAJOR");
  const hardDimensionFailed = audit.dimensionScores !== undefined && HARD_LOGIC_DIMENSIONS.some((dimension) => {
    const score = audit.dimensionScores?.[dimension];
    return typeof score !== "number" || score < HARD_LOGIC_DIMENSION_MINIMUM;
  }) || OPTIONAL_HARD_LOGIC_DIMENSIONS.some((dimension) => {
    const score = audit.dimensionScores?.[dimension];
    return score !== undefined && (typeof score !== "number" || score < HARD_LOGIC_DIMENSION_MINIMUM);
  });
  const blocking = explicitBlocking || hardDimensionFailed || audit.passed !== true;
  if (audit.passed === true && (explicitBlocking || hardDimensionFailed)) return "REVIEW_DECISION_CONTRADICTORY";
  if (blocking) return "BLOCKED_CRITICAL_FINDINGS";
  return audit.issues.length > 0 ? "ACCEPTED_WITH_FINDINGS" : "APPROVED";
}

export interface RoleTokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly actualCostUsd?: number;
}

export interface ReviewFinding {
  readonly findingId: string;
  readonly severity: ReviewSeverity;
  readonly evidence: string;
  readonly impact: string;
  readonly requiredOutcome: string;
}

export interface ScoredReview {
  readonly reviewerRole: ReviewerRole;
  readonly provider: string | null;
  readonly model: string | null;
  readonly totalScore: number;
  readonly dimensionScores: Readonly<Record<string, number>>;
  readonly decision: "APPROVED" | "APPROVED_WITH_NOTES" | "REVISION_REQUIRED" | "HELD" | "INVALID_OUTPUT";
  readonly findings: ReadonlyArray<ReviewFinding>;
  readonly reviewedCandidateSha: string;
  readonly reviewedAt: string;
  readonly tokenUsage?: RoleTokenUsage;
  readonly authorityBlocker?: boolean;
}

export interface BoundedCandidate {
  readonly label: "INITIAL" | "REVISION_1" | "REVISION_2";
  readonly content: string;
  readonly sha256: string;
  readonly reviews: ReadonlyArray<ScoredReview>;
  readonly combinedScore: number;
}

export interface BoundedReviewResult {
  readonly status: "APPROVED" | "ACCEPTED_WITH_FINDINGS" | "BLOCKED_CRITICAL_FINDINGS" | "HELD_AFTER_TWO_REVISIONS";
  readonly grade: "A" | "B" | "C" | "D" | "E";
  readonly finalContent: string;
  readonly revisionCount: 0 | 1 | 2;
  readonly candidates: ReadonlyArray<BoundedCandidate>;
  readonly bestCandidate: BoundedCandidate;
  readonly holdReason?: "AUTHORITY_BLOCKER" | "INVALID_OUTPUT" | "REVISION_LIMIT_REACHED";
  readonly usageByRole: Readonly<Record<string, RoleTokenUsage>>;
}

export function scoredLogicReviewFromAudit(
  audit: AuditResult,
  meta: { readonly candidateSha: string; readonly provider: string | null; readonly model: string | null },
): ScoredReview {
  const dimensionScores = audit.dimensionScores ?? {};
  const invalid = audit.parseFailed === true || audit.overallScore === undefined
    || LOGIC_DIMENSIONS.some((dimension) => typeof dimensionScores[dimension] !== "number");
  const score = invalid
    ? 0
    : Math.round(LOGIC_DIMENSIONS.reduce(
      (sum, dimension) => sum + dimensionScores[dimension]! * LOGIC_WEIGHTS[dimension] / 100,
      0,
    ));
  const findings: ReviewFinding[] = audit.issues.map((issue, index) => ({
    findingId: `logic-${index + 1}`,
    severity: issue.severity === "critical"
      ? "CRITICAL"
      : issue.explicitSeverity === "MAJOR"
        ? "MAJOR"
        : issue.severity === "warning" ? "MINOR" : "NOTE",
    evidence: issue.description,
    impact: issue.category,
    requiredOutcome: issue.suggestion,
  }));
  const authorityBlocker = audit.issues.some((issue) => issue.severity === "critical"
    && /authority|global lock|blueprint|canon source/i.test(`${issue.category} ${issue.description}`));
  const hasBlocking = findings.some((finding) => finding.severity === "CRITICAL" || finding.severity === "MAJOR");
  return {
    reviewerRole: "logic-canon-auditor",
    provider: meta.provider,
    model: meta.model,
    totalScore: Math.round(Math.max(0, Math.min(100, score))),
    dimensionScores,
    decision: invalid ? "INVALID_OUTPUT" : authorityBlocker ? "HELD" : hasBlocking || score < 85 ? "REVISION_REQUIRED" : findings.length > 0 ? "APPROVED_WITH_NOTES" : "APPROVED",
    findings,
    reviewedCandidateSha: meta.candidateSha,
    reviewedAt: new Date().toISOString(),
    ...(audit.tokenUsage ? { tokenUsage: audit.tokenUsage } : {}),
    ...(authorityBlocker ? { authorityBlocker: true } : {}),
  };
}

type Reviewer = (content: string, candidateSha: string) => Promise<ScoredReview>;

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

function bindReview(review: ScoredReview, candidateSha: string): ScoredReview {
  return { ...review, reviewedCandidateSha: candidateSha };
}

function has(review: ScoredReview, ...severities: ReviewSeverity[]): boolean {
  return review.findings.some((finding) => severities.includes(finding.severity));
}

function minimumDimension(review: ScoredReview): number {
  const values = Object.values(review.dimensionScores);
  return values.length === 0 ? 0 : Math.min(...values);
}

function grade(logic: ScoredReview, commercial: ScoredReview): "A" | "B" | "C" | "D" | "E" {
  if (logic.decision === "INVALID_OUTPUT" || commercial.decision === "INVALID_OUTPUT") return "E";
  if (logic.totalScore < 70 || commercial.totalScore < 70 || has(logic, "CRITICAL") || has(commercial, "CRITICAL")) return "D";
  const noBlocking = !has(logic, "CRITICAL", "MAJOR") && !has(commercial, "CRITICAL", "MAJOR");
  if (noBlocking && logic.totalScore >= 90 && commercial.totalScore >= 88
    && minimumDimension(logic) >= 80 && minimumDimension(commercial) >= 80) return "A";
  if (noBlocking && logic.totalScore >= 85 && commercial.totalScore >= 82) return "B";
  return "C";
}

function usageAdd(left: RoleTokenUsage | undefined, right: RoleTokenUsage | undefined): RoleTokenUsage {
  const leftHasUsage = !!left && (left.promptTokens > 0 || left.completionTokens > 0 || left.totalTokens > 0);
  const actualCostUsd = right?.actualCostUsd !== undefined && (!leftHasUsage || left?.actualCostUsd !== undefined)
    ? (left?.actualCostUsd ?? 0) + right.actualCostUsd
    : undefined;
  return {
    promptTokens: (left?.promptTokens ?? 0) + (right?.promptTokens ?? 0),
    completionTokens: (left?.completionTokens ?? 0) + (right?.completionTokens ?? 0),
    totalTokens: (left?.totalTokens ?? 0) + (right?.totalTokens ?? 0),
    ...(actualCostUsd !== undefined ? { actualCostUsd } : {}),
  };
}

export async function runBoundedReviewCycle(params: {
  readonly initialContent: string;
  readonly reviewLogic: Reviewer;
  readonly reviewCommercial: Reviewer;
  readonly revise: (
    content: string,
    findings: ReadonlyArray<ReviewFinding>,
    round: 1 | 2,
  ) => Promise<{ readonly content: string; readonly tokenUsage?: RoleTokenUsage }>;
  readonly onStage?: (stage: "LOGIC_REVIEW" | "READER_REVIEW" | "REVISING_1" | "RESCUE_REVISING_2") => Promise<void> | void;
}): Promise<BoundedReviewResult> {
  const usageByRole: Record<string, RoleTokenUsage> = {};
  const candidates: BoundedCandidate[] = [];
  let content = params.initialContent;
  const initialSha = sha256(content);
  await params.onStage?.("LOGIC_REVIEW");
  const initialLogic = await params.reviewLogic(content, initialSha);
  await params.onStage?.("READER_REVIEW");
  const initialCommercial = await params.reviewCommercial(content, initialSha);
  let logic = bindReview(initialLogic, initialSha);
  let commercial = bindReview(initialCommercial, initialSha);
  usageByRole[logic.reviewerRole] = usageAdd(usageByRole[logic.reviewerRole], logic.tokenUsage);
  usageByRole[commercial.reviewerRole] = usageAdd(usageByRole[commercial.reviewerRole], commercial.tokenUsage);

  const appendCandidate = (label: BoundedCandidate["label"]) => {
    const candidate: BoundedCandidate = {
      label,
      content,
      sha256: sha256(content),
      reviews: [logic, commercial],
      combinedScore: logic.totalScore + commercial.totalScore,
    };
    candidates.push(candidate);
    return candidate;
  };

  let current = appendCandidate("INITIAL");
  let currentGrade = grade(logic, commercial);
  if (currentGrade === "A" || currentGrade === "B") {
    return { status: "APPROVED", grade: currentGrade, finalContent: content, revisionCount: 0, candidates, bestCandidate: current, usageByRole };
  }
  if (logic.authorityBlocker || commercial.authorityBlocker) {
    return { status: "HELD_AFTER_TWO_REVISIONS", grade: "D", finalContent: content, revisionCount: 0, candidates, bestCandidate: current, holdReason: "AUTHORITY_BLOCKER", usageByRole };
  }
  if (currentGrade === "E") {
    return { status: "HELD_AFTER_TWO_REVISIONS", grade: "E", finalContent: content, revisionCount: 0, candidates, bestCandidate: current, holdReason: "INVALID_OUTPUT", usageByRole };
  }

  for (const round of [1, 2] as const) {
    const priorLogic = logic;
    const priorCommercial = commercial;
    const logicNeedsReview = grade(priorLogic, {
      ...priorCommercial,
      totalScore: 100,
      dimensionScores: { pass: 100 },
      findings: [],
      decision: "APPROVED",
    }) !== "A" || priorLogic.findings.length > 0;
    const commercialNeedsReview = grade({
      ...priorLogic,
      totalScore: 100,
      dimensionScores: { pass: 100 },
      findings: [],
      decision: "APPROVED",
    }, priorCommercial) !== "A" || priorCommercial.findings.length > 0;
    const findings = [...priorLogic.findings, ...priorCommercial.findings];
    await params.onStage?.(round === 1 ? "REVISING_1" : "RESCUE_REVISING_2");
    const revised = await params.revise(content, findings, round);
    usageByRole.reviser = usageAdd(usageByRole.reviser, revised.tokenUsage);
    content = revised.content;
    const candidateSha = sha256(content);
    if (logicNeedsReview) {
      await params.onStage?.("LOGIC_REVIEW");
      logic = bindReview(await params.reviewLogic(content, candidateSha), candidateSha);
      usageByRole[logic.reviewerRole] = usageAdd(usageByRole[logic.reviewerRole], logic.tokenUsage);
    }
    if (commercialNeedsReview) {
      await params.onStage?.("READER_REVIEW");
      commercial = bindReview(await params.reviewCommercial(content, candidateSha), candidateSha);
      usageByRole[commercial.reviewerRole] = usageAdd(usageByRole[commercial.reviewerRole], commercial.tokenUsage);
    }
    current = appendCandidate(round === 1 ? "REVISION_1" : "REVISION_2");
    currentGrade = grade(logic, commercial);
    if (currentGrade === "A" || currentGrade === "B") {
      return { status: "APPROVED", grade: currentGrade, finalContent: content, revisionCount: round, candidates, bestCandidate: current, usageByRole };
    }
    if (logic.authorityBlocker || commercial.authorityBlocker) break;
  }

  const finalFindings = current.reviews.flatMap((review) => review.findings);
  const finalBlocking = finalFindings.some((finding) => finding.severity === "CRITICAL" || finding.severity === "MAJOR");
  return {
    status: finalBlocking ? "BLOCKED_CRITICAL_FINDINGS" : "ACCEPTED_WITH_FINDINGS",
    grade: currentGrade === "E" ? "E" : "D",
    finalContent: current.content,
    revisionCount: 2,
    candidates,
    bestCandidate: current,
    ...(finalBlocking ? { holdReason: logic.authorityBlocker || commercial.authorityBlocker ? "AUTHORITY_BLOCKER" as const : "REVISION_LIMIT_REACHED" as const } : {}),
    usageByRole,
  };
}
