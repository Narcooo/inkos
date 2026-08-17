import { Type, type Static } from "@mariozechner/pi-ai";
import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import type { PipelineRunner } from "../pipeline/runner.js";
import { ArchitectIncompleteFoundationError } from "../agents/architect.js";
import { type ReviseMode } from "../agents/reviser.js";
import { defaultChapterLength } from "../utils/length-metrics.js";
import { inferLanguage } from "../utils/language.js";
import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { StateManager } from "../state/manager.js";
import { deleteLatestChapter } from "../state/chapter-delete.js";
import { assertSafeTruthFileName, createInteractionToolsFromDeps } from "../interaction/project-tools.js";
import { writeExportArtifact } from "../interaction/export-artifact.js";
import { assertSafeBookId, deriveBookIdFromTitle } from "../utils/book-id.js";
import { safeChildPath } from "../utils/path-safety.js";
import {
  normalizePlatformId,
  normalizePlatformOrOther,
  type BookConfig,
  type FanficMode,
} from "../models/book.js";
import { generateShortFictionCover, runShortFictionProduction } from "../pipeline/short-fiction-runner.js";
import { runInteractiveFilmCreation, runScriptCreation, runStoryboardCreation } from "../pipeline/script-storyboard-runner.js";
import { createTranslationProjectFromFile } from "../translation/index.js";
import { runResearchReport } from "../agents/researcher.js";
import { ingestMaterial } from "../materials/ingest.js";
import { retrieveMaterials } from "../materials/retrieve.js";
import {
  bindBookReference,
  listBookReferences,
  unbindBookReference,
} from "../references/book-references.js";
import { loadChaptersFromPath } from "./chapter-import-source.js";
import type { ScriptTargetFormat } from "../agents/script-storyboard.js";
import { createPlayDB, type PlayGraphDB } from "../play/play-db-factory.js";
import { PlayRunner, type PlayOpeningSeedResult, type PlayReplayResult, type PlayStepResult, type PlayVariantRestoreResult } from "../play/play-runner.js";
import { PlayStore } from "../play/play-store.js";
import type { AgentContext } from "../agents/base.js";
import {
  ActionPayloadSchema,
  shortRunCharsPerChapterError,
  shortRunCharsPerChapterRange,
  type ActionPayload,
} from "../interaction/action-envelope.js";
import { ResearchSearchConfigSchema } from "../models/project.js";
import { searchWeb } from "../utils/web-search.js";
import {
  runAsWorkflowTrajectory,
  runWithAgentTrajectoryRole,
} from "../llm/agent-trajectory.js";
import type { ActivatedSkillGuidance } from "./skill-tool.js";
import {
  activatedSkillIds,
  mergeActivatedSkillGuidance,
} from "../skills/production-bindings.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResult(text: string): AgentToolResult<undefined>;
function textResult<T>(text: string, details: T): AgentToolResult<T>;
function textResult<T = undefined>(text: string, details?: T): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details: details as T };
}

/**
 * Resolve a user-supplied relative path against the books root and guard
 * against path-traversal (../ etc.).
 */
function safeBooksPath(booksRoot: string, relativePath: string): string {
  return safeChildPath(booksRoot, relativePath);
}

function resolveToolBookId(
  toolName: string,
  paramsBookId: string | undefined,
  activeBookId: string | null,
): string {
  const resolvedBookId = paramsBookId ?? activeBookId ?? undefined;
  if (!resolvedBookId) {
    throw new Error(`${toolName} requires bookId when there is no active book.`);
  }
  const safeBookId = assertSafeBookId(resolvedBookId, `${toolName}.bookId`);
  if (paramsBookId && activeBookId && safeBookId !== activeBookId) {
    throw new Error(`${toolName}.bookId must match the active book.`);
  }
  return safeBookId;
}

function buildAgentBookConfig(input: {
  readonly title: string;
  readonly genre?: string;
  readonly platform?: string;
  readonly language?: "zh" | "en";
  readonly targetChapters?: number;
  readonly chapterWordCount?: number;
  readonly parentBookId?: string;
  readonly fanficMode?: FanficMode;
}, defaults: { readonly targetChapters?: number; readonly chapterWordCount?: number } = {}): BookConfig {
  const now = new Date().toISOString();
  const id = deriveBookIdFromTitle(input.title);
  if (!id) throw new Error(`Could not derive a valid book id from title: ${JSON.stringify(input.title)}`);
  return {
    id,
    title: input.title.trim(),
    platform: normalizePlatformOrOther(input.platform),
    genre: input.genre?.trim() || "other",
    status: "outlining",
    targetChapters: input.targetChapters ?? defaults.targetChapters ?? 200,
    chapterWordCount: input.chapterWordCount
      ?? defaults.chapterWordCount
      ?? defaultChapterLength(input.language === "en" ? "en" : "zh"),
    ...(input.language ? { language: input.language } : {}),
    ...(input.parentBookId ? { parentBookId: input.parentBookId } : {}),
    ...(input.fanficMode ? { fanficMode: input.fanficMode } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

async function assertBookDoesNotExist(projectRoot: string, bookId: string): Promise<void> {
  try {
    await stat(new StateManager(projectRoot).bookDir(bookId));
    throw new Error(`Book "${bookId}" already exists.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

async function loadCreationSource(input: {
  readonly projectRoot: string;
  readonly sourceText?: string;
  readonly sourcePath?: string;
  readonly sourceName?: string;
  readonly purpose: "reference";
}): Promise<{ readonly text: string; readonly name: string }> {
  if (input.sourceText?.trim()) {
    return {
      text: input.sourceText.trim(),
      name: input.sourceName?.trim() || "source",
    };
  }
  if (!input.sourcePath?.trim()) {
    throw new Error("A sourceText or sourcePath is required.");
  }
  if (isAbsolute(input.sourcePath)) {
    throw new Error("Creation sourcePath must be project-relative. Upload or ingest the file first.");
  }
  const sourcePath = safeChildPath(input.projectRoot, input.sourcePath);
  const material = await ingestMaterial(input.projectRoot, {
    sourceKind: "file",
    filePath: sourcePath,
    filename: basename(sourcePath),
    title: input.sourceName?.trim() || basename(sourcePath).replace(/\.[^.]+$/u, ""),
    purpose: input.purpose,
  });
  return {
    text: await readFile(join(input.projectRoot, material.markdownPath), "utf-8"),
    name: input.sourceName?.trim() || material.title,
  };
}

function createDeterministicInteractionTools(pipeline: PipelineRunner, projectRoot: string) {
  const state = new StateManager(projectRoot);
  return createInteractionToolsFromDeps(pipeline, state);
}

function closePlayDB(db: PlayGraphDB): void {
  db.close?.();
}

// runnerFactory 注入的测试替身没有 close 方法，可选调用兜底。
function closePlayRunner(runner: unknown): void {
  (runner as { close?: () => void } | null | undefined)?.close?.();
}

function safePlayId(value: string | undefined, fallback: string): string {
  const raw = (value?.trim() || fallback).slice(0, 80);
  if (!raw || raw === "." || raw === ".." || raw.includes("/") || raw.includes("\\") || raw.includes("\0")) {
    throw new Error(`Invalid play id: ${JSON.stringify(value)}`);
  }
  return raw;
}

const SuggestedActionParam = Type.Union([
  Type.String({ description: "A short clickable player action." }),
  Type.Object({
    label: Type.Optional(Type.String({ description: "Short clickable player action." })),
    action: Type.Optional(Type.String({ description: "Concrete action text." })),
    text: Type.Optional(Type.String({ description: "Concrete action text." })),
    title: Type.Optional(Type.String({ description: "Short action title." })),
    description: Type.Optional(Type.String({ description: "Optional action description." })),
  }, { description: "A model may describe an action as an object; InkOS will normalize it to one short action string." }),
], { description: "Suggested action as a string or small action object." });

type SuggestedActionParamType = Static<typeof SuggestedActionParam>;

function normalizeSuggestedActions(value: readonly SuggestedActionParamType[] | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    const text = typeof raw === "string"
      ? raw
      : raw.action ?? raw.label ?? raw.text ?? raw.title ?? raw.description ?? "";
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized) out.push(normalized);
    if (out.length >= 4) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Proposed Action Tool (propose_action)
// ---------------------------------------------------------------------------

const ProposeActionParams = Type.Object({
  action: Type.Union([
    Type.Literal("create_book"),
    Type.Literal("short_run"),
    Type.Literal("play_start"),
    Type.Literal("generate_cover"),
    Type.Literal("fanfic_init"),
    Type.Literal("continuation_import"),
    Type.Literal("spinoff_create"),
    Type.Literal("style_imitation"),
    Type.Literal("script_create"),
    Type.Literal("storyboard_create"),
    Type.Literal("interactive_film_create"),
    Type.Literal("translation_create"),
    Type.Literal("draft_structure"),
    Type.Literal("connect_choice"),
    Type.Literal("remove_node"),
  ], {
    description: "The production or assisted Studio workflow the user appears to want, but which needs explicit confirmation from general chat.",
  }),
  instruction: Type.String({
    description: "The exact production instruction to run after the user confirms. It must be self-contained: include title, story direction, active target, output directory, cover visual direction, or any referenced context that would otherwise be lost when switching sessions.",
  }),
  title: Type.Optional(Type.String({
    description: "Short user-facing title for the confirmation card.",
  })),
  summary: Type.Optional(Type.String({
    description: "One or two sentences explaining what will happen if the user confirms.",
  })),
  createBook: Type.Optional(Type.Object({
    title: Type.String({
      description: "Confirmed long-form book title.",
    }),
    genre: Type.Optional(Type.String({
      description: "Confirmed book genre/category.",
    })),
    platform: Type.Optional(Type.Union([
      Type.Literal("tomato"),
      Type.Literal("qidian"),
      Type.Literal("feilu"),
      Type.Literal("other"),
    ], { description: "Confirmed target platform, e.g. tomato for 番茄." })),
    language: Type.Optional(Type.Union([
      Type.Literal("zh"),
      Type.Literal("en"),
    ], { description: "Confirmed writing language." })),
    targetChapters: Type.Optional(Type.Number({
      description: "Confirmed total chapter count.",
    })),
    chapterWordCount: Type.Optional(Type.Number({
      description: "Confirmed per-chapter length in the book's native unit.",
    })),
  }, { description: "Structured execution args for action=create_book. Put platform/length here; do not leave them only in instruction text." })),
  shortRun: Type.Optional(Type.Object({
    title: Type.String({
      description: "Confirmed standalone short title or working title. The host uses it as the stable project identity.",
    }),
    direction: Type.String({
      description: "Confirmed standalone short direction.",
    }),
    reference: Type.Optional(Type.String({
      description: "Optional confirmed reference notes or constraints.",
    })),
    storyId: Type.Optional(Type.String({
      description: "Optional confirmed output id under shorts/.",
    })),
    language: Type.Optional(Type.Union([
      Type.Literal("zh"),
      Type.Literal("en"),
    ], { description: "Output language of the short fiction. Fill the language the user asked the story to be written in; it may differ from the conversation language (e.g. a Chinese chat asking for an English short => en). When the user does not name one, it defaults to the conversation language." })),
    chapters: Type.Optional(Type.Number({
      description: "Confirmed complete short chapter count, 12-18.",
    })),
    charsPerChapter: Type.Optional(Type.Number({
      minimum: 600,
      maximum: 1200,
      description: "Confirmed per-chapter length in the story language's native unit. zh shorts only accept 900-1200 Chinese characters; en shorts only accept 600-800 English words. Values outside the selected language's range are rejected before the task starts. Do not put total story length here.",
    })),
    cover: Type.Optional(Type.Boolean({
      description: "Whether to attempt cover generation.",
    })),
  }, { description: "Structured execution args for action=short_run." })),
  playStart: Type.Optional(Type.Object({
    title: Type.String({ description: "Confirmed interactive world title." }),
    premise: Type.String({ description: "Confirmed playable premise." }),
    worldContract: Type.Optional(Type.String({
      description: "Confirmed durable world contract in natural language: time semantics, role autonomy, object/clue/relationship rules, taboos, or other long-lived rules the user explicitly asked for. Do not invent RPG/level systems.",
    })),
    visualContract: Type.Optional(Type.String({
      description: "Confirmed visual contract for Play illustrations in natural language. Only include user-defined visual semantics; do not invent game frames, colored tiers, UI, or stats.",
    })),
    mode: Type.Optional(Type.Union([
      Type.Literal("open"),
      Type.Literal("guided"),
    ], { description: "Confirmed play mode: open for free actions, guided for suggested choices." })),
    initialScene: Type.String({
      description: "Confirmed opening scene shown to the player after confirmation. It must be pure narrative prose, not a title/setup/rules summary, not a question prompt, and not an action/options list.",
    }),
    suggestedActions: Type.Optional(Type.Array(SuggestedActionParam, {
      description: "Optional action springboards shown as separate UI chips. Do not include these in initialScene.",
    })),
  }, { description: "Structured execution args for action=play_start." })),
  generateCover: Type.Optional(Type.Object({
    title: Type.String({ description: "Confirmed cover title." }),
    intro: Type.Optional(Type.String({ description: "Confirmed synopsis/hook for the cover." })),
    sellingPoints: Type.Optional(Type.String({ description: "Confirmed selling points for the cover." })),
    coverPrompt: Type.Optional(Type.String({ description: "Confirmed visual direction." })),
    outputDir: Type.Optional(Type.String({ description: "Confirmed output directory." })),
  }, { description: "Structured execution args for action=generate_cover." })),
  scriptCreate: Type.Optional(Type.Object({
    title: Type.String({ description: "Confirmed script project title." }),
    sourceKind: Type.Optional(Type.String({ description: "Source type, e.g. novel excerpt, original idea, outline, existing script." })),
    targetFormat: Type.Optional(Type.Union([
      Type.Literal("vertical_short_drama"),
      Type.Literal("screenplay"),
      Type.Literal("audio_drama"),
      Type.Literal("interactive_script"),
      Type.Literal("general_script"),
    ], { description: "Confirmed script output format." })),
    sourceText: Type.Optional(Type.String({ description: "User-provided source text. For long sources, prefer sourcePath instead of summarizing." })),
    sourcePath: Type.Optional(Type.String({ description: "Optional project-relative source file path." })),
    requirements: Type.Optional(Type.String({ description: "Confirmed script format, production constraints, tone, episode structure, or user preferences." })),
    episodeCount: Type.Optional(Type.Number({ description: "Optional target episode/segment count." })),
    episodeDuration: Type.Optional(Type.String({ description: "Optional per-episode/per-segment duration." })),
    projectId: Type.Optional(Type.String({ description: "Optional output id under dramas/." })),
    outDir: Type.Optional(Type.String({ description: "Optional project-relative output directory. Default dramas/." })),
  }, { description: "Structured execution args for action=script_create." })),
  storyboardCreate: Type.Optional(Type.Object({
    title: Type.String({ description: "Confirmed storyboard project title." }),
    sourceKind: Type.Optional(Type.String({ description: "Source type, e.g. script, novel excerpt, idea, scene list." })),
    sourceText: Type.Optional(Type.String({ description: "User-provided source text. For long sources, prefer sourcePath instead of summarizing." })),
    sourcePath: Type.Optional(Type.String({ description: "Optional project-relative source file path." })),
    requirements: Type.Optional(Type.String({ description: "Confirmed shot/storyboard requirements." })),
    visualStyle: Type.Optional(Type.String({ description: "Confirmed visual style, if the user specified one." })),
    aspectRatio: Type.Optional(Type.String({ description: "Confirmed aspect ratio, e.g. 9:16, 16:9, 1:1." })),
    granularity: Type.Optional(Type.String({ description: "Confirmed storyboard granularity." })),
    maxShots: Type.Optional(Type.Number({ description: "Optional max shot count." })),
    projectId: Type.Optional(Type.String({ description: "Optional output id under storyboards/." })),
    outDir: Type.Optional(Type.String({ description: "Optional project-relative output directory. Default storyboards/." })),
  }, { description: "Structured execution args for action=storyboard_create." })),
  interactiveFilmCreate: Type.Optional(Type.Object({
    title: Type.String({ description: "Confirmed interactive-film project title." }),
    sourceKind: Type.Optional(Type.String({ description: "Source type, e.g. novel excerpt, script, outline, original idea." })),
    sourceText: Type.Optional(Type.String({ description: "User-provided source text. For long sources, prefer sourcePath instead of summarizing." })),
    sourcePath: Type.Optional(Type.String({ description: "Optional project-relative source file path." })),
    requirements: Type.Optional(Type.String({ description: "Confirmed branching, variable/flag, ending, production, visual, or market requirements." })),
    targetAudience: Type.Optional(Type.String({ description: "Confirmed target audience or market." })),
    episodeCount: Type.Optional(Type.Number({ description: "Optional target episode/segment count." })),
    episodeDuration: Type.Optional(Type.String({ description: "Optional per-episode/per-segment duration." })),
    budget: Type.Optional(Type.String({ description: "Optional budget or production constraints." })),
    referenceMode: Type.Optional(Type.String({ description: "Optional reference mode, e.g. 盛世天下-style multi-ending interactive drama." })),
    projectId: Type.Optional(Type.String({ description: "Optional output id under interactive-films/." })),
    outDir: Type.Optional(Type.String({ description: "Optional project-relative output directory. Default interactive-films/." })),
  }, { description: "Structured execution args for action=interactive_film_create." })),
  translationCreate: Type.Optional(Type.Object({
    filePath: Type.String({ description: "Project-relative EPUB/PDF/TXT/Markdown source file path to translate." }),
    sourceLanguage: Type.String({ description: "Source language as a human-readable name, e.g. Auto detect, Japanese, English, Chinese (Simplified), 繁体中文（台湾）. Do not require ISO abbreviations." }),
    targetLanguage: Type.String({ description: "Target language as a human-readable name, e.g. Chinese (Simplified), English, Japanese, Korean, Brazilian Portuguese. Do not require ISO abbreviations." }),
    title: Type.Optional(Type.String({ description: "Optional translation project title." })),
    segmentMaxChars: Type.Optional(Type.Number({ description: "Optional long-paragraph split threshold." })),
  }, { description: "Structured execution args for action=translation_create." })),
  fanficCreate: Type.Optional(Type.Object({
    title: Type.String({ description: "Confirmed fanfiction book title." }),
    sourceText: Type.Optional(Type.String({ description: "Provided canon/source text. Prefer sourcePath for uploaded or long files." })),
    sourcePath: Type.Optional(Type.String({ description: "Project-relative uploaded canon/source file path." })),
    sourceName: Type.Optional(Type.String({ description: "Human-readable source work name." })),
    mode: Type.Optional(Type.Union([
      Type.Literal("canon"),
      Type.Literal("au"),
      Type.Literal("ooc"),
      Type.Literal("cp"),
    ], { description: "Confirmed fanfiction mode." })),
    genre: Type.Optional(Type.String({ description: "Confirmed genre." })),
    platform: Type.Optional(Type.Union([
      Type.Literal("tomato"), Type.Literal("qidian"), Type.Literal("feilu"), Type.Literal("other"),
    ])),
    language: Type.Optional(Type.Union([Type.Literal("zh"), Type.Literal("en")])),
    targetChapters: Type.Optional(Type.Number({ description: "Confirmed total chapter count." })),
    chapterWordCount: Type.Optional(Type.Number({ description: "Confirmed per-chapter length." })),
  }, { description: "Structured execution args for action=fanfic_init. This creates the book directly after confirmation." })),
  continuationImport: Type.Optional(Type.Object({
    bookId: Type.Optional(Type.String({ description: "Existing target book id. Omit when creating a new continuation book." })),
    title: Type.Optional(Type.String({ description: "New continuation book title when bookId is omitted." })),
    sourcePath: Type.String({ description: "Project-relative uploaded novel file or chapter directory." }),
    splitPattern: Type.Optional(Type.String({ description: "Optional custom chapter-heading regex source." })),
    resumeFrom: Type.Optional(Type.Number({ description: "Resume interrupted replay from this 1-based chapter number." })),
    genre: Type.Optional(Type.String({ description: "Genre for a newly created continuation book." })),
    platform: Type.Optional(Type.Union([
      Type.Literal("tomato"), Type.Literal("qidian"), Type.Literal("feilu"), Type.Literal("other"),
    ])),
    language: Type.Optional(Type.Union([Type.Literal("zh"), Type.Literal("en")])),
    targetChapters: Type.Optional(Type.Number({ description: "Target total chapters for a new book." })),
    chapterWordCount: Type.Optional(Type.Number({ description: "Per-chapter length for a new book." })),
  }, { description: "Structured execution args for action=continuation_import. This imports and rebuilds state directly after confirmation." })),
  spinoffCreate: Type.Optional(Type.Object({
    title: Type.String({ description: "Confirmed side-story title." }),
    parentBookId: Type.String({ description: "Existing InkOS parent book id whose canon is inherited." }),
    direction: Type.Optional(Type.String({ description: "Confirmed standalone side-story direction." })),
    genre: Type.Optional(Type.String({ description: "Optional genre override; defaults to the parent book." })),
    platform: Type.Optional(Type.Union([
      Type.Literal("tomato"), Type.Literal("qidian"), Type.Literal("feilu"), Type.Literal("other"),
    ])),
    language: Type.Optional(Type.Union([Type.Literal("zh"), Type.Literal("en")])),
    targetChapters: Type.Optional(Type.Number({ description: "Optional chapter count; defaults to the parent book." })),
    chapterWordCount: Type.Optional(Type.Number({ description: "Optional chapter length; defaults to the parent book." })),
  }, { description: "Structured execution args for action=spinoff_create. This creates the side-story directly after confirmation." })),
  imitationCreate: Type.Optional(Type.Object({
    title: Type.String({ description: "Confirmed original imitation-project title." }),
    referenceText: Type.Optional(Type.String({ description: "Reference prose. Prefer referencePath for uploaded or long files." })),
    referencePath: Type.Optional(Type.String({ description: "Project-relative uploaded reference-work path." })),
    storyIdea: Type.String({ description: "Confirmed original story idea; do not copy the reference plot." }),
    sourceName: Type.Optional(Type.String({ description: "Human-readable reference work name." })),
    genre: Type.Optional(Type.String({ description: "Confirmed genre." })),
    platform: Type.Optional(Type.Union([
      Type.Literal("tomato"), Type.Literal("qidian"), Type.Literal("feilu"), Type.Literal("other"),
    ])),
    language: Type.Optional(Type.Union([Type.Literal("zh"), Type.Literal("en")])),
    targetChapters: Type.Optional(Type.Number({ description: "Confirmed total chapter count." })),
    chapterWordCount: Type.Optional(Type.Number({ description: "Confirmed per-chapter length." })),
  }, { description: "Structured execution args for action=style_imitation. This creates an original book and style guide directly after confirmation." })),
});

type ProposeActionParamsType = Static<typeof ProposeActionParams>;
type ProposeActionToolOptions = {
  readonly sameSession?: boolean;
  readonly requestedSkillIds?: () => ReadonlyArray<string>;
  readonly attachmentPaths?: () => ReadonlyArray<string>;
};

function proposedActionSessionKind(action: ProposeActionParamsType["action"]): "book-create" | "short" | "play" | "script" | "storyboard" | "interactive-film" | "interactive-film-authoring" | "chat" {
  if (action === "create_book") return "book-create";
  if (action === "play_start") return "play";
  if (action === "script_create") return "script";
  if (action === "storyboard_create") return "storyboard";
  if (action === "interactive_film_create") return "interactive-film";
  if (action === "translation_create") return "chat";
  if (action === "draft_structure" || action === "connect_choice" || action === "remove_node") return "interactive-film-authoring";
  if (action === "fanfic_init" || action === "continuation_import" || action === "spinoff_create" || action === "style_imitation") return "chat";
  return "short";
}

function proposedActionFallbackTitle(action: ProposeActionParamsType["action"], isZh: boolean): string {
  switch (action) {
    case "create_book":
      return isZh ? "创建长篇书籍" : "Create a long-form book";
    case "short_run":
      return isZh ? "生成 InkOS Short" : "Generate InkOS Short";
    case "play_start":
      return isZh ? "启动 InkOS Play" : "Start InkOS Play";
    case "generate_cover":
      return isZh ? "生成封面" : "Generate cover";
    case "fanfic_init":
      return isZh ? "创建同人作品" : "Create fanfiction";
    case "continuation_import":
      return isZh ? "导入并续写作品" : "Import and continue a work";
    case "spinoff_create":
      return isZh ? "创建番外作品" : "Create a side story";
    case "style_imitation":
      return isZh ? "创建仿写作品" : "Create a style-imitation work";
    case "script_create":
      return isZh ? "创建剧本" : "Create script";
    case "storyboard_create":
      return isZh ? "创建分镜" : "Create storyboard";
    case "interactive_film_create":
      return isZh ? "创建互动影游" : "Create interactive film";
    case "translation_create":
      return isZh ? "创建翻译项目" : "Create translation project";
    case "draft_structure":
      return isZh ? "生成故事结构" : "Draft story structure";
    case "connect_choice":
      return isZh ? "连接选项" : "Connect choice";
    case "remove_node":
      return isZh ? "删除节点" : "Remove node";
  }
}

function proposedActionFallbackSummary(action: ProposeActionParamsType["action"], isZh: boolean): string {
  return isZh
    ? "确认后将直接执行这条需求；不会要求你再去另一个表单重复填写。"
    : "After confirmation, InkOS will run this request directly without asking you to repeat it in another form.";
}

function compactObject<T extends Record<string, unknown>>(value: T | undefined): T | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      const text = raw.trim();
      if (text) out[key] = text;
      continue;
    }
    if (Array.isArray(raw)) {
      const items = raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim());
      if (items.length > 0) out[key] = items;
      continue;
    }
    if (typeof raw === "number") {
      if (Number.isFinite(raw) && raw > 0) out[key] = raw;
      continue;
    }
    if (raw !== undefined && raw !== null) {
      out[key] = raw;
    }
  }
  return Object.keys(out).length > 0 ? out as T : undefined;
}

function compactPlayStartPayload(value: ProposeActionParamsType["playStart"]): NonNullable<ActionPayload["playStart"]> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: NonNullable<ActionPayload["playStart"]> = {};
  const title = value.title?.trim();
  if (title) out.title = title;
  const premise = value.premise?.trim();
  if (premise) out.premise = premise;
  const worldContract = value.worldContract?.trim();
  if (worldContract) out.worldContract = worldContract;
  const visualContract = value.visualContract?.trim();
  if (visualContract) out.visualContract = visualContract;
  if (value.mode) out.mode = value.mode;
  const initialScene = value.initialScene?.trim();
  if (initialScene) out.initialScene = initialScene;
  const suggestedActions = normalizeSuggestedActions(value.suggestedActions);
  if (suggestedActions.length > 0) out.suggestedActions = suggestedActions;
  return Object.keys(out).length > 0 ? out : undefined;
}

function proposedActionPayload(
  params: ProposeActionParamsType,
  language: "zh" | "en",
): ActionPayload | undefined {
  const payload: ActionPayload = {};
  if (params.action === "create_book") {
    const createBook = compactObject(params.createBook);
    if (createBook) payload.createBook = createBook;
  }
  if (params.action === "short_run") {
    const shortRun = compactObject(params.shortRun);
    if (shortRun) payload.shortRun = { language, ...shortRun };
  }
  if (params.action === "play_start") {
    const playStart = compactPlayStartPayload(params.playStart);
    if (playStart) payload.playStart = playStart;
  }
  if (params.action === "generate_cover") {
    const generateCover = compactObject(params.generateCover);
    if (generateCover) payload.generateCover = generateCover;
  }
  if (params.action === "script_create") {
    const scriptCreate = compactObject(params.scriptCreate);
    if (scriptCreate) payload.scriptCreate = scriptCreate;
  }
  if (params.action === "storyboard_create") {
    const storyboardCreate = compactObject(params.storyboardCreate);
    if (storyboardCreate) payload.storyboardCreate = storyboardCreate;
  }
  if (params.action === "interactive_film_create") {
    const interactiveFilmCreate = compactObject(params.interactiveFilmCreate);
    if (interactiveFilmCreate) payload.interactiveFilmCreate = interactiveFilmCreate;
  }
  if (params.action === "translation_create") {
    const translationCreate = compactObject(params.translationCreate);
    if (translationCreate) payload.translationCreate = translationCreate;
  }
  if (params.action === "fanfic_init") {
    const fanficCreate = compactObject(params.fanficCreate);
    if (fanficCreate) payload.fanficCreate = fanficCreate;
  }
  if (params.action === "continuation_import") {
    const continuationImport = compactObject(params.continuationImport);
    if (continuationImport) payload.continuationImport = continuationImport;
  }
  if (params.action === "spinoff_create") {
    const spinoffCreate = compactObject(params.spinoffCreate);
    if (spinoffCreate) payload.spinoffCreate = spinoffCreate;
  }
  if (params.action === "style_imitation") {
    const imitationCreate = compactObject(params.imitationCreate);
    if (imitationCreate) payload.imitationCreate = imitationCreate;
  }
  return Object.keys(payload).length > 0 ? payload : undefined;
}

function validateProposedActionPayload(payload: ActionPayload | undefined): {
  readonly payload?: ActionPayload;
  readonly error?: string;
} {
  if (!payload) return {};
  const parsed = ActionPayloadSchema.safeParse(payload);
  if (parsed.success) return { payload: parsed.data };
  return { error: parsed.error.issues.map((issue) => issue.message).join("; ") };
}

function withSingleAttachmentFallback(
  params: ProposeActionParamsType,
  payload: ActionPayload | undefined,
  attachmentPaths: ReadonlyArray<string>,
): ActionPayload | undefined {
  const paths = [...new Set(attachmentPaths.map((path) => path.trim()).filter(Boolean))];
  if (!payload || paths.length !== 1) return payload;
  const [path] = paths;
  const useHostAttachment = (candidate: string | undefined): boolean => {
    const value = candidate?.trim();
    return !value || (value.startsWith(".inkos/uploads/") && value !== path);
  };

  if (params.action === "translation_create" && payload.translationCreate && useHostAttachment(payload.translationCreate.filePath)) {
    return { ...payload, translationCreate: { ...payload.translationCreate, filePath: path } };
  }
  if (
    params.action === "fanfic_init"
    && payload.fanficCreate
    && !payload.fanficCreate.sourceText?.trim()
    && useHostAttachment(payload.fanficCreate.sourcePath)
  ) {
    return { ...payload, fanficCreate: { ...payload.fanficCreate, sourcePath: path } };
  }
  if (
    params.action === "continuation_import"
    && payload.continuationImport
    && useHostAttachment(payload.continuationImport.sourcePath)
  ) {
    return { ...payload, continuationImport: { ...payload.continuationImport, sourcePath: path } };
  }
  if (
    params.action === "style_imitation"
    && payload.imitationCreate
    && !payload.imitationCreate.referenceText?.trim()
    && useHostAttachment(payload.imitationCreate.referencePath)
  ) {
    return { ...payload, imitationCreate: { ...payload.imitationCreate, referencePath: path } };
  }
  return payload;
}

function requireProposedText(value: string | undefined, label: string): void {
  if (typeof value === "string" && value.trim().length > 0) return;
  throw new Error(`propose_action is missing ${label}; retry with that field in the structured payload, not only in summary or instruction.`);
}

function assertExecutableProposedAction(params: ProposeActionParamsType, payload: ActionPayload | undefined): void {
  if (params.action === "create_book") {
    requireProposedText(payload?.createBook?.title, "createBook.title");
    return;
  }
  if (params.action === "play_start") {
    requireProposedText(payload?.playStart?.title, "playStart.title");
    requireProposedText(payload?.playStart?.premise, "playStart.premise");
    requireProposedText(payload?.playStart?.initialScene, "playStart.initialScene");
    return;
  }
  if (params.action === "short_run") {
    requireProposedText(payload?.shortRun?.title, "shortRun.title");
    requireProposedText(payload?.shortRun?.direction, "shortRun.direction");
    return;
  }
  if (params.action === "generate_cover") {
    requireProposedText(payload?.generateCover?.title, "generateCover.title");
    return;
  }
  if (params.action === "script_create") {
    requireProposedText(payload?.scriptCreate?.title, "scriptCreate.title");
    return;
  }
  if (params.action === "storyboard_create") {
    requireProposedText(payload?.storyboardCreate?.title, "storyboardCreate.title");
    return;
  }
  if (params.action === "interactive_film_create") {
    requireProposedText(payload?.interactiveFilmCreate?.title, "interactiveFilmCreate.title");
    return;
  }
  if (params.action === "translation_create") {
    requireProposedText(payload?.translationCreate?.filePath, "translationCreate.filePath");
    requireProposedText(payload?.translationCreate?.sourceLanguage, "translationCreate.sourceLanguage");
    requireProposedText(payload?.translationCreate?.targetLanguage, "translationCreate.targetLanguage");
    return;
  }
  if (params.action === "fanfic_init") {
    requireProposedText(payload?.fanficCreate?.title, "fanficCreate.title");
    if (!payload?.fanficCreate?.sourceText?.trim() && !payload?.fanficCreate?.sourcePath?.trim()) {
      throw new Error("propose_action is missing fanficCreate.sourceText/sourcePath; ask for or use the attached source before proposing production.");
    }
    return;
  }
  if (params.action === "continuation_import") {
    requireProposedText(payload?.continuationImport?.sourcePath, "continuationImport.sourcePath");
    if (!payload?.continuationImport?.bookId?.trim() && !payload?.continuationImport?.title?.trim()) {
      throw new Error("propose_action requires continuationImport.bookId or continuationImport.title.");
    }
    return;
  }
  if (params.action === "spinoff_create") {
    requireProposedText(payload?.spinoffCreate?.title, "spinoffCreate.title");
    requireProposedText(payload?.spinoffCreate?.parentBookId, "spinoffCreate.parentBookId");
    return;
  }
  if (params.action === "style_imitation") {
    requireProposedText(payload?.imitationCreate?.title, "imitationCreate.title");
    requireProposedText(payload?.imitationCreate?.storyIdea, "imitationCreate.storyIdea");
    if (!payload?.imitationCreate?.referenceText?.trim() && !payload?.imitationCreate?.referencePath?.trim()) {
      throw new Error("propose_action is missing imitationCreate.referenceText/referencePath; ask for or use the attached reference before proposing production.");
    }
  }
}

export function createProposeActionTool(
  language: "zh" | "en" = "zh",
  options: ProposeActionToolOptions = {},
): AgentTool<typeof ProposeActionParams> {
  return {
    name: "propose_action",
    description:
      "Ask the user to confirm a production action from general chat. " +
      "Use this before creating books, generating shorts/covers, or starting play worlds when the user has not clicked a confirmation.",
    label: "Confirm Action",
    parameters: ProposeActionParams,
    async execute(_toolCallId: string, params: ProposeActionParamsType): Promise<AgentToolResult<unknown>> {
      const targetSessionKind = proposedActionSessionKind(params.action);
      const isZh = language === "zh";
      const title = params.title?.trim() || proposedActionFallbackTitle(params.action, isZh);
      const summary = params.summary?.trim() || proposedActionFallbackSummary(params.action, isZh);
      const proposedPayload = validateProposedActionPayload(withSingleAttachmentFallback(
        params,
        proposedActionPayload(params, language),
        options.attachmentPaths?.() ?? [],
      ));
      if (proposedPayload.error) {
        throw new Error(`Invalid proposed action payload: ${proposedPayload.error}`);
      }
      const actionPayload = proposedPayload.payload;
      assertExecutableProposedAction(params, actionPayload);
      const requestedSkills = normalizeProposedSkillIds(options.requestedSkillIds?.());
      return textResult(
        [
          title,
          summary,
          "",
          `Instruction: ${params.instruction}`,
        ].join("\n"),
        {
          kind: "proposed_action",
          action: params.action,
          targetSessionKind,
          sameSession: options.sameSession === true,
          title,
          summary,
          instruction: params.instruction,
          ...(requestedSkills.length > 0 ? { requestedSkills } : {}),
          ...(actionPayload ? { actionPayload } : {}),
        },
      );
    },
  };
}

function normalizeProposedSkillIds(values: ReadonlyArray<string> | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const id = value.trim().toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. SubAgentTool (sub_agent)
// ---------------------------------------------------------------------------

const SubAgentParams = Type.Object({
  agent: Type.Union([
    Type.Literal("architect"),
    Type.Literal("writer"),
    Type.Literal("auditor"),
    Type.Literal("reviser"),
    Type.Literal("exporter"),
  ]),
  instruction: Type.String({ description: "Natural language instruction for the sub-agent. For reviser, this is passed as the one-off revision brief." }),
  bookId: Type.Optional(Type.String({
    description: "Optional book ID. In active-book sessions, omit it to use the current active book; if provided, it must match the current active book. For architect creation, this optionally sets the new book ID.",
  })),
  chapterNumber: Type.Optional(Type.Number({ description: "auditor/reviser: target chapter number. Omit to use the latest chapter." })),
  chapterCount: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: 20,
    description: "writer only: number of consecutive new chapters to write in this operation. Default: 1. InkOS writes them sequentially under one book lock.",
  })),
  // -- architect params --
  title: Type.Optional(Type.String({ description: "architect only: explicit book title. Required when creating a book." })),
  genre: Type.Optional(Type.String({ description: "architect only: genre (xuanhuan, urban, mystery, romance, scifi, fantasy, wuxia, general, etc.)" })),
  platform: Type.Optional(Type.Union([
    Type.Literal("tomato"),
    Type.Literal("qidian"),
    Type.Literal("feilu"),
    Type.Literal("other"),
  ], { description: "architect only: target platform. Default: other" })),
  language: Type.Optional(Type.Union([
    Type.Literal("zh"),
    Type.Literal("en"),
  ], { description: "architect only: writing language. Default: zh" })),
  targetChapters: Type.Optional(Type.Number({ description: "architect only: total chapter count. Default: 200" })),
  chapterWordCount: Type.Optional(Type.Number({ description: "architect/writer: per-chapter length in the book's native unit (zh characters / en words). Default: 3000 zh, 2000 en" })),
  revise: Type.Optional(Type.Boolean({
    description: "architect only: true 表示在当前 active book 上重新生成架构稿，而不是新建书籍。no-book creation sessions cannot revise an existing book.",
  })),
  feedback: Type.Optional(Type.String({
    description: "architect only: revise 模式下的调整要求。举例：把架构稿从条目式升级成段落式架构稿、某个角色设定需要重新设计、主线冲突表达太弱需要加强等。如果是架构稿评审未通过要求重写的场景，把评审意见的 overallFeedback 原样传入即可",
  })),
  // -- reviser params --
  mode: Type.Optional(Type.Union([
    Type.Literal("spot-fix"),
    Type.Literal("polish"),
    Type.Literal("rewrite"),
    Type.Literal("rework"),
    Type.Literal("anti-detect"),
  ], { description: "reviser only: revision mode. Default: spot-fix" })),
  // -- exporter params --
  format: Type.Optional(Type.Union([
    Type.Literal("txt"),
    Type.Literal("md"),
    Type.Literal("epub"),
  ], { description: "exporter only: export format. Default: txt" })),
  approvedOnly: Type.Optional(Type.Boolean({ description: "exporter only: export only approved chapters. Default: false" })),
});

type SubAgentParamsType = Static<typeof SubAgentParams>;

const ArchitectCreateSubAgentParams = Type.Object({
  agent: Type.Literal("architect"),
  instruction: Type.String({ description: "Confirmed self-contained book-creation instruction for the architect." }),
  bookId: Type.Optional(Type.String({
    description: "Optional new book ID. Usually omit it and let InkOS derive the ID from title.",
  })),
  title: Type.Optional(Type.String({ description: "Confirmed book title. Required when creating a book." })),
  genre: Type.Optional(Type.String({ description: "Confirmed book genre." })),
  platform: Type.Optional(Type.Union([
    Type.Literal("tomato"),
    Type.Literal("qidian"),
    Type.Literal("feilu"),
    Type.Literal("other"),
  ], { description: "Confirmed target platform. Default: other" })),
  language: Type.Optional(Type.Union([
    Type.Literal("zh"),
    Type.Literal("en"),
  ], { description: "Confirmed writing language. Default: zh" })),
  targetChapters: Type.Optional(Type.Number({ description: "Confirmed total chapter count. Default: 200" })),
  chapterWordCount: Type.Optional(Type.Number({ description: "Confirmed per-chapter length in the book's native unit. Default: 3000 zh, 2000 en" })),
});

function prepareSubAgentArguments(args: unknown): SubAgentParamsType {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return args as SubAgentParamsType;
  }

  const prepared = { ...(args as Record<string, unknown>) };
  if ("platform" in prepared) {
    const platform = normalizePlatformId(prepared.platform);
    if (platform) {
      prepared.platform = platform;
    } else {
      delete prepared.platform;
    }
  }
  return prepared as SubAgentParamsType;
}

function runPipelineWithAgentContext<T>(
  pipeline: PipelineRunner,
  signal: AbortSignal | undefined,
  activatedSkills: ReadonlyArray<ActivatedSkillGuidance>,
  task: () => Promise<T>,
): Promise<T> {
  return runAsWorkflowTrajectory(() => (
    pipeline.runWithAgentContext({ signal, activatedSkills }, task)
  ));
}

function runPipelineWithAbortSignal<T>(
  pipeline: PipelineRunner,
  signal: AbortSignal | undefined,
  task: () => Promise<T>,
): Promise<T> {
  return runPipelineWithAgentContext(pipeline, signal, [], task);
}

interface SkillAwareProductionOptions {
  readonly defaultSkills?: ReadonlyArray<ActivatedSkillGuidance>;
  readonly activeSkills?: () => ReadonlyArray<ActivatedSkillGuidance>;
}

function resolveProductionToolSkills(options: SkillAwareProductionOptions): ActivatedSkillGuidance[] {
  return mergeActivatedSkillGuidance(
    options.defaultSkills ?? [],
    options.activeSkills?.() ?? [],
  );
}

export function createSubAgentTool(
  pipeline: PipelineRunner,
  activeBookId: string | null,
  projectRoot?: string,
  options: {
    readonly actionPayload?: ActionPayload;
    readonly architectCreateOnly?: boolean;
    readonly language?: "zh" | "en";
    readonly activeSkills?: () => ReadonlyArray<ActivatedSkillGuidance>;
    readonly workerSkills?: (agent: string) => ReadonlyArray<ActivatedSkillGuidance>;
  } = {},
): AgentTool<any> {
  const sessionIsZh = (options.language ?? "zh") !== "en";
  return {
    name: "sub_agent",
    description: options.architectCreateOnly
      ? "Create a new long-form InkOS book foundation. This confirmation turn can only call agent='architect'; writing chapters happens after the session is bound to the created book."
      : "Delegate a heavy operation to a specialised sub-agent. " +
        "Use agent='architect' to initialise a new book, 'writer' to write the next chapter, " +
        "'auditor' to audit quality, 'reviser' to revise a chapter, 'exporter' to export.",
    label: "Sub-Agent",
    parameters: options.architectCreateOnly ? ArchitectCreateSubAgentParams : SubAgentParams,
    prepareArguments: prepareSubAgentArguments,
    async execute(
      toolCallId: string,
      params: SubAgentParamsType,
      _signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback,
    ): Promise<AgentToolResult<unknown>> {
      return runWithAgentTrajectoryRole("subagent", async () => {
        const { agent, instruction, bookId, title, chapterNumber, chapterCount, genre, platform, language, targetChapters, chapterWordCount, revise, feedback, mode, format, approvedOnly } = params;
        const activatedSkills = mergeActivatedSkillGuidance(
          options.workerSkills?.(agent) ?? [],
          options.activeSkills?.() ?? [],
        );
        const skillIds = activatedSkills.map((activation) => activation.skill.id);

        const progress = (msg: string) => {
          onUpdate?.(textResult(msg));
        };

        try {
          if (options.architectCreateOnly && agent !== "architect") {
            throw new Error("This confirmed book-creation turn can only run the architect. Open the created book or use the book session to write chapters.");
          }
          if (!activeBookId && agent !== "architect") {
            return textResult("No active book. Only the architect agent can create a book from this session.");
          }
          if (activeBookId && agent === "architect" && !revise) {
            return textResult(
              sessionIsZh
                ? "当前已有书籍，不需要建书。如果你想创建新书，请先回到首页。"
                : "This session already has a book, so no new book is needed. To create a new book, go back to the home page first.",
            );
          }

          switch (agent) {
            case "architect": {
            const createBookPayload = options.actionPayload?.createBook;
            if (revise) {
              if (!activeBookId) {
                return textResult("Open the book first before revising its foundation.");
              }
              const targetBookId = resolveToolBookId("architect", bookId, activeBookId);
              progress(`Revising foundation for "${targetBookId}"...`);
              await runPipelineWithAgentContext(
                pipeline,
                _signal,
                activatedSkills,
                () => pipeline.reviseFoundation(targetBookId, feedback ?? instruction),
              );
              progress(`Foundation revised for "${targetBookId}".`);
              return textResult(
                sessionIsZh
                  ? `Book "${targetBookId}" 架构稿已按要求重写。原书的条目式架构稿已备份到 story/.backup-phase4-<时间戳>/。`
                  : `Book "${targetBookId}" foundation has been rewritten as requested. The previous itemized foundation was backed up to story/.backup-phase4-<timestamp>/.`,
              );
            }
            const confirmedTitle = createBookPayload?.title?.trim();
            const resolvedTitle = confirmedTitle || title?.trim();
            if (!resolvedTitle) {
              return textResult('Error: title is required for the architect agent.');
            }
            const id = confirmedTitle
              ? deriveBookIdFromTitle(confirmedTitle) || `book-${Date.now().toString(36)}`
              : bookId
                ? assertSafeBookId(bookId, "architect.bookId")
                : deriveBookIdFromTitle(resolvedTitle) || `book-${Date.now().toString(36)}`;
            const now = new Date().toISOString();
            const resolvedLanguage = createBookPayload?.language ?? language ?? inferLanguage(instruction);
            progress(`Starting architect for book "${id}"...`);
            await runPipelineWithAgentContext(
              pipeline,
              _signal,
              activatedSkills,
              () => pipeline.initBook(
                {
                  id,
                  title: resolvedTitle,
                  genre: createBookPayload?.genre ?? genre ?? "general",
                  platform: normalizePlatformOrOther(createBookPayload?.platform ?? platform),
                  language: resolvedLanguage as any,
                  status: "outlining" as any,
                  targetChapters: createBookPayload?.targetChapters ?? targetChapters ?? 200,
                  chapterWordCount: createBookPayload?.chapterWordCount ?? chapterWordCount ?? defaultChapterLength(resolvedLanguage),
                  createdAt: now,
                  updatedAt: now,
                },
                { externalContext: instruction },
              ),
            );
            progress(`Architect finished — book "${id}" foundation created.`);
            return textResult(
              `Book "${resolvedTitle}" (${id}) initialised successfully. Foundation files are ready.`,
              { kind: "book_created", bookId: id, title: resolvedTitle, skillIds },
            );
          }

          case "writer": {
            const targetBookId = resolveToolBookId("writer", bookId, activeBookId);
            const requestedCount = chapterCount ?? 1;
            if (requestedCount > 1) {
              progress(`Writing ${requestedCount} consecutive chapters for "${targetBookId}"...`);
              const results = await runPipelineWithAgentContext(
                pipeline,
                _signal,
                activatedSkills,
                () => pipeline.writeChapters(targetBookId, requestedCount, {
                  wordCount: chapterWordCount,
                  externalContext: instruction,
                  onChapterComplete(result, completedCount, totalCount) {
                    progress(`Writer finished chapter ${result.chapterNumber} (${completedCount}/${totalCount}) for "${targetBookId}".`);
                  },
                }),
              );
              const last = results.at(-1);
              const stoppedStatus = last?.status !== "ready-for-review" ? last?.status : undefined;
              const output = textResult(
                stoppedStatus
                  ? sessionIsZh
                    ? `已完成 ${results.length}/${requestedCount} 章；第 ${last?.chapterNumber} 章状态为 ${stoppedStatus}，批量写作已停止，请复核后再继续。`
                    : `Writer completed ${results.length} of ${requestedCount} requested chapters for "${targetBookId}" and stopped because chapter ${last?.chapterNumber} ended with status "${stoppedStatus}".`
                  : sessionIsZh
                    ? `已连续完成 ${results.length} 章（第 ${results[0]?.chapterNumber} 章至第 ${last?.chapterNumber} 章）。`
                    : `Writer completed ${results.length} consecutive chapters for "${targetBookId}".`,
                {
                  kind: "chapters_written",
                  bookId: targetBookId,
                  requestedCount,
                  completedCount: results.length,
                  skillIds,
                  chapters: results.map((result) => ({
                    chapterNumber: result.chapterNumber,
                    title: result.title,
                    wordCount: result.wordCount,
                    status: result.status,
                    ...(result.contextTrace ? { contextTrace: result.contextTrace } : {}),
                  })),
                  ...(stoppedStatus ? { stoppedStatus } : {}),
                },
              );
              return stoppedStatus ? { ...output, isError: true } : output;
            }
            progress(`Writing next chapter for "${targetBookId}"...`);
            const result = await runPipelineWithAgentContext(
              pipeline,
              _signal,
              activatedSkills,
              () => pipeline.writeNextChapter(targetBookId, chapterWordCount, undefined, instruction),
            );
            progress(`Writer finished chapter for "${targetBookId}".`);
            const resultStatus = (result as any).status;
            const wordCount = (result as any).wordCount ?? "unknown";
            const chapterNumberResult = (result as any).chapterNumber;
            const titleResult = (result as any).title;
            const needsReview = Boolean(resultStatus && resultStatus !== "ready-for-review" && resultStatus !== "active");
            const chapterRef = chapterNumberResult
              ? sessionIsZh
                ? `第 ${chapterNumberResult} 章${titleResult ? `《${titleResult}》` : ""}`
                : `chapter ${chapterNumberResult}${titleResult ? ` "${titleResult}"` : ""}`
              : sessionIsZh ? "下一章" : "the next chapter";
            const message = needsReview
              ? sessionIsZh
                ? `已为 ${targetBookId} 写出${chapterRef}，字数 ${wordCount}，但审稿未通过，状态 ${resultStatus}，需要复核后再继续。`
                : `Wrote ${chapterRef} for ${targetBookId}: ${wordCount} words, but review did not pass (status: ${resultStatus}). Manual review is required before continuing.`
              : sessionIsZh
                ? `已为 ${targetBookId} 完成${chapterRef}，字数 ${wordCount}，状态 ${resultStatus ?? "ready-for-review"}。`
                : `Completed ${chapterRef} for ${targetBookId}: ${wordCount} words, status ${resultStatus ?? "ready-for-review"}.`;
            const output = textResult(
              message,
              {
                kind: "chapter_written",
                bookId: targetBookId,
                chapterNumber: chapterNumberResult,
                title: titleResult,
                wordCount,
                status: resultStatus,
                skillIds,
                ...(result.contextTrace ? { contextTrace: result.contextTrace } : {}),
              },
            );
            return needsReview ? { ...output, isError: true } : output;
          }

          case "auditor": {
            const targetBookId = resolveToolBookId("auditor", bookId, activeBookId);
            progress(`Auditing chapter ${chapterNumber ?? "latest"} for "${targetBookId}"...`);
            const audit = await runPipelineWithAgentContext(
              pipeline,
              _signal,
              activatedSkills,
              () => pipeline.auditDraft(targetBookId, chapterNumber),
            );
            progress(`Audit complete for "${targetBookId}".`);
            const issueLines = (audit.issues ?? [])
              .map((i: any) => `[${i.severity}] ${i.description}`)
              .join("\n");
            return textResult(
              `Audit chapter ${audit.chapterNumber}: ${audit.passed ? "PASSED" : "FAILED"}, ${(audit.issues ?? []).length} issue(s).` +
              (issueLines ? `\n${issueLines}` : ""),
              {
                kind: "chapter_audit",
                bookId: targetBookId,
                chapterNumber: audit.chapterNumber,
                passed: audit.passed,
                issueCount: (audit.issues ?? []).length,
                skillIds,
              },
            );
          }

          case "reviser": {
            const targetBookId = resolveToolBookId("reviser", bookId, activeBookId);
            const resolvedMode: ReviseMode = (mode as ReviseMode) ?? "spot-fix";
            progress(`Revising "${targetBookId}" chapter ${chapterNumber ?? "latest"} in ${resolvedMode} mode...`);
            const result = await runPipelineWithAgentContext(
              pipeline,
              _signal,
              activatedSkills,
              () => pipeline.reviseDraft(targetBookId, chapterNumber, resolvedMode, instruction),
            );
            const applied = result.applied !== false;
            const resultChapter = result.chapterNumber ?? chapterNumber;
            const details = {
              kind: "chapter_revision",
              bookId: targetBookId,
              chapterNumber: resultChapter,
              mode: resolvedMode,
              applied,
              status: result.status,
              wordCount: result.wordCount,
              fixedIssues: result.fixedIssues,
              skippedReason: result.skippedReason,
              auditPassed: result.auditPassed,
              auditIssues: result.auditIssues,
              revisionDiagnostics: result.revisionDiagnostics,
              skillIds,
            };
            if (!applied) {
              progress(`Revision not applied for "${targetBookId}".`);
              const diagnostics = result.revisionDiagnostics;
              const diagnosticText = diagnostics
                ? [
                    "",
                    "Revision gate:",
                    `- Standard: ${diagnostics.standard}`,
                    `- Before: blocking=${diagnostics.before.blockingCount}, critical=${diagnostics.before.criticalCount}, aiTell=${diagnostics.before.aiTellCount}`,
                    `- After: blocking=${diagnostics.after.blockingCount}, critical=${diagnostics.after.criticalCount}, aiTell=${diagnostics.after.aiTellCount}`,
                    ...(diagnostics.remainingIssues.length > 0
                      ? [
                          "- Remaining issues:",
                          ...diagnostics.remainingIssues.map((issue) => `  - [${issue.severity}] ${issue.category}: ${issue.description}${issue.suggestion ? ` (${issue.suggestion})` : ""}`),
                        ]
                      : []),
                  ].join("\n")
                : "";
              return textResult(
                `Revision not applied for "${targetBookId}" chapter ${resultChapter ?? "latest"}: ${result.skippedReason ?? result.status ?? "pipeline kept the original chapter"}.${diagnosticText}`,
                details,
              );
            }
            progress(`Revision complete for "${targetBookId}".`);
            const auditText = result.auditPassed === undefined
              ? ""
              : result.auditPassed
                ? " Audit passed."
                : ` Audit still has ${(result.auditIssues ?? []).length} blocking issue(s).`;
            return textResult(
              `Revision (${resolvedMode}) complete for "${targetBookId}" chapter ${resultChapter ?? "latest"}.${auditText}`,
              details,
            );
          }

          case "exporter": {
            const targetBookId = resolveToolBookId("exporter", bookId, activeBookId);
            if (!projectRoot) return textResult("Error: exporter requires projectRoot.");
            const state = new StateManager(projectRoot);
            const result = await writeExportArtifact(state, targetBookId, {
              format: format ?? "txt",
              approvedOnly: approvedOnly ?? false,
            });
            return textResult(
              `Exported "${targetBookId}": ${result.chaptersExported} chapters, ${result.totalWords} words → ${result.outputPath}`,
            );
          }

            default:
              return textResult(`Unknown agent: ${agent}`);
          }
        } catch (err: any) {
          if (agent === "architect" && err instanceof ArchitectIncompleteFoundationError) {
            const missing = err.missing.join(", ");
            return textResult(
              [
                err.message,
                "",
                `缺失 section: ${missing}`,
                "我会把已生成的部分保留下来，并继续补齐缺失 section；不要重新发明一本书。",
              ].join("\n"),
              {
                kind: "architect_incomplete",
                missing: [...err.missing],
                partialContent: err.partialContent,
                retryInstruction: `Continue repairing the architect foundation. Preserve the partial content and fill missing sections: ${missing}.`,
              },
            );
          }
          console.error(`[sub_agent] "${agent}" failed:`, err);
          throw err;
        }
      }, toolCallId);
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Research Tool (research_web)
// ---------------------------------------------------------------------------

const ResearchWebParams = Type.Object({
  topic: Type.String({
    description: "Research question or topic, e.g. 1990s county cold-storage accounting workflow or Tang dynasty courier stations.",
  }),
  purpose: Type.Union([
    Type.Literal("worldbuilding"),
    Type.Literal("era"),
    Type.Literal("profession"),
    Type.Literal("market"),
    Type.Literal("fact-check"),
    Type.Literal("general"),
  ], {
    description: "Why this research is needed. Research reports are references only and must not directly mutate story state.",
  }),
  depth: Type.Optional(Type.Union([
    Type.Literal("quick"),
    Type.Literal("standard"),
    Type.Literal("deep"),
  ], {
    description: "Research depth. Default standard.",
  })),
});

type ResearchWebParamsType = Static<typeof ResearchWebParams>;

export function createResearchWebTool(projectRoot: string): AgentTool<typeof ResearchWebParams> {
  return {
    name: "research_web",
    description:
      "Collect traceable web research for worldbuilding, era, profession, market, or fact-check questions. " +
      "Saves a Markdown report under .inkos/research/. It is reference material only; it must not modify books, chapters, or truth files.",
    label: "Research Web",
    parameters: ResearchWebParams,
    async execute(
      _toolCallId: string,
      params: ResearchWebParamsType,
      _signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback,
    ): Promise<AgentToolResult<unknown>> {
      onUpdate?.(textResult(`Researching: ${params.topic}`));
      const searchConfig = await readResearchSearchConfig(projectRoot);
      const searchOptions = searchConfig.enabled
        ? {
            apiKey: searchConfig.apiKey,
            apiKeyEnv: searchConfig.apiKeyEnv,
            baseUrl: searchConfig.baseUrl,
          }
        : {};
      const report = await runResearchReport({
        topic: params.topic,
        purpose: params.purpose,
        depth: params.depth ?? "standard",
      }, {
        search: (query, maxResults) => searchWeb(query, maxResults, searchOptions),
      });
      const reportDir = join(projectRoot, ".inkos", "research");
      await mkdir(reportDir, { recursive: true });
      const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}-${slugResearchTopic(params.topic)}.md`;
      const reportPath = join(reportDir, fileName);
      await writeFile(reportPath, report.markdown, "utf-8");
      return textResult(
        [
          `Research report saved: ${reportPath}`,
          `Sources: ${report.sources.length}; confidence: ${report.confidence}.`,
          report.partialFailures.length > 0 ? `Partial failures: ${report.partialFailures.length}.` : "Partial failures: none.",
        ].join("\n"),
        {
          kind: "research_report",
          reportPath,
          topic: params.topic,
          purpose: params.purpose,
          depth: params.depth ?? "standard",
          sources: report.sources,
          claims: report.claims,
          confidence: report.confidence,
          partialFailures: report.partialFailures,
        },
      );
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Material Ingestion Tool (ingest_material)
// ---------------------------------------------------------------------------

const IngestMaterialParams = Type.Object({
  sourceKind: Type.Union([
    Type.Literal("url"),
    Type.Literal("file"),
  ], {
    description: "Use url for an external URL; use file for a user-uploaded file path shown in the Uploaded Files block.",
  }),
  url: Type.Optional(Type.String({
    description: "HTTP/HTTPS URL to fetch and extract. Supports HTML/text/JSON/PDF.",
  })),
  filePath: Type.Optional(Type.String({
    description: "Project-relative stored_path from the Uploaded Files block, e.g. .inkos/uploads/session/file.pdf.",
  })),
  filename: Type.Optional(Type.String({
    description: "Original filename when known.",
  })),
  mimeType: Type.Optional(Type.String({
    description: "MIME type when known, e.g. application/pdf or text/markdown.",
  })),
  title: Type.Optional(Type.String({
    description: "Human-readable material title.",
  })),
  purpose: Type.Optional(Type.Union([
    Type.Literal("reference"),
    Type.Literal("worldbuilding"),
    Type.Literal("script"),
    Type.Literal("storyboard"),
    Type.Literal("research"),
    Type.Literal("general"),
  ], {
    description: "Why this material is being ingested. It remains reference material unless the user explicitly promotes it.",
  })),
});

type IngestMaterialParamsType = Static<typeof IngestMaterialParams>;

export function createIngestMaterialTool(projectRoot: string): AgentTool<typeof IngestMaterialParams> {
  return {
    name: "ingest_material",
    description:
      "Extract and archive a user-provided URL or uploaded file into .inkos/materials as traceable Markdown. " +
      "Supports HTML/text/JSON/Markdown/PDF. This creates reference material only; it must not mutate canon, chapters, scripts, or play state.",
    label: "Ingest Material",
    parameters: IngestMaterialParams,
    async execute(
      _toolCallId: string,
      params: IngestMaterialParamsType,
      _signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback,
    ): Promise<AgentToolResult<unknown>> {
      onUpdate?.(textResult(params.sourceKind === "url"
        ? `Extracting URL: ${params.url ?? "(missing)"}`
        : `Extracting file: ${params.filePath ?? params.filename ?? "(missing)"}`));
      const asset = await ingestMaterial(projectRoot, {
        sourceKind: params.sourceKind,
        url: params.url,
        filePath: params.filePath,
        filename: params.filename,
        mimeType: params.mimeType,
        title: params.title,
        purpose: params.purpose ?? "reference",
      });
      return textResult(
        [
          `Material ingested: ${asset.markdownPath}`,
          `Material ID: ${asset.id}`,
          `Kind: ${asset.kind}; chars: ${asset.charCount}; source: ${asset.source}`,
          asset.totalPages !== undefined ? `PDF pages: ${asset.totalPages}` : "",
          "",
          "Excerpt:",
          asset.excerpt,
        ].filter(Boolean).join("\n"),
        {
          kind: "material_ingested",
          asset,
        },
      );
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Material Retrieval Tool (retrieve_material)
// ---------------------------------------------------------------------------

const RetrieveMaterialParams = Type.Object({
  query: Type.String({
    description: "Natural-language query written by the agent from the user's current task, e.g. 冷库赔偿款 0607 账页 or storyboard shot requirements.",
  }),
  purpose: Type.Optional(Type.Union([
    Type.Literal("reference"),
    Type.Literal("worldbuilding"),
    Type.Literal("script"),
    Type.Literal("storyboard"),
    Type.Literal("research"),
    Type.Literal("general"),
  ], {
    description: "Optional material purpose filter.",
  })),
  limit: Type.Optional(Type.Number({
    description: "Maximum number of material snippets to return. Default 5.",
  })),
});

type RetrieveMaterialParamsType = Static<typeof RetrieveMaterialParams>;

export function createRetrieveMaterialTool(projectRoot: string): AgentTool<typeof RetrieveMaterialParams> {
  return {
    name: "retrieve_material",
    description:
      "Retrieve traceable snippets from previously ingested .inkos/materials reference cards. " +
      "The agent supplies the semantic query; InkOS returns evidence pointers. This must not mutate canon, chapters, scripts, or play state.",
    label: "Retrieve Material",
    parameters: RetrieveMaterialParams,
    async execute(
      _toolCallId: string,
      params: RetrieveMaterialParamsType,
      _signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback,
    ): Promise<AgentToolResult<unknown>> {
      onUpdate?.(textResult(`Retrieving materials: ${params.query}`));
      const results = await retrieveMaterials(projectRoot, {
        query: params.query,
        purpose: params.purpose,
        limit: params.limit,
      });
      if (results.length === 0) {
        return textResult(
          "No matching archived materials were found. Ask the user to upload or ingest relevant material if needed.",
          {
            kind: "material_retrieval",
            query: params.query,
            purpose: params.purpose,
            results: [],
          },
        );
      }
      return textResult(
        [
          `Retrieved ${results.length} material snippet${results.length === 1 ? "" : "s"}.`,
          "",
          ...results.flatMap((result, index) => [
            `## ${index + 1}. ${result.title}`,
            `- material_id: ${result.id}`,
            `- source: ${result.source}`,
            `- path: ${result.markdownPath}:${result.charStart}-${result.charEnd}`,
            `- purpose: ${result.purpose}`,
            `- score: ${result.score.toFixed(2)}`,
            "",
            result.excerpt,
            "",
          ]),
        ].join("\n"),
        {
          kind: "material_retrieval",
          query: params.query,
          purpose: params.purpose,
          results,
        },
      );
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Book Reference Binding Tool (manage_book_reference)
// ---------------------------------------------------------------------------

const ManageBookReferenceParams = Type.Object({
  action: Type.Union([
    Type.Literal("list"),
    Type.Literal("bind"),
    Type.Literal("unbind"),
  ], {
    description: "list = inspect bindings; bind = attach an ingested material to this book; unbind = remove that attachment without deleting the project asset.",
  }),
  materialId: Type.Optional(Type.String({
    description: "Exact material asset id returned by ingest_material. Required for bind and unbind.",
  })),
  uses: Type.Optional(Type.Array(Type.String(), {
    description: "bind only: user-defined natural-language purposes, e.g. 开篇机制, 人物关系, 调查节奏. Preserve the user's words instead of mapping them to a fixed taxonomy.",
  })),
  note: Type.Optional(Type.String({
    description: "bind only: optional user instruction that limits how this reference may be used.",
  })),
});

type ManageBookReferenceParamsType = Static<typeof ManageBookReferenceParams>;

export function createManageBookReferenceTool(
  projectRoot: string,
  activeBookId: string,
): AgentTool<typeof ManageBookReferenceParams> {
  const bookId = assertSafeBookId(activeBookId, "manage_book_reference.bookId");
  return {
    name: "manage_book_reference",
    description:
      "Bind already-ingested project materials to the active book with user-defined purposes, list current bindings, or unbind them. " +
      "The material remains stored once under .inkos/materials. Binding never copies prose into the book and never changes canon by itself.",
    label: "Manage Book Reference",
    parameters: ManageBookReferenceParams,
    async execute(
      _toolCallId: string,
      params: ManageBookReferenceParamsType,
      signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback,
    ): Promise<AgentToolResult<unknown>> {
      signal?.throwIfAborted();
      if (params.action === "list") {
        const listed = await listBookReferences(projectRoot, bookId);
        const references = listed.references.map((reference) => ({
          materialId: reference.materialId,
          title: reference.title,
          uses: reference.uses,
          note: reference.note,
          available: reference.available,
          error: reference.error,
        }));
        return textResult(
          references.length === 0
            ? `No reference materials are bound to book "${bookId}".`
            : [
                `Bound references for "${bookId}":`,
                ...references.map((reference) => [
                  `- ${reference.title ?? reference.materialId} (${reference.materialId})`,
                  `  uses: ${reference.uses.join("; ")}`,
                  reference.note ? `  note: ${reference.note}` : undefined,
                  reference.available ? undefined : `  unavailable: ${reference.error ?? "material missing"}`,
                ].filter(Boolean).join("\n")),
              ].join("\n"),
          { kind: "book_reference_list", bookId, references },
        );
      }

      const materialId = params.materialId?.trim();
      if (!materialId) throw new Error(`manage_book_reference.${params.action} requires materialId.`);
      if (params.action === "unbind") {
        onUpdate?.(textResult(`Unbinding reference ${materialId} from ${bookId}...`));
        const result = await unbindBookReference(projectRoot, bookId, materialId);
        return textResult(
          result.removed
            ? `Reference ${materialId} was unbound from "${bookId}". The project asset was kept.`
            : `Reference ${materialId} was not bound to "${bookId}".`,
          { kind: "book_reference_unbound", bookId, materialId, removed: result.removed },
        );
      }

      const uses = params.uses ?? [];
      onUpdate?.(textResult(`Binding reference ${materialId} to ${bookId}...`));
      const manifest = await bindBookReference(projectRoot, bookId, {
        materialId,
        uses,
        note: params.note,
      });
      const binding = manifest.bindings.find((entry) => entry.materialId === materialId)!;
      return textResult(
        [
          `Reference ${materialId} was bound to "${bookId}".`,
          `Uses: ${binding.uses.join("; ")}`,
          binding.note ? `Note: ${binding.note}` : undefined,
          "Future chapter composition may select relevant sections; the reference does not override author intent or canon.",
        ].filter(Boolean).join("\n"),
        {
          kind: "book_reference_bound",
          bookId,
          materialId,
          uses: binding.uses,
          note: binding.note,
        },
      );
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Chapter Import Tool (import_chapters)
// ---------------------------------------------------------------------------

const ImportChaptersParams = Type.Object({
  bookId: Type.Optional(Type.String({
    description: "Target book ID to import into. In active-book sessions, omit it to use the current active book; if provided, it must match the active book. In general chat there is no active book, so it is required and must be an existing book.",
  })),
  sourcePath: Type.String({
    description: "Local path of the chapter source: either the stored_path from the Uploaded Files block (project-relative, e.g. .inkos/uploads/<session>/novel.txt) or an absolute path on this machine that the user provided. A directory imports each .md/.txt file as one chapter in filename order; a single file is split into chapters automatically by heading lines.",
  }),
  splitPattern: Type.Optional(Type.String({
    description: "Single-file mode only: custom JavaScript regex source matching chapter heading lines. Omit to use the default pattern, which matches \"第X章/第X回\" and \"Chapter N\" headings.",
  })),
  resumeFrom: Type.Optional(Type.Number({
    description: "Resume an interrupted import from chapter N (1-based). Required when the book already has chapters: replay starts at chapter N and earlier chapters are kept. Omit for a fresh import into an empty book.",
  })),
  importMode: Type.Optional(Type.Union([
    Type.Literal("continuation"),
    Type.Literal("series"),
  ], {
    description: "continuation (default): the book picks up exactly where the imported text left off, no new spacetime. series: shared universe but an independent new story, so a new spacetime is generated.",
  })),
});

type ImportChaptersParamsType = Static<typeof ImportChaptersParams>;

export function createImportChaptersTool(
  pipeline: PipelineRunner,
  activeBookId: string | null,
  projectRoot: string,
): AgentTool<typeof ImportChaptersParams> {
  return {
    name: "import_chapters",
    description:
      "Import an existing novel's chapters from a local file or directory into an InkOS book as real chapters (not reference material). " +
      "InkOS reverse-engineers foundation/truth files from the imported text and replays every chapter to rebuild story state, so the book can be continued afterwards. " +
      "Use ingest_material instead when the user only wants to archive reference material without touching book chapters.",
    label: "Import Chapters",
    parameters: ImportChaptersParams,
    async execute(
      _toolCallId: string,
      params: ImportChaptersParamsType,
      _signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback,
    ): Promise<AgentToolResult<unknown>> {
      const targetBookId = resolveToolBookId("import_chapters", params.bookId, activeBookId);

      const state = new StateManager(projectRoot);
      const existingChapterCount = (await state.getNextChapterNumber(targetBookId)) - 1;
      if (existingChapterCount > 0 && params.resumeFrom === undefined) {
        throw new Error(
          `Book "${targetBookId}" already has ${existingChapterCount} chapter(s). ` +
          `Pass resumeFrom=<n> to resume/append from chapter n, or ask the user to clear the existing chapters first.`,
        );
      }

      const resolvedSourcePath = isAbsolute(params.sourcePath)
        ? params.sourcePath
        : resolve(projectRoot, params.sourcePath);
      onUpdate?.(textResult(`Reading chapters from ${resolvedSourcePath}...`));
      const chapters = await loadChaptersFromPath(resolvedSourcePath, params.splitPattern);

      onUpdate?.(textResult(`Found ${chapters.length} chapter(s); importing into "${targetBookId}"...`));
      const result = await runPipelineWithAbortSignal(
        pipeline,
        _signal,
        () => pipeline.importChapters({
          bookId: targetBookId,
          chapters,
          resumeFrom: params.resumeFrom,
          importMode: params.importMode,
        }),
      );

      const regeneratedFoundation = (params.resumeFrom ?? 1) === 1;
      return textResult(
        [
          `Imported ${result.importedCount} chapter(s) into book "${result.bookId}".`,
          `Total imported length: ${result.totalWords}. Next chapter to write: ${result.nextChapter}.`,
          regeneratedFoundation
            ? "Foundation and truth files were reverse-engineered from the imported text; chapter files and the chapter index were rebuilt by sequential replay."
            : `Resumed replay from chapter ${params.resumeFrom}; earlier chapters and the existing foundation were kept.`,
          `The book can now be continued with sub_agent(agent="writer") in the book session.`,
        ].join("\n"),
        {
          kind: "chapters_imported",
          bookId: result.bookId,
          importedCount: result.importedCount,
          totalWords: result.totalWords,
          nextChapter: result.nextChapter,
          importMode: params.importMode ?? "continuation",
        },
      );
    },
  };
}

const FanficCreateParams = Type.Object({
  title: Type.String({ description: "Fanfiction book title." }),
  sourceText: Type.Optional(Type.String({ description: "Canon/source text. Prefer sourcePath for long material." })),
  sourcePath: Type.Optional(Type.String({ description: "Project-relative uploaded canon/source path." })),
  sourceName: Type.Optional(Type.String({ description: "Human-readable source work name." })),
  mode: Type.Optional(Type.Union([
    Type.Literal("canon"), Type.Literal("au"), Type.Literal("ooc"), Type.Literal("cp"),
  ])),
  genre: Type.Optional(Type.String()),
  platform: Type.Optional(Type.Union([
    Type.Literal("tomato"), Type.Literal("qidian"), Type.Literal("feilu"), Type.Literal("other"),
  ])),
  language: Type.Optional(Type.Union([Type.Literal("zh"), Type.Literal("en")])),
  targetChapters: Type.Optional(Type.Integer({ minimum: 1 })),
  chapterWordCount: Type.Optional(Type.Integer({ minimum: 1 })),
});

type FanficCreateParamsType = Static<typeof FanficCreateParams>;

export function createFanficBookTool(
  pipeline: PipelineRunner,
  projectRoot: string,
  options: SkillAwareProductionOptions = {},
): AgentTool<typeof FanficCreateParams> {
  return {
    name: "fanfic_create",
    description: "Create an InkOS fanfiction book directly from supplied canon/source material after user confirmation.",
    label: "Create Fanfiction",
    parameters: FanficCreateParams,
    async execute(_toolCallId, params: FanficCreateParamsType, signal, onUpdate) {
      const source = await loadCreationSource({
        projectRoot,
        sourceText: params.sourceText,
        sourcePath: params.sourcePath,
        sourceName: params.sourceName,
        purpose: "reference",
      });
      const mode = params.mode ?? "canon";
      const book = buildAgentBookConfig({
        ...params,
        fanficMode: mode,
      }, { targetChapters: 100 });
      await assertBookDoesNotExist(projectRoot, book.id);
      const activatedSkills = resolveProductionToolSkills(options);
      onUpdate?.(textResult(`Creating fanfiction book "${book.title}" from ${source.name}...`));
      await runPipelineWithAgentContext(pipeline, signal, activatedSkills, () => (
        pipeline.initFanficBook(book, source.text, source.name, mode)
      ));
      return textResult(
        `Created fanfiction book "${book.title}" (${book.id}) in ${mode} mode.`,
        {
          kind: "book_created",
          creationKind: "fanfic",
          bookId: book.id,
          title: book.title,
          fanficMode: mode,
          sourceName: source.name,
          skillIds: activatedSkillIds(activatedSkills),
        },
      );
    },
  };
}

const SpinoffCreateParams = Type.Object({
  title: Type.String({ description: "Standalone side-story title." }),
  parentBookId: Type.String({ description: "Existing InkOS parent book id." }),
  direction: Type.Optional(Type.String({ description: "Side-story direction that must not advance the parent mainline." })),
  genre: Type.Optional(Type.String()),
  platform: Type.Optional(Type.Union([
    Type.Literal("tomato"), Type.Literal("qidian"), Type.Literal("feilu"), Type.Literal("other"),
  ])),
  language: Type.Optional(Type.Union([Type.Literal("zh"), Type.Literal("en")])),
  targetChapters: Type.Optional(Type.Integer({ minimum: 1 })),
  chapterWordCount: Type.Optional(Type.Integer({ minimum: 1 })),
});

type SpinoffCreateParamsType = Static<typeof SpinoffCreateParams>;

export function createSpinoffBookTool(
  pipeline: PipelineRunner,
  projectRoot: string,
  options: SkillAwareProductionOptions = {},
): AgentTool<typeof SpinoffCreateParams> {
  return {
    name: "spinoff_create",
    description: "Create a standalone side story that inherits canon from an existing InkOS parent book.",
    label: "Create Side Story",
    parameters: SpinoffCreateParams,
    async execute(_toolCallId, params: SpinoffCreateParamsType, signal, onUpdate) {
      const parentBookId = assertSafeBookId(params.parentBookId, "spinoff_create.parentBookId");
      const state = new StateManager(projectRoot);
      const parent = await state.loadBookConfig(parentBookId);
      const book = buildAgentBookConfig({
        ...params,
        parentBookId,
        genre: params.genre ?? parent.genre,
        platform: params.platform ?? parent.platform,
        language: params.language ?? parent.language,
        targetChapters: params.targetChapters ?? parent.targetChapters,
        chapterWordCount: params.chapterWordCount ?? parent.chapterWordCount,
      });
      await assertBookDoesNotExist(projectRoot, book.id);
      const activatedSkills = resolveProductionToolSkills(options);
      onUpdate?.(textResult(`Creating side story "${book.title}" from parent book "${parent.title}"...`));
      await runPipelineWithAgentContext(pipeline, signal, activatedSkills, () => (
        pipeline.initSpinoffBook(book, parentBookId, params.direction)
      ));
      return textResult(
        `Created side-story book "${book.title}" (${book.id}) from "${parent.title}".`,
        {
          kind: "book_created",
          creationKind: "spinoff",
          bookId: book.id,
          title: book.title,
          parentBookId,
          skillIds: activatedSkillIds(activatedSkills),
        },
      );
    },
  };
}

const ImitationCreateParams = Type.Object({
  title: Type.String({ description: "Original imitation-project title." }),
  referenceText: Type.Optional(Type.String({ description: "Reference prose. Prefer referencePath for long material." })),
  referencePath: Type.Optional(Type.String({ description: "Project-relative uploaded reference-work path." })),
  storyIdea: Type.String({ description: "Original story idea. The reference contributes prose style, not plot or characters." }),
  sourceName: Type.Optional(Type.String({ description: "Human-readable reference work name." })),
  genre: Type.Optional(Type.String()),
  platform: Type.Optional(Type.Union([
    Type.Literal("tomato"), Type.Literal("qidian"), Type.Literal("feilu"), Type.Literal("other"),
  ])),
  language: Type.Optional(Type.Union([Type.Literal("zh"), Type.Literal("en")])),
  targetChapters: Type.Optional(Type.Integer({ minimum: 1 })),
  chapterWordCount: Type.Optional(Type.Integer({ minimum: 1 })),
});

type ImitationCreateParamsType = Static<typeof ImitationCreateParams>;

export function createImitationBookTool(
  pipeline: PipelineRunner,
  projectRoot: string,
  options: SkillAwareProductionOptions = {},
): AgentTool<typeof ImitationCreateParams> {
  return {
    name: "imitation_create",
    description: "Create an original InkOS book and derive its prose style guide from supplied reference writing.",
    label: "Create Style Imitation",
    parameters: ImitationCreateParams,
    async execute(_toolCallId, params: ImitationCreateParamsType, signal, onUpdate) {
      const reference = await loadCreationSource({
        projectRoot,
        sourceText: params.referenceText,
        sourcePath: params.referencePath,
        sourceName: params.sourceName,
        purpose: "reference",
      });
      const book = buildAgentBookConfig(params);
      await assertBookDoesNotExist(projectRoot, book.id);
      const activatedSkills = resolveProductionToolSkills(options);
      onUpdate?.(textResult(`Creating original book "${book.title}" with style reference ${reference.name}...`));
      await runPipelineWithAgentContext(pipeline, signal, activatedSkills, () => (
        pipeline.initImitationBook(book, reference.text, params.storyIdea, reference.name)
      ));
      return textResult(
        `Created imitation book "${book.title}" (${book.id}) with a persisted style guide.`,
        {
          kind: "book_created",
          creationKind: "imitation",
          bookId: book.id,
          title: book.title,
          sourceName: reference.name,
          skillIds: activatedSkillIds(activatedSkills),
        },
      );
    },
  };
}

const ContinuationImportParams = Type.Object({
  bookId: Type.Optional(Type.String({ description: "Existing target book id. Omit to create a new continuation book." })),
  title: Type.Optional(Type.String({ description: "New book title when bookId is omitted." })),
  sourcePath: Type.String({ description: "Project-relative uploaded novel file or chapter directory." }),
  splitPattern: Type.Optional(Type.String({ description: "Optional custom chapter-heading regex source." })),
  resumeFrom: Type.Optional(Type.Integer({ minimum: 1 })),
  genre: Type.Optional(Type.String()),
  platform: Type.Optional(Type.Union([
    Type.Literal("tomato"), Type.Literal("qidian"), Type.Literal("feilu"), Type.Literal("other"),
  ])),
  language: Type.Optional(Type.Union([Type.Literal("zh"), Type.Literal("en")])),
  targetChapters: Type.Optional(Type.Integer({ minimum: 1 })),
  chapterWordCount: Type.Optional(Type.Integer({ minimum: 1 })),
});

type ContinuationImportParamsType = Static<typeof ContinuationImportParams>;

export function createContinuationImportTool(
  pipeline: PipelineRunner,
  activeBookId: string | null,
  projectRoot: string,
  options: SkillAwareProductionOptions = {},
): AgentTool<typeof ContinuationImportParams> {
  return {
    name: "continuation_import",
    description: "Import an uploaded novel into an existing or newly created InkOS book, rebuild story state, and prepare it for continuation.",
    label: "Import for Continuation",
    parameters: ContinuationImportParams,
    async execute(_toolCallId, params: ContinuationImportParamsType, signal, onUpdate) {
      if (isAbsolute(params.sourcePath)) {
        throw new Error("continuation_import.sourcePath must be project-relative. Upload the source first.");
      }
      const sourcePath = safeChildPath(projectRoot, params.sourcePath);
      const state = new StateManager(projectRoot);
      const requestedBookId = params.bookId ?? activeBookId ?? undefined;
      let bookId: string;
      let created = false;
      if (requestedBookId) {
        bookId = resolveToolBookId("continuation_import", requestedBookId, activeBookId);
        await state.loadBookConfig(bookId);
      } else {
        if (!params.title?.trim()) {
          throw new Error("continuation_import requires title when no existing bookId is selected.");
        }
        const book = buildAgentBookConfig({ ...params, title: params.title.trim() });
        await assertBookDoesNotExist(projectRoot, book.id);
        await state.saveBookConfig(book.id, book);
        bookId = book.id;
        created = true;
      }

      const existingChapterCount = (await state.getNextChapterNumber(bookId)) - 1;
      if (existingChapterCount > 0 && params.resumeFrom === undefined) {
        throw new Error(`Book "${bookId}" already has ${existingChapterCount} chapter(s); resumeFrom is required.`);
      }
      const chapters = await loadChaptersFromPath(sourcePath, params.splitPattern);
      const activatedSkills = resolveProductionToolSkills(options);
      onUpdate?.(textResult(`Importing ${chapters.length} chapter(s) into "${bookId}" and rebuilding story state...`));
      const result = await runPipelineWithAgentContext(pipeline, signal, activatedSkills, () => (
        pipeline.importChapters({
          bookId,
          chapters,
          resumeFrom: params.resumeFrom,
          importMode: "continuation",
        })
      ));
      return textResult(
        `Imported ${result.importedCount} chapter(s) into "${bookId}". Next chapter: ${result.nextChapter}.`,
        {
          kind: created ? "book_created" : "chapters_imported",
          creationKind: "continuation",
          bookId,
          importedCount: result.importedCount,
          totalWords: result.totalWords,
          nextChapter: result.nextChapter,
          skillIds: activatedSkillIds(activatedSkills),
        },
      );
    },
  };
}

function slugResearchTopic(topic: string): string {
  const slug = topic
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "research";
}

async function readResearchSearchConfig(projectRoot: string) {
  try {
    const raw = JSON.parse(await readFile(join(projectRoot, "inkos.json"), "utf-8")) as Record<string, unknown>;
    return ResearchSearchConfigSchema.parse(raw.researchSearch ?? {});
  } catch {
    return ResearchSearchConfigSchema.parse({});
  }
}

// ---------------------------------------------------------------------------
// 3. Standalone Short Fiction Tool
// ---------------------------------------------------------------------------

const ShortFictionRunParams = Type.Object({
  title: Type.Optional(Type.String({
    description: "Confirmed title or working title. When present, the host uses it as the stable project identity instead of guessing from generated outline prose.",
  })),
  direction: Type.String({
    description: "Required short fiction direction, e.g. 女频短篇 婚姻背叛 证据反杀. Include genre, protagonist pressure, conflict, and desired payoff when known.",
  }),
  reference: Type.Optional(Type.String({
    description: "Optional user-provided reference notes or constraints. Do not paste copyrighted source text unless the user explicitly provided it.",
  })),
  storyId: Type.Optional(Type.String({
    description: "Optional output id under shorts/. Leave empty to derive from the generated title.",
  })),
  chapters: Type.Optional(Type.Number({
    description: "Target complete short chapter count, 12-18. Default 12.",
  })),
  charsPerChapter: Type.Optional(Type.Number({
    description: "Per-chapter length in the story language's native unit: 900-1200 Chinese characters (default 1000) for zh, or 600-800 English words (default 650) for en. Values outside the story language's range are rejected before the pipeline starts. Do not use total story length here.",
  })),
  cover: Type.Optional(Type.Boolean({
    description: "Whether to attempt cover image generation after synopsis and cover prompt. Default true; use false if the user only wants text assets.",
  })),
  coverBaseUrl: Type.Optional(Type.String({
    description: "Optional OpenAI-compatible Responses API base URL for cover generation.",
  })),
  coverEndpoint: Type.Optional(Type.String({
    description: "Optional exact Responses endpoint for cover generation. Overrides coverBaseUrl.",
  })),
  coverModel: Type.Optional(Type.String({
    description: "Optional image-capable Responses model. Default gpt-image-2.",
  })),
  coverSize: Type.Optional(Type.String({
    description: "Optional image size, default 1024x1360.",
  })),
  coverApiKeyEnv: Type.Optional(Type.String({
    description: "Optional env var containing the cover API key. Default INKOS_COVER_API_KEY.",
  })),
});

type ShortFictionRunParamsType = Static<typeof ShortFictionRunParams>;

// 启动 pipeline 之前校验 charsPerChapter 是否落在最终语言的合法区间：
// 确认卡 payload 在 language 缺省时只能做 600-1200 并集校验，这里能拿到最终
// 语言（payload.language ?? 会话语言 ?? zh，与 runner 的默认一致），越界立即
// 抛出带合法范围的双语错误，不让任务开跑后才在 runner 中途失败。
function assertShortRunCharsPerChapter(
  value: number | undefined,
  language: "zh" | "en",
): void {
  if (value === undefined) return;
  const { min, max } = shortRunCharsPerChapterRange(language);
  if (Number.isInteger(value) && value >= min && value <= max) return;
  throw new Error(shortRunCharsPerChapterError(value, language));
}

export function createShortFictionRunTool(
  pipeline: PipelineRunner,
  projectRoot: string,
  options: {
    readonly actionPayload?: ActionPayload;
    readonly language?: "zh" | "en";
  } & SkillAwareProductionOptions = {},
): AgentTool<typeof ShortFictionRunParams> {
  return {
    name: "short_fiction_run",
    description:
      "Create a standalone short fiction project from a direction. " +
      "Runs outline -> outline review/revision -> full draft -> draft review/revision -> synopsis/selling points/cover prompt -> optional cover image. " +
      "Uses the user's direction and optional reference notes as input.",
    label: "Short Fiction",
    parameters: ShortFictionRunParams,
    async execute(
      _toolCallId: string,
      params: ShortFictionRunParamsType,
      _signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback,
    ): Promise<AgentToolResult<unknown>> {
      const progress = (message: string) => onUpdate?.(textResult(message));
      const shortPayload = options.actionPayload?.shortRun;
      const language = shortPayload?.language ?? options.language;
      const charsPerChapter = shortPayload?.charsPerChapter ?? params.charsPerChapter;
      const activatedSkills = resolveProductionToolSkills(options);
      assertShortRunCharsPerChapter(charsPerChapter, language ?? "zh");
      const result = await runPipelineWithAgentContext(
        pipeline,
        _signal,
        activatedSkills,
        () => runShortFictionProduction({
          projectRoot,
          title: shortPayload?.title ?? params.title,
          direction: shortPayload?.direction ?? params.direction,
          runtimes: {
            planner: pipeline.createAgentContext("short-outline"),
            outlineReview: pipeline.createAgentContext("short-outline-review"),
            writer: pipeline.createAgentContext("short-writer"),
            draftReview: pipeline.createAgentContext("short-draft-review"),
            revise: pipeline.createAgentContext("short-revise"),
            package: pipeline.createAgentContext("short-package"),
          },
          ...((shortPayload?.reference ?? params.reference) ? { reference: { text: shortPayload?.reference ?? params.reference! } } : {}),
          storyId: shortPayload?.storyId ?? params.storyId,
          chapterCount: shortPayload?.chapters ?? params.chapters,
          charsPerChapter,
          language,
          cover: shortPayload?.cover ?? params.cover,
          coverBaseUrl: params.coverBaseUrl,
          coverEndpoint: params.coverEndpoint,
          coverModel: params.coverModel,
          coverSize: params.coverSize,
          coverApiKeyEnv: params.coverApiKeyEnv,
          signal: _signal,
          onProgress: progress,
        }),
      );

      return textResult(
        [
          `Short fiction "${result.storyId}" completed.`,
          `Final: ${result.finalMarkdownPath}`,
          `Sales package: ${result.salesPackagePath}`,
          `Cover prompt: ${result.coverPromptPath}`,
          result.coverImagePath
            ? `Cover image: ${result.coverImagePath}`
            : [
                "Cover image: not generated.",
                `Cover image reason: ${summarizeCoverGenerationError(result.coverError)}`,
                "The short fiction draft, synopsis, selling points, and cover prompt were still written successfully.",
              ].join("\n"),
        ].join("\n"),
        { kind: "short_fiction_created", ...result, skillIds: activatedSkillIds(activatedSkills) },
      );
    },
  };
}

function summarizeCoverGenerationError(error: string | undefined): string {
  const text = (error ?? "not generated").trim();
  if (text.includes("HTTP 503")) {
    return "cover provider returned HTTP 503; retry later or switch the Studio cover provider/model.";
  }
  if (text.includes("HTTP 502")) {
    return "cover provider returned HTTP 502; retry later or switch the Studio cover provider/model.";
  }
  if (/API key is required|api key/i.test(text)) {
    return "cover API key is missing; configure it in Studio service settings.";
  }
  return text.slice(0, 300);
}

// ---------------------------------------------------------------------------
// 3. Translation tool
// ---------------------------------------------------------------------------

const TranslationCreateParams = Type.Object({
  filePath: Type.String({
    description: "Project-relative EPUB/PDF/TXT/Markdown source file path to translate.",
  }),
  sourceLanguage: Type.String({
    description: "Source language as a human-readable name, e.g. Auto detect, Japanese, English, Chinese (Simplified), 繁体中文（台湾）. Do not require ISO abbreviations.",
  }),
  targetLanguage: Type.String({
    description: "Target language as a human-readable name, e.g. Chinese (Simplified), English, Japanese, Korean, Brazilian Portuguese. Do not require ISO abbreviations.",
  }),
  title: Type.Optional(Type.String({
    description: "Optional translation project title.",
  })),
  segmentMaxChars: Type.Optional(Type.Number({
    description: "Optional max chars per segment before splitting long paragraphs.",
  })),
});

type TranslationCreateParamsType = Static<typeof TranslationCreateParams>;

export function createTranslationCreateTool(
  projectRoot: string,
  options: { readonly actionPayload?: ActionPayload } = {},
): AgentTool<typeof TranslationCreateParams> {
  return {
    name: "translation_create",
    description:
      "Create an InkOS translation project from an EPUB/PDF/TXT/Markdown file. " +
      "This only ingests and segments the source; running the actual translation is a separate long task.",
    label: "Translation",
    parameters: TranslationCreateParams,
    async execute(_toolCallId: string, params: TranslationCreateParamsType): Promise<AgentToolResult<unknown>> {
      const payload = options.actionPayload?.translationCreate;
      const result = await createTranslationProjectFromFile(projectRoot, {
        filePath: payload?.filePath ?? params.filePath,
        sourceLanguage: payload?.sourceLanguage ?? params.sourceLanguage,
        targetLanguage: payload?.targetLanguage ?? params.targetLanguage,
        title: payload?.title ?? params.title,
        segmentMaxChars: payload?.segmentMaxChars ?? params.segmentMaxChars,
      });
      return textResult(
        [
          `Translation project "${result.manifest.title}" created.`,
          `ID: ${result.manifest.id}`,
          `Source: ${result.manifest.source.kind} ${result.manifest.sourceLanguage} -> ${result.manifest.targetLanguage}`,
          `Chapters: ${result.manifest.chapters.length}`,
          `Manifest: ${result.manifestPath}`,
        ].join("\n"),
        { kind: "translation_project_created", ...result },
      );
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Script and Storyboard tools
// ---------------------------------------------------------------------------

const ScriptCreateParams = Type.Object({
  title: Type.String({
    description: "Required script project title.",
  }),
  instruction: Type.String({
    description: "Confirmed script creation instruction, including format, source, and user preferences.",
  }),
  sourceKind: Type.Optional(Type.String({
    description: "Source type, e.g. novel excerpt, original idea, outline, existing script.",
  })),
  targetFormat: Type.Optional(Type.Union([
    Type.Literal("vertical_short_drama"),
    Type.Literal("screenplay"),
    Type.Literal("audio_drama"),
    Type.Literal("interactive_script"),
    Type.Literal("general_script"),
  ], { description: "Confirmed script output format." })),
  sourceText: Type.Optional(Type.String({
    description: "User-provided source text. For long sources, prefer sourcePath instead of summarizing.",
  })),
  sourcePath: Type.Optional(Type.String({
    description: "Optional project-relative source file path.",
  })),
  requirements: Type.Optional(Type.String({
    description: "Confirmed script format, production constraints, tone, episode structure, or user preferences.",
  })),
  episodeCount: Type.Optional(Type.Number({
    description: "Optional target episode/segment count.",
  })),
  episodeDuration: Type.Optional(Type.String({
    description: "Optional per-episode/per-segment duration.",
  })),
  projectId: Type.Optional(Type.String({
    description: "Optional output id under dramas/.",
  })),
  outDir: Type.Optional(Type.String({
    description: "Optional project-relative output directory. Default dramas/.",
  })),
});

type ScriptCreateParamsType = Static<typeof ScriptCreateParams>;

export function createScriptCreationTool(
  pipeline: PipelineRunner,
  projectRoot: string,
  options: {
    readonly actionPayload?: ActionPayload;
    readonly language?: "zh" | "en";
  } & SkillAwareProductionOptions = {},
): AgentTool<typeof ScriptCreateParams> {
  return {
    name: "script_create",
    description:
      "Create a script project from a novel excerpt, idea, outline, or existing script. " +
      "Writes human-readable Markdown spec and script files under dramas/.",
    label: "Script Creation",
    parameters: ScriptCreateParams,
    async execute(
      _toolCallId: string,
      params: ScriptCreateParamsType,
      _signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback,
    ): Promise<AgentToolResult<unknown>> {
      const progress = (message: string) => onUpdate?.(textResult(message));
      const payload = options.actionPayload?.scriptCreate;
      const activatedSkills = resolveProductionToolSkills(options);
      const result = await runPipelineWithAgentContext(pipeline, _signal, activatedSkills, () => runScriptCreation({
        projectRoot,
        runtime: pipeline.createAgentContext("script-creation"),
        title: payload?.title ?? params.title,
        instruction: params.instruction,
        sourceKind: payload?.sourceKind ?? params.sourceKind,
        targetFormat: (payload?.targetFormat ?? params.targetFormat) as ScriptTargetFormat | undefined,
        sourceText: payload?.sourceText ?? params.sourceText,
        sourcePath: payload?.sourcePath ?? params.sourcePath,
        requirements: payload?.requirements ?? params.requirements,
        episodeCount: payload?.episodeCount ?? params.episodeCount,
        episodeDuration: payload?.episodeDuration ?? params.episodeDuration,
        language: options.language,
        projectId: payload?.projectId ?? params.projectId,
        outDir: payload?.outDir ?? params.outDir,
        onProgress: progress,
      }));

      return textResult(
        [
          `Script "${result.projectId}" completed.`,
          `Spec: ${result.specPath}`,
          `Script: ${result.scriptPath}`,
        ].join("\n"),
        { kind: "script_created", ...result, skillIds: activatedSkillIds(activatedSkills) },
      );
    },
  };
}

const StoryboardCreateParams = Type.Object({
  title: Type.String({
    description: "Required storyboard project title.",
  }),
  instruction: Type.String({
    description: "Confirmed storyboard creation instruction, including source, style, aspect ratio, and shot granularity.",
  }),
  sourceKind: Type.Optional(Type.String({
    description: "Source type, e.g. script, novel excerpt, idea, scene list.",
  })),
  sourceText: Type.Optional(Type.String({
    description: "User-provided source text. For long sources, prefer sourcePath instead of summarizing.",
  })),
  sourcePath: Type.Optional(Type.String({
    description: "Optional project-relative source file path.",
  })),
  requirements: Type.Optional(Type.String({
    description: "Confirmed shot/storyboard requirements.",
  })),
  visualStyle: Type.Optional(Type.String({
    description: "Confirmed visual style, if the user specified one.",
  })),
  aspectRatio: Type.Optional(Type.String({
    description: "Confirmed aspect ratio, e.g. 9:16, 16:9, 1:1.",
  })),
  granularity: Type.Optional(Type.String({
    description: "Confirmed storyboard granularity.",
  })),
  maxShots: Type.Optional(Type.Number({
    description: "Optional max shot count.",
  })),
  projectId: Type.Optional(Type.String({
    description: "Optional output id under storyboards/.",
  })),
  outDir: Type.Optional(Type.String({
    description: "Optional project-relative output directory. Default storyboards/.",
  })),
});

type StoryboardCreateParamsType = Static<typeof StoryboardCreateParams>;

export function createStoryboardCreationTool(
  pipeline: PipelineRunner,
  projectRoot: string,
  options: {
    readonly actionPayload?: ActionPayload;
    readonly language?: "zh" | "en";
  } & SkillAwareProductionOptions = {},
): AgentTool<typeof StoryboardCreateParams> {
  return {
    name: "storyboard_create",
    description:
      "Create a storyboard project and image prompts from a script, novel excerpt, idea, or scene list. " +
      "Writes human-readable Markdown spec, storyboard, and image prompt files under storyboards/.",
    label: "Storyboard Creation",
    parameters: StoryboardCreateParams,
    async execute(
      _toolCallId: string,
      params: StoryboardCreateParamsType,
      _signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback,
    ): Promise<AgentToolResult<unknown>> {
      const progress = (message: string) => onUpdate?.(textResult(message));
      const payload = options.actionPayload?.storyboardCreate;
      const activatedSkills = resolveProductionToolSkills(options);
      const result = await runPipelineWithAgentContext(pipeline, _signal, activatedSkills, () => runStoryboardCreation({
        projectRoot,
        runtime: pipeline.createAgentContext("storyboard-creation"),
        title: payload?.title ?? params.title,
        instruction: params.instruction,
        sourceKind: payload?.sourceKind ?? params.sourceKind,
        sourceText: payload?.sourceText ?? params.sourceText,
        sourcePath: payload?.sourcePath ?? params.sourcePath,
        requirements: payload?.requirements ?? params.requirements,
        visualStyle: payload?.visualStyle ?? params.visualStyle,
        aspectRatio: payload?.aspectRatio ?? params.aspectRatio,
        granularity: payload?.granularity ?? params.granularity,
        maxShots: payload?.maxShots ?? params.maxShots,
        language: options.language,
        projectId: payload?.projectId ?? params.projectId,
        outDir: payload?.outDir ?? params.outDir,
        onProgress: progress,
      }));

      return textResult(
        [
          `Storyboard "${result.projectId}" completed.`,
          `Spec: ${result.specPath}`,
          `Storyboard: ${result.storyboardPath}`,
          `Image prompts: ${result.imagePromptsPath}`,
          `Image assets: ${result.assetsManifestPath}`,
        ].join("\n"),
        { kind: "storyboard_created", ...result, skillIds: activatedSkillIds(activatedSkills) },
      );
    },
  };
}

const InteractiveFilmCreateParams = Type.Object({
  title: Type.String({
    description: "Required interactive-film project title.",
  }),
  instruction: Type.String({
    description: "Confirmed interactive-film creation instruction, including branching, variables/flags, endings, source, and user preferences.",
  }),
  sourceKind: Type.Optional(Type.String({
    description: "Source type, e.g. novel excerpt, script, outline, original idea.",
  })),
  sourceText: Type.Optional(Type.String({
    description: "User-provided source text. For long sources, prefer sourcePath instead of summarizing.",
  })),
  sourcePath: Type.Optional(Type.String({
    description: "Optional project-relative source file path.",
  })),
  requirements: Type.Optional(Type.String({
    description: "Confirmed branching, variable/flag, ending, production, visual, or market requirements.",
  })),
  targetAudience: Type.Optional(Type.String({
    description: "Optional confirmed target audience or market.",
  })),
  episodeCount: Type.Optional(Type.Number({
    description: "Optional target episode/segment count.",
  })),
  episodeDuration: Type.Optional(Type.String({
    description: "Optional per-episode/per-segment duration.",
  })),
  budget: Type.Optional(Type.String({
    description: "Optional budget or production constraints.",
  })),
  referenceMode: Type.Optional(Type.String({
    description: "Optional reference mode, e.g. 盛世天下-style multi-ending interactive drama.",
  })),
  projectId: Type.Optional(Type.String({
    description: "Optional output id under interactive-films/.",
  })),
  outDir: Type.Optional(Type.String({
    description: "Optional project-relative output directory. Default interactive-films/.",
  })),
});

type InteractiveFilmCreateParamsType = Static<typeof InteractiveFilmCreateParams>;

export function createInteractiveFilmCreationTool(
  pipeline: PipelineRunner,
  projectRoot: string,
  options: {
    readonly actionPayload?: ActionPayload;
    readonly language?: "zh" | "en";
  } & SkillAwareProductionOptions = {},
): AgentTool<typeof InteractiveFilmCreateParams> {
  return {
    name: "interactive_film_create",
    description:
      "Create an interactive film/game script package with story tree, variables/flags, endings, script, storyboard, and image prompts. " +
      "Writes human-readable Markdown files under interactive-films/.",
    label: "Interactive Film Creation",
    parameters: InteractiveFilmCreateParams,
    async execute(
      _toolCallId: string,
      params: InteractiveFilmCreateParamsType,
      _signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback,
    ): Promise<AgentToolResult<unknown>> {
      const progress = (message: string) => onUpdate?.(textResult(message));
      const payload = options.actionPayload?.interactiveFilmCreate;
      const activatedSkills = resolveProductionToolSkills(options);
      const result = await runPipelineWithAgentContext(pipeline, _signal, activatedSkills, () => runInteractiveFilmCreation({
        projectRoot,
        runtime: pipeline.createAgentContext("interactive-film-creation"),
        title: payload?.title ?? params.title,
        instruction: params.instruction,
        sourceKind: payload?.sourceKind ?? params.sourceKind,
        sourceText: payload?.sourceText ?? params.sourceText,
        sourcePath: payload?.sourcePath ?? params.sourcePath,
        requirements: payload?.requirements ?? params.requirements,
        targetAudience: payload?.targetAudience ?? params.targetAudience,
        episodeCount: payload?.episodeCount ?? params.episodeCount,
        episodeDuration: payload?.episodeDuration ?? params.episodeDuration,
        budget: payload?.budget ?? params.budget,
        referenceMode: payload?.referenceMode ?? params.referenceMode,
        language: options.language,
        projectId: payload?.projectId ?? params.projectId,
        outDir: payload?.outDir ?? params.outDir,
        onProgress: progress,
      }));

      return textResult(
        [
          `Interactive film "${result.projectId}" completed.`,
          `Spec: ${result.specPath}`,
          `Story graph: ${result.storyGraphPath}`,
          `Story tree: ${result.storyTreePath}`,
          `Flags: ${result.flagsPath}`,
          `Script: ${result.scriptPath}`,
          `Storyboard: ${result.storyboardPath}`,
          `Image prompts: ${result.imagePromptsPath}`,
          `Image assets: ${result.assetsManifestPath}`,
        ].join("\n"),
        { kind: "interactive_film_created", ...result, skillIds: activatedSkillIds(activatedSkills) },
      );
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Standalone Cover Tool
// ---------------------------------------------------------------------------

const GenerateCoverParams = Type.Object({
  title: Type.String({
    description: "Required book or short-fiction title. Use the real story title when regenerating an existing cover.",
  }),
  intro: Type.Optional(Type.String({
    description: "Optional synopsis or one-paragraph story hook to guide the cover.",
  })),
  sellingPoints: Type.Optional(Type.String({
    description: "Optional selling points separated by semicolons or new lines, e.g. 婚姻背叛；证据反杀；女主冷笑.",
  })),
  coverPrompt: Type.Optional(Type.String({
    description: "Optional concrete or revised visual direction. Use this when the user changes the cover prompt through chat. Keep it short and commercial; do not paste the whole story.",
  })),
  outputDir: Type.Optional(Type.String({
    description: "Optional project-relative directory for cover-prompt.md and cover.png. For an existing short or cover prompt revision, use its existing final/cover directory to overwrite that cover.",
  })),
  coverBaseUrl: Type.Optional(Type.String({
    description: "Optional image API base URL. Usually omit and use Studio cover config.",
  })),
  coverEndpoint: Type.Optional(Type.String({
    description: "Optional exact image endpoint. Overrides coverBaseUrl.",
  })),
  coverModel: Type.Optional(Type.String({
    description: "Optional image model. Usually omit and use Studio cover config.",
  })),
  coverSize: Type.Optional(Type.String({
    description: "Optional image size, default 1024x1360.",
  })),
  coverApiKeyEnv: Type.Optional(Type.String({
    description: "Optional env var containing the cover API key. Usually omit and use Studio cover config.",
  })),
});

type GenerateCoverParamsType = Static<typeof GenerateCoverParams>;

export function createGenerateCoverTool(
  projectRoot: string,
  options: { readonly actionPayload?: ActionPayload } = {},
): AgentTool<typeof GenerateCoverParams> {
  return {
    name: "generate_cover",
    description:
      "Generate only a cover image and cover prompt from a title/synopsis/visual direction. " +
      "Use this when the user asks to create/regenerate a cover or revise the cover prompt through chat, without rerunning story generation.",
    label: "Generate Cover",
    parameters: GenerateCoverParams,
    async execute(
      _toolCallId: string,
      params: GenerateCoverParamsType,
      _signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback,
    ): Promise<AgentToolResult<unknown>> {
      onUpdate?.(textResult("Generating cover image..."));
      const coverPayload = options.actionPayload?.generateCover;
      const result = await generateShortFictionCover({
        projectRoot,
        title: coverPayload?.title ?? params.title,
        intro: coverPayload?.intro ?? params.intro,
        sellingPoints: coverPayload?.sellingPoints ?? params.sellingPoints,
        coverPrompt: coverPayload?.coverPrompt ?? params.coverPrompt,
        outputDir: coverPayload?.outputDir ?? params.outputDir,
        coverBaseUrl: params.coverBaseUrl,
        coverEndpoint: params.coverEndpoint,
        coverModel: params.coverModel,
        coverSize: params.coverSize,
        coverApiKeyEnv: params.coverApiKeyEnv,
        signal: _signal,
      });
      return textResult(
        [
          `Cover generated for "${result.title}".`,
          `Cover prompt: ${result.coverPromptPath}`,
          `Cover image: ${result.coverImagePath}`,
        ].join("\n"),
        { kind: "cover_generated", ...result },
      );
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Interactive Play tools
// ---------------------------------------------------------------------------

const PlayStartParams = Type.Object({
  title: Type.String({
    description: "Interactive world title. Use the user's natural direction as a short playable world title.",
  }),
  premise: Type.Optional(Type.String({
    description: "Playable premise: player role, location, pressure, and core conflict. Keep it concise.",
  })),
  worldContract: Type.Optional(Type.String({
    description: "Durable world contract in natural language. Preserve only user-defined long-lived rules: semantic time, role autonomy, object/clue/relationship systems, taboos, or setting laws. Leave empty when the user did not define rules; do not invent RPG/level systems.",
  })),
  visualContract: Type.Optional(Type.String({
    description: "Visual contract for Play illustrations. Preserve only user-defined visual rules; leave empty when unspecified. Do not invent game frames, colored tiers, UI, or stats.",
  })),
  mode: Type.Optional(Type.Union([
    Type.Literal("open"),
    Type.Literal("guided"),
  ], { description: "open = free actions; guided = emphasize suggested actions. Default open." })),
  initialScene: Type.Optional(Type.String({
    description: "Opening scene shown to the player. Write pure narrative prose for the first playable moment, not a config summary, not a question prompt, and not an action/options list.",
  })),
  suggestedActions: Type.Optional(Type.Array(SuggestedActionParam)),
});

type PlayStartParamsType = Static<typeof PlayStartParams>;

export interface PlayStartToolOptions extends SkillAwareProductionOptions {
  readonly actionPayload?: ActionPayload;
  readonly runnerFactory?: (input: {
    readonly projectRoot: string;
    readonly worldId: string;
    readonly runId: string;
    readonly ctx: AgentContext;
    readonly db: PlayGraphDB;
  }) => { seedOpening(input: { sceneText: string; suggestedActions?: readonly string[] }): Promise<PlayOpeningSeedResult | null> };
}

export function createPlayStartTool(
  pipeline: PipelineRunner | null,
  projectRoot: string,
  sessionId: string,
  playMode?: "open" | "guided",
  options: PlayStartToolOptions = {},
): AgentTool<typeof PlayStartParams> {
  return {
    name: "play_start",
    description:
      "Start an interactive InkOS Play world directly from chat. " +
      "Use when the user asks to play, roleplay, run an open-world interactive story, or start a Tavern-like scene.",
    label: "Start Play",
    parameters: PlayStartParams,
    async execute(
      _toolCallId: string,
      params: PlayStartParamsType,
      _signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback,
    ): Promise<AgentToolResult<unknown>> {
      _signal?.throwIfAborted();
      onUpdate?.(textResult("Starting interactive world..."));
      if (!pipeline) {
        throw new Error("play_start requires an initialized InkOS pipeline to create authoritative world state.");
      }
      const playPayload = options.actionPayload?.playStart;
      const activatedSkills = resolveProductionToolSkills(options);
      const store = new PlayStore(projectRoot);
      // The play world is bound 1:1 to the chat session: worldId IS the
      // sessionId. This removes any "which world?" ambiguity, so two play
      // sessions never advance each other's world.
      const worldId = safePlayId(sessionId, sessionId);
      const runId = "main";
      const title = playPayload?.title ?? params.title;
      const premise = playPayload?.premise ?? params.premise;
      const worldContract = playPayload?.worldContract ?? params.worldContract;
      const visualContract = playPayload?.visualContract ?? params.visualContract;
      const initialScene = playPayload?.initialScene?.trim() || params.initialScene;
      const playLanguage = inferLanguage([title, premise, worldContract, visualContract, initialScene].filter(Boolean).join("\n"));
      const existingWorld = await store.loadWorld(worldId);
      const world = await store.createWorld({
        id: worldId,
        title: title.trim(),
        premise: premise?.trim() ?? "",
        worldContract: worldContract?.trim() ?? "",
        visualContract: visualContract?.trim() ?? "",
        mode: playMode ?? params.mode ?? "open",
        language: playLanguage,
      });
      await store.ensureRun(world.id, runId);

      const existingTranscript = await store.readTranscript(world.id, runId);
      const sceneText = (initialScene?.trim() || (world.language === "en"
        ? [`You enter "${world.title}".`, world.premise || "The scene is set. Make your first move."].join("\n")
        : [`你进入「${world.title}」。`, world.premise || "场景已经就位，等待你的第一个动作。"].join("\n"))).trim();
      const suggestedActions = normalizeSuggestedActions(playPayload?.suggestedActions ?? params.suggestedActions);
      let seed: PlayOpeningSeedResult | null = null;
      let graph;
      try {
        const db = createPlayDB(store.runDir(world.id, runId));
        try {
          seed = await runPipelineWithAgentContext(
            pipeline,
            _signal,
            activatedSkills,
            () => {
              const ctx = pipeline.createAgentContext("play");
              const runner = options.runnerFactory?.({
                projectRoot,
                worldId: world.id,
                runId,
                ctx,
                db,
              }) ?? new PlayRunner({
                projectRoot,
                worldId: world.id,
                runId,
                ctx,
                db,
              });
              return runner.seedOpening({ sceneText, suggestedActions });
            },
          );
          _signal?.throwIfAborted();
          graph = db.snapshot();
        } finally {
          closePlayDB(db);
        }

        if (!graph?.entities?.some((entity) => entity.id === "actor_player")
          || !graph.entities.some((entity) => entity.id !== "actor_player")) {
          throw new Error(world.language === "en"
            ? "Play opening state is incomplete: no usable player/world graph was created."
            : "互动世界开场状态不完整：没有生成可用的玩家与世界图谱。");
        }

        if (existingTranscript.length === 0) {
          await store.writeProjection(world.id, runId, "projections/scene.md", `${sceneText}\n`);
          await store.saveCurrentState(world.id, runId, {
            turn: 0,
            worldId: world.id,
            runId,
            mode: world.mode,
            premise: world.premise,
            worldContract: world.worldContract,
            visualContract: world.visualContract,
          });
          await store.appendTranscriptTurn(world.id, runId, {
            role: "assistant",
            content: sceneText,
            timestamp: Date.now(),
          });
        }
      } catch (error) {
        _signal?.throwIfAborted();
        if (!existingWorld) await store.removeWorld(world.id);
        throw error;
      }

      return textResult(
        sceneText,
        {
          kind: "play_world_started",
          worldId: world.id,
          runId,
          title: world.title,
          mode: world.mode,
          premise: world.premise,
          worldContract: world.worldContract,
          visualContract: world.visualContract,
          sceneText,
          suggestedActions,
          skillIds: activatedSkillIds(activatedSkills),
          ...(seed ? { seedMutation: seed.mutation } : {}),
          ...(graph ? { graph } : {}),
        },
      );
    },
  };
}

const PlayStepParams = Type.Object({
  input: Type.String({
    description: "The player's next free-form action or chosen option.",
  }),
});

type PlayStepParamsType = Static<typeof PlayStepParams>;

export interface PlayStepToolOptions extends SkillAwareProductionOptions {
  readonly language?: "zh" | "en";
  readonly runnerFactory?: (input: {
    readonly projectRoot: string;
    readonly worldId: string;
    readonly runId: string;
    readonly ctx: AgentContext;
  }) => { step(input: string): Promise<PlayStepResult> };
}

const PlayReviseParams = Type.Object({
  action: Type.Union([
    Type.Literal("regenerate_last"),
    Type.Literal("edit_last_input"),
    Type.Literal("restore_variant"),
  ], {
    description: "How to revise the latest play turn: regenerate the same player input, edit the previous player input, or restore a saved variant.",
  }),
  input: Type.Optional(Type.String({
    description: "Replacement player input when action=edit_last_input.",
  })),
  turn: Type.Optional(Type.Number({
    description: "Turn number when restoring a saved variant.",
  })),
  variantId: Type.Optional(Type.String({
    description: "Saved variant id when action=restore_variant.",
  })),
});

type PlayReviseParamsType = Static<typeof PlayReviseParams>;

export interface PlayReviseToolOptions extends SkillAwareProductionOptions {
  readonly language?: "zh" | "en";
  readonly runnerFactory?: (input: {
    readonly projectRoot: string;
    readonly worldId: string;
    readonly runId: string;
    readonly ctx: AgentContext;
  }) => {
    regenerateLastTurn(input?: string): Promise<PlayReplayResult>;
    restoreVariant(input: { readonly turn: number; readonly variantId: string }): Promise<PlayVariantRestoreResult>;
  };
}

const PlayEntityUpdateParam = Type.Object({
  id: Type.Optional(Type.String({
    description: "Existing entity id to update. Use actor_player for the player persona.",
  })),
  label: Type.Optional(Type.String({
    description: "Existing entity label to update when id is unknown.",
  })),
  type: Type.Optional(Type.Union([
    Type.Literal("actor"),
    Type.Literal("location"),
    Type.Literal("item"),
    Type.Literal("evidence"),
    Type.Literal("clue"),
    Type.Literal("claim"),
    Type.Literal("proof_chain"),
    Type.Literal("organization"),
    Type.Literal("rule"),
    Type.Literal("scene"),
    Type.Literal("event"),
  ], { description: "Entity type when creating a missing entity. Usually actor for character/persona edits." })),
  summary: Type.Optional(Type.String({
    description: "Replacement or enriched entity summary, including goals/motives/persona when relevant.",
  })),
  status: Type.Optional(Type.String({
    description: "Natural-language current status. Do not invent numeric meters unless the user asked for them.",
  })),
});

type PlayEntityUpdateParamType = Static<typeof PlayEntityUpdateParam>;

const PlayContractReplacementParam = Type.Object({
  from: Type.String({
    description: "Exact old wording to replace in the existing contract.",
  }),
  to: Type.String({
    description: "New wording that should replace the old wording.",
  }),
});

type PlayContractReplacementParamType = Static<typeof PlayContractReplacementParam>;

const PlayEditParams = Type.Object({
  worldContract: Type.Optional(Type.String({
    description: "Full updated world contract after applying the user's requested rule change. Use when the user edits world rules, time semantics, item semantics, role autonomy, taboos, or costs.",
  })),
  worldContractReplacements: Type.Optional(Type.Array(PlayContractReplacementParam, {
    description: "Exact replacements for existing world-contract wording. Use when the user says to change/replace X into Y; do not append the new rule while leaving the old wording in place.",
  })),
  worldContractAppend: Type.Optional(Type.String({
    description: "A narrow new world-contract addition. Do not use this for replacements such as 'change X to Y'; use worldContractReplacements or full worldContract instead.",
  })),
  visualContract: Type.Optional(Type.String({
    description: "Full updated visual contract after applying the user's requested image/visual-rule change.",
  })),
  visualContractReplacements: Type.Optional(Type.Array(PlayContractReplacementParam, {
    description: "Exact replacements for existing visual-contract wording. Use when the user says to change/replace one visual rule into another.",
  })),
  visualContractAppend: Type.Optional(Type.String({
    description: "A narrow new visual-contract addition. Do not use this for replacements such as 'change X to Y'; use visualContractReplacements or full visualContract instead.",
  })),
  premise: Type.Optional(Type.String({
    description: "Updated world premise only when the user explicitly changes premise/backstory. Do not rewrite premise for ordinary turns.",
  })),
  playerPersona: Type.Optional(Type.String({
    description: "Updated player persona/identity/goals. This updates the reserved actor_player entity.",
  })),
  entityUpdates: Type.Optional(Type.Array(PlayEntityUpdateParam, {
    description: "Character, object, place, or rule-card updates requested by the user. Use for role goals, status, motives, taboos, or known facts.",
  })),
  note: Type.Optional(Type.String({
    description: "Short human-readable note summarizing what changed.",
  })),
});

type PlayEditParamsType = Static<typeof PlayEditParams>;

export function createPlayEditTool(
  projectRoot: string,
  sessionId: string,
  language: "zh" | "en" = "zh",
): AgentTool<typeof PlayEditParams> {
  return {
    name: "play_edit",
    description:
      "Persistently edit the active InkOS Play world card, visual contract, player persona, or entity/role cards without advancing time or narrating a turn. " +
      "Use when the user says to change world rules, visual rules, character goals/persona/status, or long-lived play contracts.",
    label: "Edit Play World",
    parameters: PlayEditParams,
    async execute(
      _toolCallId: string,
      params: PlayEditParamsType,
    ): Promise<AgentToolResult<unknown>> {
      const store = new PlayStore(projectRoot);
      const worldId = safePlayId(sessionId, sessionId);
      const runId = "main";
      const world = await store.loadWorld(worldId);
      if (!world) {
        return textResult(
          language === "en"
            ? "There is no interactive world to edit yet. Start one with play_start first."
            : "还没有可编辑的互动世界。先用 play_start 开一局。",
        );
      }
      const isZh = (world.language ?? "zh") !== "en";

      const patch: Parameters<PlayStore["updateWorld"]>[1] = {};
      const nextWorldContract = mergeContract(
        world.worldContract,
        params.worldContract,
        params.worldContractReplacements,
        params.worldContractAppend,
      );
      const nextVisualContract = mergeContract(
        world.visualContract,
        params.visualContract,
        params.visualContractReplacements,
        params.visualContractAppend,
      );
      if (nextWorldContract !== world.worldContract) patch.worldContract = nextWorldContract;
      if (nextVisualContract !== world.visualContract) patch.visualContract = nextVisualContract;
      const premise = params.premise?.trim();
      if (premise && premise !== world.premise) patch.premise = premise;
      const updatedWorld = Object.keys(patch).length > 0
        ? await store.updateWorld(worldId, patch)
        : world;

      await store.ensureRun(worldId, runId);
      const db = createPlayDB(store.runDir(worldId, runId));
      let updatedEntities = 0;
      try {
        const playerPersona = params.playerPersona?.trim();
        if (playerPersona) {
          const existingPlayer = db.getEntity("actor_player");
          upsertPlayEditEntity(db, {
            id: "actor_player",
            type: "actor",
            label: existingPlayer?.label ?? (isZh ? "玩家" : "Player"),
            summary: playerPersona,
            status: isZh ? "已更新" : "Updated",
          });
          updatedEntities += 1;
        }
        for (const update of params.entityUpdates ?? []) {
          if (upsertPlayEditEntity(db, update)) updatedEntities += 1;
        }
        const graph = db.snapshot();
        const currentState = await store.loadCurrentState(worldId, runId).catch(() => ({}));
        await store.saveCurrentState(worldId, runId, {
          ...(currentState && typeof currentState === "object" ? currentState as Record<string, unknown> : {}),
          worldContract: updatedWorld.worldContract,
          visualContract: updatedWorld.visualContract,
          premise: updatedWorld.premise,
          graphEditedAt: new Date().toISOString(),
        });
        return textResult(
          params.note?.trim() || (isZh ? "互动世界设定已更新。" : "Interactive world settings updated."),
          {
            kind: "play_world_updated",
            worldId,
            runId,
            world: updatedWorld,
            updatedWorldContract: nextWorldContract !== world.worldContract,
            updatedVisualContract: nextVisualContract !== world.visualContract,
            updatedPremise: Boolean(patch.premise),
            updatedEntities,
            graph,
          },
        );
      } finally {
        closePlayDB(db);
      }
    },
  };
}

export function createPlayStepTool(
  pipeline: PipelineRunner,
  projectRoot: string,
  sessionId: string,
  options: PlayStepToolOptions = {},
): AgentTool<typeof PlayStepParams> {
  return {
    name: "play_step",
    description:
      "Advance the current InkOS Play world by one player action. " +
      "Use after play_start when the user keeps acting in the interactive scene.",
    label: "Play Step",
    parameters: PlayStepParams,
    async execute(
      _toolCallId: string,
      params: PlayStepParamsType,
      _signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback,
    ): Promise<AgentToolResult<unknown>> {
      const input = params.input.trim();
      if (!input) return textResult("Play input is empty.");
      const store = new PlayStore(projectRoot);
      // The play world is bound to this chat session (worldId === sessionId).
      const worldId = safePlayId(sessionId, sessionId);
      const runId = "main";
      const world = await store.loadWorld(worldId);
      if (!world) {
        return textResult(
          options.language === "en"
            ? "There is no interactive world to advance yet. Start one with play_start first."
            : "还没有可推进的互动世界。先用 play_start 开一局。",
        );
      }
      const target = { worldId, runId, world };
      const activatedSkills = resolveProductionToolSkills(options);
      onUpdate?.(textResult(`Advancing "${target.worldId}" / "${target.runId}"...`));
      let runner: ({ step(input: string): Promise<PlayStepResult> } & { close?: () => void }) | undefined;
      let step: PlayStepResult;
      try {
        step = await runPipelineWithAgentContext(pipeline, _signal, activatedSkills, () => {
          const ctx = pipeline.createAgentContext("play");
          const activeRunner = options.runnerFactory?.({
            projectRoot,
            worldId: target.worldId,
            runId: target.runId,
            ctx,
          }) ?? new PlayRunner({
            projectRoot,
            worldId: target.worldId,
            runId: target.runId,
            ctx,
          });
          runner = activeRunner;
          return activeRunner.step(input);
        });
      } catch (err) {
        // Never hand a raw tool error to the outer agent — it improvises a fake
        // "service unavailable / reload your save" message. Return a fixed, graceful
        // structured failure so the turn fails honestly and recoverably instead.
        const isZh = (target.world?.language ?? "zh") !== "en";
        return textResult(
          isZh
            ? "（系统刚才卡了一下，这一步没能展开。把你刚才想做的再说一遍，我就接着推进。）"
            : "(The system hiccuped and this step didn't resolve. Say what you just did again and I'll continue.)",
          {
            kind: "play_step_failed",
            worldId: target.worldId,
            runId: target.runId,
            error: err instanceof Error ? err.message : String(err),
            skillIds: activatedSkillIds(activatedSkills),
          },
        );
      } finally {
        closePlayRunner(runner);
      }

      const db = createPlayDB(store.runDir(target.worldId, target.runId));
      let graph;
      try {
        graph = db.snapshot();
      } finally {
        closePlayDB(db);
      }
      const currentState = await store.loadCurrentState(target.worldId, target.runId).catch(() => null);

      return textResult(
        step.sceneText,
        {
          kind: "play_turn_advanced",
          worldId: target.worldId,
          runId: target.runId,
          title: target.world?.title,
          sceneText: step.sceneText,
          suggestedActions: step.suggestedActions,
          action: step.action,
          mutation: step.mutation,
          currentState,
          graph,
          skillIds: activatedSkillIds(activatedSkills),
        },
      );
    },
  };
}

export function createPlayReviseTool(
  pipeline: PipelineRunner,
  projectRoot: string,
  sessionId: string,
  options: PlayReviseToolOptions = {},
): AgentTool<typeof PlayReviseParams> {
  return {
    name: "play_revise",
    description:
      "Regenerate, edit, or restore the latest InkOS Play turn using saved turn checkpoints. " +
      "Use when the user says to redo the previous turn, try another version, swipe, or replace their last player input.",
    label: "Revise Play Turn",
    parameters: PlayReviseParams,
    async execute(
      _toolCallId: string,
      params: PlayReviseParamsType,
      _signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback,
    ): Promise<AgentToolResult<unknown>> {
      const store = new PlayStore(projectRoot);
      const worldId = safePlayId(sessionId, sessionId);
      const runId = "main";
      const world = await store.loadWorld(worldId);
      if (!world) {
        return textResult(
          options.language === "en"
            ? "There is no interactive world to redo yet. Start one with play_start first."
            : "还没有可重做的互动世界。先用 play_start 开一局。",
        );
      }
      const isZh = (world.language ?? "zh") !== "en";
      const activatedSkills = resolveProductionToolSkills(options);
      let runner: ({
        regenerateLastTurn(input?: string): Promise<PlayReplayResult>;
        restoreVariant(input: { readonly turn: number; readonly variantId: string }): Promise<PlayVariantRestoreResult>;
      } & { close?: () => void }) | undefined;
      const runWithPlayRunner = <T>(
        task: (activeRunner: NonNullable<typeof runner>) => Promise<T>,
      ): Promise<T> => runPipelineWithAgentContext(pipeline, _signal, activatedSkills, () => {
        const ctx = pipeline.createAgentContext("play");
        const activeRunner = options.runnerFactory?.({ projectRoot, worldId, runId, ctx }) ?? new PlayRunner({
          projectRoot,
          worldId,
          runId,
          ctx,
        });
        runner = activeRunner;
        return task(activeRunner);
      });

      let replay: PlayReplayResult;
      // finally 关闭 runner 自建的 play.db 连接：句柄不关闭时 Windows 上无法删除数据库文件。
      try {
        if (params.action === "restore_variant") {
          const turn = params.turn;
          const variantId = params.variantId?.trim();
          if (typeof turn !== "number" || !Number.isFinite(turn) || !variantId) {
            return textResult(
              isZh
                ? "恢复版本需要 turn 和 variantId。"
                : "Restoring a variant requires both turn and variantId.",
            );
          }
          onUpdate?.(textResult(`Restoring play variant "${variantId}"...`));
          const restored = await runWithPlayRunner((activeRunner) => activeRunner.restoreVariant({
            turn: Math.trunc(turn),
            variantId,
          }));
          return textResult(
            restored.sceneText || (isZh ? "已切换到指定互动回合版本。" : "Switched to the requested play turn variant."),
            {
              kind: "play_variant_restored",
              worldId,
              runId,
              title: world.title,
              turn: restored.turn,
              variantId: restored.variantId,
              sceneText: restored.sceneText,
              skillIds: activatedSkillIds(activatedSkills),
            },
          );
        }

        const replacement = params.action === "edit_last_input" ? params.input?.trim() : undefined;
        if (params.action === "edit_last_input" && !replacement) {
          return textResult(
            isZh
              ? "编辑上一条玩家动作需要提供新的 input。"
              : "Editing the previous player action requires a new input.",
          );
        }
        onUpdate?.(textResult(params.action === "edit_last_input" ? "Replaying edited play turn..." : "Regenerating last play turn..."));
        try {
          replay = await runWithPlayRunner((activeRunner) => activeRunner.regenerateLastTurn(replacement));
        } catch (err) {
          return textResult(
            isZh
              ? "（上一回合暂时不能安全重做。继续输入新的动作，我会从当前状态推进。）"
              : "(The previous turn cannot be safely regenerated yet. Enter a new action and I will continue from the current state.)",
            {
              kind: "play_revise_failed",
              worldId,
              runId,
              error: err instanceof Error ? err.message : String(err),
              skillIds: activatedSkillIds(activatedSkills),
            },
          );
        }
      } finally {
        closePlayRunner(runner);
      }

      const db = createPlayDB(store.runDir(worldId, runId));
      let graph;
      try {
        graph = db.snapshot();
      } finally {
        closePlayDB(db);
      }
      const currentState = await store.loadCurrentState(worldId, runId).catch(() => null);

      return textResult(
        replay.sceneText,
        {
          kind: "play_turn_revised",
          worldId,
          runId,
          title: world.title,
          sceneText: replay.sceneText,
          suggestedActions: replay.suggestedActions,
          action: replay.action,
          mutation: replay.mutation,
          replayedInput: replay.replayedInput,
          previousVariantId: replay.previousVariantId,
          variantId: replay.variantId,
          currentState,
          graph,
          skillIds: activatedSkillIds(activatedSkills),
        },
      );
    },
  };
}

function mergeContract(
  existing: string,
  replacement: string | undefined,
  replacements: PlayContractReplacementParamType[] | undefined,
  addition: string | undefined,
): string {
  const next = replacement?.trim();
  if (next) return next;
  let current = existing;
  for (const patch of replacements ?? []) {
    const from = patch.from.trim();
    const to = patch.to.trim();
    if (!from || !to || !current.includes(from)) continue;
    current = current.split(from).join(to);
  }
  const add = addition?.trim();
  if (!add) return current;
  if (current.includes(add)) return current;
  return current.trim() ? `${current.trim()}\n- ${add}` : add;
}

function upsertPlayEditEntity(db: PlayGraphDB, update: PlayEntityUpdateParamType): boolean {
  const summary = update.summary?.trim();
  const status = update.status?.trim();
  const label = update.label?.trim();
  const entityId = resolvePlayEditEntityId(db, update);
  if (!entityId && !label) return false;
  const existing = entityId ? db.getEntity(entityId) : null;
  const id = entityId || playEditEntityId(update.type ?? "actor", label!);
  db.upsertEntity({
    id,
    type: update.type ?? existing?.type ?? "actor",
    label: label || existing?.label || id,
    summary: summary ?? existing?.summary ?? "",
    status: status ?? existing?.status ?? "",
    createdEventId: existing?.createdEventId ?? "manual-edit",
    updatedEventId: "manual-edit",
  });
  return true;
}

function resolvePlayEditEntityId(db: PlayGraphDB, update: PlayEntityUpdateParamType): string | undefined {
  const id = update.id?.trim();
  if (id) return id;
  const label = update.label?.trim();
  if (!label) return undefined;
  const snapshot = db.snapshot();
  const match = snapshot.entities.find((entity) => entity.label === label || entity.id === label);
  return match?.id;
}

function playEditEntityId(type: string, label: string): string {
  const ascii = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return `${type}_${ascii || Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// 5. Deterministic writing tools
// ---------------------------------------------------------------------------

const WriteTruthFileParams = Type.Object({
  bookId: Type.Optional(Type.String({ description: "Book ID. Omit to use the active book." })),
  fileName: Type.String({ description: "Truth file path under story/. Prefer outline/story_frame.md, outline/volume_map.md, roles/major/<name>.md, roles/minor/<name>.md; flat files such as current_focus.md and author_intent.md are also supported." }),
  content: Type.String({ description: "Full replacement content for the truth file." }),
});

export function createWriteTruthFileTool(
  pipeline: PipelineRunner,
  projectRoot: string,
  activeBookId: string | null,
): AgentTool<typeof WriteTruthFileParams> {
  const tools = createDeterministicInteractionTools(pipeline, projectRoot);
  return {
    name: "write_truth_file",
    description: "Replace a truth/control file under story/ using deterministic project tools.",
    label: "Write Truth File",
    parameters: WriteTruthFileParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<undefined>> {
      try {
        const bookId = resolveToolBookId("write_truth_file", params.bookId, activeBookId);
        const fileName = assertSafeTruthFileName(params.fileName);
        await tools.writeTruthFile(bookId, fileName, params.content);
        return textResult(`Updated "${fileName}" for "${bookId}".`);
      } catch (err: any) {
        return textResult(`write_truth_file failed: ${err?.message ?? String(err)}`);
      }
    },
  };
}

const RenameEntityParams = Type.Object({
  bookId: Type.Optional(Type.String({ description: "Book ID. Omit to use the active book." })),
  oldValue: Type.String({ description: "Current entity name." }),
  newValue: Type.String({ description: "New entity name." }),
});

export function createRenameEntityTool(
  pipeline: PipelineRunner,
  projectRoot: string,
  activeBookId: string | null,
): AgentTool<typeof RenameEntityParams> {
  const tools = createDeterministicInteractionTools(pipeline, projectRoot);
  return {
    name: "rename_entity",
    description: "Rename an entity across truth files and chapters using deterministic edit control.",
    label: "Rename Entity",
    parameters: RenameEntityParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<undefined>> {
      const bookId = resolveToolBookId("rename_entity", params.bookId, activeBookId);
      const result = await tools.renameEntity(bookId, params.oldValue, params.newValue) as {
        readonly __interaction?: { readonly responseText?: string };
      };
      const summary = result.__interaction?.responseText ?? `Renamed "${params.oldValue}" to "${params.newValue}" in "${bookId}".`;
      return textResult(summary);
    },
  };
}

const PatchChapterTextParams = Type.Object({
  bookId: Type.Optional(Type.String({ description: "Book ID. Omit to use the active book." })),
  chapterNumber: Type.Number({ description: "Chapter number to patch." }),
  targetText: Type.String({ description: "Exact text to replace." }),
  replacementText: Type.String({ description: "Replacement text." }),
});

const DeleteLatestChapterParams = Type.Object({
  bookId: Type.Optional(Type.String({ description: "Book ID. Omit to use the active book." })),
  chapterNumber: Type.Optional(Type.Number({
    description: "Latest chapter number expected by the user. The tool rejects middle-chapter deletion.",
  })),
});

export function createDeleteLatestChapterTool(
  projectRoot: string,
  activeBookId: string | null,
): AgentTool<typeof DeleteLatestChapterParams> {
  return {
    name: "delete_latest_chapter",
    description:
      "Safely delete only the latest chapter, preserve its manuscript under chapters/.trash, " +
      "and roll story state back to the previous chapter snapshot. Never deletes a middle chapter.",
    label: "Delete Latest Chapter",
    parameters: DeleteLatestChapterParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
      const bookId = resolveToolBookId("delete_latest_chapter", params.bookId, activeBookId);
      const state = new StateManager(projectRoot);
      const releaseLock = await state.acquireBookLock(bookId);
      try {
        const result = await deleteLatestChapter(state, bookId, {
          chapterNumber: params.chapterNumber,
        });
        return textResult(
          `Deleted latest chapter ${result.deletedChapter} from "${bookId}", preserved it in trash, and rolled story state back to chapter ${result.rolledBackTo}.`,
          {
            kind: "chapter_deleted",
            ...result,
          },
        );
      } finally {
        await releaseLock();
      }
    },
  };
}

export function createPatchChapterTextTool(
  pipeline: PipelineRunner,
  projectRoot: string,
  activeBookId: string | null,
): AgentTool<typeof PatchChapterTextParams> {
  const tools = createDeterministicInteractionTools(pipeline, projectRoot);
  return {
    name: "patch_chapter_text",
    description: "Apply a deterministic local text patch to a chapter and mark it for review.",
    label: "Patch Chapter",
    parameters: PatchChapterTextParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<undefined>> {
      const bookId = resolveToolBookId("patch_chapter_text", params.bookId, activeBookId);
      const result = await tools.patchChapterText(
        bookId,
        params.chapterNumber,
        params.targetText,
        params.replacementText,
      ) as {
        readonly __interaction?: { readonly responseText?: string };
      };
      const summary = result.__interaction?.responseText ?? `Patched chapter ${params.chapterNumber} for "${bookId}".`;
      return textResult(summary);
    },
  };
}

const ReplaceChapterTextParams = Type.Object({
  bookId: Type.Optional(Type.String({ description: "Book ID. Omit to use the active book." })),
  chapterNumber: Type.Number({ description: "Chapter number to replace." }),
  fullText: Type.String({ description: "The complete replacement chapter markdown/text supplied by the user." }),
});

export function createReplaceChapterTextTool(
  pipeline: PipelineRunner,
  projectRoot: string,
  activeBookId: string | null,
): AgentTool<typeof ReplaceChapterTextParams> {
  const tools = createDeterministicInteractionTools(pipeline, projectRoot);
  return {
    name: "replace_chapter_text",
    description:
      "Replace a whole existing chapter with user-supplied full chapter text and mark it for review. " +
      "Use only when the user provides the complete replacement chapter; for model-generated rewrites use sub_agent reviser.",
    label: "Replace Chapter",
    parameters: ReplaceChapterTextParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<undefined>> {
      const bookId = resolveToolBookId("replace_chapter_text", params.bookId, activeBookId);
      const result = await tools.replaceChapterText(
        bookId,
        params.chapterNumber,
        params.fullText,
      ) as {
        readonly __interaction?: { readonly responseText?: string };
      };
      const summary = result.__interaction?.responseText ?? `Replaced chapter ${params.chapterNumber} for "${bookId}".`;
      return textResult(summary);
    },
  };
}

const ResyncChapterStateParams = Type.Object({
  bookId: Type.Optional(Type.String({ description: "Book ID. Omit to use the active book." })),
  chapterNumber: Type.Optional(Type.Number({ description: "Latest chapter number to rebuild from its persisted body. Omit to use the latest chapter." })),
  allowNewHooks: Type.Optional(Type.Boolean({
    description:
      "Whether settlement may create brand-new hook IDs. Set false when the user asks to preserve stable hook IDs, avoid replacement hooks, or only repair existing truth state.",
  })),
});

export function createResyncChapterStateTool(
  pipeline: PipelineRunner,
  activeBookId: string | null,
  options: SkillAwareProductionOptions & { readonly language?: "zh" | "en" } = {},
): AgentTool<typeof ResyncChapterStateParams> {
  return {
    name: "resync_chapter_state",
    description:
      "Keep the persisted chapter body unchanged, rebuild its derived story state, summaries, and hooks from the previous chapter snapshot, then run a fresh audit. " +
      "Use after an explicit chapter edit or when the user asks to repair/synchronize truth state without rewriting prose. Only the latest chapter is supported.",
    label: "Resync Chapter State",
    parameters: ResyncChapterStateParams,
    async execute(_toolCallId, params, signal): Promise<AgentToolResult<unknown>> {
      const bookId = resolveToolBookId("resync_chapter_state", params.bookId, activeBookId);
      const activatedSkills = resolveProductionToolSkills(options);
      const result = await runPipelineWithAgentContext(
        pipeline,
        signal,
        activatedSkills,
        () => pipeline.resyncChapterStateAndAudit(bookId, params.chapterNumber, {
          allowNewHooks: params.allowNewHooks,
        }),
      );
      const issues = result.audit.issues;
      const zh = options.language !== "en";
      const summary = result.audit.passed
        ? (zh
            ? `第 ${result.chapter.chapterNumber} 章正文未改动；状态、摘要与伏笔已从上一章快照重建，重新审稿通过。`
            : `Chapter ${result.chapter.chapterNumber} prose was unchanged; state, summaries, and hooks were rebuilt from the previous snapshot, and the fresh audit passed.`)
        : [
            zh
              ? `第 ${result.chapter.chapterNumber} 章正文未改动；状态、摘要与伏笔已重建，但重新审稿仍有 ${issues.length} 个问题：`
              : `Chapter ${result.chapter.chapterNumber} prose was unchanged; state, summaries, and hooks were rebuilt, but the fresh audit still found ${issues.length} issue(s):`,
            ...issues.map((issue) => `- [${issue.severity}] ${issue.description}${issue.suggestion ? ` (${issue.suggestion})` : ""}`),
          ].join("\n");
      return textResult(summary, {
        kind: "chapter_state_resynced",
        bookId,
        chapterNumber: result.chapter.chapterNumber,
        status: result.audit.passed ? "ready-for-review" : "audit-failed",
        auditPassed: result.audit.passed,
        auditIssues: issues,
        summary: result.audit.summary,
        skillIds: activatedSkillIds(activatedSkills),
      });
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Read Tool
// ---------------------------------------------------------------------------

const ReadParams = Type.Object({
  path: Type.String({ description: "File path relative to the tool's permitted read root, or an absolute path when system path reading is enabled." }),
});

export interface ReadToolOptions {
  readonly allowSystemPaths?: boolean;
  readonly scope?: "books" | "project";
}

function resolveReadPath(readRoot: string, requestedPath: string, options: ReadToolOptions): string {
  if (options.allowSystemPaths && isAbsolute(requestedPath)) {
    return resolve(requestedPath);
  }
  return safeChildPath(readRoot, requestedPath);
}

export function createReadTool(
  projectRoot: string,
  options: ReadToolOptions = {},
): AgentTool<typeof ReadParams> {
  const readRoot = options.scope === "project" ? projectRoot : join(projectRoot, "books");
  const description = options.allowSystemPaths
    ? "Read a file. Relative paths resolve under books/; absolute paths read from the system filesystem."
    : options.scope === "project"
      ? "Read a UTF-8 file inside the current InkOS project. Path is relative to the project root."
    : "Read a file from the book directory. Path is relative to books/.";

  return {
    name: "read",
    description,
    label: "Read File",
    parameters: ReadParams,
    async execute(
      _toolCallId: string,
      params: Static<typeof ReadParams>,
    ): Promise<AgentToolResult<undefined>> {
      try {
        const filePath = resolveReadPath(readRoot, params.path, options);
        const content = await readFile(filePath, "utf-8");
        return textResult(content);
      } catch (err: any) {
        return textResult(`Failed to read "${params.path}": ${err?.message ?? String(err)}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Edit Tool
// ---------------------------------------------------------------------------

const EditParams = Type.Object({
  path: Type.String({ description: "File path relative to books/" }),
  old_string: Type.String({ description: "Exact string to find in the file" }),
  new_string: Type.String({ description: "Replacement string" }),
});

export function createEditTool(projectRoot: string): AgentTool<typeof EditParams> {
  const booksRoot = join(projectRoot, "books");

  return {
    name: "edit",
    description:
      "Edit a file under books/ via exact string replacement. " +
      "old_string must appear exactly once in the file. " +
      "For chapter text use patch_chapter_text; for canonical truth files (outline/story_frame.md, outline/volume_map.md, roles/**/*.md, current_focus.md, author_intent.md) prefer write_truth_file; " +
      "to rewrite or polish a whole chapter call sub_agent with agent=\"reviser\".",
    label: "Edit File",
    parameters: EditParams,
    async execute(
      _toolCallId: string,
      params: Static<typeof EditParams>,
    ): Promise<AgentToolResult<undefined>> {
      try {
        const filePath = safeBooksPath(booksRoot, params.path);
        const content = await readFile(filePath, "utf-8");
        const idx = content.indexOf(params.old_string);
        if (idx === -1) {
          return textResult(`old_string not found in "${params.path}".`);
        }
        if (content.indexOf(params.old_string, idx + 1) !== -1) {
          return textResult(`old_string appears more than once in "${params.path}". Provide a more specific match.`);
        }
        const updated = content.slice(0, idx) + params.new_string + content.slice(idx + params.old_string.length);
        await writeFile(filePath, updated, "utf-8");
        return textResult(`File "${params.path}" updated successfully.`);
      } catch (err: any) {
        return textResult(`Failed to edit "${params.path}": ${err?.message ?? String(err)}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Write Tool
// ---------------------------------------------------------------------------

const WriteFileParams = Type.Object({
  path: Type.String({ description: "File path relative to books/" }),
  content: Type.String({ description: "Full file content to write" }),
});

export function createWriteFileTool(projectRoot: string): AgentTool<typeof WriteFileParams> {
  const booksRoot = join(projectRoot, "books");

  return {
    name: "write",
    description:
      "Create a new file, or fully replace an existing file's content under books/. " +
      "Parent directories are created automatically. Existing content is overwritten silently — " +
      "for canonical truth files prefer write_truth_file; " +
      "for whole-chapter rewrites/polishing call sub_agent with agent=\"reviser\".",
    label: "Write File",
    parameters: WriteFileParams,
    async execute(
      _toolCallId: string,
      params: Static<typeof WriteFileParams>,
    ): Promise<AgentToolResult<undefined>> {
      try {
        const filePath = safeBooksPath(booksRoot, params.path);
        const parentDir = resolve(filePath, "..");
        const { mkdir } = await import("node:fs/promises");
        await mkdir(parentDir, { recursive: true });
        await writeFile(filePath, params.content, "utf-8");
        return textResult(`File "${params.path}" written successfully.`);
      } catch (err: any) {
        return textResult(`Failed to write "${params.path}": ${err?.message ?? String(err)}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Grep Tool
// ---------------------------------------------------------------------------

const GrepParams = Type.Object({
  bookId: Type.String({ description: "Book ID to search within" }),
  pattern: Type.String({ description: "Search pattern (plain text or regex)" }),
});

export function createGrepTool(projectRoot: string): AgentTool<typeof GrepParams> {
  const booksRoot = join(projectRoot, "books");

  return {
    name: "grep",
    description:
      "Search for a text pattern across a book's story/ and chapters/ directories. Returns matching lines.",
    label: "Search",
    parameters: GrepParams,
    async execute(
      _toolCallId: string,
      params: Static<typeof GrepParams>,
    ): Promise<AgentToolResult<undefined>> {
      try {
        const bookDir = safeBooksPath(booksRoot, params.bookId);
        const regex = new RegExp(params.pattern, "gi");
        const results: string[] = [];

        async function searchDir(dir: string, prefix: string) {
          let entries: string[];
          try {
            entries = await readdir(dir);
          } catch {
            return; // directory doesn't exist
          }
          for (const entry of entries) {
            const fullPath = join(dir, entry);
            const entryStat = await stat(fullPath);
            if (entryStat.isDirectory()) {
              await searchDir(fullPath, `${prefix}${entry}/`);
            } else if (entry.endsWith(".md") || entry.endsWith(".txt") || entry.endsWith(".json")) {
              const content = await readFile(fullPath, "utf-8");
              const lines = content.split("\n");
              for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                  results.push(`${prefix}${entry}:${i + 1}: ${lines[i]}`);
                  regex.lastIndex = 0; // reset for next test
                }
              }
            }
          }
        }

        await Promise.all([
          searchDir(join(bookDir, "story"), "story/"),
          searchDir(join(bookDir, "chapters"), "chapters/"),
        ]);

        if (results.length === 0) {
          return textResult(`No matches for "${params.pattern}" in book "${params.bookId}".`);
        }

        const truncated = results.length > 100
          ? results.slice(0, 100).join("\n") + `\n\n... [${results.length - 100} more matches]`
          : results.join("\n");

        return textResult(truncated);
      } catch (err: any) {
        return textResult(`Grep failed: ${err?.message ?? String(err)}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Ls Tool
// ---------------------------------------------------------------------------

const LsParams = Type.Object({
  bookId: Type.String({ description: "Book ID" }),
  subdir: Type.Optional(
    Type.String({ description: "Subdirectory within the book, e.g. 'story', 'chapters', 'story/runtime'" }),
  ),
});

export function createLsTool(projectRoot: string): AgentTool<typeof LsParams> {
  const booksRoot = join(projectRoot, "books");

  return {
    name: "ls",
    description: "List files in a book directory. Optionally specify a subdirectory like 'story' or 'chapters'.",
    label: "List Files",
    parameters: LsParams,
    async execute(
      _toolCallId: string,
      params: Static<typeof LsParams>,
    ): Promise<AgentToolResult<undefined>> {
      try {
        const base = safeBooksPath(booksRoot, params.bookId);
        const target = params.subdir ? safeBooksPath(base, params.subdir) : base;

        const entries = await readdir(target);
        const details: string[] = [];

        for (const entry of entries) {
          const fullPath = join(target, entry);
          try {
            const entryStat = await stat(fullPath);
            const suffix = entryStat.isDirectory() ? "/" : ` (${entryStat.size} bytes)`;
            details.push(`${entry}${suffix}`);
          } catch {
            details.push(entry);
          }
        }

        if (details.length === 0) {
          return textResult(`Directory is empty: ${params.bookId}/${params.subdir ?? ""}`);
        }

        return textResult(details.join("\n"));
      } catch (err: any) {
        return textResult(`Failed to list "${params.bookId}/${params.subdir ?? ""}": ${err?.message ?? String(err)}`);
      }
    },
  };
}
