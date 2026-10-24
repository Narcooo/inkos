import { BaseAgent } from "./base.js";
import { completeLongForm } from "../llm/long-form-completion.js";
import { materializeStoryGraph } from "../interactive-film/generate.js";
import { InteractiveFilmPackageToolSchema, StoryboardPackageToolSchema } from "./production-document-tool.js";

export type ScriptTargetFormat = string;

export interface ScriptCreationInput {
  readonly authorRequest?: string;
  readonly title: string;
  readonly sourceKind?: string;
  readonly targetFormat?: ScriptTargetFormat;
  readonly sourceText?: string;
  readonly requirements?: string;
  readonly episodeCount?: number;
  readonly episodeDuration?: string;
  readonly language?: "zh" | "en";
}

export interface StoryboardCreationInput {
  readonly authorRequest?: string;
  readonly title: string;
  readonly sourceKind?: string;
  readonly sourceText?: string;
  readonly requirements?: string;
  readonly visualStyle?: string;
  readonly aspectRatio?: string;
  readonly granularity?: string;
  readonly maxShots?: number;
  readonly language?: "zh" | "en";
}

export interface InteractiveFilmCreationInput {
  readonly authorRequest?: string;
  readonly title: string;
  readonly sourceKind?: string;
  readonly sourceText?: string;
  readonly requirements?: string;
  readonly targetAudience?: string;
  readonly episodeCount?: number;
  readonly episodeDuration?: string;
  readonly budget?: string;
  readonly referenceMode?: string;
  readonly language?: "zh" | "en";
}

export class ScriptCreationAgent extends BaseAgent {
  get name(): string {
    return "script-creation-writer";
  }

  private async recoverProductionMarkdown(
    fragments: string,
    language: "zh" | "en",
    requiredHeadings: readonly string[],
  ): Promise<string> {
    const response = await this.chat([
      {
        role: "system",
        content: language === "en"
          ? [
              "You recover one canonical production document after a transport-confirmed output-limit continuation.",
              "The fragments may contain scratch analysis, overlapping suffixes, and complete-document restarts.",
              "Return exactly one complete Markdown deliverable. Preserve the user's requirements and the most developed usable content; remove process notes, scratch analysis, wrappers, duplicate document roots, and repeated sections.",
              "Do not summarize or shorten the actual deliverable.",
            ].join("\n")
          : [
              "你负责在模型因输出上限续写后，恢复唯一一份规范生产文档。",
              "输入片段可能包含思考草稿、重叠后缀和从头重写的完整文档。",
              "返回且只返回一份完整 Markdown 交付稿。保留用户要求和完成度最高的可用内容；删除流程说明、思考草稿、包装文本、重复文档开头和重复小节。",
              "不得概括或缩短实际交付内容。",
            ].join("\n"),
      },
      {
        role: "user",
        content: [
          language === "en" ? "## Required Headings" : "## 必需标题",
          ...requiredHeadings.map((heading) => `- ${heading}`),
          "",
          language === "en" ? "## Output Fragments" : "## 输出片段",
          fragments,
        ].join("\n"),
      },
    ], {

      maxTokens: 32_000,
    });
    return response.content.trim();
  }
  async writeScript(input: ScriptCreationInput): Promise<string> {
    const language = input.language ?? "zh";
    const messages = [
      { role: "system", content: buildScriptCreationSystemPrompt(language) },
      { role: "user", content: buildScriptCreationUserPrompt(input, language) },
    ] as const;
    const response = await completeLongForm({
      messages,
      language,
      generate: (continuationMessages) => this.chat(continuationMessages, {

        maxTokens: this.ctx.client.defaults.maxTokens,
      }),
      onContinuation: (pass) => this.log?.warn(`[script] Output limit reached; continuing pass ${pass}.`),
      recoverAfterContinuation: (fragments) => this.recoverProductionMarkdown(
        fragments,
        language,
        language === "en" ? ["## Characters", "## Script"] : ["## 人物", "## 剧本正文"],
      ),
    });
    return response.content.trim();
  }
}

export class StoryboardCreationAgent extends BaseAgent {
  get name(): string {
    return "storyboard-creation-writer";
  }

  async writeStoryboard(input: StoryboardCreationInput) {
    const language = input.language ?? "zh";
    const { result } = await this.submitStructured([
      { role: "system", content: buildStoryboardCreationSystemPrompt(language) },
      { role: "user", content: buildStoryboardCreationUserPrompt(input, language) },
    ], {
      name: "submit_storyboard_package",
      label: "Submit storyboard package",
      description: "Submit the complete human-readable storyboard and its generation-ready image prompts in shot order.",
      parameters: StoryboardPackageToolSchema,
    }, {

      maxTokens: this.ctx.client.defaults.maxTokens,
    });
    return {
      storyboard: result.storyboard.trim(),
      imagePrompts: result.imagePrompts.map((prompt) => prompt.trim()).filter(Boolean),
    };
  }
}

export class InteractiveFilmCreationAgent extends BaseAgent {
  get name(): string {
    return "interactive-film-creation-writer";
  }

  async createInteractiveFilmPackage(input: InteractiveFilmCreationInput) {
    const language = input.language ?? "zh";
    const { result } = await this.submitStructured([
      { role: "system", content: buildInteractiveFilmCreationSystemPrompt(language) },
      { role: "user", content: buildInteractiveFilmCreationUserPrompt(input, language) },
    ], {
      name: "submit_interactive_film_package",
      label: "Submit interactive-film package",
      description: "Submit the complete human-readable interactive-film production package. Each text field is a complete Markdown artifact; imagePrompts preserves shot order.",
      parameters: InteractiveFilmPackageToolSchema,
      validate: (result) => {
        materializeStoryGraph({
          projectId: "pending",
          title: input.title,
          content: result.storyGraph,
        });
        return result;
      },
    }, {

      maxTokens: this.ctx.client.defaults.maxTokens,
    });
    return result;
  }
}

function productionBrief(input: {authorRequest?: string; requirements?: string}, language: "zh" | "en") {
  const en = language === "en";
  return [
    ...(input.authorRequest?.trim() ? [en ? "## Author request" : "## 作者原始请求", input.authorRequest, ""] : []),
    en ? "## Production brief" : "## 创作任务与方案",
    en ? "This brief elaborates the task. Added production choices remain adjustable within the author's constraints."
      : "以下说明展开创作任务；其中补充的制作选择可在作者约束内调整。",
    input.requirements?.trim() || (en ? "Follow the author's request." : "遵循作者请求。"),
  ];
}

export function renderScriptSpec(input: ScriptCreationInput): string {
  if ((input.language ?? "zh") === "en") {
    return [
      `# ${input.title} Script Creation Spec`,
      "",
      "## Goal",
      `- Deliverable: ${formatScriptTarget(input.targetFormat, "en")}`,
      input.episodeCount
        ? `- Episode/segment count: ${input.episodeCount}`
        : "- Episode/segment count: unspecified; judge from the source material and user requirements",
      input.episodeDuration
        ? `- Per-episode/segment duration: ${input.episodeDuration}`
        : "- Per-episode/segment duration: unspecified",
      input.sourceKind
        ? `- Source material: ${input.sourceKind}`
        : "- Source material: user input / conversation brief",
      "",
      ...productionBrief(input, "en"),
      "",
      "## Source Material Summary",
      summarizeSourceForSpec(input.sourceText, "en"),
    ].join("\n");
  }
  return [
    `# ${input.title} 剧本创作规格`,
    "",
    "## 目标",
    `- 交付类型：${formatScriptTarget(input.targetFormat)}`,
    input.episodeCount ? `- 集数/段落数：${input.episodeCount}` : "- 集数/段落数：未指定，按素材和用户要求判断",
    input.episodeDuration ? `- 单集/单段时长：${input.episodeDuration}` : "- 单集/单段时长：未指定",
    input.sourceKind ? `- 原素材：${input.sourceKind}` : "- 原素材：用户输入/对话需求",
    "",
    ...productionBrief(input, "zh"),
    "",
    "## 源素材摘要",
    summarizeSourceForSpec(input.sourceText),
  ].join("\n");
}

export function renderStoryboardSpec(input: StoryboardCreationInput): string {
  if ((input.language ?? "zh") === "en") {
    return [
      `# ${input.title} Storyboard Creation Spec`,
      "",
      "## Goal",
      `- Shot granularity: ${input.granularity?.trim() || "unspecified"}`,
      `- Aspect ratio: ${input.aspectRatio?.trim() || "unspecified"}`,
      `- Visual style: ${input.visualStyle?.trim() || "unspecified"}`,
      input.maxShots ? `- Shot cap: ${input.maxShots}` : "- Shot cap: unspecified",
      input.sourceKind
        ? `- Source material: ${input.sourceKind}`
        : "- Source material: user input / conversation brief",
      "",
      ...productionBrief(input, "en"),
      "",
      "## Source Material Summary",
      summarizeSourceForSpec(input.sourceText, "en"),
    ].join("\n");
  }
  return [
    `# ${input.title} 分镜创作规格`,
    "",
    "## 目标",
    `- 分镜粒度：${input.granularity?.trim() || "未指定"}`,
    `- 画幅：${input.aspectRatio?.trim() || "未指定"}`,
    `- 视觉风格：${input.visualStyle?.trim() || "未指定"}`,
    input.maxShots ? `- 镜头上限：${input.maxShots}` : "- 镜头上限：未指定",
    input.sourceKind ? `- 原素材：${input.sourceKind}` : "- 原素材：用户输入/对话需求",
    "",
    ...productionBrief(input, "zh"),
    "",
    "## 源素材摘要",
    summarizeSourceForSpec(input.sourceText),
  ].join("\n");
}

export function renderInteractiveFilmSpec(input: InteractiveFilmCreationInput): string {
  if ((input.language ?? "zh") === "en") {
    return [
      `# ${input.title} Interactive Film Creation Spec`,
      "",
      "## Goal",
      "- Deliverable: interactive film / interactive narrative game / film-game script",
      "- Scope: story tree, variables/flags, playable node scripts, multiple endings, storyboards, and image assets",
      input.episodeCount
        ? `- Story segments/episodes: ${input.episodeCount}`
        : "- Story segments/episodes: unspecified; judge from the source material and user requirements",
      input.episodeDuration
        ? `- Per-segment/episode duration: ${input.episodeDuration}`
        : "- Per-segment/episode duration: unspecified",
      input.budget ? `- Budget constraint: ${input.budget}` : "- Budget constraint: unspecified",
      input.targetAudience ? `- Target audience: ${input.targetAudience}` : "- Target audience: unspecified",
      input.referenceMode
        ? `- Reference mode: ${input.referenceMode}`
        : "- Reference mode: unspecified by the user; do not impose a fixed game template",
      input.sourceKind
        ? `- Source material: ${input.sourceKind}`
        : "- Source material: user input / conversation brief",
      "",
      ...productionBrief(input, "en"),
      "",
      "## Source Material Summary",
      summarizeSourceForSpec(input.sourceText, "en"),
    ].join("\n");
  }
  return [
    `# ${input.title} 互动影游创作规格`,
    "",
    "## 目标",
    "- 交付类型：互动影游 / 互动叙事类游戏 / 影游剧本",
    "- 交付范围：剧情树、变量/旗标、可玩节点剧本、多结局、分镜与图片资产",
    input.episodeCount ? `- 剧情段落/集数：${input.episodeCount}` : "- 剧情段落/集数：未指定，按素材和用户要求判断",
    input.episodeDuration ? `- 单段/单集时长：${input.episodeDuration}` : "- 单段/单集时长：未指定",
    input.budget ? `- 预算约束：${input.budget}` : "- 预算约束：未指定",
    input.targetAudience ? `- 目标受众：${input.targetAudience}` : "- 目标受众：未指定",
    input.referenceMode ? `- 参考模式：${input.referenceMode}` : "- 参考模式：用户未指定，不擅自套固定游戏模板",
    input.sourceKind ? `- 原素材：${input.sourceKind}` : "- 原素材：用户输入/对话需求",
    "",
    ...productionBrief(input, "zh"),
    "",
    "## 源素材摘要",
    summarizeSourceForSpec(input.sourceText),
  ].join("\n");
}


function buildScriptCreationSystemPrompt(language: "zh" | "en" = "zh"): string {
  if (language === "en") {
    return [
      "Produce the confirmed script artifact with the activated script-writing Skill.",
      "The deliverable must include the exact Markdown headings `## Characters` and `## Script`, followed by a complete performable script rather than a proposal or outline.",
      "Output Markdown. No process notes, no model self-narration, no \"Here is\" preamble.",
    ].join("\n");
  }
  return [
    "按已激活的剧本创作 Skill 生成确认的剧本工件。",
    "交付稿必须包含准确的 Markdown 标题 `## 人物` 和 `## 剧本正文`，并在其后给出完整可排演剧本，不能只交方案或大纲。",
    "输出 Markdown。不要写流程说明、模型自述或“以下是”。",
  ].join("\n");
}

function buildScriptCreationUserPrompt(input: ScriptCreationInput, language: "zh" | "en" = "zh"): string {
  if (language === "en") {
    return [
      "## Creation Spec",
      renderScriptSpec(input),
      "",
      "## Full Source Material",
      input.sourceText?.trim()
        || "The user did not provide full source material; write an extensible script draft strictly from the creation spec and user requirements.",
      "",
      "## Output Format",
      `# ${input.title}`,
      "",
      "## Characters",
      "",
      "## Script",
      "",
      "Use the target format defined by the activated Skill and confirmed spec.",
    ].join("\n");
  }
  return [
    "## 创作规格",
    renderScriptSpec(input),
    "",
    "## 完整源素材",
    input.sourceText?.trim() || "用户没有提供完整源素材；请严格根据创作规格和用户要求写一个可继续扩展的剧本稿。",
    "",
    "## 输出格式",
    `# ${input.title}`,
    "",
    "## 人物",
    "",
    "## 剧本正文",
    "",
    "按已激活 Skill 和确认规格中的目标格式输出。",
  ].join("\n");
}

function buildStoryboardCreationSystemPrompt(language: "zh" | "en" = "zh"): string {
  if (language === "en") {
    return [
      "Execute the confirmed visual spec with the activated storyboard Skill; unconfirmed choices remain adjustable.",
      "Submit the complete human-readable storyboard and its image prompts together through the result tool. No model self-narration or process explanation.",
    ].join("\n");
  }
  return [
    "按已激活的分镜 Skill 执行确认的视觉规格；未确认选择保持可调整。",
    "通过结果工具同时提交完整可读分镜和对应图像提示词。不要写模型自述或流程解释。",
  ].join("\n");
}

function buildStoryboardCreationUserPrompt(input: StoryboardCreationInput, language: "zh" | "en" = "zh"): string {
  const maxShotsRule = input.maxShots
    ? (language === "en" ? `Do not exceed ${input.maxShots} shots.` : `镜头总数不得超过 ${input.maxShots}。`)
    : "";
  if (language === "en") {
    return [
      "## Storyboard Spec",
      renderStoryboardSpec(input),
      "",
      "## Full Source Material",
      input.sourceText?.trim()
        || "The user did not provide full source material; write an extensible storyboard draft strictly from the storyboard spec and user requirements.",
      "",
      "## Output Format",
      `# ${input.title} Storyboard`,
      "",
      "## Storyboard",
      "",
      maxShotsRule,
      "",
      "Return the complete shot document in storyboard. Put one image prompt per shot only in imagePrompts, in shot order; do not append another prompt list to storyboard.",
    ].join("\n");
  }
  return [
    "## 分镜规格",
    renderStoryboardSpec(input),
    "",
    "## 完整源素材",
    input.sourceText?.trim() || "用户没有提供完整源素材；请严格根据分镜规格和用户要求写一个可继续扩展的分镜稿。",
    "",
    "## 输出格式",
    `# ${input.title} 分镜`,
    "",
    "## 分镜表",
    "",
    maxShotsRule,
    "",
    "storyboard 字段只提交完整分镜文档。每镜头的一条图像提示词只放入 imagePrompts 数组，保持镜头顺序，不在分镜文档中再附提示词清单。",
  ].join("\n");
}

function buildInteractiveFilmCreationSystemPrompt(language: "zh" | "en" = "zh"): string {
  if (language === "en") {
    return [
      "Execute the confirmed spec with the activated interactive-film Skill; unconfirmed choices remain adjustable.",
      "Submit the complete package through the result tool. storyTree, flags, script, and storyboard are complete human-readable Markdown artifacts; imagePrompts preserve shot order; storyGraph is the playable graph for the same material.",
      "Put image prompts only in imagePrompts, one per shot in shot order. The storyboard field contains the shot document without a duplicate prompt list; include only the user's established visual constraints.",
    ].join("\n");
  }
  return [
    "按已激活的互动影游 Skill 执行确认规格；未确认选择保持可调整。",
    "通过结果工具提交完整交付包。storyTree、flags、script、storyboard 是完整且人可读的 Markdown 资产；imagePrompts 保持镜头顺序；storyGraph 是同一内容的可玩图谱。",
    "图像提示词只放入 imagePrompts 数组，每镜头一条并保持镜头顺序；storyboard 字段只写分镜，不重复附提示词清单。只写用户已明确的视觉限制。",
  ].join("\n");
}

function buildInteractiveFilmCreationUserPrompt(input: InteractiveFilmCreationInput, language: "zh" | "en" = "zh"): string {
  if (language === "en") {
    return [
      "## Interactive Film Spec",
      renderInteractiveFilmSpec(input),
      "",
      "## Full Source Material",
      input.sourceText?.trim()
        || "The user did not provide full source material; write an extensible interactive-film deliverable strictly from the creation spec and user requirements.",
      "",
      "## Output Format",
      `# ${input.title} Interactive Film Package`,
      "",
      "## Story Tree",
      "Provide the complete story tree using the activated Skill.",
      "",
      "## Variables and Flags",
      "Provide the complete variables and flags surface using the activated Skill.",
      "",
      "## Ending Paths",
      "Provide every ending path and its conditions.",
      "",
      "## Interactive Script",
      "Provide the complete playable node scripts.",
      "",
      "## Storyboard and Image Prompts",
      "Return the shot document in storyboard and the corresponding prompt list only in imagePrompts, in shot order.",
      "",
      "## Playable Story Graph",
      "Submit the complete graph for the same story in storyGraph: exactly one start, at least one meaningful choice with distinct destinations or state consequences, and every path can reach an ending. The opening node may carry the first branching choice directly.",
    ].join("\n");
  }
  return [
    "## 互动影游规格",
    renderInteractiveFilmSpec(input),
    "",
    "## 完整源素材",
    input.sourceText?.trim() || "用户没有提供完整源素材；请严格根据创作规格和用户要求写一个可继续扩展的互动影游交付稿。",
    "",
    "## 输出格式",
    `# ${input.title} 互动影游方案`,
    "",
    "## 剧情树",
    "按已激活 Skill 提交完整剧情树。",
    "",
    "## 变量与旗标表",
    "按已激活 Skill 提交完整变量与旗标面。",
    "",
    "## 多结局路径",
    "提交全部结局路径及其条件。",
    "",
    "## 互动剧本",
    "提交完整可玩的节点剧本。",
    "",
    "## 分镜与图像提示词",
    "storyboard 字段提交完整分镜；对应图像提示词只放入 imagePrompts 数组，保持镜头顺序。",
    "",
    "## 可玩故事图谱",
    "在 storyGraph 字段提交同一剧情的完整可玩图谱：恰好一个 start，至少一个具有不同去向或状态后果的真实分支选择，且每条路径可达 ending。开场节点可以直接承载分支选择。",
  ].join("\n");
}

function formatScriptTarget(value: ScriptTargetFormat | undefined, language: "zh" | "en" = "zh"): string {
  const custom = value?.trim();
  if (custom && !["vertical_short_drama", "screenplay", "audio_drama", "interactive_script", "general_script"].includes(custom)) {
    return custom;
  }
  if (language === "en") {
    switch (value) {
      case "vertical_short_drama":
        return "vertical short drama";
      case "screenplay":
        return "standard screenplay";
      case "audio_drama":
        return "audio drama";
      case "interactive_script":
        return "interactive script";
      case "general_script":
      default:
        return "general script";
    }
  }
  switch (value) {
    case "vertical_short_drama":
      return "竖屏短剧";
    case "screenplay":
      return "标准剧本";
    case "audio_drama":
      return "广播剧/有声剧";
    case "interactive_script":
      return "互动剧本";
    case "general_script":
    default:
      return "通用剧本";
  }
}

function summarizeSourceForSpec(sourceText: string | undefined, language: "zh" | "en" = "zh"): string {
  const text = sourceText?.replace(/\s+/g, " ").trim();
  if (language === "en") {
    if (!text) return "No full source material provided.";
    return `Full source material provided, about ${text.length} characters; the full content will be read during generation.`;
  }
  if (!text) return "未提供完整源素材。";
  return `已提供完整源素材，约 ${text.length} 字符；生成时会读取完整内容。`;
}
