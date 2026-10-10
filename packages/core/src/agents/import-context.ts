import type { LLMClient } from "../llm/provider.js";
import { runWorkerAgent } from "../agent/worker-agent.js";
import { prepareWorkerMessages } from "./base.js";
import type { ActivatedSkillGuidance } from "../agent/skill-tool.js";
import { loadAvailableAgentSkills, mergeActivatedSkillGuidance } from "../skills/index.js";
import { estimateTextTokens } from "../llm/provider.js";
import { semanticInputBudget, splitTextByEstimatedTokens } from "../llm/semantic-input.js";

export interface ImportedChapterSource {
  readonly title: string;
  readonly content: string;
}

export function renderCompleteImportSource(
  chapters: ReadonlyArray<ImportedChapterSource>,
  language: "zh" | "en",
): string {
  return chapters.map((chapter, index) => language === "en"
    ? `Chapter ${index + 1}: ${chapter.title}\n\n${chapter.content}`
    : `第${index + 1}章 ${chapter.title}\n\n${chapter.content}`)
    .join("\n\n---\n\n");
}

export async function compileImportSource(input: {
  readonly client: LLMClient;
  readonly model: string;
  readonly projectRoot: string;
  readonly chapters: ReadonlyArray<ImportedChapterSource>;
  readonly language: "zh" | "en";
  readonly activeSkills?: ReadonlyArray<ActivatedSkillGuidance>;
  readonly signal?: AbortSignal;
}): Promise<{ readonly markdown: string; readonly compiled: boolean; readonly chunkCount: number }> {
  const complete = renderCompleteImportSource(input.chapters, input.language);
  const budget = semanticInputBudget(input.client, { reservedOutputTokens: 16_384 });
  if (budget === undefined || estimateTextTokens(complete) <= budget) {
    return { markdown: complete, compiled: false, chunkCount: 0 };
  }

  const available = await loadAvailableAgentSkills({ projectRoot: input.projectRoot });
  const skills = ["inkos-story-import", "inkos-continuation-writing"].map((id) => {
    const skill = available.skills.find((candidate) => candidate.id === id);
    if (!skill) throw new Error(`Import context compilation requires unavailable skill: ${id}`);
    return { skill, resources: [] };
  });
  const chunks = splitTextByEstimatedTokens(complete, budget);
  const compiled: string[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    const response = await runWorkerAgent(input.client, input.model, await prepareWorkerMessages({ ...input, activatedSkills: mergeActivatedSkillGuidance(input.activeSkills ?? [], skills) }, [
      {
        role: "system",
        content: input.language === "en"
          ? "Apply the activated import and continuation Skills to this complete source chunk. Return traceable Markdown only."
          : "按已激活的导入与续写 Skill 处理这份完整源片段，只返回可追溯 Markdown。",
      },
      { role: "user", content: `Source chunk ${index + 1}/${chunks.length}\n\n${chunk}` },
    ], undefined, "import-context"), {

      signal: input.signal,
    });
    const body = response.content.trim();
    if (!body) throw new Error(`Import context compiler returned empty output for chunk ${index + 1}/${chunks.length}.`);
    compiled.push(`## ${input.language === "en" ? "Compiled source chunk" : "编译源片段"} ${index + 1}/${chunks.length}\n\n${body}`);
  }
  const catalog = input.chapters.map((chapter, index) => input.language === "en"
    ? `- Chapter ${index + 1}: ${chapter.title}`
    : `- 第${index + 1}章：${chapter.title}`).join("\n");
  return {
    markdown: [
      input.language === "en" ? "# Compiled import context" : "# 编译后的导入上下文",
      "",
      input.language === "en" ? "## Complete chapter catalog" : "## 完整章节目录",
      catalog,
      "",
      ...compiled,
    ].join("\n"),
    compiled: true,
    chunkCount: chunks.length,
  };
}
