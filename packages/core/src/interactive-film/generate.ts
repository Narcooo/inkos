import type { LLMClient } from "../llm/provider.js";
import { runWorkerAgentTool } from "../agent/worker-agent.js";
import { appendActivatedSkillGuidance } from "../agents/base.js";
import type { ActivatedSkillGuidance } from "../agent/skill-tool.js";
import { StoryGraphSchema, type StoryGraph } from "./graph-schema.js";
import { StoryGraphContentToolSchema } from "./tool-schemas.js";
import { validateStoryGraph } from "./validation.js";

const SYSTEM_PROMPT_ZH = `你是互动影游编剧。根据用户的故事前提，生成一个小而完整的可玩分支图。
要求：恰好 1 个 type=start 节点；至少 2 个 branch 节点；至少 2 个差异化 ending；每条路径都能到达某个 ending；用变量、条件和效果表达真正影响后续的玩家选择。完成后调用 submit_story_graph 提交分支图。`;

const SYSTEM_PROMPT_EN = `You are an interactive film scriptwriter. From the user's story premise, generate a small but complete playable branching graph.
Requirements: exactly 1 node with type=start; at least 2 branch nodes; at least 2 clearly differentiated endings; every path must reach some ending; use variables, conditions, and effects for choices that genuinely change later scenes. Finish by calling submit_story_graph.`;

export interface GenerateStoryGraphInput {
  readonly projectId: string;
  readonly title: string;
  readonly premise: string;
}

export async function generateStoryGraph(
  client: LLMClient,
  model: string,
  input: GenerateStoryGraphInput,
  options?: {
    readonly maxTokens?: number;
    readonly language?: "zh" | "en";
    readonly activatedSkills?: ReadonlyArray<ActivatedSkillGuidance>;
    readonly signal?: AbortSignal;
  },
): Promise<StoryGraph> {
  const language = options?.language ?? "zh";
  const systemPrompt = language === "en" ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_ZH;
  const userPrompt = language === "en"
    ? `Title: ${input.title}\nPremise: ${input.premise}`
    : `标题：${input.title}\n前提：${input.premise}`;
  const submitted = await runWorkerAgentTool(client, model, appendActivatedSkillGuidance([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ], options?.activatedSkills), {
    name: "submit_story_graph",
    label: language === "en" ? "Submit Story Graph" : "提交故事图谱",
    description: language === "en"
      ? "Submit the complete playable branching graph. The host owns the project id, schema version, and title."
      : "提交完整可玩的分支图。项目 id、schema 版本和标题由宿主负责。",
    parameters: StoryGraphContentToolSchema,
  }, {
    temperature: 0.5,
    maxTokens: options?.maxTokens ?? 8000,
    signal: options?.signal,
  });
  const graph = StoryGraphSchema.parse({
    ...submitted,
    schemaVersion: 1,
    projectId: input.projectId,
    title: input.title,
  });
  const startCount = graph.nodes.filter((node) => node.type === "start").length;
  const branchCount = graph.nodes.filter((node) => node.type === "branch").length;
  const report = validateStoryGraph(graph);
  if (startCount !== 1 || branchCount < 2 || graph.endings.length < 2 || !report.ok) {
    const reasons = [
      ...(startCount !== 1 ? [`expected exactly one start node, received ${startCount}`] : []),
      ...(branchCount < 2 ? [`expected at least two branch nodes, received ${branchCount}`] : []),
      ...(graph.endings.length < 2 ? [`expected at least two endings, received ${graph.endings.length}`] : []),
      ...report.issues.filter((issue) => issue.level === "error").map((issue) => issue.message),
    ];
    throw new Error(`Generated story graph is not playable: ${reasons.join("; ")}`);
  }
  return graph;
}
