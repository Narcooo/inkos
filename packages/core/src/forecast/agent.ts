import { BaseAgent } from "../agents/base.js";
import type { LLMMessage } from "../llm/provider.js";
import {
  ForecastModelOutputSchema,
  type ForecastModelOutput,
} from "./schema.js";
import { ForecastResultToolSchema } from "./tool-schema.js";
import {
  buildForecastRepairPrompt,
  buildForecastSystemPrompt,
  buildForecastUserPrompt,
  type ForecastLanguage,
} from "./prompts.js";

export interface ForecastGenerationInput {
  readonly contextMarkdown: string;
  readonly divergence: string;
  readonly branchCount: number;
  readonly horizon: number;
  readonly baseChapter: number;
  readonly language: ForecastLanguage;
}

/**
 * Single-call forecast generator with one validation-driven retry: if the
 * first response fails JSON/schema/branch-count validation, the error is fed
 * back to the model once. A second failure surfaces as a hard error — the
 * runner then writes nothing to disk.
 */
export class NarrativeForecastAgent extends BaseAgent {
  get name(): string {
    return "narrative-forecast";
  }

  async generateBranches(input: ForecastGenerationInput): Promise<ForecastModelOutput> {
    const messages: ReadonlyArray<LLMMessage> = [
      { role: "system", content: buildForecastSystemPrompt(input.language) },
      { role: "user", content: buildForecastUserPrompt(input, input.language) },
    ];
    const maxTokens = estimateForecastMaxTokens(input.branchCount, input.horizon);

    const tool = {
      name: "submit_narrative_forecast",
      label: input.language === "en" ? "Submit narrative forecast" : "提交剧情推演",
      description: "Submit the complete non-canonical branch set.",
      parameters: ForecastResultToolSchema,
    } as const;
    const first = await this.submitStructured(messages, tool, {  maxTokens });
    let firstError: unknown;
    try {
      return validateGeneratedOutput(ForecastModelOutputSchema.parse(first.result), input.branchCount);
    } catch (error) {
      firstError = error;
      this.log?.warn(`[narrative-forecast] model output invalid, retrying once: ${String(error)}`);
    }

    const retry = await this.submitStructured([
      ...messages,
      { role: "user", content: buildForecastRepairPrompt(String(firstError), input.language) },
    ], tool, {  maxTokens });
    return validateGeneratedOutput(ForecastModelOutputSchema.parse(retry.result), input.branchCount);
  }
}

function validateGeneratedOutput(output: ForecastModelOutput, expectedBranches: number): ForecastModelOutput {
  if (output.branches.length !== expectedBranches) {
    throw new Error(
      `narrative forecast model returned ${output.branches.length} branches, expected exactly ${expectedBranches}.`,
    );
  }
  return output;
}

// Planning material is compact; scale headroom with branch count and horizon.
// zh chars run ~1.5 tokens each, so this deliberately over-provisions for en.
function estimateForecastMaxTokens(branchCount: number, horizon: number): number {
  return Math.max(8192, branchCount * (horizon * 220 + 1600));
}
