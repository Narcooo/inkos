import { loadWorkManifest } from "../work-store.js";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { PipelineRunner } from "../../pipeline/runner.js";
import { runShortFictionStage, type ShortProductionStage } from "../../pipeline/short-fiction-runner.js";
import { readShortProductionState } from "../../pipeline/short-production-state.js";
import { loadAvailableAgentSkills } from "../../skills/builtin-loader.js";
import { resolveProfileSkillActivations } from "../../skills/activations.js";
import { createBuiltInWorkProfileRegistry } from "../builtin-profiles.js";

const Parameters = Type.Object({
  workId: Type.String({ minLength: 1 }),
  coverRequired: Type.Union([Type.Boolean(),Type.Null()],{description:"Whether the author's final delivery requires a generated cover image. Use true for a requested cover image, false for an explicitly text-only delivery, or null to inherit the saved requirement. A cover prompt alone is not a cover image. This records the requirement; image generation uses the visual action."}),
  direction: Type.Optional(Type.String({description:"Creative direction for outline generation, or additional instructions for the requested packaging stage. Existing story intent remains unchanged."})),
  chapters: Type.Optional(Type.Integer({ minimum: 1 })),
  charsPerChapter: Type.Optional(Type.Integer({ minimum: 1 })),
  minChapterLength: Type.Union([Type.Integer({minimum:1}),Type.Null()],{description:"Lower end of the author's requested per-chapter range, including approximate ranges. Use null only when no lower bound was given, or to inherit the saved Work contract in a later stage."}),
  openingHookChars: Type.Union([Type.Integer({minimum:1}),Type.Null()],{description:"Requested independent opening scene length. Use 200 for an approximately 200-character opening. Use null only when none was requested, or to inherit the saved Work contract in a later stage."}),
  maxChaptersPerCall: Type.Optional(Type.Integer({ minimum: 1 })),
  maxChapterLength: Type.Union([Type.Integer({minimum:1}),Type.Null()],{description:"Upper end of the author's requested per-chapter range, including approximate ranges, in native length units. Use null only when no upper bound was given, or to inherit the saved Work contract in a later stage."}),
  reviewScope: Type.Optional(Type.String()),
});

export function createShortProductionStageTools(pipeline: PipelineRunner, root: string, activeWorkId?: string): Array<AgentTool<typeof Parameters> & { readonly artifactsCommitted: true }> {
  const stages: Array<[ShortProductionStage, string]> = [["outline", "plan_short_fiction"], ["draft", "draft_short_fiction"], ["review", "review_short_fiction"], ["package", "package_short_fiction"]];
  return stages.map(([stage, name]) => ({
    artifactsCommitted: true,
    name, label: `Short fiction: ${stage}`, parameters: Parameters,
    description: `Execute only the ${stage} stage of a short-fiction Work. Earlier artifacts must exist. Return persisted results and execution observations.`,
    async execute(_id, params, signal, onUpdate) {
      if (activeWorkId && activeWorkId !== params.workId) throw new Error("Action must target the active Work");
      const work = await loadWorkManifest(root, params.workId).catch(error=>{
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        throw Object.assign(new Error('Create the Work and bind its selected source revisions before short-fiction production.'),{
          code:'WORK_TARGET_REQUIRED',recovery:{action:'workspace__create_work',reason:'Create the requested Work with its Profile, title, brief and any selected source revisions, then run the requested production stage.'},
        });
      });
      const title=work.title, language=work.language==='en'?'en':'zh';
      const profile = createBuiltInWorkProfileRegistry(root).require(work.profileId);
      if (!profile.capabilityIds.includes("short-fiction")) throw new Error("This Work does not declare short-fiction capability");
      const skills = resolveProfileSkillActivations((await loadAvailableAgentSkills({ projectRoot: root })).skills, profile);
      const existing = await readShortProductionState(root, `works/${params.workId}/source`);
      const direction = params.direction ?? existing?.intent ?? (typeof work.metadata.intent==='string'?work.metadata.intent:"");
      if (stage === "outline" && !direction.trim()) throw new Error("An outline needs a creative direction");
      const result = await pipeline.runWithAgentContext({ signal, activatedSkills: skills }, () => runShortFictionStage({
        projectRoot: root, storyId: params.workId, title, direction, stage, language, chapterCount: params.chapters,
        coverRequired:params.coverRequired??undefined,
        minChapterLength:params.minChapterLength??undefined,openingHookChars:params.openingHookChars??undefined,
        charsPerChapter: params.charsPerChapter, maxChapterLength: params.maxChapterLength??undefined, maxChaptersPerCall: params.maxChaptersPerCall ?? profile.production.maxChaptersPerCall,
        minChapterLengthRatio: profile.production.minChapterLengthRatio, reviewScope: params.reviewScope,
        signal, onProgress: message => onUpdate?.({ content: [{ type: "text", text: message }], details: { stage } }),
        runtimes: { planner: pipeline.createAgentContext("short-outline"), writer: pipeline.createAgentContext("short-writer"),
          draftReview: pipeline.createAgentContext("short-draft-review"), package: pipeline.createAgentContext("short-package") },
      }));
      return { content: [{ type: "text", text: `${stage} ${result.stageStatus}: ${result.artifactPaths.join(", ")}` }], details: { kind: result.stageStatus === "failed" ? "short_stage_failed" : "short_stage_completed", workId: result.storyId, ...result } };
    },
  }));
}
