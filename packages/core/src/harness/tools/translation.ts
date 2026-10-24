import { withWorkMutationScope } from "../../utils/work-mutation-scope.js";
import { StateManager } from "../../state/manager.js";
import { Type, type Static } from "@mariozechner/pi-ai";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { PipelineRunner } from "../../pipeline/runner.js";
import {
  createLLMTranslationModel,
  createTranslationProjectFromFile,
  runTranslationProject,
  reviseTranslationSegment,
  writeTranslationExport,
} from "../../translation/index.js";
import type { ActivatedSkillGuidance } from "../../agent/skill-tool.js";
import type { TranslationModelPort } from "../../translation/types.js";
import { mergeActivatedSkillGuidance } from "../../skills/activations.js";
import { activatedSkillIds } from "../../skills/activations.js";
import type { ActionPayload } from "../../interaction/action-envelope.js";
import { safeChildPath } from "../../utils/path-safety.js";
import { CreationSourceReferences } from "../../agent/creation-source.js";

function textResult<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details };
}

const TranslationCreateParams = Type.Object({
  sources: Type.Optional(CreationSourceReferences),
  filePath: Type.Optional(Type.String({ description: "Project-relative EPUB/PDF/TXT/Markdown source file path. Omit when sourceText is supplied." })),
  sourceText: Type.Optional(Type.String({ minLength: 1, description: "Complete source text supplied in chat; the host persists it as a source artifact." })),
  glossary: Type.Optional(Type.Array(Type.Object({ source: Type.String(), target: Type.String(), note: Type.Optional(Type.String()) }))),
  sourceLanguage: Type.String({ description: "Human-readable source language or Auto detect." }),
  targetLanguage: Type.String({ description: "Human-readable target language." }),
  title: Type.Optional(Type.String()),
  segmentMaxChars: Type.Optional(Type.Number()),
});

export function createTranslationCreateTool(
  projectRoot: string,
  options: { readonly actionPayload?: ActionPayload } = {},
): AgentTool<typeof TranslationCreateParams> {
  return {
    name: "translation_create",
    label: "Create Translation Work",
    description: "Create a translation Work from ordered registered source artifacts, author-pasted sourceText, or a project-relative EPUB/PDF/TXT/Markdown file. For existing Works pass sources, never retype their prose. Persist exact source versions and the supplied glossary.",
    parameters: TranslationCreateParams,
    async execute(_toolCallId, params: Static<typeof TranslationCreateParams>) {
      const payload = options.actionPayload?.translationCreate;
      const result = await createTranslationProjectFromFile(projectRoot, {
        sources: payload?.sources ?? params.sources,
        filePath: payload?.filePath ?? params.filePath,
        sourceText: payload?.sourceText ?? params.sourceText,
        glossary: payload?.glossary ?? params.glossary,
        sourceLanguage: payload?.sourceLanguage ?? params.sourceLanguage,
        targetLanguage: payload?.targetLanguage ?? params.targetLanguage,
        title: payload?.title ?? params.title,
        segmentMaxChars: payload?.segmentMaxChars ?? params.segmentMaxChars,
      });
      return textResult(
        `Translation Work "${result.manifest.title}" created with ${result.manifest.chapters.length} chapter(s).`,
        { kind: "translation_project_created", workId: result.manifest.id, ...result },
      );
    },
  };
}

const TranslationRunParams = Type.Object({
  workId: Type.Optional(Type.String({ description: "Translation Work ID returned by translation_create. Required when no Work is active." })),
  batchSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 32 })),
  maxTokens: Type.Optional(Type.Integer({ minimum: 256 })),
});

export function createTranslationRunTool(
  pipeline: PipelineRunner,
  projectRoot: string,
  activeWorkId?: string,
  options: {
    readonly defaultSkills?: ReadonlyArray<ActivatedSkillGuidance>;
    readonly activeSkills?: () => ReadonlyArray<ActivatedSkillGuidance>;
    readonly createModel?: (input: {
      readonly client: ReturnType<PipelineRunner["createAgentContext"]>["client"];
      readonly model: string;
      readonly maxTokens?: number;
      readonly activatedSkills: ReadonlyArray<ActivatedSkillGuidance>;
      readonly signal?: AbortSignal;
    }) => TranslationModelPort;
  } = {},
): AgentTool<typeof TranslationRunParams> {
  return {
    name: "translation_run",
    label: "Run Translation",
    description: "Translate all pending segments in the current translation Work and persist review results.",
    parameters: TranslationRunParams,
    async execute(_toolCallId, params: Static<typeof TranslationRunParams>, signal) {
      const workId = resolveTranslationWorkId(activeWorkId, params.workId);
      const skills = mergeActivatedSkillGuidance(options.defaultSkills ?? [], options.activeSkills?.() ?? []);
      const result = await withWorkMutationScope(projectRoot, workId, () => new StateManager(projectRoot).acquireBookLock(workId), () => pipeline.runWithAgentContext({ signal, activatedSkills: skills }, async () => {
        const context = pipeline.createAgentContext("translation", workId);
        const reviewContext = pipeline.createAgentContext("auditor", workId);
        const createModel = options.createModel ?? createLLMTranslationModel;
        const translator = createModel({client: context.client, model: context.model, maxTokens: params.maxTokens, activatedSkills: skills, signal});
        const reviewer = createModel({client: reviewContext.client, model: reviewContext.model, activatedSkills: skills, signal});
        return runTranslationProject(projectRoot, workId, {
          model: { ...translator, reviewChapter: reviewer.reviewChapter },
          batchSize: params.batchSize,
        });
      }));
      return textResult(
        `Translated ${result.translatedSegments} segment(s) this run. Complete: ${result.completedSegments}/${result.totalSegments}; pending: ${result.pendingSegments}. Reviewed ${result.reviewedChapters} chapter(s); ${result.observations.filter(observation => observation.assessment === "issue").length} review issue(s).`,
        { kind: result.pendingSegments?"translation_pending":"translation_completed", workId, ...result, skillIds: activatedSkillIds(skills) },
      );
    },
  };
}

const TranslationRevisionParams=Type.Object({
  workId:Type.Optional(Type.String({description:"Translation Work ID; omit only when this Work is active."})),
  chapterNumber:Type.Integer({minimum:1}),
  paragraph:Type.Union([Type.Literal("last"),Type.Integer({minimum:1})],{description:"Use last for the final paragraph. Otherwise supply a human paragraph number starting at 1. This is not a zero-based array index or a stored segment ID."}),
  instruction:Type.String({minLength:1,description:"The requested change to this translated paragraph, preserving source facts."}),
},{additionalProperties:false});

export function createTranslationRevisionTool(pipeline:PipelineRunner,projectRoot:string,activeWorkId?:string,options:NonNullable<Parameters<typeof createTranslationRunTool>[3]>={}):AgentTool<typeof TranslationRevisionParams>{
  return {
    name:"revise_paragraph",label:"Revise translated paragraph",
    description:"Revise one translated paragraph while preserving every other paragraph and all source text. To revise the final paragraph, set paragraph to last. The host selects it from the complete chapter. Review and export after revision.",
    parameters:TranslationRevisionParams,
    async execute(_id,params,signal){
      const workId=resolveTranslationWorkId(activeWorkId,params.workId);
      const skills=mergeActivatedSkillGuidance(options.defaultSkills??[],options.activeSkills?.()??[]);
      const result=await withWorkMutationScope(projectRoot,workId,()=>new StateManager(projectRoot).acquireBookLock(workId),()=>pipeline.runWithAgentContext({signal,activatedSkills:skills},async()=>{
        const context=pipeline.createAgentContext("translation",workId);
        return reviseTranslationSegment(projectRoot,workId,{chapterNumber:params.chapterNumber,paragraph:params.paragraph,instruction:params.instruction,model:(options.createModel??createLLMTranslationModel)({client:context.client,model:context.model,activatedSkills:skills,signal})});
      }));
      return textResult(`${result.changed?"Revised":"Kept"} chapter ${result.chapterNumber}, paragraph ${result.paragraphNumber} of ${result.paragraphCount}${result.isLastParagraph?" (last paragraph)":" (not the last paragraph)"}. Selected source: ${result.sourceExcerpt}`,{kind:"translation_segment_revised",workId,...result});
    },
  };
}

const TranslationExportParams = Type.Object({
  workId: Type.Optional(Type.String({ description: "Translation Work ID. Required when no Work is active." })),
  format: Type.Optional(Type.Union([Type.Literal("md"), Type.Literal("txt"), Type.Literal("epub")])),
  outputPath: Type.Optional(Type.String()),
});

export function createTranslationExportTool(
  projectRoot: string,
  activeWorkId?: string,
): AgentTool<typeof TranslationExportParams> {
  return {
    name: "translation_export",
    label: "Export Translation",
    description: "Export the current translated Work as Markdown, text, or EPUB. Markdown is the default when no format is specified; an export request does not require another format confirmation.",
    parameters: TranslationExportParams,
    async execute(_toolCallId, params: Static<typeof TranslationExportParams>) {
      const workId = resolveTranslationWorkId(activeWorkId, params.workId);
      const result = await withWorkMutationScope(projectRoot, workId, () => new StateManager(projectRoot).acquireBookLock(workId), () => writeTranslationExport(projectRoot, workId, {
        format: params.format,
        ...(params.outputPath ? { outputPath: safeChildPath(projectRoot, params.outputPath) } : {}),
      }));
      return textResult(
        `Exported ${result.chaptersExported} translated chapter(s) to ${result.outputPath}.`,
        { kind: "translation_exported", workId, ...result },
      );
    },
  };
}

function resolveTranslationWorkId(active: string | undefined, requested: string | undefined): string {
  if (active && requested && active !== requested) throw new Error("Action must target the active Translation Work");
  const id = active ?? requested;
  if (!id) throw new Error("Translation Work ID is required");
  return id;
}
