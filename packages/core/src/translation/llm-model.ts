import type { LLMClient } from "../llm/provider.js";
import { runWorkerAgentTool } from "../agent/worker-agent.js";
import { Type } from "@sinclair/typebox";
import { prepareWorkerMessages } from "../agents/base.js";
import type { ActivatedSkillGuidance } from "../agent/skill-tool.js";
import type { TranslationModelPort, TranslationSegment } from "./types.js";
import { ObservationToolSchema } from "../agents/review-tool.js";

const TranslationResultToolSchema = Type.Object({
  chapterTitle: Type.Optional(Type.String()),
  segments: Type.Array(Type.Object({
    index: Type.Integer({ minimum: 0 }),
    target: Type.String({ minLength: 1 }),
    notes: Type.Optional(Type.String()),
  })),
  glossary: Type.Optional(Type.Array(Type.Object({
    source: Type.String({ minLength: 1 }),
    target: Type.String({ minLength: 1 }),
    note: Type.Optional(Type.String()),
  }))),
});

const TranslationReviewToolSchema = Type.Object({
  summary: Type.String(),
  observations: Type.Array(ObservationToolSchema),
});

export function createLLMTranslationModel(input: {
  readonly client: LLMClient;
  readonly model: string;
  readonly maxTokens?: number;
  readonly activatedSkills?: ReadonlyArray<ActivatedSkillGuidance>;
  readonly signal?: AbortSignal;
}): TranslationModelPort {
  return {
    async reviseSegment(request){
      return runWorkerAgentTool(input.client,input.model,await prepareWorkerMessages(input,[
        {role:"system",content:"Revise only the supplied translated paragraph according to the instruction. Preserve all facts, identities, terminology and point of view in its source. Use neighboring paragraphs only for continuity. Return the complete revised target text, without commentary."},
        {role:"user",content:JSON.stringify(request)},
      ],input.maxTokens??4096,"translation-revision"),{
        name:"submit_translation_revision",label:"Revise one translated paragraph",description:"Submit only the revised target paragraph.",
        parameters:Type.Object({target:Type.String({minLength:1})}),
        validate:result=>{if(!result.target.trim())throw Object.assign(new Error("A translated paragraph cannot be empty"),{code:"TRANSLATION_TARGET_EMPTY"});return{target:result.target.trim()};},
      },{maxTokens:input.maxTokens??4096,signal:input.signal});
    },
    async translateSegments(request) {
      const parsed = await runWorkerAgentTool(input.client, input.model, await prepareWorkerMessages(input, [
        {
          role: "system",
          content: [
            "Translate the chapter title and all segments with the activated translation Skill.",
            "Submit the complete translation through the translation result tool.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            sourceLanguage: request.sourceLanguage,
            targetLanguage: request.targetLanguage,
            chapterTitle: request.chapterTitle,
            glossary: request.glossary,
            segments: request.segments.map((segment) => ({
              index: segment.index,
              source: segment.source,
            })),
          }, null, 2),
        },
      ], input.maxTokens ?? 8192, "translation"), {
        name: "submit_translation",
        label: "Submit translation",
        description: "Submit translated segments and glossary updates.",
        parameters: TranslationResultToolSchema,
        validate:result=>{validateTranslatedSegments(result.segments,request.segments);return result;},
      }, {  maxTokens: input.maxTokens ?? 8192, signal: input.signal });
  return {
        ...(parsed.chapterTitle?.trim()
          ? { chapterTitle: parsed.chapterTitle.trim() }
          : {}),
        segments: validateTranslatedSegments(parsed.segments, request.segments),
        glossary: (parsed.glossary ?? []).map((term) => ({
          source: term.source.trim(),
          target: term.target.trim(),
          ...(term.note?.trim() ? { note: term.note.trim() } : {}),
        })),
      };
    },
    async reviewChapter(request) {
      const parsed = await runWorkerAgentTool(input.client, input.model, await prepareWorkerMessages(input, [
        {
          role: "system",
          content: [
            "Review the translation with the activated translation Skill.",
            "Submit the review summary and evidence-backed observations through the review result tool. An empty observations array is valid.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            sourceLanguage: request.sourceLanguage,
            targetLanguage: request.targetLanguage,
            chapterTitle: request.chapterTitle,
            glossary: request.glossary,
            segments: request.segments.map((segment) => ({
              index: segment.index,
              source: segment.source,
              target: segment.target ?? "",
            })),
          }, null, 2),
        },
      ], 4096, "translation-review"), {
        name: "submit_translation_review",
        label: "Submit translation review",
        description: "Submit the translation review.",
        parameters: TranslationReviewToolSchema,
      }, {  maxTokens: 4096, signal: input.signal });
      return {
        summary: parsed.summary,
        observations: parsed.observations,
      };
    },
  };
}

function validateTranslatedSegments(
  value: ReadonlyArray<{ readonly index: number; readonly target: string; readonly notes?: string }>,
  sourceSegments: ReadonlyArray<TranslationSegment>,
): ReadonlyArray<{
  readonly index: number;
  readonly target: string;
  readonly notes?: string;
}> {
  const sourceIndex = new Set(sourceSegments.map((segment) => segment.index));
  const byIndex = new Map<number, { readonly index: number; readonly target: string; readonly notes?: string }>();
  for (const item of value) {
    if(!item.target.trim())throw Object.assign(new Error(`Translation returned an empty target for segment ${item.index}.`),{code:"TRANSLATION_TARGET_EMPTY",segmentIndex:item.index});
    if (!sourceIndex.has(item.index)) throw new Error(`Translation returned unknown segment index ${item.index}.`);
    if (byIndex.has(item.index)) throw new Error(`Translation returned duplicate segment index ${item.index}.`);
    byIndex.set(item.index, {
      index: item.index,
      target: item.target.trim(),
      ...(item.notes?.trim() ? { notes: item.notes.trim() } : {}),
    });
  }
  const missing = sourceSegments.map((segment) => segment.index).filter((index) => !byIndex.has(index));
  if (missing.length > 0) throw new Error(`Translation omitted segment index(es): ${missing.join(", ")}.`);
  return sourceSegments.map((segment) => byIndex.get(segment.index)!);
}
