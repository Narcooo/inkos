import { Type, type Static } from "@mariozechner/pi-ai";
import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import type { PipelineRunner } from "../../pipeline/runner.js";
import type { ActionPayload } from "../../interaction/action-envelope.js";
import type { ReviseMode } from "../../agents/reviser.js";
import type { ActivatedSkillGuidance } from "../../agent/skill-tool.js";
import { defaultChapterLength } from "../../utils/length-metrics.js";
import { assertSafeBookId, deriveBookIdFromTitle } from "../../utils/book-id.js";
import { mergeActivatedSkillGuidance } from "../../skills/activations.js";
import { runAsWorkflowTrajectory } from "../../llm/agent-trajectory.js";
import {StateManager} from "../../state/manager.js";
import type {WorkManifest} from "../contracts.js";
import type {BookConfig} from "../../models/book.js";

interface LongformToolOptions {
  readonly activeWork?: {readonly work:WorkManifest;readonly projectRoot:string};
  readonly actionPayload?: ActionPayload;
  readonly language?: "zh" | "en";
  readonly activeSkills?: () => ReadonlyArray<ActivatedSkillGuidance>;
  readonly workerSkills?: (worker: string) => ReadonlyArray<ActivatedSkillGuidance>;
}

const BookCreateParams = Type.Object({
  instruction: Type.String(),
  title: Type.Optional(Type.String()),
  bookId: Type.Optional(Type.String()),
  genre: Type.Optional(Type.String()),
  platform: Type.Optional(Type.String({ minLength: 1 })),
  language: Type.Optional(Type.Union([Type.Literal("zh"), Type.Literal("en")])),
  targetChapters: Type.Optional(Type.Integer({ minimum: 1 })),
  chapterWordCount: Type.Optional(Type.Integer({ minimum: 1 })),
  minChapterLength: Type.Optional(Type.Integer({minimum:1,description:"Lower end of an explicitly requested per-chapter range. Preserve it as a Work constraint."})),
  maxChapterLength: Type.Optional(Type.Integer({minimum:1,description:"Upper end of an explicitly requested per-chapter range. Preserve it as a Work constraint."})),
});

const FoundationRevisionParams = Type.Object({
  instruction: Type.String(),
  bookId: Type.Optional(Type.String()),
});

const WriteChaptersParams = Type.Object({
  instruction: Type.String(),
  bookId: Type.Optional(Type.String()),
  startChapterNumber: Type.Integer({ minimum: 1, description: "First chapter in the requested writing range. Use the author's target, or inspect current progress for a request to continue. Existing chapters require revision, not another append." }),
  chapterCount: Type.Optional(Type.Integer({ minimum: 1 })),
  chapterWordCount: Type.Optional(Type.Integer({ minimum: 1 })),
});

const ReviewChapterParams = Type.Object({
  bookId: Type.Optional(Type.String()),
  chapterNumber: Type.Optional(Type.Integer({ minimum: 1 })),
});

const ReviseChapterParams = Type.Object({
  targetText:Type.Optional(Type.String({minLength:1,description:'For a localized paragraph or scene edit, first read the chapter and supply its exact unique source excerpt here, without display line-number prefixes. The host preserves all surrounding prose; the writer only replaces this selection.'})),
  instruction: Type.String(),
  bookId: Type.Optional(Type.String()),
  chapterNumber: Type.Optional(Type.Integer({ minimum: 1 })),
  mode: Type.Optional(Type.Union([
    Type.Literal("spot-fix"), Type.Literal("polish"), Type.Literal("rewrite"),
    Type.Literal("rework"), Type.Literal("anti-detect"),
  ])),
});

const StyleGuideParams = Type.Object({
  referenceText: Type.String({ minLength: 1, description: "User-provided reference prose used only to derive an operational style guide." }),
  sourceName: Type.Optional(Type.String({ description: "Human-readable reference source name." })),
});

function textResult<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details };
}

function resolveBookId(tool: string, requested: string | undefined, activeBookId: string | null): string {
  const id = assertSafeBookId(requested ?? activeBookId ?? "", `${tool}.bookId`);
  if (!id) throw new Error(`${tool} requires an active Work or bookId.`);
  if (requested && activeBookId && id !== activeBookId) {
    throw new Error(`${tool}.bookId must match the active Work.`);
  }
  return id;
}

function activatedSkills(options: LongformToolOptions, worker: string): ActivatedSkillGuidance[] {
  return mergeActivatedSkillGuidance(
    options.workerSkills?.(worker) ?? [],
    options.activeSkills?.() ?? [],
  );
}

function runPipeline<T>(
  pipeline: PipelineRunner,
  signal: AbortSignal | undefined,
  options: LongformToolOptions,
  task: () => Promise<T>,
): Promise<T> {
  return runAsWorkflowTrajectory(() => pipeline.runWithAgentContext({
    signal,
    workerSkills: (agent) => activatedSkills(options, agent),
  }, task));
}

function progress(onUpdate: AgentToolUpdateCallback | undefined, message: string): void {
  onUpdate?.(textResult(message, undefined));
}

export function createBookFoundationTool(
  pipeline: PipelineRunner,
  options: LongformToolOptions = {},
): AgentTool<typeof BookCreateParams> {
  return {
    name: "create_book",
    label: "Create long-form Work",
    description: options.activeWork
      ? "Initialize the current long-form Work's native book configuration and foundation. Preserve its Work ID; provide targetChapters and chapterWordCount from the user's request. An initialized book cannot be overwritten."
      : "Create one long-form Work foundation from the confirmed instruction.",
    parameters: BookCreateParams,
    async execute(_toolCallId, params: Static<typeof BookCreateParams>, signal, onUpdate) {
        const payload = options.actionPayload?.createBook;
        const title = options.activeWork?.work.title || payload?.title?.trim() || params.title?.trim();
        if (!title) throw new Error("create_book requires title.");
        const id = options.activeWork ? resolveBookId("create_book",params.bookId,options.activeWork.work.id) : payload?.title
          ? deriveBookIdFromTitle(payload.title) || `book-${Date.now().toString(36)}`
          : params.bookId
            ? assertSafeBookId(params.bookId, "create_book.bookId")
            : deriveBookIdFromTitle(title) || `book-${Date.now().toString(36)}`;
        let existing:BookConfig|undefined;
        if(options.activeWork){
          const state=new StateManager(options.activeWork.projectRoot);
          if(await state.isCompleteBookDirectory(state.bookDir(id)))throw Object.assign(new Error("The current book is already initialized; use its foundation or chapter revision action."),{code:"BOOK_ALREADY_INITIALIZED"});
          try{existing=await state.loadBookConfig(id);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
        }
        const language = existing?.language ?? (options.activeWork ? options.activeWork.work.language==="en"?"en":"zh" : payload?.language ?? params.language ?? options.language ?? "zh");
        const skills = activatedSkills(options, "architect");
        const now = new Date().toISOString();
        progress(onUpdate, `Creating foundation for "${id}"...`);
        const book = {
          ...existing,
          id,
          title,
          genre: payload?.genre ?? params.genre ?? existing?.genre ?? "other",
          platform: payload?.platform ?? params.platform ?? existing?.platform ?? "other",
          language,
          status: "outlining",
          targetChapters: payload?.targetChapters ?? params.targetChapters ?? existing?.targetChapters ?? 200,
          chapterWordCount: payload?.chapterWordCount ?? params.chapterWordCount ?? existing?.chapterWordCount ?? defaultChapterLength(language),
          minChapterLength:payload?.minChapterLength??params.minChapterLength??existing?.minChapterLength,
          maxChapterLength:payload?.maxChapterLength??params.maxChapterLength??existing?.maxChapterLength,
          createdAt: existing?.createdAt ?? options.activeWork?.work.createdAt ?? now,
          updatedAt: now,
        } as const;
        await runPipeline(pipeline, signal, options, () => (
          pipeline.initBook(book, { externalContext: params.instruction })
        ));
        return textResult(`Created long-form Work "${title}" (${id}).`, {
          kind: "book_created",
          workId: id,
          bookId: id,
          title,
          skillIds: skills.map((skill) => skill.skill.id),
        });
    },
  };
}

export function createFoundationRevisionTool(
  pipeline: PipelineRunner,
  activeBookId: string,
  options: LongformToolOptions = {},
): AgentTool<typeof FoundationRevisionParams> {
  return {
    name: "revise_foundation",
    label: "Revise foundation",
    description: "Rebuild the active Work foundation from an explicit revision instruction.",
    parameters: FoundationRevisionParams,
    async execute(_toolCallId, params: Static<typeof FoundationRevisionParams>, signal, onUpdate) {
        const bookId = resolveBookId("revise_foundation", params.bookId, activeBookId);
        const skills = activatedSkills(options, "architect");
        progress(onUpdate, `Revising foundation for "${bookId}"...`);
        await runPipeline(pipeline, signal, options, () => pipeline.reviseFoundation(bookId, params.instruction));
        return textResult(`Revised foundation for "${bookId}".`, {
          kind: "foundation_revised",
          bookId,
          skillIds: skills.map((skill) => skill.skill.id),
        });
    },
  };
}

export function createWriteChaptersTool(
  pipeline: PipelineRunner,
  activeBookId: string | null,
  options: LongformToolOptions = {},
): AgentTool<typeof WriteChaptersParams> {
  return {
    name: "write_chapters",
    label: "Write chapters",
    description: "Write a specific consecutive range of new chapters. startChapterNumber must match the next unwritten chapter; an existing or skipped range is rejected before generation. Inspect existing chapters for review, revision or export instead of resending an already completed writing range. This persists chapter artifacts and story state.",
    parameters: WriteChaptersParams,
    async execute(_toolCallId, params: Static<typeof WriteChaptersParams>, signal, onUpdate) {
        const bookId = resolveBookId("write_chapters", params.bookId, activeBookId);
        const count = params.chapterCount ?? 1;
        const skills = activatedSkills(options, "writer");
        const results = await runPipeline(pipeline, signal, options, () => pipeline.writeChapters(bookId, count, {
          startChapterNumber: params.startChapterNumber,
          wordCount: params.chapterWordCount,
          externalContext: params.instruction,
          onChapterComplete(result, completed, total) {
            progress(onUpdate, `Completed chapter ${result.chapterNumber} (${completed}/${total}).`);
          },
        }));
        const first = results[0];
        const observations = results.flatMap((result) => result.review.observations);
        const checked=results.filter(result=>result.delivery);
        const delivery=checked.length?{
          status:checked.some(result=>result.delivery!.status==="needs_revision")?"needs_revision":"checks_passed",
          chapters:checked.map(result=>({chapterNumber:result.chapterNumber,...result.delivery})),
        }:undefined;
        return textResult(`Completed ${results.length} chapter(s) for "${bookId}".`, {
          kind: results.length === 1 ? "chapter_written" : "chapters_written",
          workId: bookId,
          bookId,
          requestedCount: count,
          startChapterNumber: params.startChapterNumber,
          endChapterNumber: params.startChapterNumber + count - 1,
          completedCount: results.length,
          ...(delivery?{delivery}:{}),
          observations,
          skillIds: skills.map((skill) => skill.skill.id),
          ...(results.length === 1 && first
            ? {
                chapterNumber: first.chapterNumber,
                title: first.title,
                wordCount: first.wordCount,
                ...(first.contextTrace ? { contextTrace: first.contextTrace } : {}),
              }
            : {}),
          chapters: results.map((result) => ({
            chapterNumber: result.chapterNumber,
            title: result.title,
            wordCount: result.wordCount,
            observations: result.review.observations,
            ...(result.contextTrace ? { contextTrace: result.contextTrace } : {}),
          })),
        });
    },
  };
}

export function createReviewChapterTool(
  pipeline: PipelineRunner,
  activeBookId: string,
  options: LongformToolOptions = {},
): AgentTool<typeof ReviewChapterParams> {
  return {
    name: "review_chapter",
    label: "Review chapter",
    description: "Review one persisted chapter and record evidence-backed observations.",
    parameters: ReviewChapterParams,
    async execute(_toolCallId, params: Static<typeof ReviewChapterParams>, signal) {
        const bookId = resolveBookId("review_chapter", params.bookId, activeBookId);
        const skills = activatedSkills(options, "auditor");
        const review = await runPipeline(pipeline, signal, options, () => pipeline.reviewChapter(bookId, params.chapterNumber));
        return textResult(`Reviewed chapter ${review.chapterNumber}; ${review.observations.length} observation(s).`, {
          kind: "chapter_review",
          workId: bookId,
          bookId,
          chapterNumber: review.chapterNumber,
          summary: review.summary,
          observations: review.observations,
          ...(review.reviewedArtifact?{reviewedArtifact:review.reviewedArtifact}:{}),
          ...(review.delivery?{delivery:review.delivery}:{}),
          skillIds: skills.map((skill) => skill.skill.id),
        });
    },
  };
}

export function createReviseChapterTool(
  pipeline: PipelineRunner,
  activeBookId: string,
  options: LongformToolOptions = {},
): AgentTool<typeof ReviseChapterParams> {
  return {
    name: "revise_chapter",
    label: "Revise chapter",
    description: "Revise one persisted chapter using source-bound edits by default. For a precise local change, read and bind targetText to keep every surrounding paragraph unchanged. Request rewrite mode only for an author-authorized whole-chapter rewrite. Check the returned changedRegion before claiming the requested change is complete.",
    parameters: ReviseChapterParams,
    async execute(_toolCallId, params: Static<typeof ReviseChapterParams>, signal) {
        const bookId = resolveBookId("revise_chapter", params.bookId, activeBookId);
        const mode = (params.mode ?? "spot-fix") as ReviseMode;
        const skills = activatedSkills(options, "reviser");
        const result = await runPipeline(
          pipeline,
          signal,
          options,
          () => pipeline.reviseDraft(bookId, params.chapterNumber, mode, params.instruction,{targetText:params.targetText}),
        );
        return textResult(
          result.changed ? `Revised chapter ${result.chapterNumber}.` : `Chapter ${result.chapterNumber} was unchanged.`,
          {
            kind: "chapter_revision",
            workId: bookId,
            bookId,
            chapterNumber: result.chapterNumber,
            mode,
            wordCount: result.wordCount,
            changed: result.changed,
            changedRegion:result.changedRegion,
            observations: result.observations,
            ...(result.delivery?{delivery:result.delivery}:{}),
            skillIds: skills.map((skill) => skill.skill.id),
          },
        );
    },
  };
}

export function createGenerateStyleGuideTool(
  pipeline: PipelineRunner,
  activeBookId: string,
  options: LongformToolOptions = {},
): AgentTool<typeof StyleGuideParams> {
  return {
    name: "generate_style_guide",
    label: "Generate style guide",
    description: "Compile user-provided reference prose into an operational style guide for the active Work and persist it as a revisioned artifact.",
    parameters: StyleGuideParams,
    async execute(_toolCallId, params, signal) {
      const bookId = resolveBookId("generate_style_guide", undefined, activeBookId);
      const skills = activatedSkills(options, "style-guide");
      const guide = await runPipeline(
        pipeline,
        signal,
        options,
        () => pipeline.generateStyleGuide(bookId, params.referenceText, params.sourceName),
      );
      return textResult(`Generated style guide for "${bookId}".`, {
        kind: "style_guide_generated",
        workId: bookId,
        bookId,
        sourceName: params.sourceName,
        guideLength: guide.length,
        skillIds: skills.map((skill) => skill.skill.id),
      });
    },
  };
}
