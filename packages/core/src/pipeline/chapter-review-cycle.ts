import type { AuditIssue, AuditResult } from "../agents/continuity.js";
import type { ReviseMode, ReviseOutput } from "../agents/reviser.js";
import type { WriteChapterOutput } from "../agents/writer.js";
import type { ChapterIntent, ChapterMemo, ContextPackage, RuleStack } from "../models/input-governance.js";
import type { LengthSpec } from "../models/length-governance.js";
import { countChapterLength, isOutsideSoftRange } from "../utils/length-metrics.js";

export interface ChapterReviewCycleUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface ChapterReviewCycleControlInput {
  readonly chapterIntent: string;
  readonly chapterMemo?: ChapterMemo;
  readonly chapterIntentData?: ChapterIntent;
  readonly contextPackage: ContextPackage;
  readonly ruleStack: RuleStack;
}

export interface ChapterReviewCycleResult {
  readonly finalContent: string;
  readonly finalWordCount: number;
  readonly preAuditNormalizedWordCount: number;
  readonly revised: boolean;
  readonly auditResult: AuditResult;
  readonly totalUsage: ChapterReviewCycleUsage;
  readonly postReviseCount: number;
  readonly normalizeApplied: boolean;
}

const MAX_REVIEW_ITERATIONS = 3;
const PASS_SCORE_THRESHOLD = 85;
const NET_IMPROVEMENT_EPSILON = 3;

interface ReviewSnapshot {
  readonly content: string;
  readonly wordCount: number;
  readonly auditResult: AuditResult;
  readonly score: number;
}

export async function runChapterReviewCycle(params: {
  readonly book: Pick<{ genre: string }, "genre">;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly initialOutput: Pick<WriteChapterOutput, "content" | "wordCount" | "postWriteErrors">;
  readonly reducedControlInput?: ChapterReviewCycleControlInput;
  readonly lengthSpec: LengthSpec;
  readonly initialUsage: ChapterReviewCycleUsage;
  readonly createReviser: () => {
    reviseChapter: (
      bookDir: string,
      chapterContent: string,
      chapterNumber: number,
      issues: ReadonlyArray<AuditIssue>,
      mode?: ReviseMode,
      genre?: string,
      options?: {
        chapterIntent?: string;
        chapterMemo?: ChapterMemo;
        chapterIntentData?: ChapterIntent;
        contextPackage?: ContextPackage;
        ruleStack?: RuleStack;
        lengthSpec?: LengthSpec;
      },
    ) => Promise<ReviseOutput>;
  };
  readonly auditor: {
    auditChapter: (
      bookDir: string,
      chapterContent: string,
      chapterNumber: number,
      genre?: string,
      options?: {
        temperature?: number;
        chapterIntent?: string;
        chapterMemo?: ChapterMemo;
        contextPackage?: ContextPackage;
        ruleStack?: RuleStack;
      },
    ) => Promise<AuditResult>;
  };
  readonly normalizeDraftLengthIfNeeded: (chapterContent: string) => Promise<{
    content: string;
    wordCount: number;
    applied: boolean;
    tokenUsage?: ChapterReviewCycleUsage;
  }>;
  readonly normalizePostWriteSurface?: (chapterContent: string) => string;
  readonly assertChapterContentNotEmpty: (content: string, stage: string) => void;
  readonly addUsage: (
    left: ChapterReviewCycleUsage,
    right?: ChapterReviewCycleUsage,
  ) => ChapterReviewCycleUsage;
  readonly analyzeAITells: (content: string) => { issues: ReadonlyArray<AuditIssue> };
  readonly analyzeSensitiveWords: (content: string) => {
    found: ReadonlyArray<{ severity: string }>;
    issues: ReadonlyArray<AuditIssue>;
  };
  /** Re-run deterministic post-write checks (chapter-ref, paragraph shape, etc.) on any content. */
  readonly runPostWriteChecks?: (content: string) => ReadonlyArray<AuditIssue>;
  readonly logWarn: (message: { zh: string; en: string; ko?: string }) => void;
  readonly logStage: (message: { zh: string; en: string; ko?: string }) => void;
}): Promise<ChapterReviewCycleResult> {
  let totalUsage = params.initialUsage;
  let normalizeApplied = false;
  let finalContent = params.initialOutput.content;
  let finalWordCount = params.initialOutput.wordCount;

  // Convert initial postWriteErrors into AuditIssues as fallback when runPostWriteChecks isn't provided.
  const initialPostWriteIssues: ReadonlyArray<AuditIssue> = params.initialOutput.postWriteErrors.map((violation) => ({
    severity: "critical" as const,
    category: violation.rule,
    description: violation.description,
    suggestion: violation.suggestion,
  }));

  // ---------------------------------------------------------------------------
  // Length normalization: dedicated step, runs until in softRange (max 2 passes)
  // Length is NOT mixed into the reviser's issues — normalize handles it.
  // ---------------------------------------------------------------------------
  const normalizeUntilInRange = async (content: string): Promise<{
    content: string;
    wordCount: number;
    applied: boolean;
  }> => {
    let current = content;
    let applied = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const wc = countChapterLength(current, params.lengthSpec.countingMode);
      if (!isOutsideSoftRange(wc, params.lengthSpec)) {
        return { content: current, wordCount: wc, applied };
      }
      const result = await params.normalizeDraftLengthIfNeeded(current);
      totalUsage = params.addUsage(totalUsage, result.tokenUsage);
      current = result.content;
      applied = applied || result.applied;
    }
    const finalWc = countChapterLength(current, params.lengthSpec.countingMode);
    return { content: current, wordCount: finalWc, applied };
  };

  const normalizedBeforeAudit = await normalizeUntilInRange(finalContent);
  finalContent = params.normalizePostWriteSurface?.(normalizedBeforeAudit.content) ?? normalizedBeforeAudit.content;
  finalWordCount = countChapterLength(finalContent, params.lengthSpec.countingMode);
  normalizeApplied = normalizeApplied || normalizedBeforeAudit.applied;
  params.assertChapterContentNotEmpty(finalContent, "draft generation");

  // ---------------------------------------------------------------------------
  // Helper: assess a chapter (audit + deterministic checks + length + score)
  // ---------------------------------------------------------------------------
  const assess = async (
    content: string,
    options?: { temperature?: number },
  ): Promise<{ auditResult: AuditResult; score: number; lengthInRange: boolean }> => {
    const llmAudit = await params.auditor.auditChapter(
      params.bookDir,
      content,
      params.chapterNumber,
      params.book.genre,
      params.reducedControlInput
        ? { ...params.reducedControlInput, ...(options ?? {}) }
        : options,
    );
    totalUsage = params.addUsage(totalUsage, llmAudit.tokenUsage);
    const aiTellsResult = params.analyzeAITells(content);
    const sensitiveResult = params.analyzeSensitiveWords(content);
    const hasBlockedWords = sensitiveResult.found.some((item) => item.severity === "block");
    const wordCount = countChapterLength(content, params.lengthSpec.countingMode);
    const lengthInRange = !isOutsideSoftRange(wordCount, params.lengthSpec);

    // Deterministic post-write checks: run every round, not just the first.
    // If runPostWriteChecks is provided, use it; otherwise fall back to initial postWriteErrors.
    const postWriteIssues = params.runPostWriteChecks
      ? params.runPostWriteChecks(content)
      : initialPostWriteIssues;

    const allIssues: AuditIssue[] = [
      ...llmAudit.issues,
      ...aiTellsResult.issues,
      ...sensitiveResult.issues,
      ...postWriteIssues,
    ];

    // Length is NOT added to reviser issues — normalize handles it as a dedicated step.
    // lengthInRange is only used in isPassed() as a hard gate.

    const hasPostWriteCritical = postWriteIssues.some((i) => i.severity === "critical");
    const auditResult: AuditResult = {
      passed: (hasBlockedWords || hasPostWriteCritical) ? false : llmAudit.passed,
      issues: allIssues,
      summary: llmAudit.summary,
      overallScore: llmAudit.overallScore,
    };

    const score = llmAudit.overallScore ?? 0;

    return { auditResult, score, lengthInRange };
  };

  const isPassed = (assessment: { auditResult: AuditResult; score: number; lengthInRange: boolean }): boolean =>
    assessment.auditResult.passed && assessment.score >= PASS_SCORE_THRESHOLD && assessment.lengthInRange;

  // ---------------------------------------------------------------------------
  // Scoring loop: assess → revise → assess, max 3 iterations, pick best
  // ---------------------------------------------------------------------------
  params.logStage({ zh: "审计草稿", en: "auditing draft" });
  const initial = await assess(finalContent);

  const snapshots: ReviewSnapshot[] = [{
    content: finalContent,
    wordCount: finalWordCount,
    auditResult: initial.auditResult,
    score: initial.score,
  }];

  let currentAudit = initial;
  let postReviseCount = 0;

  if (!isPassed(initial)) {
    for (let iteration = 0; iteration < MAX_REVIEW_ITERATIONS; iteration++) {
      params.logStage({
        zh: `修复轮次 ${iteration + 1}/${MAX_REVIEW_ITERATIONS}（当前 ${currentAudit.score} 分）`,
        en: `repair iteration ${iteration + 1}/${MAX_REVIEW_ITERATIONS} (current score: ${currentAudit.score})`,
        ko: `수정 라운드 ${iteration + 1}/${MAX_REVIEW_ITERATIONS} (현재 ${currentAudit.score}점)`,
      });

      const reviser = params.createReviser();
      const reviseOutput = await reviser.reviseChapter(
        params.bookDir,
        finalContent,
        params.chapterNumber,
        currentAudit.auditResult.issues,
        "auto",
        params.book.genre,
        { ...params.reducedControlInput, lengthSpec: params.lengthSpec },
      );
      totalUsage = params.addUsage(totalUsage, reviseOutput.tokenUsage);

      if (reviseOutput.revisedContent.length === 0 || reviseOutput.revisedContent === finalContent) {
        params.logWarn({
          zh: `修复轮次 ${iteration + 1} 未产出新内容，退出循环`,
          en: `repair iteration ${iteration + 1} produced no new content, exiting loop`,
          ko: `수정 라운드 ${iteration + 1}에서 새 내용이 생성되지 않아 반복을 종료합니다`,
        });
        break;
      }

      params.assertChapterContentNotEmpty(reviseOutput.revisedContent, `repair iteration ${iteration + 1}`);
      const revisedContent = params.normalizePostWriteSurface?.(reviseOutput.revisedContent) ?? reviseOutput.revisedContent;
      const revisedWordCount = countChapterLength(revisedContent, params.lengthSpec.countingMode);

      // Re-assess revised content. If REVISED_CONTENT drifted on length,
      // lengthInRange will be false → isPassed fails → bestSnapshot picks
      // the earlier in-range version. No in-loop normalize needed.
      const nextAssessment = await assess(revisedContent, { temperature: 0 });

      snapshots.push({
        content: revisedContent,
        wordCount: revisedWordCount,
        auditResult: nextAssessment.auditResult,
        score: nextAssessment.score,
      });

      // Check if passed
      if (isPassed(nextAssessment)) {
        params.logStage({
          zh: `修复后达到通过线（${nextAssessment.score} 分），退出循环`,
          en: `repair reached pass threshold (${nextAssessment.score}), exiting loop`,
          ko: `수정 후 통과 기준에 도달했습니다 (${nextAssessment.score}점). 반복을 종료합니다`,
        });
        finalContent = revisedContent;
        finalWordCount = revisedWordCount;
        postReviseCount = revisedWordCount;
        currentAudit = nextAssessment;
        break;
      }

      // Check net improvement
      if (nextAssessment.score >= currentAudit.score + NET_IMPROVEMENT_EPSILON) {
        finalContent = revisedContent;
        finalWordCount = revisedWordCount;
        postReviseCount = revisedWordCount;
        currentAudit = nextAssessment;
        // Continue to next iteration
      } else {
        params.logWarn({
          zh: `修复轮次 ${iteration + 1} 未净提升（${currentAudit.score} → ${nextAssessment.score}），退出循环`,
          en: `repair iteration ${iteration + 1} no net improvement (${currentAudit.score} → ${nextAssessment.score}), exiting loop`,
          ko: `수정 라운드 ${iteration + 1}에서 점수가 개선되지 않았습니다 (${currentAudit.score} → ${nextAssessment.score}). 반복을 종료합니다`,
        });
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pick the best scoring snapshot for final output
  // ---------------------------------------------------------------------------
  const bestSnapshot = snapshots.reduce((best, snap) =>
    snap.score >= best.score + NET_IMPROVEMENT_EPSILON ? snap : best,
  );

  // If best snapshot differs from current content (repair made things worse
  // but an earlier version was better), roll back to the best version.
  if (bestSnapshot.content !== finalContent && bestSnapshot.score >= currentAudit.score + NET_IMPROVEMENT_EPSILON) {
    params.logWarn({
      zh: `回退到最高分版本（${bestSnapshot.score} 分 vs 当前 ${currentAudit.score} 分）`,
      en: `rolling back to highest-scoring version (${bestSnapshot.score} vs current ${currentAudit.score})`,
    });
    finalContent = bestSnapshot.content;
    finalWordCount = bestSnapshot.wordCount;
    currentAudit = {
      auditResult: bestSnapshot.auditResult,
      score: bestSnapshot.score,
      lengthInRange: !isOutsideSoftRange(bestSnapshot.wordCount, params.lengthSpec),
    };
  }

  return {
    finalContent,
    finalWordCount,
    preAuditNormalizedWordCount: finalWordCount,
    revised: snapshots.length > 1 && finalContent !== params.initialOutput.content,
    auditResult: currentAudit.auditResult,
    totalUsage,
    postReviseCount,
    normalizeApplied,
  };
}
