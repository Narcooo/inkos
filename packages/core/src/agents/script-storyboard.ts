import { BaseAgent } from "./base.js";
import { completeLongForm } from "../llm/long-form-completion.js";

export type ScriptTargetFormat =
  | "vertical_short_drama"
  | "screenplay"
  | "audio_drama"
  | "interactive_script"
  | "general_script";

export interface ScriptCreationInput {
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
  readonly title: string;
  readonly sourceKind?: string;
  readonly sourceText?: string;
  readonly requirements?: string;
  readonly visualStyle?: string;
  readonly aspectRatio?: string;
  readonly granularity?: string;
  readonly maxShots?: number;
  readonly language?: "zh" | "en";
  readonly segment?: {
    readonly label: string;
    readonly index: number;
    readonly count: number;
    readonly estimatedShots: number;
  };
}

export interface InteractiveFilmCreationInput {
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

abstract class LongFormProductionAgent extends BaseAgent {
  protected async recoverProductionMarkdown(
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
      temperature: 0.1,
      maxTokens: 32_000,
    });
    return response.content.trim();
  }
}

export class ScriptCreationAgent extends LongFormProductionAgent {
  get name(): string {
    return "script-creation-writer";
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
        temperature: 0.55,
        maxTokens: estimateScriptMaxTokens(input),
      }),
      onContinuation: (pass) => this.log?.warn(`[script] Output limit reached; continuing pass ${pass}.`),
      recoverAfterContinuation: (fragments) => this.recoverProductionMarkdown(
        fragments,
        language,
        language === "en" ? ["## Characters", "## Script"] : ["## 人物", "## 剧本正文"],
      ),
    });
    return extractProductionDocument(response.content, input.title);
  }
}

export class StoryboardCreationAgent extends LongFormProductionAgent {
  get name(): string {
    return "storyboard-creation-writer";
  }

  async writeStoryboard(input: StoryboardCreationInput): Promise<string> {
    const language = input.language ?? "zh";
    const messages = [
      { role: "system", content: buildStoryboardCreationSystemPrompt(language) },
      { role: "user", content: buildStoryboardCreationUserPrompt(input, language) },
    ] as const;
    const response = await completeLongForm({
      messages,
      language,
      generate: (continuationMessages) => this.chat(continuationMessages, {
        temperature: 0.45,
        maxTokens: estimateStoryboardMaxTokens(input),
      }),
      onContinuation: (pass) => this.log?.warn(`[storyboard] Output limit reached; continuing pass ${pass}.`),
      recoverAfterContinuation: (fragments) => this.recoverProductionMarkdown(
        fragments,
        language,
        language === "en" ? ["## Storyboard", "## Image Prompts"] : ["## 分镜表", "## 图像提示词"],
      ),
    });
    return extractProductionDocument(response.content, input.title);
  }
}

export class InteractiveFilmCreationAgent extends LongFormProductionAgent {
  get name(): string {
    return "interactive-film-creation-writer";
  }

  async writeInteractiveFilm(input: InteractiveFilmCreationInput): Promise<string> {
    const language = input.language ?? "zh";
    const messages = [
      { role: "system", content: buildInteractiveFilmCreationSystemPrompt(language) },
      { role: "user", content: buildInteractiveFilmCreationUserPrompt(input, language) },
    ] as const;
    const response = await completeLongForm({
      messages,
      language,
      generate: (continuationMessages) => this.chat(continuationMessages, {
        temperature: 0.5,
        maxTokens: estimateInteractiveFilmMaxTokens(input),
      }),
      onContinuation: (pass) => this.log?.warn(`[interactive-film] Output limit reached; continuing pass ${pass}.`),
      recoverAfterContinuation: (fragments) => this.recoverProductionMarkdown(
        fragments,
        language,
        language === "en"
          ? ["## Story Tree", "## Variables and Flags", "## Ending Paths", "## Interactive Script", "## Storyboard and Image Prompts"]
          : ["## 剧情树", "## 变量与旗标表", "## 多结局路径", "## 互动剧本", "## 分镜与图像提示词"],
      ),
    });
    return extractProductionDocument(response.content, input.title);
  }
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
      "## User Requirements",
      input.requirements?.trim() || "Not separately specified; follow the instruction the user confirmed.",
      "",
      "## Adaptation Boundaries",
      "- Preserve the characters, relationships, conflicts, key events, and taboos the user explicitly specified.",
      "- Never decide adaptation intensity (\"faithful adaptation / commercial punch-up / low-budget shoot\") on the user's behalf; execute only the spec the user has confirmed.",
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
    "## 用户要求",
    input.requirements?.trim() || "未单独指定；以用户确认时的 instruction 为准。",
    "",
    "## 改编边界",
    "- 优先保留用户明确指定的人物、关系、冲突、关键事件和禁忌。",
    "- 不替用户擅自决定“忠实改编 / 商业强化 / 低成本拍摄”等强度；只执行用户已确认的规格。",
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
      `- Shot granularity: ${input.granularity?.trim() || "split by scene and key shots"}`,
      `- Aspect ratio: ${input.aspectRatio?.trim() || "unspecified; default to what the user's material and target imply"}`,
      `- Visual style: ${input.visualStyle?.trim() || "unspecified; judge from the user's material and target platform"}`,
      input.maxShots ? `- Shot cap: ${input.maxShots}` : "- Shot cap: unspecified",
      input.sourceKind
        ? `- Source material: ${input.sourceKind}`
        : "- Source material: user input / conversation brief",
      "",
      "## User Requirements",
      input.requirements?.trim() || "Not separately specified; follow the instruction the user confirmed.",
      "",
      "## Storyboard Boundaries",
      "- A storyboard is a creative tool, not a locked-in shooting plan; the output must stay easy to discuss, extend, trim, and re-shoot.",
      "- Follow only the art style, format, composition, and visual constraints the user has confirmed; never turn unstated preferences into default hard constraints.",
      "",
      "## Source Material Summary",
      summarizeSourceForSpec(input.sourceText, "en"),
    ].join("\n");
  }
  return [
    `# ${input.title} 分镜创作规格`,
    "",
    "## 目标",
    `- 分镜粒度：${input.granularity?.trim() || "按场景和关键镜头拆分"}`,
    `- 画幅：${input.aspectRatio?.trim() || "未指定，默认按用户素材目标判断"}`,
    `- 视觉风格：${input.visualStyle?.trim() || "未指定，按用户素材和目标平台判断"}`,
    input.maxShots ? `- 镜头上限：${input.maxShots}` : "- 镜头上限：未指定",
    input.sourceKind ? `- 原素材：${input.sourceKind}` : "- 原素材：用户输入/对话需求",
    "",
    "## 用户要求",
    input.requirements?.trim() || "未单独指定；以用户确认时的 instruction 为准。",
    "",
    "## 分镜边界",
    "- 分镜是创作工具，不替用户锁死最终拍法；输出要便于继续讨论、增删、改镜头。",
    "- 只遵循用户已确认的画风、格式、构图和视觉限制；用户没说的，不写成默认硬限制。",
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
      "## User Requirements",
      input.requirements?.trim() || "Not separately specified; follow the instruction the user confirmed.",
      "",
      "## Interactive Film Boundaries",
      "- Do not impose RPG stats, combat formulas, equipment tiers, or any other mechanics the user did not request.",
      "- Never decide subject matter, budget, art style, or commercial punch-up intensity on the user's behalf; mark anything unspecified as adjustable.",
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
    "## 用户要求",
    input.requirements?.trim() || "未单独指定；以用户确认时的 instruction 为准。",
    "",
    "## 互动影游边界",
    "- 不擅自加入用户没有要求的 RPG 数值、战斗公式、装备等级或其他玩法系统。",
    "- 不替用户擅自决定题材、预算、画风和商业强化强度；未指定处写为可调整。",
    "",
    "## 源素材摘要",
    summarizeSourceForSpec(input.sourceText),
  ].join("\n");
}

export function extractStoryboardImagePrompts(raw: string): string {
  const section = extractMarkdownSection(raw, [
    "图像提示词",
    "分镜图提示词",
    "Image Prompts",
    "Shot Image Prompts",
  ]);
  const source = section?.trim() || raw.trim();
  const prompts = extractPromptLines(source);
  return prompts.length > 0 ? prompts.map((prompt, index) => `${index + 1}. ${prompt}`).join("\n") : "";
}

export function extractMarkdownSection(raw: string, headings: readonly string[]): string | undefined {
  const lines = raw.split(/\r?\n/);
  let start = -1;
  let level = 0;
  const normalizedHeadings = headings.map(normalizeHeadingText);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s*(.+?)\s*$/u.exec(lines[index] ?? "");
    if (!match) continue;
    const text = normalizeHeadingText(match[2]!);
    if (normalizedHeadings.some((heading) => headingMatches(text, heading))) {
      start = index + 1;
      level = match[1]!.length;
      break;
    }
  }
  if (start < 0) return undefined;
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+/u.exec(lines[index] ?? "");
    if (match && match[1]!.length <= level) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

export function countMarkdownSections(raw: string, headings: readonly string[]): number {
  const normalizedHeadings = headings.map(normalizeHeadingText);
  let count = 0;
  for (const line of raw.split(/\r?\n/)) {
    const match = /^(#{1,6})\s*(.+?)\s*$/u.exec(line);
    if (!match) continue;
    const text = normalizeHeadingText(match[2]!);
    if (normalizedHeadings.some((heading) => headingMatches(text, heading))) count += 1;
  }
  return count;
}

export function extractProductionDocument(raw: string, title: string): string {
  const lines = raw.split(/\r?\n/);
  const normalizedTitle = normalizeHeadingText(title);
  const start = lines.findIndex((line) => {
    const match = /^#\s+(.+?)\s*$/u.exec(line);
    if (!match) return false;
    return normalizeHeadingText(match[1]!).startsWith(normalizedTitle);
  });
  return (start >= 0 ? lines.slice(start).join("\n") : raw).trim();
}

function normalizeHeadingText(text: string): string {
  return text
    .trim()
    .replace(/^\*\*(.+)\*\*$/u, "$1")
    .replace(/[`*_]+/gu, "")
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function headingMatches(text: string, heading: string): boolean {
  if (text === heading) return true;
  if (!text.startsWith(heading)) return false;
  const rest = text.slice(heading.length).trim();
  return rest === "" || /^[（(【\[\s:：\-—]/u.test(rest);
}

export function normalizeScriptEpisodeEndLabels(script: string): string {
  const lines = script.split(/\r?\n/);
  let currentEpisode: string | null = null;
  return lines.map((line) => {
    const heading = /^#{1,6}\s*第\s*([一二三四五六七八九十百千万\d]+)\s*集(?:\s|$)/u.exec(line.trim());
    if (heading) currentEpisode = heading[1]!;
    if (!currentEpisode) return line;
    return line.replace(
      /(字幕\s*[：:]\s*)第\s*[一二三四五六七八九十百千万\d]+\s*集完/gu,
      `$1第${currentEpisode}集完`,
    );
  }).join("\n");
}

function buildScriptCreationSystemPrompt(language: "zh" | "en" = "zh"): string {
  if (language === "en") {
    return [
      "You are a script-creation tool, not a novel-continuation engine.",
      "This is a non-interactive production call after user confirmation. Execute the confirmed creation spec and source material now.",
      "Never ask a question, offer options for the user to choose, or defer writing. Resolve unspecified creative details with a coherent working choice; they remain editable later.",
      "The deliverable must include the exact Markdown headings `## Characters` and `## Script`, followed by a complete performable script rather than a proposal or outline.",
      "Output Markdown. No process notes, no model self-narration, no \"Here is\" preamble.",
    ].join("\n");
  }
  return [
    "你是剧本创作工具，不是小说续写器。",
    "这是用户确认后的非交互生产调用。现在执行已确认的创作规格和源素材。",
    "不得提问、给用户列待选方案或推迟落笔。未指定的创意细节采用连贯的工作版本，后续仍可编辑。",
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
      "Follow the target format. Vertical short drama: \"Episode N / scene slug / characters / action / dialogue / end-of-episode hook\". Standard screenplay: \"scene heading / action / character / dialogue\".",
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
    "按目标格式输出。竖屏短剧使用“第N集 / 场次 / 人物 / 动作 / 对白 / 集尾钩子”；标准剧本使用“场景标题 / 动作 / 角色 / 对白”。",
  ].join("\n");
}

function buildStoryboardCreationSystemPrompt(language: "zh" | "en" = "zh"): string {
  if (language === "en") {
    return [
      "You are a storyboard-creation tool. Execute the confirmed visual spec and source material; unconfirmed choices remain adjustable.",
      "Output Markdown. No model self-narration or process explanation.",
    ].join("\n");
  }
  return [
    "你是分镜创作工具。执行用户确认的视觉规格和源素材；未确认的选择保持可调整。",
    "输出 Markdown。不要写模型自述或流程解释。",
  ].join("\n");
}

function buildStoryboardCreationUserPrompt(input: StoryboardCreationInput, language: "zh" | "en" = "zh"): string {
  const maxShots = input.maxShots ?? 24;
  if (language === "en") {
    return [
      "## Storyboard Spec",
      renderStoryboardSpec(input),
      "",
      "## Full Source Material",
      input.sourceText?.trim()
        || "The user did not provide full source material; write an extensible storyboard draft strictly from the storyboard spec and user requirements.",
      ...(input.segment ? [
        "",
        "## Current Production Segment",
        `Write only ${input.segment.label} (${input.segment.index + 1}/${input.segment.count}) in this call. The global shot cap is NOT the shot count for this call. Preserve all global requirements and follow the exact scene/segment shot count when the user confirmed one. Do not summarize or write any other segment.`,
      ] : []),
      "",
      "## Output Format",
      `# ${input.title} Storyboard`,
      "",
      "## Storyboard",
      "",
      `Output at most ${maxShots} shots. Each shot includes: shot number, visual, characters/objects, action, shot size/camera, dialogue/captions, suggested duration, notes.`,
      "",
      "## Image Prompts",
      "",
      "Write one generation-ready image prompt per shot. Each prompt MUST be its own `Prompt: ...` line; never merge it into the storyboard body, table headers, or explanations. Include only the visual constraints the user has confirmed.",
    ].join("\n");
  }
  return [
    "## 分镜规格",
    renderStoryboardSpec(input),
    "",
    "## 完整源素材",
    input.sourceText?.trim() || "用户没有提供完整源素材；请严格根据分镜规格和用户要求写一个可继续扩展的分镜稿。",
    ...(input.segment ? [
      "",
      "## 当前生产分段",
      `本次只写${input.segment.label}（${input.segment.index + 1}/${input.segment.count}）。全局镜头上限不是本次镜头数。保留全部全局要求；用户已确认本场/本段镜头数时严格按该数量执行。不要概括或生成任何其他分段。`,
    ] : []),
    "",
    "## 输出格式",
    `# ${input.title} 分镜`,
    "",
    "## 分镜表",
    "",
    `输出不超过 ${maxShots} 个镜头。每个镜头包含：镜号、画面、人物/物件、动作、景别/机位、对白/字幕、时长建议、备注。`,
    "",
    "## 图像提示词",
    "",
    "为每个镜头写一条可用于生图的提示词。每条必须单独写成 `Prompt: ...`，不要混入分镜正文、表头或解释；只写用户确认过的视觉限制。",
  ].join("\n");
}

function buildInteractiveFilmCreationSystemPrompt(language: "zh" | "en" = "zh"): string {
  if (language === "en") {
    return [
      "You are an interactive-film creation tool. Execute the confirmed spec and source material; unconfirmed choices remain adjustable.",
      "Output must be Markdown with the specified sections. No model self-narration, process notes, or \"Here is\" preamble.",
      "Every storyboard image prompt must be its own standalone `Prompt: ...` line so downstream asset management can pick it up; include only the visual constraints the user has confirmed.",
    ].join("\n");
  }
  return [
    "你是互动影游创作工具。执行用户确认的规格和源素材；未确认的选择保持可调整。",
    "输出必须是 Markdown，包含指定小节。不要写模型自述、流程说明或“以下是”。",
    "分镜图提示词必须写成单独的 `Prompt: ...` 行，便于后续资产管理；只写用户确认过的视觉限制。",
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
      "Lay out main-line nodes, branch nodes, key choices, and merge/no-return relationships as Markdown. The multi-ending structure must be visible at a glance.",
      "",
      "## Variables and Flags",
      "List each variable/flag: name, meaning, trigger, scope of impact, and related nodes. Variables may be relationships, states, evidence, items, identities, secret/public status, ending gates, and so on.",
      "",
      "## Ending Paths",
      "For every ending: its unlock conditions, the key choice chain, the required variables/flags, plus any failure or hidden-ending conditions.",
      "",
      "## Interactive Script",
      "Write a playable script per node: scene, characters, action, dialogue, player choices, variable changes, and branch destinations. Never write summaries only.",
      "",
      "## Storyboard and Image Prompts",
      "List the key shots. Each shot includes visual, characters/objects, action, shot size, and suggested duration. After each shot, add exactly one standalone `Prompt: ...` line.",
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
    "用 Markdown 列出主线节点、分支节点、关键选择、回流/不可回流关系。必须能看出多结局结构。",
    "",
    "## 变量与旗标表",
    "列出变量/旗标名、含义、触发方式、影响范围、对应节点。变量可以是关系、状态、证据、物品、身份、公开/隐瞒、结局门槛等。",
    "",
    "## 多结局路径",
    "列出每个结局的达成条件、关键选择链、必需变量/旗标，以及失败或隐藏结局条件。",
    "",
    "## 互动剧本",
    "按节点写可演剧本：场景、人物、动作、对白、玩家选择、变量变化和分支去向。不要只写摘要。",
    "",
    "## 分镜与图像提示词",
    "列出关键镜头。每个镜头包含画面、人物/物件、动作、景别、时长建议。每个镜头后必须单独写一行 `Prompt: ...`。",
  ].join("\n");
}

function formatScriptTarget(value: ScriptTargetFormat | undefined, language: "zh" | "en" = "zh"): string {
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

function estimateScriptMaxTokens(input: ScriptCreationInput): number {
  const episodes = input.episodeCount ?? 6;
  return Math.min(32000, Math.max(12000, episodes * 2200));
}

function estimateStoryboardMaxTokens(input: StoryboardCreationInput): number {
  const shots = input.segment?.estimatedShots ?? input.maxShots ?? 24;
  // Each shot includes both an editable shot record and a standalone image
  // prompt. The old 700-token estimate cut off complete 13-shot scenes.
  return Math.min(48000, Math.max(12000, shots * 1800));
}

function estimateInteractiveFilmMaxTokens(input: InteractiveFilmCreationInput): number {
  const episodes = input.episodeCount ?? 6;
  return Math.min(36000, Math.max(16000, episodes * 3000));
}

function extractPromptLines(markdown: string): string[] {
  const prompts: string[] = [];
  let promptColumnIndex = -1;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine
      .trim()
      .replace(/^`{1,3}\s*/u, "")
      .replace(/\s*`{1,3}$/u, "")
      .trim();
    if (!line) {
      promptColumnIndex = -1;
      continue;
    }
    const tableCells = parseMarkdownTableRow(line);
    if (tableCells) {
      if (isMarkdownTableSeparator(tableCells)) continue;
      const headerIndex = tableCells.findIndex(isPromptColumnHeader);
      if (headerIndex >= 0) {
        promptColumnIndex = headerIndex;
        continue;
      }
      if (promptColumnIndex >= 0) {
        const prompt = cleanPromptText(tableCells[promptColumnIndex] ?? "");
        if (prompt) prompts.push(prompt);
      }
      continue;
    }
    promptColumnIndex = -1;
    const promptMatch = /(?:^|[|>\-\d.)、\s])(?:\*\*)?\s*(?:Prompt(?:\s+for\s+[^:*：]+)?|提示词(?:\s*[^:*：]+)?|图像提示词|分镜图提示词)\s*(?:\*\*)?\s*[：:]\s*(.+?)\s*$/iu.exec(line);
    if (!promptMatch) continue;
    const prompt = cleanPromptText(promptMatch[1]!);
    if (prompt) prompts.push(prompt);
  }
  return prompts;
}

function parseMarkdownTableRow(line: string): string[] | undefined {
  if (!line.startsWith("|") || !line.endsWith("|")) return undefined;
  const cells = line.slice(1, -1).split("|").map((cell) => cell.trim());
  return cells.length >= 2 ? cells : undefined;
}

function isMarkdownTableSeparator(cells: readonly string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function isPromptColumnHeader(cell: string): boolean {
  return /^(?:prompt|image\s*prompt|shot\s*prompt|提示词|图像提示词|分镜图提示词)$/iu.test(
    cell.replace(/[`*_]+/gu, "").trim(),
  );
}

function cleanPromptText(text: string): string {
  return text
    .replace(/^`{1,3}\s*/u, "")
    .replace(/\s*`{1,3}$/u, "")
    .replace(/\s*\|\s*$/u, "")
    .replace(/\*\*$/u, "")
    .replace(/^(?:Prompt(?:\s+for\s+[^:*：]+)?|提示词(?:\s*[^:*：]+)?|图像提示词|分镜图提示词)\s*[：:]\s*/iu, "")
    .replace(/\s+/g, " ")
    .trim();
}
