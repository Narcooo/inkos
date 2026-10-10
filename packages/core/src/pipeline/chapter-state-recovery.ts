import type { Observation } from "../models/observation.js";
import type {
  ValidationResult,
} from "../agents/state-validator.js";
import type { StateValidatorAgent } from "../agents/state-validator.js";
import {withStateProjectionContext} from '../agents/state-validator.js';
import type {RuntimeStateSnapshot} from '../state/state-reducer.js';
import type { StateValidationAuthorityContext } from "../agents/state-validator.js";
import type { WriteChapterOutput } from "../agents/writer.js";
import type { WriterAgent } from "../agents/writer.js";
import type { Logger } from "../utils/logger.js";
import type { BookConfig } from "../models/book.js";
import type { ContextPackage } from "../models/input-governance.js";
import type { LengthLanguage } from "../utils/length-metrics.js";

export interface SettlementRetryParams {
  readonly writer: Pick<WriterAgent, "settleChapterState">;
  readonly validator: Pick<StateValidatorAgent, "validate">;
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly baselineChapter?: number;
  readonly allowNewHooks?: boolean;
  readonly title: string;
  readonly content: string;
  readonly reducedControlInput: {
    chapterIntent: string;
    contextPackage: ContextPackage;
  };
  readonly oldState: string;
  readonly oldHooks: string;
  readonly originalValidation: ValidationResult;
  readonly authorityContext?: StateValidationAuthorityContext;
  readonly previousProjection?: RuntimeStateSnapshot;
  readonly language: LengthLanguage;
  readonly logWarn?: (message: { zh: string; en: string }) => void;
  readonly logger?: Pick<Logger, "warn">;
}

export type SettlementRetryResult =
  | {
    readonly kind: "reconciled";
    readonly output: WriteChapterOutput;
    readonly validation: ValidationResult;
  }
  | {
    readonly kind: "unresolved";
    readonly output: WriteChapterOutput;
    readonly validation: ValidationResult;
    readonly observations: ReadonlyArray<Observation>;
  };

export async function reconcileChapterStateAfterReview(
  params: SettlementRetryParams,
): Promise<SettlementRetryResult> {
  params.logWarn?.({
    zh: `状态投影需要对账，正在仅重算第${params.chapterNumber}章结算层`,
    en: `State projection needs reconciliation; recalculating settlement for chapter ${params.chapterNumber}`,
  });

  const retryOutput = await params.writer.settleChapterState({
    book: params.book,
    bookDir: params.bookDir,
    chapterNumber: params.chapterNumber,
    title: params.title,
    content: params.content,
    allowReapply: true,
    baselineChapter: params.baselineChapter,
    allowNewHooks: params.allowNewHooks,
    chapterIntent: params.reducedControlInput.chapterIntent,
    contextPackage: params.reducedControlInput.contextPackage,
    validationFeedback: buildStateReconciliationFeedback(
      params.originalValidation.observations,
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
      withStateProjectionContext(params.authorityContext,params.previousProjection,retryOutput.runtimeStateSnapshot),
    );
  } catch (error) {
    const validation: ValidationResult = {
      consistent: false,
      reconciliationRequired: true,
      observations: [{
        code: "state-validation-unavailable",
        summary: `State reconciliation could not be verified: ${String(error)}`,
        evidence: [],
      }],
    };
    return {
      kind: "unresolved",
      output: retryOutput,
      validation,
      observations: validation.observations,
    };
  }

  if (retryValidation.observations.length > 0) {
    params.logWarn?.({
      zh: `状态校验重试后，第${params.chapterNumber}章仍有 ${retryValidation.observations.length} 条观察`,
      en: `State validation retry still reports ${retryValidation.observations.length} observation(s) for chapter ${params.chapterNumber}`,
    });
    for (const observation of retryValidation.observations) {
      params.logger?.warn(`  [${observation.code}] ${observation.summary}`);
    }
  }

  if (retryValidation.consistent && !retryValidation.reconciliationRequired) {
    return {
      kind: "reconciled",
      output: retryOutput,
      validation: retryValidation,
    };
  }

  return {
    kind: "unresolved",
    output: retryOutput,
    validation: retryValidation,
    observations: retryValidation.observations.length > 0
      ? retryValidation.observations
      : [unresolvedStateObservation(params.language)],
  };
}

export function buildStateReconciliationFeedback(
  observations: ReadonlyArray<Observation>,
  language: LengthLanguage,
): string {
  const corrections=observations.filter(observation=>observation.assessment===undefined||observation.assessment==='issue');
  if (corrections.length === 0) {
    return language === "en"
      ? "The previous settlement contradicted the chapter text. Reconcile truth files strictly to the body."
      : "上一次状态结算与正文矛盾。请严格以正文为准修正 truth files。";
  }

  if (language === "en") {
    return [
      "The previous settlement needs reconciliation. Align these differences with the chapter body:",
      ...corrections.map((observation) => `- [${observation.code}] ${observation.summary}${observation.sourceRefs?.length?`\n${JSON.stringify({sourceRefs:observation.sourceRefs})}`:''}`),
    ].join("\n");
  }

  return [
    "上一次状态结算需要对账。请对照正文修正以下差异：",
    ...corrections.map((observation) => `- [${observation.code}] ${observation.summary}${observation.sourceRefs?.length?`\n${JSON.stringify({sourceRefs:observation.sourceRefs})}`:''}`),
  ].join("\n");
}

export function unresolvedStateObservation(
  language: LengthLanguage,
): Observation {
  return {
    code: "state-validation",
    summary: language === "en"
      ? "State reconciliation remains unresolved after recalculation."
      : "状态结算重算后仍有未解决差异。",
    evidence: [],
  };
}
