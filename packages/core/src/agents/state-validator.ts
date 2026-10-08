import { BaseAgent } from "./base.js";
import { StateValidationToolSchema } from "./state-validation-tool.js";
import type { Observation } from "../models/observation.js";

export interface ValidationResult {
  readonly observations: ReadonlyArray<Observation>;
  readonly consistent: boolean;
  readonly reconciliationRequired: boolean;
}

export interface StateValidationAuthorityContext {
  readonly storyFrame?: string;
  readonly bookRules?: string;
  readonly chapterSummaries?: string;
}

/**
 * Validates Settler output by comparing old and new truth files via LLM.
 * Catches contradictions, missing state changes, and temporal inconsistencies.
 *
 * The model submits a typed reconciliation decision; prose has no authority.
 */
export class StateValidatorAgent extends BaseAgent {
  get name(): string {
    return "state-validator";
  }

  async validate(
    chapterContent: string,
    chapterNumber: number,
    oldState: string,
    newState: string,
    oldHooks: string,
    newHooks: string,
    language: "zh" | "en" = "zh",
    authorityContext?: StateValidationAuthorityContext,
  ): Promise<ValidationResult> {
    if (oldState === newState && oldHooks === newHooks) {
      return { observations: [], consistent: true, reconciliationRequired: false };
    }

    const langInstruction = language === "en"
      ? "Respond in English."
      : "用中文回答。";

    const systemPrompt = `Validate the derived truth projection against the current chapter and supplied authority using the activated long-writing Skill. ${langInstruction}
Do not rewrite the chapter or silently resolve contradictory sources. A hook marked superseded retains an explicitly withdrawn plan for history; its original premise is not active canon or a future promise. Verify its notes against the current withdrawal authority, rather than requiring that premise to occur in the chapter. Set reconciliationRequired=true only when a different truth projection can resolve the mismatch; a contradiction inside the chapter or between authorities remains a reported observation and does not authorize another settlement pass. Submit the Boolean decision and a concise Markdown report with concrete evidence through the validation tool. Use an empty report when there are no findings.`;

    const authorityBlock = this.buildAuthorityContextBlock(authorityContext);

    const userPrompt = `Chapter ${chapterNumber} validation:

${authorityBlock}

## Previous State Card
${oldState}

## Proposed State Card
${newState}

## Previous Hooks
${oldHooks}

## Proposed Hooks
${newHooks}

## Chapter Text (for reference)
${chapterContent}`;

    try {
      const { result } = await this.submitStructured(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        {
          name: "submit_state_validation",
          label: language === "en" ? "Submit state validation" : "提交状态对账",
          description: "Submit whether state reconciliation is required and the concrete evidence.",
          parameters: StateValidationToolSchema,
          validate: result => {
            if(result.reconciliationRequired && !result.reportMarkdown.trim()) throw Object.assign(new Error(JSON.stringify({code:"STATE_RECONCILIATION_REASON_REQUIRED",instruction:"Explain the projection mismatch that requires recalculation."})),{code:"STATE_RECONCILIATION_REASON_REQUIRED"});
            return result;
          },
        },
        {  maxTokens: Math.min(8192, this.ctx.client.defaults.maxTokens) },
      );
      return {
        observations: result.reportMarkdown.trim() ? [{code:result.reconciliationRequired ? "state-reconciliation" : "state-projection-review",summary:result.reportMarkdown.trim(),evidence:[]}] : [],
        consistent: !result.reconciliationRequired,
        reconciliationRequired: result.reconciliationRequired,
      };
    } catch (error) {
      this.log?.warn(`State reconciliation review unavailable: ${error}`);
      throw error;
    }
  }

  private buildAuthorityContextBlock(authorityContext?: StateValidationAuthorityContext): string {
    if (!authorityContext) return "## Authority / Cross-Truth Context\n(no authority context provided)";

    const storyFrame = (authorityContext.storyFrame ?? "").trim();
    const bookRules = (authorityContext.bookRules ?? "").trim();
    const chapterSummaries = (authorityContext.chapterSummaries ?? "").trim();

    return [
      "## Authority / Cross-Truth Context",
      "Contradictory authority must be reported for reconciliation rather than silently reordered.",
      "",
      "### story_frame",
      storyFrame || "(empty)",
      "",
      "### book_rules excerpt",
      bookRules || "(empty)",
      "",
      "### chapter_summaries",
      chapterSummaries || "(empty)",
    ].join("\n");
  }

}
