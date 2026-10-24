import type { LLMClient } from "../llm/provider.js";
import { runWorkerAgent } from "../agent/worker-agent.js";
import { prepareWorkerMessages } from "./base.js";
import type { ActivatedSkillGuidance } from "../agent/skill-tool.js";
import { loadAvailableAgentSkills, mergeActivatedSkillGuidance } from "../skills/index.js";

export async function compileStyleGuide(input: {
  readonly client: LLMClient;
  readonly model: string;
  readonly projectRoot: string;
  readonly referenceText: string;
  readonly sourceName?: string;
  readonly language?: "zh" | "en";
  readonly activeSkills?: ReadonlyArray<ActivatedSkillGuidance>;
  readonly signal?: AbortSignal;
}): Promise<string> {
  const sample = input.referenceText.trim();
  if (!sample) throw new Error("Reference text is required for style extraction.");
  const language = input.language ?? "zh";
  const available = await loadAvailableAgentSkills({ projectRoot: input.projectRoot });
  const skills = ["inkos-long-story-analysis", "inkos-imitation-writing"].map((id) => {
    const skill = available.skills.find((candidate) => candidate.id === id);
    if (!skill) throw new Error(`Style extraction requires unavailable skill: ${id}`);
    return { skill, resources: [] };
  });
  const response = await runWorkerAgent(input.client, input.model, await prepareWorkerMessages({ ...input, activatedSkills: mergeActivatedSkillGuidance(input.activeSkills ?? [], skills) }, [
    {
      role: "system",
      content: language === "en"
        ? "Compile the reference into an evidence-backed operational style guide. Return Markdown only."
        : "把参考文本编译为有证据、可执行的文风指南，只返回 Markdown。",
    },
    {
      role: "user",
      content: language === "en"
        ? `Source: ${input.sourceName?.trim() || "reference"}\n\n${sample}`
        : `来源：${input.sourceName?.trim() || "参考文本"}\n\n${sample}`,
    },
  ], undefined, "style-guide"), {

    signal: input.signal,
  });
  const guide = response.content.trim();
  if (!guide) throw new Error("Style extraction returned an empty guide.");
  return guide;
}
