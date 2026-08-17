import { access, mkdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { AgentContext } from "../agents/base.js";
import { generateStoryGraph } from "../interactive-film/generate.js";
import type { StoryGraph } from "../interactive-film/graph-schema.js";
import {
  commitProductionArtifacts,
  createProductionRunSnapshot,
} from "../production/harness.js";
import {
  InteractiveFilmCreationAgent,
  ScriptCreationAgent,
  StoryboardCreationAgent,
  countMarkdownSections,
  extractStoryboardImagePrompts,
  extractMarkdownSection,
  normalizeScriptEpisodeEndLabels,
  renderInteractiveFilmSpec,
  renderScriptSpec,
  renderStoryboardSpec,
  type InteractiveFilmCreationInput,
  type ScriptCreationInput,
  type ScriptTargetFormat,
  type StoryboardCreationInput,
} from "../agents/script-storyboard.js";
import { safeChildPath } from "../utils/path-safety.js";
import { toPosixPath } from "../utils/posix-path.js";

export interface ScriptCreationRunOptions {
  readonly projectRoot: string;
  readonly runtime: AgentContext;
  readonly title: string;
  readonly instruction: string;
  readonly sourceKind?: string;
  readonly targetFormat?: ScriptTargetFormat;
  readonly sourceText?: string;
  readonly sourcePath?: string;
  readonly requirements?: string;
  readonly episodeCount?: number;
  readonly episodeDuration?: string;
  readonly language?: "zh" | "en";
  readonly projectId?: string;
  readonly outDir?: string;
  readonly onProgress?: (message: string) => void;
}

export interface StoryboardCreationRunOptions {
  readonly projectRoot: string;
  readonly runtime: AgentContext;
  readonly title: string;
  readonly instruction: string;
  readonly sourceKind?: string;
  readonly sourceText?: string;
  readonly sourcePath?: string;
  readonly requirements?: string;
  readonly visualStyle?: string;
  readonly aspectRatio?: string;
  readonly granularity?: string;
  readonly maxShots?: number;
  readonly language?: "zh" | "en";
  readonly projectId?: string;
  readonly outDir?: string;
  readonly onProgress?: (message: string) => void;
}

export interface InteractiveFilmCreationRunOptions {
  readonly projectRoot: string;
  readonly runtime: AgentContext;
  readonly title: string;
  readonly instruction: string;
  readonly sourceKind?: string;
  readonly sourceText?: string;
  readonly sourcePath?: string;
  readonly requirements?: string;
  readonly targetAudience?: string;
  readonly episodeCount?: number;
  readonly episodeDuration?: string;
  readonly budget?: string;
  readonly referenceMode?: string;
  readonly language?: "zh" | "en";
  readonly projectId?: string;
  readonly outDir?: string;
  readonly onProgress?: (message: string) => void;
}

export interface ScriptCreationRunResult {
  readonly projectId: string;
  readonly baseDir: string;
  readonly specPath: string;
  readonly scriptPath: string;
}

export interface InteractiveFilmCreationRunResult {
  readonly projectId: string;
  readonly baseDir: string;
  readonly storyGraphPath: string;
  readonly specPath: string;
  readonly storyTreePath: string;
  readonly flagsPath: string;
  readonly scriptPath: string;
  readonly storyboardPath: string;
  readonly imagePromptsPath: string;
  readonly assetsManifestPath: string;
  readonly assetsDir: string;
}

export interface StoryboardCreationRunResult {
  readonly projectId: string;
  readonly baseDir: string;
  readonly specPath: string;
  readonly storyboardPath: string;
  readonly imagePromptsPath: string;
  readonly assetsManifestPath: string;
  readonly assetsDir: string;
}

export interface StoryboardImageAssetVariant {
  readonly id: string;
  readonly path: string;
  readonly status: "pending" | "generated" | "selected" | "failed";
  readonly model?: string;
  readonly provider?: string;
  readonly createdAt?: string;
  readonly error?: string;
}

export interface StoryboardImageAsset {
  readonly shotId: string;
  readonly prompt: string;
  readonly sourceRefs: readonly string[];
  readonly variants: readonly StoryboardImageAssetVariant[];
  readonly selectedPath?: string;
  readonly status: "prompt_ready" | "generated" | "selected" | "failed";
}

export interface StoryboardAssetsManifest {
  readonly version: 1;
  readonly kind: "storyboard_assets";
  readonly title: string;
  readonly projectId: string;
  readonly baseDir: string;
  readonly storyboardPath: string;
  readonly imagePromptsPath: string;
  readonly assetsDir: string;
  readonly sourceDir: string;
  readonly generatedDir: string;
  readonly selectedDir: string;
  readonly createdAt: string;
  readonly assets: readonly StoryboardImageAsset[];
}

export async function runScriptCreation(
  options: ScriptCreationRunOptions,
): Promise<ScriptCreationRunResult> {
  const projectId = safeSegment(options.projectId ?? slugify(options.title));
  const baseDir = resolveProjectBaseDir(options.outDir ?? "dramas", projectId);
  const sourceText = await resolveSourceText(options.projectRoot, options.sourceText, options.sourcePath);
  const input: ScriptCreationInput = {
    title: options.title,
    sourceKind: options.sourceKind,
    targetFormat: options.targetFormat,
    sourceText,
    requirements: mergeRequirements(options.instruction, options.requirements, options.language),
    episodeCount: options.episodeCount,
    episodeDuration: options.episodeDuration,
    language: options.language,
  };

  options.onProgress?.("Writing script creation spec...");
  const spec = renderScriptSpec(input);

  options.onProgress?.("Writing script draft...");
  const agent = new ScriptCreationAgent(options.runtime);
  const script = normalizeScriptEpisodeEndLabels(await agent.writeScript(input));
  assertScriptDeliverable(script, options.language ?? "zh");
  const artifacts = [
    textArtifact(join(baseDir, "script-spec.md"), spec),
    textArtifact(join(baseDir, "script.md"), script),
  ];
  await commitProductionArtifacts({
    rootDir: options.projectRoot,
    artifacts,
    runPath: join(baseDir, "status.json"),
    run: createProductionRunSnapshot({
      kind: "script",
      id: projectId,
      status: "complete",
      stage: "commit",
      artifacts: artifacts.map((artifact) => artifact.relativePath),
      observations: [],
    }),
    validate: () => assertNonEmptyArtifacts(artifacts),
  });

  return {
    projectId,
    baseDir,
    specPath: relPath(baseDir, "script-spec.md"),
    scriptPath: relPath(baseDir, "script.md"),
  };
}

function assertScriptDeliverable(script: string, language: "zh" | "en"): void {
  const characterHeadings = language === "en" ? ["Characters"] : ["人物", "Characters"];
  const scriptHeadings = language === "en" ? ["Script"] : ["剧本正文", "Script"];
  const body = extractMarkdownSection(
    script,
    scriptHeadings,
  );
  const characterSectionCount = countMarkdownSections(script, characterHeadings);
  const scriptSectionCount = countMarkdownSections(script, scriptHeadings);
  if (!body?.trim() || characterSectionCount !== 1 || scriptSectionCount !== 1) {
    throw new Error(
      language === "en"
        ? "Script production did not return exactly one `## Characters` and one non-empty `## Script` deliverable. No artifacts were committed."
        : "剧本生产没有返回且仅返回一份 `## 人物` 和一份非空 `## 剧本正文` 交付段，未提交任何产物。",
    );
  }
}

export async function runInteractiveFilmCreation(
  options: InteractiveFilmCreationRunOptions,
): Promise<InteractiveFilmCreationRunResult> {
  const projectId = safeSegment(options.projectId ?? slugify(options.title));
  const baseDir = resolveProjectBaseDir(options.outDir ?? "interactive-films", projectId);
  const sourceText = await resolveSourceText(options.projectRoot, options.sourceText, options.sourcePath);
  const input: InteractiveFilmCreationInput = {
    title: options.title,
    sourceKind: options.sourceKind,
    sourceText,
    requirements: mergeRequirements(options.instruction, options.requirements, options.language),
    targetAudience: options.targetAudience,
    episodeCount: options.episodeCount,
    episodeDuration: options.episodeDuration,
    budget: options.budget,
    referenceMode: options.referenceMode,
    language: options.language,
  };

  options.onProgress?.("Writing interactive-film creation spec...");
  const spec = renderInteractiveFilmSpec(input);

  options.onProgress?.("Writing story tree, flags, script, storyboard, and image prompts...");
  const agent = new InteractiveFilmCreationAgent(options.runtime);
  const packageMarkdown = await agent.writeInteractiveFilm(input);
  const storyTree = requiredSection(packageMarkdown, [
    "剧情树",
    "Story Tree",
    "Branching Story Tree",
  ], packageMarkdown);
  const flags = requiredSection(packageMarkdown, [
    "旗标与变量系统说明",
    "变量与旗标表",
    "变量和旗标表",
    "变量表",
    "旗标表",
    "Variables and Flags",
    "Flag Table",
  ], packageMarkdown);
  const script = requiredSection(packageMarkdown, [
    "互动剧本",
    "Interactive Script",
    "Script",
  ], packageMarkdown);
  const storyboard = requiredSection(packageMarkdown, [
    "分镜与图像提示词",
    "分镜表",
    "Storyboard and Image Prompts",
    "Storyboard",
  ], packageMarkdown);
  const imagePrompts = extractStoryboardImagePrompts(storyboard);
  const storyGraphPath = relPath("interactive-films", projectId, "story-graph.json");

  await ensureProjectDir(options.projectRoot, join(baseDir, "assets", "source"));
  await ensureProjectDir(options.projectRoot, join(baseDir, "assets", "generated"));
  await ensureProjectDir(options.projectRoot, join(baseDir, "assets", "selected"));
  const assetsManifest = createStoryboardAssetsManifest({
    title: options.title,
    projectId,
    baseDir,
    storyboardPath: join(baseDir, "storyboard.md"),
    imagePromptsPath: join(baseDir, "image-prompts.md"),
    imagePrompts,
    createdAt: new Date().toISOString(),
  });

  options.onProgress?.("Writing interactive-film story graph...");
  const graph = await createInteractiveFilmStoryGraph(options.runtime, {
    projectId,
    title: options.title,
    input,
    storyTree,
    flags,
    script,
    imagePrompts,
    onProgress: options.onProgress,
  });
  const artifacts = [
    textArtifact(join(baseDir, "interactive-spec.md"), spec),
    textArtifact(join(baseDir, "story-tree.md"), storyTree),
    textArtifact(join(baseDir, "flags.md"), flags),
    textArtifact(join(baseDir, "script.md"), normalizeScriptEpisodeEndLabels(script)),
    textArtifact(join(baseDir, "storyboard.md"), storyboard),
    textArtifact(join(baseDir, "image-prompts.md"), imagePrompts),
    textArtifact(join(baseDir, "assets.json"), JSON.stringify(assetsManifest, null, 2)),
    textArtifact(storyGraphPath, JSON.stringify(graph, null, 2)),
  ];
  await commitProductionArtifacts({
    rootDir: options.projectRoot,
    artifacts,
    runPath: join(baseDir, "status.json"),
    run: createProductionRunSnapshot({
      kind: "interactive-film",
      id: projectId,
      status: "complete",
      stage: "commit",
      artifacts: artifacts.map((artifact) => artifact.relativePath),
      observations: [],
    }),
    validate: () => assertNonEmptyArtifacts(artifacts),
  });

  return {
    projectId,
    baseDir,
    storyGraphPath,
    specPath: relPath(baseDir, "interactive-spec.md"),
    storyTreePath: relPath(baseDir, "story-tree.md"),
    flagsPath: relPath(baseDir, "flags.md"),
    scriptPath: relPath(baseDir, "script.md"),
    storyboardPath: relPath(baseDir, "storyboard.md"),
    imagePromptsPath: relPath(baseDir, "image-prompts.md"),
    assetsManifestPath: relPath(baseDir, "assets.json"),
    assetsDir: relPath(baseDir, "assets"),
  };
}

export async function runStoryboardCreation(
  options: StoryboardCreationRunOptions,
): Promise<StoryboardCreationRunResult> {
  const projectId = safeSegment(options.projectId ?? slugify(options.title));
  const baseDir = resolveProjectBaseDir(options.outDir ?? "storyboards", projectId);
  const sourceText = await resolveSourceText(options.projectRoot, options.sourceText, options.sourcePath);
  const input: StoryboardCreationInput = {
    title: options.title,
    sourceKind: options.sourceKind,
    sourceText,
    requirements: mergeRequirements(options.instruction, options.requirements, options.language),
    visualStyle: options.visualStyle,
    aspectRatio: options.aspectRatio,
    granularity: options.granularity,
    maxShots: options.maxShots,
    language: options.language,
  };

  options.onProgress?.("Writing storyboard creation spec...");
  const spec = renderStoryboardSpec(input);

  options.onProgress?.("Writing storyboard and image prompts...");
  const agent = new StoryboardCreationAgent(options.runtime);
  const segments = splitStoryboardSource(input.sourceText, input.maxShots);
  const storyboardParts: string[] = [];
  for (const [index, segment] of segments.entries()) {
    if (segments.length > 1) {
      options.onProgress?.(`Writing storyboard segment ${index + 1}/${segments.length}: ${segment.label}...`);
    }
    storyboardParts.push(await agent.writeStoryboard({
      ...input,
      sourceText: segment.sourceText,
      ...(segments.length > 1 ? {
        segment: {
          label: segment.label,
          index,
          count: segments.length,
          estimatedShots: Math.ceil((input.maxShots ?? 24) / segments.length),
        },
      } : {}),
    }));
  }
  const storyboard = storyboardParts.join("\n\n");
  // Extract each segment before concatenation because a Markdown section
  // extractor correctly returns only the first matching heading.
  const imagePrompts = storyboardParts
    .map((part) => extractStoryboardImagePrompts(part))
    .filter(Boolean)
    .join("\n\n");
  await ensureProjectDir(options.projectRoot, join(baseDir, "assets", "source"));
  await ensureProjectDir(options.projectRoot, join(baseDir, "assets", "generated"));
  await ensureProjectDir(options.projectRoot, join(baseDir, "assets", "selected"));
  const assetsManifest = createStoryboardAssetsManifest({
    title: options.title,
    projectId,
    baseDir,
    storyboardPath: join(baseDir, "storyboard.md"),
    imagePromptsPath: join(baseDir, "image-prompts.md"),
    imagePrompts,
    createdAt: new Date().toISOString(),
  });
  const artifacts = [
    textArtifact(join(baseDir, "storyboard-spec.md"), spec),
    textArtifact(join(baseDir, "storyboard.md"), storyboard),
    textArtifact(join(baseDir, "image-prompts.md"), imagePrompts),
    textArtifact(join(baseDir, "assets.json"), JSON.stringify(assetsManifest, null, 2)),
  ];
  await commitProductionArtifacts({
    rootDir: options.projectRoot,
    artifacts,
    runPath: join(baseDir, "status.json"),
    run: createProductionRunSnapshot({
      kind: "storyboard",
      id: projectId,
      status: "complete",
      stage: "commit",
      artifacts: artifacts.map((artifact) => artifact.relativePath),
      observations: [],
    }),
    validate: () => assertNonEmptyArtifacts(artifacts),
  });

  return {
    projectId,
    baseDir,
    specPath: relPath(baseDir, "storyboard-spec.md"),
    storyboardPath: relPath(baseDir, "storyboard.md"),
    imagePromptsPath: relPath(baseDir, "image-prompts.md"),
    assetsManifestPath: relPath(baseDir, "assets.json"),
    assetsDir: relPath(baseDir, "assets"),
  };
}

interface StoryboardSourceSegment {
  readonly label: string;
  readonly sourceText: string;
}

/**
 * Large storyboards are generated one explicit document section at a time so
 * no model call has to emit the entire deliverable. This parses Markdown
 * structure only; it does not infer story meaning or discard source text.
 */
function splitStoryboardSource(
  sourceText: string | undefined,
  maxShots: number | undefined,
): StoryboardSourceSegment[] {
  const source = sourceText?.trim();
  if (!source || (maxShots ?? 24) * 700 <= 24_000) {
    return [{ label: "full storyboard", sourceText: source ?? "" }];
  }

  const lines = source.split(/\r?\n/);
  const headings: Array<{ readonly line: number; readonly label: string }> = [];
  for (const [line, raw] of lines.entries()) {
    const heading = /^#{1,6}\s+(.+?)\s*$/u.exec(raw.trim());
    if (!heading) continue;
    const label = heading[1]!.trim();
    if (/^第\s*[一二三四五六七八九十百千万\d]+\s*集(?:\s|《|$)/u.test(label)
      || /^episode\s+\d+(?:\s|[:：\-—]|$)/iu.test(label)) {
      headings.push({ line, label });
    }
  }
  if (headings.length < 2) {
    return [{ label: "full storyboard", sourceText: source }];
  }

  const episodeSegments = headings.map((heading, index) => {
    const start = index === 0 ? 0 : heading.line;
    const end = headings[index + 1]?.line ?? lines.length;
    return {
      label: heading.label,
      sourceText: lines.slice(start, end).join("\n").trim(),
    };
  });
  return episodeSegments.flatMap(splitStoryboardEpisodeScenes);
}

function splitStoryboardEpisodeScenes(episode: StoryboardSourceSegment): StoryboardSourceSegment[] {
  const lines = episode.sourceText.split(/\r?\n/);
  const boundaries: Array<{ readonly line: number; readonly label: string }> = [];
  for (const [line, raw] of lines.entries()) {
    const text = raw.trim();
    const bold = /^\*\*(.+?)\*\*(?:\s.*)?$/u.exec(text);
    const label = bold?.[1]?.trim();
    if (!label) continue;
    if (/^(?:场次\s*\d+|集尾钩子)(?:\s|[：:／/]|$)/u.test(label)
      || /^(?:scene\s+\d+|episode[- ]end hook)(?:\s|[：:/\-—]|$)/iu.test(label)) {
      boundaries.push({ line, label });
    }
  }
  if (boundaries.length < 2) return [episode];
  return boundaries.map((boundary, index) => ({
    label: `${episode.label} / ${boundary.label}`,
    sourceText: lines
      .slice(index === 0 ? 0 : boundary.line, boundaries[index + 1]?.line ?? lines.length)
      .join("\n")
      .trim(),
  }));
}

async function createInteractiveFilmStoryGraph(
  runtime: AgentContext,
  args: {
    readonly projectId: string;
    readonly title: string;
    readonly input: InteractiveFilmCreationInput;
    readonly storyTree: string;
    readonly flags: string;
    readonly script: string;
    readonly imagePrompts: string;
    readonly onProgress?: (message: string) => void;
  },
): Promise<StoryGraph> {
  args.onProgress?.(args.input.language === "en"
    ? "Building the playable story graph through the structured authoring harness..."
    : "正在通过结构化创作内核生成可玩故事图谱……");
  return generateStoryGraph(runtime.client, runtime.model, {
    projectId: args.projectId,
    title: args.title,
    premise: buildInteractiveFilmGraphPremise(args.input, args.storyTree, args.flags, args.script, args.imagePrompts),
  }, {
    language: args.input.language,
    activatedSkills: runtime.activatedSkills,
    signal: runtime.signal,
  });
}

function buildInteractiveFilmGraphPremise(
  input: InteractiveFilmCreationInput,
  storyTree: string,
  flags: string,
  script: string,
  imagePrompts: string,
): string {
  if ((input.language ?? "zh") === "en") {
    return [
      `Creation brief: ${input.requirements}`,
      input.targetAudience ? `Target audience: ${input.targetAudience}` : "",
      input.episodeCount ? `Segments/episodes: ${input.episodeCount}` : "",
      input.episodeDuration ? `Per-segment duration: ${input.episodeDuration}` : "",
      input.budget ? `Budget: ${input.budget}` : "",
      input.referenceMode ? `Reference mode: ${input.referenceMode}` : "",
      `Story tree:\n${storyTree}`,
      `Variables and flags:\n${flags}`,
      `Interactive script:\n${script}`,
      `Image prompts:\n${imagePrompts}`,
    ].filter(Boolean).join("\n\n");
  }
  return [
    `创作需求：${input.requirements}`,
    input.targetAudience ? `目标受众：${input.targetAudience}` : "",
    input.episodeCount ? `段落/集数：${input.episodeCount}` : "",
    input.episodeDuration ? `单段时长：${input.episodeDuration}` : "",
    input.budget ? `预算：${input.budget}` : "",
    input.referenceMode ? `参考模式：${input.referenceMode}` : "",
    `剧情树：\n${storyTree}`,
    `变量旗标：\n${flags}`,
    `互动剧本：\n${script}`,
    `图像提示词：\n${imagePrompts}`,
  ].filter(Boolean).join("\n\n");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createStoryboardAssetsManifest(args: {
  readonly title: string;
  readonly projectId: string;
  readonly baseDir: string;
  readonly storyboardPath: string;
  readonly imagePromptsPath: string;
  readonly imagePrompts: string;
  readonly createdAt: string;
}): StoryboardAssetsManifest {
  const assetsDir = relPath(args.baseDir, "assets");
  const prompts = parseStoryboardPromptLines(args.imagePrompts);
  return {
    version: 1,
    kind: "storyboard_assets",
    title: args.title,
    projectId: args.projectId,
    baseDir: toPosixPath(args.baseDir),
    storyboardPath: toPosixPath(args.storyboardPath),
    imagePromptsPath: toPosixPath(args.imagePromptsPath),
    assetsDir,
    sourceDir: relPath(assetsDir, "source"),
    generatedDir: relPath(assetsDir, "generated"),
    selectedDir: relPath(assetsDir, "selected"),
    createdAt: args.createdAt,
    assets: prompts.map((prompt, index) => {
      const shotId = `shot-${String(index + 1).padStart(3, "0")}`;
      return {
        shotId,
        prompt,
        sourceRefs: [],
        variants: [],
        status: "prompt_ready",
      };
    }),
  };
}

async function resolveSourceText(
  projectRoot: string,
  sourceText: string | undefined,
  sourcePath: string | undefined,
): Promise<string | undefined> {
  const direct = sourceText?.trim();
  if (direct) return direct;
  const path = sourcePath?.trim();
  if (!path) return undefined;
  return readFile(safeChildPath(projectRoot, path), "utf-8");
}

function textArtifact(relativePath: string, content: string): {
  readonly relativePath: string;
  readonly content: string;
} {
  return {
    relativePath,
    content: content.endsWith("\n") ? content : `${content}\n`,
  };
}

function assertNonEmptyArtifacts(
  artifacts: ReadonlyArray<{ readonly relativePath: string; readonly content: string }>,
): void {
  for (const artifact of artifacts) {
    if (!artifact.content.trim()) {
      throw new Error(`Production artifact is empty: ${artifact.relativePath}`);
    }
  }
}

async function ensureProjectDir(projectRoot: string, relativePath: string): Promise<void> {
  await mkdir(safeChildPath(projectRoot, relativePath), { recursive: true });
}

function mergeRequirements(
  instruction: string,
  requirements: string | undefined,
  language: "zh" | "en" = "zh",
): string {
  const extraLabel = language === "en" ? "Additional requirements:" : "补充要求：";
  return [
    instruction.trim(),
    requirements?.trim() ? `\n${extraLabel}\n${requirements.trim()}` : "",
  ].filter(Boolean).join("\n");
}

function normalizeOutputDir(value: string): string {
  const text = value.trim().replace(/^\/+|\/+$/g, "");
  if (!text || text.includes("..") || text.includes("\0")) {
    throw new Error(`Invalid output directory: ${JSON.stringify(value)}`);
  }
  return text;
}

function resolveProjectBaseDir(outDir: string, projectId: string): string {
  const outputDir = normalizeOutputDir(outDir);
  return basename(outputDir) === projectId ? outputDir : relPath(outputDir, projectId);
}

// Project-relative path for results and manifests: always "/" separators.
function relPath(...segments: string[]): string {
  return toPosixPath(join(...segments));
}

function safeSegment(value: string): string {
  const text = value.trim();
  if (!text || text === "." || text === ".." || text.includes("/") || text.includes("\\") || text.includes("\0")) {
    throw new Error(`Invalid project id: ${JSON.stringify(value)}`);
  }
  return text.slice(0, 80);
}

function slugify(value: string): string {
  const text = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return text || `script-${Date.now()}`;
}

function parseStoryboardPromptLines(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const prompts: string[] = [];
  let promptColumnIndex = -1;

  for (const rawLine of lines) {
    const line = rawLine.trim();
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
    if (promptMatch) {
      const prompt = cleanPromptText(promptMatch[1]!);
      if (prompt) prompts.push(prompt);
      continue;
    }
    const numberedPrompt = /^(?:[-*]\s*)?(?:\d+|[０-９]+)[.)、：:\s-]+(.+)$/u.exec(line);
    if (numberedPrompt) {
      const prompt = numberedPrompt[1]!
        .replace(/\s+/g, " ")
        .trim();
      if (prompt) prompts.push(prompt);
    }
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
    .replace(/\s*\|\s*$/u, "")
    .replace(/\*\*$/u, "")
    .replace(/^(?:Prompt(?:\s+for\s+[^:*：]+)?|提示词(?:\s*[^:*：]+)?|图像提示词|分镜图提示词)\s*[：:]\s*/iu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function requiredSection(raw: string, headings: readonly string[], fallback: string): string {
  return extractMarkdownSection(raw, headings)?.trim() || fallback.trim();
}

export async function projectFileExists(projectRoot: string, relativePath: string): Promise<boolean> {
  try {
    await access(safeChildPath(projectRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}
