import type { AuditIssue } from "../agents/continuity.js";
import type {
  ValidationResult,
  ValidationWarning,
} from "../agents/state-validator.js";
import type { StateValidatorAgent } from "../agents/state-validator.js";
import type { WriteChapterOutput } from "../agents/writer.js";
import type { WriterAgent } from "../agents/writer.js";
import type { Logger } from "../utils/logger.js";
import type { BookConfig } from "../models/book.js";
import type { ChapterMeta } from "../models/chapter.js";
import type { ContextPackage, RuleStack } from "../models/input-governance.js";
import type { LengthLanguage } from "../utils/length-metrics.js";

export interface SettlementRetryParams {
  readonly writer: Pick<WriterAgent, "settleChapterState">;
  readonly validator: Pick<StateValidatorAgent, "validate">;
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly reducedControlInput?: {
    chapterIntent: string;
    contextPackage: ContextPackage;
    ruleStack: RuleStack;
  };
  readonly oldState: string;
  readonly oldHooks: string;
  readonly originalValidation: ValidationResult;
  readonly language: LengthLanguage;
  readonly logWarn?: (message: { zh: string; en: string }) => void;
  readonly logger?: Pick<Logger, "warn">;
}

export type SettlementRetryResult =
  | {
    readonly kind: "recovered";
    readonly output: WriteChapterOutput;
    readonly validation: ValidationResult;
  }
  | {
    readonly kind: "degraded";
    readonly issues: ReadonlyArray<AuditIssue>;
  };

export async function retrySettlementAfterValidationFailure(
  params: SettlementRetryParams,
): Promise<SettlementRetryResult> {
  params.logWarn?.({
    zh: `状态校验失败，正在仅重试结算层（第${params.chapterNumber}章）`,
    en: `State validation failed; retrying settlement only for chapter ${params.chapterNumber}`,
  });

  const retryOutput = await params.writer.settleChapterState({
    book: params.book,
    bookDir: params.bookDir,
    chapterNumber: params.chapterNumber,
    title: params.title,
    content: params.content,
    allowReapply: true,
    chapterIntent: params.reducedControlInput?.chapterIntent,
    contextPackage: params.reducedControlInput?.contextPackage,
    ruleStack: params.reducedControlInput?.ruleStack,
    validationFeedback: buildStateValidationFeedback(
      params.originalValidation.warnings,
      params.language,
    ),
  });

  let retryValidation: ValidationResult;
  try {
    retryValidation = await params.validator.validate(
      params.content,
      params.chapterNumber,
      params.oldState,
      retryOutput.updatedState,
      params.oldHooks,
      retryOutput.updatedHooks,
      params.language,
    );
  } catch (error) {
    throw new Error(`State validation retry failed for chapter ${params.chapterNumber}: ${String(error)}`);
  }

  if (retryValidation.warnings.length > 0) {
    params.logWarn?.({
      zh: `状态校验重试后，第${params.chapterNumber}章仍有 ${retryValidation.warnings.length} 条警告`,
      en: `State validation retry still reports ${retryValidation.warnings.length} warning(s) for chapter ${params.chapterNumber}`,
    });
    for (const warning of retryValidation.warnings) {
      params.logger?.warn(`  [${warning.category}] ${warning.description}`);
    }
  }

  if (retryValidation.passed) {
    return {
      kind: "recovered",
      output: retryOutput,
      validation: retryValidation,
    };
  }

  return {
    kind: "degraded",
    issues: buildStateDegradedIssues(retryValidation.warnings, params.language),
  };
}

export function buildStateValidationFeedback(
  warnings: ReadonlyArray<ValidationWarning>,
  language: LengthLanguage,
): string {
  if (warnings.length === 0) {
    return language === "en"
      ? "The previous settlement contradicted the chapter text. Reconcile truth files strictly to the body."
      : "上一次状态结算与正文矛盾。请严格以正文为准修正 truth files。";
  }

  if (language === "en") {
    return [
      "The previous settlement failed validation. Fix these contradictions against the chapter body:",
      ...warnings.map((warning) => `- [${warning.category}] ${warning.description}`),
    ].join("\n");
  }

  return [
    "上一次状态结算未通过校验。请对照正文修正以下矛盾：",
    ...warnings.map((warning) => `- [${warning.category}] ${warning.description}`),
  ].join("\n");
}

export function buildStateDegradedIssues(
  warnings: ReadonlyArray<ValidationWarning>,
  language: LengthLanguage,
): ReadonlyArray<AuditIssue> {
  if (warnings.length > 0) {
    return warnings.map((warning) => ({
      severity: "warning" as const,
      category: "state-validation",
      description: warning.description,
      suggestion: language === "en"
        ? "Repair chapter state from the persisted body before continuing."
        : "请先基于已保存正文修复本章 state，再继续后续章节。",
    }));
  }

  return [{
    severity: "warning",
    category: "state-validation",
    description: language === "en"
      ? "State validation still failed after settlement retry."
      : "状态结算重试后仍未通过校验。",
    suggestion: language === "en"
      ? "Repair chapter state from the persisted body before continuing."
      : "请先基于已保存正文修复本章 state，再继续后续章节。",
  }];
}

export function buildStateDegradedPersistenceOutput(params: {
  readonly output: WriteChapterOutput;
  readonly oldState: string;
  readonly oldHooks: string;
  readonly oldLedger: string;
}): WriteChapterOutput {
  return {
    ...params.output,
    runtimeStateDelta: undefined,
    runtimeStateSnapshot: undefined,
    updatedState: params.oldState,
    updatedLedger: params.oldLedger,
    updatedHooks: params.oldHooks,
    updatedChapterSummaries: undefined,
  };
}

export interface StateDegradedReviewNote {
  readonly kind: "state-degraded";
  readonly baseStatus: "ready-for-review" | "audit-failed";
  readonly injectedIssues: ReadonlyArray<string>;
}

export function buildStateDegradedReviewNote(
  baseStatus: "ready-for-review" | "audit-failed",
  issues: ReadonlyArray<AuditIssue>,
): string {
  return JSON.stringify({
    kind: "state-degraded",
    baseStatus,
    injectedIssues: issues.map((issue) => `[${issue.severity}] ${issue.description}`),
  } satisfies StateDegradedReviewNote);
}

export function parseStateDegradedReviewNote(
  reviewNote?: string,
): StateDegradedReviewNote | null {
  if (!reviewNote) {
    return null;
  }

  try {
    const parsed = JSON.parse(reviewNote) as {
      kind?: unknown;
      baseStatus?: unknown;
      injectedIssues?: unknown;
    };
    if (
      parsed.kind !== "state-degraded"
      || (parsed.baseStatus !== "ready-for-review" && parsed.baseStatus !== "audit-failed")
      || !Array.isArray(parsed.injectedIssues)
    ) {
      return null;
    }

    return {
      kind: "state-degraded",
      baseStatus: parsed.baseStatus,
      injectedIssues: parsed.injectedIssues.filter((issue): issue is string => typeof issue === "string"),
    };
  } catch {
    return null;
  }
}

export function resolveStateDegradedBaseStatus(
  chapter: Pick<ChapterMeta, "reviewNote" | "auditIssues">,
): "ready-for-review" | "audit-failed" {
  const metadata = parseStateDegradedReviewNote(chapter.reviewNote);
  if (metadata) {
    return metadata.baseStatus;
  }

  return chapter.auditIssues.some((issue) => issue.startsWith("[critical]"))
    ? "audit-failed"
    : "ready-for-review";
}
