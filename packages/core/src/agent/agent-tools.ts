import { Type, type Static } from "@mariozechner/pi-ai";
import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import type { PipelineRunner } from "../pipeline/runner.js";
import { type ReviseMode } from "../agents/reviser.js";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { StateManager } from "../state/manager.js";
import { assertSafeTruthFileName, createInteractionToolsFromDeps } from "../interaction/project-tools.js";
import { executeEditTransaction } from "../interaction/edit-controller.js";
import { writeExportArtifact } from "../interaction/export-artifact.js";
import { assertSafeBookId, deriveBookIdFromTitle } from "../utils/book-id.js";
import { safeChildPath } from "../utils/path-safety.js";
import { normalizePlatformId, normalizePlatformOrOther } from "../models/book.js";
import { generateShortFictionCover, runShortFictionProduction } from "../pipeline/short-fiction-runner.js";

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

function createDeterministicInteractionTools(pipeline: PipelineRunner, projectRoot: string) {
  const state = new StateManager(projectRoot);
  return createInteractionToolsFromDeps(pipeline, state);
}

// ---------------------------------------------------------------------------
// 1. SubAgentTool (sub_agent)
// ---------------------------------------------------------------------------

const SubAgentParams = Type.Object({
  agent: Type.Union([
    Type.Literal("architect"),
    Type.Literal("writer"),
    Type.Literal("auditor"),
    Type.Literal("reviser"),
    Type.Literal("exporter"),
  ]),
  instruction: Type.String({ description: "Natural language instruction for the sub-agent" }),
  bookId: Type.Optional(Type.String({
    description: "Optional book ID. In active-book sessions, omit it to use the current active book; if provided, it must match the current active book. For architect creation, this optionally sets the new book ID.",
  })),
  chapterNumber: Type.Optional(Type.Number({ description: "auditor/reviser: target chapter number. Omit to use the latest chapter." })),
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
  chapterWordCount: Type.Optional(Type.Number({ description: "architect/writer: words per chapter. Default: 3000" })),
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

export function createSubAgentTool(
  pipeline: PipelineRunner,
  activeBookId: string | null,
  projectRoot?: string,
): AgentTool<typeof SubAgentParams> {
  return {
    name: "sub_agent",
    description:
      "Delegate a heavy operation to a specialised sub-agent. " +
      "Use agent='architect' to initialise a new book, 'writer' to write the next chapter, " +
      "'auditor' to audit quality, 'reviser' to revise a chapter, 'exporter' to export.",
    label: "Sub-Agent",
    parameters: SubAgentParams,
    prepareArguments: prepareSubAgentArguments,
    async execute(
      _toolCallId: string,
      params: SubAgentParamsType,
      _signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback,
    ): Promise<AgentToolResult<unknown>> {
      const { agent, instruction, bookId, title, chapterNumber, genre, platform, language, targetChapters, chapterWordCount, revise, feedback, mode, format, approvedOnly } = params;

      const progress = (msg: string) => {
        onUpdate?.(textResult(msg));
      };

      try {
        if (!activeBookId && agent !== "architect") {
          return textResult("No active book. Only the architect agent can create a book from this session.");
        }
        if (activeBookId && agent === "architect" && !revise) {
          return textResult("当前已有书籍，不需要建书。如果你想创建新书，请先回到首页。");
        }

        switch (agent) {
          case "architect": {
            if (revise) {
              if (!activeBookId) {
                return textResult("Open the book first before revising its foundation.");
              }
              const targetBookId = resolveToolBookId("architect", bookId, activeBookId);
              progress(`Revising foundation for "${targetBookId}"...`);
              await pipeline.reviseFoundation(targetBookId, feedback ?? instruction);
              progress(`Foundation revised for "${targetBookId}".`);
              return textResult(
                `Book "${targetBookId}" 架构稿已按要求重写。原书的条目式架构稿已备份到 story/.backup-phase4-<时间戳>/。`,
              );
            }
            const resolvedTitle = title?.trim();
            if (!resolvedTitle) {
              return textResult('Error: title is required for the architect agent.');
            }
            const id = bookId
              ? assertSafeBookId(bookId, "architect.bookId")
              : deriveBookIdFromTitle(resolvedTitle) || `book-${Date.now().toString(36)}`;
            const now = new Date().toISOString();
            progress(`Starting architect for book "${id}"...`);
            await pipeline.initBook(
              {
                id,
                title: resolvedTitle,
                genre: genre ?? "general",
                platform: normalizePlatformOrOther(platform),
                language: (language ?? "zh") as any,
                status: "outlining" as any,
                targetChapters: targetChapters ?? 200,
                chapterWordCount: chapterWordCount ?? 3000,
                createdAt: now,
                updatedAt: now,
              },
              { externalContext: instruction },
            );
            progress(`Architect finished — book "${id}" foundation created.`);
            return textResult(
              `Book "${resolvedTitle}" (${id}) initialised successfully. Foundation files are ready.`,
              { kind: "book_created", bookId: id, title: resolvedTitle },
            );
          }

          case "writer": {
            const targetBookId = resolveToolBookId("writer", bookId, activeBookId);
            progress(`Writing next chapter for "${targetBookId}"...`);
            const result = await pipeline.writeNextChapter(targetBookId, chapterWordCount);
            progress(`Writer finished chapter for "${targetBookId}".`);
            return textResult(
              `Chapter written for "${targetBookId}". ` +
              `Word count: ${(result as any).wordCount ?? "unknown"}.`,
              {
                kind: "chapter_written",
                bookId: targetBookId,
                chapterNumber: (result as any).chapterNumber,
                title: (result as any).title,
                wordCount: (result as any).wordCount,
                status: (result as any).status,
              },
            );
          }

          case "auditor": {
            const targetBookId = resolveToolBookId("auditor", bookId, activeBookId);
            progress(`Auditing chapter ${chapterNumber ?? "latest"} for "${targetBookId}"...`);
            const audit = await pipeline.auditDraft(targetBookId, chapterNumber);
            progress(`Audit complete for "${targetBookId}".`);
            const issueLines = (audit.issues ?? [])
              .map((i: any) => `[${i.severity}] ${i.description}`)
              .join("\n");
            return textResult(
              `Audit chapter ${audit.chapterNumber}: ${audit.passed ? "PASSED" : "FAILED"}, ${(audit.issues ?? []).length} issue(s).` +
              (issueLines ? `\n${issueLines}` : ""),
            );
          }

          case "reviser": {
            const targetBookId = resolveToolBookId("reviser", bookId, activeBookId);
            const resolvedMode: ReviseMode = (mode as ReviseMode) ?? "spot-fix";
            progress(`Revising "${targetBookId}" chapter ${chapterNumber ?? "latest"} in ${resolvedMode} mode...`);
            await pipeline.reviseDraft(targetBookId, chapterNumber, resolvedMode);
            progress(`Revision complete for "${targetBookId}".`);
            return textResult(`Revision (${resolvedMode}) complete for "${targetBookId}" chapter ${chapterNumber ?? "latest"}.`);
          }

          case "exporter": {
            const targetBookId = resolveToolBookId("exporter", bookId, activeBookId);
            if (!projectRoot) return textResult("Error: exporter requires projectRoot.");
            const inferredFormat = format ?? (/epub/i.test(instruction)
              ? "epub"
              : /markdown|\bmd\b/i.test(instruction)
                ? "md"
                : "txt");
            const exportApprovedOnly = approvedOnly ?? /approved|已通过|通过章节/.test(instruction);
            const state = new StateManager(projectRoot);
            const result = await writeExportArtifact(state, targetBookId, {
              format: inferredFormat,
              approvedOnly: exportApprovedOnly,
            });
            return textResult(
              `Exported "${targetBookId}": ${result.chaptersExported} chapters, ${result.totalWords} words → ${result.outputPath}`,
            );
          }

          default:
            return textResult(`Unknown agent: ${agent}`);
        }
      } catch (err: any) {
        console.error(`[sub_agent] "${agent}" failed:`, err);
        throw err;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Standalone Short Fiction Tool
// ---------------------------------------------------------------------------

const ShortFictionRunParams = Type.Object({
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
  chars: Type.Optional(Type.Number({
    description: "Target Chinese characters per chapter, 900-1200. Default 1000.",
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

export function createShortFictionRunTool(
  pipeline: PipelineRunner,
  projectRoot: string,
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
      const result = await runShortFictionProduction({
        projectRoot,
        direction: params.direction,
        runtimes: {
          planner: pipeline.createAgentContext("short-outline"),
          outlineReview: pipeline.createAgentContext("short-outline-review"),
          writer: pipeline.createAgentContext("short-writer"),
          draftReview: pipeline.createAgentContext("short-draft-review"),
          revise: pipeline.createAgentContext("short-revise"),
          package: pipeline.createAgentContext("short-package"),
        },
        ...(params.reference ? { reference: { text: params.reference } } : {}),
        storyId: params.storyId,
        chapterCount: params.chapters,
        charsPerChapter: params.chars,
        cover: params.cover,
        coverBaseUrl: params.coverBaseUrl,
        coverEndpoint: params.coverEndpoint,
        coverModel: params.coverModel,
        coverSize: params.coverSize,
        coverApiKeyEnv: params.coverApiKeyEnv,
        onProgress: progress,
      });

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
        { kind: "short_fiction_created", ...result },
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
// 3. Standalone Cover Tool
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
      const result = await generateShortFictionCover({
        projectRoot,
        title: params.title,
        intro: params.intro,
        sellingPoints: params.sellingPoints,
        coverPrompt: params.coverPrompt,
        outputDir: params.outputDir,
        coverBaseUrl: params.coverBaseUrl,
        coverEndpoint: params.coverEndpoint,
        coverModel: params.coverModel,
        coverSize: params.coverSize,
        coverApiKeyEnv: params.coverApiKeyEnv,
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
// 4. Deterministic writing tools
// ---------------------------------------------------------------------------

const WriteTruthFileParams = Type.Object({
  bookId: Type.Optional(Type.String({ description: "Book ID. Omit to use the active book." })),
  fileName: Type.String({ description: "Truth file name under story/, e.g. story_bible.md or current_focus.md." }),
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
  chapterNumber: Type.Number({ description: "Existing chapter number to replace." }),
  content: Type.String({
    description: "Complete replacement chapter body. Do not include the Markdown chapter heading; the existing heading is preserved.",
  }),
});

export function createReplaceChapterTextTool(
  pipeline: PipelineRunner,
  projectRoot: string,
  activeBookId: string | null,
): AgentTool<typeof ReplaceChapterTextParams> {
  const state = new StateManager(projectRoot);
  return {
    name: "replace_chapter_text",
    description: "Fully replace an existing chapter body, preserve its heading, and mark it for review and state resync.",
    label: "Replace Chapter",
    parameters: ReplaceChapterTextParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<undefined>> {
      const bookId = resolveToolBookId("replace_chapter_text", params.bookId, activeBookId);
      const execution = await executeEditTransaction(
        {
          bookDir: (targetBookId) => state.bookDir(targetBookId),
          loadChapterIndex: (targetBookId) => state.loadChapterIndex(targetBookId),
          saveChapterIndex: (targetBookId, index) => state.saveChapterIndex(targetBookId, index),
        },
        {
          kind: "chapter-replace",
          bookId,
          chapterNumber: params.chapterNumber,
          instruction: params.content,
        },
      );
      return textResult(execution.summary);
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Read Tool
// ---------------------------------------------------------------------------

const ReadParams = Type.Object({
  path: Type.String({ description: "File path relative to books/, or an absolute path when system path reading is enabled." }),
});

export interface ReadToolOptions {
  readonly allowSystemPaths?: boolean;
}

function resolveReadPath(booksRoot: string, requestedPath: string, options: ReadToolOptions): string {
  if (options.allowSystemPaths && isAbsolute(requestedPath)) {
    return resolve(requestedPath);
  }
  return safeBooksPath(booksRoot, requestedPath);
}

export function createReadTool(
  projectRoot: string,
  options: ReadToolOptions = {},
): AgentTool<typeof ReadParams> {
  const booksRoot = join(projectRoot, "books");
  const description = options.allowSystemPaths
    ? "Read a file. Relative paths resolve under books/; absolute paths read from the system filesystem."
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
        const filePath = resolveReadPath(booksRoot, params.path, options);
        let content = await readFile(filePath, "utf-8");
        if (content.length > 10_000) {
          content = content.slice(0, 10_000) + "\n\n... [truncated at 10 000 chars]";
        }
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
      "For chapter text use patch_chapter_text; for canonical truth files (story_bible/volume_outline/book_rules/current_focus) prefer write_truth_file; " +
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
