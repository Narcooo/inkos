// Bilingual prompt builders for the narrative forecast agent, organized the
// same way as prompts/short-fiction.ts: each builder switches on language.

import type { WritingLanguage } from "../models/book.js";
import { RUSSIAN_OUTPUT_INSTRUCTION } from "../utils/language.js";

export type ForecastLanguage = WritingLanguage;

export interface ForecastPromptInput {
  readonly contextMarkdown: string;
  readonly divergence: string;
  readonly branchCount: number;
  readonly horizon: number;
  readonly baseChapter: number;
}

export function buildForecastSystemPrompt(language: ForecastLanguage): string {
  if (language === "ru") return `Предложите независимые варианты развития сюжета. Сохраняйте установленные факты и отмечайте возможные противоречия. ${RUSSIAN_OUTPUT_INSTRUCTION}`;
  return language === "en"
    ? "Project mutually isolated, non-canonical futures with the activated long-writing Skill. Preserve canon and surface conflicts as risks."
    : "按已激活的长篇写作 Skill 推演相互隔离的非正史候选未来。保留正典，把冲突明确列为风险。";
}

export function buildForecastUserPrompt(input: ForecastPromptInput, language: ForecastLanguage): string {
  const firstChapter = input.baseChapter + 1;
  if (language !== "zh") {
    return [
      input.contextMarkdown,
      "",
      "## Divergence point",
      "",
      input.divergence,
      "",
      "## Output requirements",
      "",
      `Produce exactly ${input.branchCount} candidate branches. Each branch covers roughly ${input.horizon} future chapters starting at chapter ${firstChapter}.`,
      "Submit complete branches through the forecast result tool.",
    ].join("\n");
  }
  return [
    input.contextMarkdown,
    "",
    "## 分歧点",
    "",
    input.divergence,
    "",
    "## 输出要求",
    "",
    `生成恰好 ${input.branchCount} 个候选分支。每个分支覆盖从第 ${firstChapter} 章开始、约 ${input.horizon} 章的未来走向。`,
    "通过剧情推演结果工具提交完整分支。",
  ].join("\n");
}

export function buildForecastRepairPrompt(validationError: string, language: ForecastLanguage): string {
  if (language !== "zh") {
    return [
      `Your previous output failed validation: ${validationError}`,
      "Submit the corrected complete branch set through the result tool.",
    ].join("\n");
  }
  return [
    `你上一次的输出未通过校验：${validationError}`,
    "请修正上述问题后，通过结果工具重新提交完整分支。",
  ].join("\n");
}
