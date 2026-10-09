import {authorTextScopeRequest,authorTextScopeContract} from '../../agents/author-edit-scope.js';
import { numberReviewSource } from "../../models/observation.js";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { PipelineRunner } from "../../pipeline/runner.js";
import { BaseAgent } from "../../agents/base.js";
import { loadWorkManifest } from "../work-store.js";
import { createBuiltInWorkProfileRegistry } from "../builtin-profiles.js";
import { loadAvailableAgentSkills } from "../../skills/builtin-loader.js";
import { resolveProfileSkillActivations } from "../../skills/activations.js";
import { syncWorkSourceArtifacts } from "../source-sync.js";
import { createReplaceWorkArtifactTool, createExportWorkTool } from "./work-artifacts.js";
import { validatedArtifactWrites } from "../artifact-validation.js";
import { changedSourceRegion, measureSourceText, splitSourceLines } from "../../utils/source-text.js";
import {textRangeEditContract,textScopedSelectionEditContract,TextEditRangeSchema,type TextEditRange} from '../../utils/text-range-edits.js';
import { readArtifactRevision } from "../artifact-reader.js";
import { currentExecutionBaselineWork, currentExecutionAuthorRequest, updateExecutionWork, recordExecutionEvidence } from "../execution-evidence.js";
import {inspectFilmGraph} from './film-delivery.js';
import {StoryGraphSchema} from '../../interactive-film/graph-schema.js';
import {FilmRequirementsSchema,type FilmRequirements} from '../../interactive-film/delivery-requirements.js';
import {Value} from '@sinclair/typebox/value';

interface ReviewComparison {
  scope: 'episode_start' | 'parent_revision';
  sourceId: string;
  before: {revisionId: string; checksum: string};
  after: {revisionId: string; checksum: string};
  changedRegion: ReturnType<typeof changedSourceRegion>;
}

const LineRange = TextEditRangeSchema;
const Parameters = Type.Object({ artifactId: Type.String(), revisionId: Type.Optional(Type.String({description:"For review, an exact candidate or historical revision from inspect_work. Omit to review the current revision."})), referenceArtifactIds: Type.Optional(Type.Array(Type.String(), {description:"Current artifacts in this Work to supply for comparison, such as a separate image-prompt document. IDs mentioned only in instruction are not loaded; list every comparison source here."})), instruction: Type.String({ minLength: 1 }), editRanges:Type.Optional(Type.Array(LineRange,{minItems:1,description:"For localized Markdown revision, specify exact inclusive 1-based source line ranges. The host preserves every byte outside these ranges. Read the current artifact first; include associated prompt lines only when authorized."})) });
const Replacement = Type.Object({ content: Type.String({ minLength: 1 }) });
const DeliveryParameters = Type.Object({
  ...Type.Omit(Parameters, ['editRanges']).properties,
}, {additionalProperties: false});

/** A requested review/export pair shares one pinned revision and one action receipt. */
export function createDeliverWorkArtifactTool(pipeline: PipelineRunner, root: string, workId: string): AgentTool<typeof DeliveryParameters> & { readonly artifactsCommitted: true } {
  const reviewTool = createArtifactMethodTools(pipeline, root, workId)[0]!;
  const exportTool = createExportWorkTool(root, workId);
  return {
    artifactsCommitted: true,
    name: 'review_and_export_work_artifact', label: 'Review and export artifact', parameters: DeliveryParameters,
    description: "Review and export a current standalone source Markdown artifact, such as a script or storyboard. Persist the professional review, then export exactly that revision. For a domain-generated collection such as a novel, first refresh it with the domain export action, then call review_work_artifact on the resulting export revision. Findings are separate from execution: an exported draft may still need revision. Never edits the manuscript.",
    async execute(id, params, signal, onUpdate) {
      const {artifact, revision} = await readArtifactRevision({projectRoot: root, workId, artifactId: params.artifactId, revisionId: params.revisionId});
      if (revision.id !== artifact!.currentRevisionId || !revision.path.endsWith('.md') || revision.path.startsWith('source/exports/')) {
        throw Object.assign(new Error('Select the current source Markdown revision for delivery.'), {
          code:'ARTIFACT_DELIVERY_TARGET_INVALID',
          recovery:{action:'workspace__review_work_artifact',parameters:{...params,revisionId:revision.id},
            reason:'This target cannot be exported by the generic source exporter. For a domain collection, refresh it using the domain export action before reviewing its resulting revision. Review alone can inspect this exact existing revision.'},
        });
      }
      const review = await reviewTool.execute(id, {...params, revisionId: revision.id}, signal, onUpdate);
      const reviewed = review.details as {path: string; observations: Array<{assessment?: string; category?: string}>; reviewedReferences: unknown[]; measurements: unknown; comparison?: ReviewComparison};
      // A review failure propagates before any export; a concurrent edit cannot
      // silently turn the reviewed version into a different exported version.
      signal?.throwIfAborted();
      const exported = await exportTool.execute(id, {artifactId: params.artifactId, expectedRevisionId: revision.id}, signal, onUpdate);
      const output = exported.details as {path: string; sourceRevisionId: string};
      const observations = reviewed.observations.filter(item => item.category !== 'execution');
      const reviewExecutionObservations = reviewed.observations.filter(item => item.category === 'execution');
      const delivery = {
        status: observations.some(item => item.assessment === 'issue') ? 'needs_revision'
          : observations.some(item => item.assessment === 'unavailable') ? 'unverified' : 'passed',
        requested: 'review_and_export',
        review: {status: 'completed', path: reviewed.path, revisionId: revision.id},
        export: {status: 'completed', path: output.path, revisionId: output.sourceRevisionId},
      };
      return {
        content: [{type: 'text', text: `Reviewed ${params.artifactId}@${revision.id} and exported ${output.path}. Content checks: ${delivery.status}. Review report: ${reviewed.path}.`}],
        details: {kind: 'artifact_delivered', workId, artifactId: params.artifactId, revisionId: revision.id,
          targetHash: revision.checksum, path: output.path, delivery,
          reviewedReferences: reviewed.reviewedReferences, measurements: reviewed.measurements,
          ...(reviewed.comparison ? {comparison: reviewed.comparison} : {}), observations, reviewExecutionObservations},
      };
    },
  };
}
type EditRange=TextEditRange;
class ArtifactWorker extends BaseAgent {
  get name() { return "artifact-method"; }
  async selectAuthorScope(content: string, authorRequest: string) {
    const request=authorTextScopeRequest(content,authorRequest);
    const selected=await this.submitStructured(request.messages,request.tool,{maxTokens:Math.min(8192,this.ctx.client.defaults.maxTokens),professionalGuidance:false});
    return authorTextScopeContract(content,selected.result);
  }

  async review(sources: ReadonlyMap<string, string>, instruction: string, criteria: string[], paths: ReadonlyMap<string,string>, versions:ReadonlyMap<string,{revisionId:string;checksum:string}>, comparison?: ReviewComparison, structure?: unknown) {
    const authorRequest = currentExecutionAuthorRequest();
    const response = await this.submitSourcedReview([
      ...(authorRequest?.trim() ? [{role:"system" as const,content:"Judge this artifact and its verified changes against the author's original instruction. Other artifacts and operations remain outside this review."}] : []),
      { role: 'system', content: 'Classify verified changes outside the author-authorized revision region as scope, citing both before and current sources. Scope is about permission to change existing material, not stylistic preferences or ordinary content defects. Missing comparison evidence is unavailable, not a scope violation. Classify other content findings as quality, and claims about tool execution, persistence, exports or external operations as execution. Review only the supplied evidence; future operations cannot be verified from manuscript text. Execution findings do not replace host tool receipts.' },
      { role: "system", content: "For revision-scope checks, use the supplied comparison when present. Its verified before/after snapshots and changedRegion describe actual text changes. Scope episode_start compares against the start of this episode, including multiple edits within it; parent_revision compares only with the selected revision's parent. Cite the before and current source IDs. A truncated changedRegion is a preview: consult the full numbered sources for omitted details. Do not extend these comparisons to other episodes or files." },
      { role: "system", content: "Review the primary artifact using the activated professional methods within the user's requested scope. References are separate documents with separate responsibilities: storyboard shots belong in the storyboard, and supplied image prompts need not be duplicated there. Submit evidence-backed findings through the review tool. Distinguish content defects, resolved issues, neutral observations, and unavailable evidence. If a requested comparison or file-change claim lacks its source versions or execution evidence, mark it unavailable rather than calling it a content defect or demanding duplicated material. Cite short numbered source ranges with sourceId, startLine and endLine; the host copies the original text. Do not copy line-number prefixes into quotes. Use the supplied measurements for length facts; never estimate a different count. Measurements cover the full artifact, including headings and markup." },
      ...(structure ? [{role:'system' as const,content:'The supplied structure contains deterministic checks of the identified graph revision and executable path witnesses. Use it for structural counts and reachability; a witness is not a literary-quality judgment. Review character motivation, narrative continuity, and the meaning of choices independently.'}] : []),
      { role: "user", content: JSON.stringify({ instruction:authorRequest?.trim()?authorRequest:instruction, criteria, comparison, ...(structure?{structure}:{}), sources: [...sources].map(([sourceId, content], index) => ({ sourceId, ...versions.get(sourceId), role:index===0?'primary':sourceId===comparison?.sourceId?'comparison':'reference', path:paths.get(sourceId), measurements: measureSourceText(content), numberedLines: numberReviewSource(content) })) }) },
    ], sources, { name: "submit_artifact_review", label: "Submit artifact review", description: "Submit observations with source line addresses and an explicit scope, quality or execution category." }, { maxTokens: Math.min(4096, this.ctx.client.defaults.maxTokens), categoryRequired: true,
      validateObservations: observations=>{
        for(const observation of observations.filter(item=>item.category==='scope'&&item.assessment==='issue')){
          const ids=new Set(observation.sourceRefs?.map(ref=>ref.sourceId));
          if(!comparison||comparison.before.revisionId===comparison.after.revisionId||!ids.has(comparison.sourceId)||!ids.has(sources.keys().next().value!))throw Object.assign(new Error('A scope violation requires distinct verified before/current revisions and citations to both. Classify ordinary content defects as quality and missing comparison evidence as unavailable.'),{code:'REVIEW_SCOPE_EVIDENCE_REQUIRED'});
        }
      },
    });
    return response.result;
  }
  async revise(content: string, instruction: string, references: ReadonlyMap<string, string>, ranges?:EditRange[],authorScope?:ReturnType<typeof textScopedSelectionEditContract>|ReturnType<typeof textRangeEditContract>) {
    if(authorScope||ranges){
      const contract=authorScope??textRangeEditContract(content,ranges!);
      const textSelections='startOffset' in contract.ranges[0]!;
      const response=await this.submitStructured([
        {role:"system",content:textSelections
          ? 'Revise only each exact selected text fragment. A selection may be part of a source line. The full document and protectedPrefix/protectedSuffix are read-only context and will remain around your replacement. Return only replacement characters for each content value in its named selection_N_text field. Do not repeat the protected prefix/suffix or add surrounding labels, annotations, formatting or line breaks that are outside the selection.'
          : "Revise only the numbered editable ranges using the user's instruction and professional methods. The full document is context. Return each range's replacement in its named range_N_content field, retaining the original trailing newline when present. Do not repeat or modify surrounding text."},
        {role:"user",content:JSON.stringify({instruction,measurements:measureSourceText(content),document:numberReviewSource(content),...(textSelections?{editableSelections:contract.ranges}:{editableRanges:contract.ranges}),references:[...references].map(([sourceId,content])=>({sourceId,content}))})},
      ],{name:"submit_artifact_revision",label:"Submit scoped artifact revision",description:"Submit only replacement text for each authorized range.",parameters:contract.parameters},{maxTokens:this.ctx.client.defaults.maxTokens});
      return{content:contract.apply(response.result)};
    }
    return (await this.submitStructured([
      { role: "system", content: "Apply the user's revision request using the activated professional methods. Submit the complete replacement document through the tool. Preserve the document's data format and all material outside the requested scope." },
      { role: "user", content: JSON.stringify({ instruction, measurements: measureSourceText(content), artifact: content, references: [...references].map(([sourceId, content]) => ({sourceId, content})) }) },
    ], { name: "submit_artifact_revision", label: "Submit artifact revision", description: "Submit the complete replacement document.", parameters: Replacement }, { maxTokens: this.ctx.client.defaults.maxTokens })).result;
  }
}

export function createArtifactMethodTools(pipeline: PipelineRunner, root: string, workId: string): Array<AgentTool<typeof Parameters> & { readonly artifactsCommitted: true }> {
  return (["review", "revise"] as const).map(mode => ({
    artifactsCommitted: true,
    name: `${mode}_work_artifact`, label: `${mode} work artifact`, parameters: Parameters,
    description: mode === 'review'
      ? "Review a selected artifact without exporting it. If the user requests both review and export, use review_and_export_work_artifact. An explicit candidate/history revisionId records evidence without adopting it."
      : "Revise a current artifact using this Work's professional Skills. For a localized Markdown edit, first read and supply exact editRanges; the host preserves surrounding bytes. Inspect the returned changedRegion before claiming the requested edit succeeded: it shows actual changes, which may differ from the request.",
    async execute(id, params, signal, onUpdate) {
      const work = await loadWorkManifest(root, workId);
      const profile = createBuiltInWorkProfileRegistry(root).require(work.profileId);
      const artifact = work.artifacts.find(artifact => artifact.id === params.artifactId);
      const revision = artifact?.revisions.find(revision => revision.id === (params.revisionId ?? artifact.currentRevisionId));
      if (!artifact || !revision) throw Object.assign(new Error("Select a current artifact or supply its exact candidate revisionId"), {code:"ARTIFACT_REVISION_REQUIRED"});
      if (mode === "revise" && revision.id !== artifact.currentRevisionId) throw Object.assign(new Error("Revision requires the current artifact version"), {code:"ARTIFACT_REVISION_CONFLICT"});
      if (!revision.contentType.startsWith("text/") && revision.contentType !== "application/json") throw new Error("This action requires a text artifact");
      const { bytes } = await readArtifactRevision({ projectRoot: root, workId, artifactId: artifact.id, revisionId: revision.id });
      const content = bytes.toString("utf8");
      const baselineWork = currentExecutionBaselineWork();
      updateExecutionWork(work);
      if (mode === "revise") {
        validatedArtifactWrites(work, revision.path, content, profile);
      }
      const sources = new Map([[artifact.id, content]]);
      const paths = new Map([[artifact.id, revision.path]]);
      const versions=new Map([[artifact.id,{revisionId:revision.id,checksum:revision.checksum}]]);
      const references: Array<{ artifactId: string; revisionId: string; checksum: string }> = [];
      let comparison: ReviewComparison | undefined;
      if (mode === 'review') {
        const baselineId = baselineWork === undefined ? revision.parentRevisionId
          : baselineWork?.id === workId ? baselineWork.artifacts.find(item => item.id === artifact.id)?.currentRevisionId : undefined;
        if (baselineId) {
          const before = await readArtifactRevision({projectRoot: root, workId, artifactId: artifact.id, revisionId: baselineId});
          const beforeText = before.bytes.toString('utf8');
          const sourceId = baselineId === revision.id ? artifact.id : `${artifact.id}@${baselineId}`;
          if (sourceId !== artifact.id) {
            sources.set(sourceId, beforeText); paths.set(sourceId, before.revision.path);
            versions.set(sourceId,{revisionId:before.revision.id,checksum:before.revision.checksum});
            references.push({artifactId: artifact.id, revisionId: baselineId, checksum: before.revision.checksum});
          }
          comparison = {scope: baselineWork === undefined ? 'parent_revision' : 'episode_start', sourceId,
            before: {revisionId: baselineId, checksum: before.revision.checksum},
            after: {revisionId: revision.id, checksum: revision.checksum}, changedRegion: changedSourceRegion(beforeText, content)};
        }
      }
      const relatedPaths = ['source/storyboard.md','source/image-prompts.md','source/script.md'].includes(revision.path)
        && profile.capabilityIds.some(id=>['script','storyboard','interactive-film'].includes(id))
        ? ['source/source-material.md','source/interactive-spec.md',revision.path==='source/script.md'?'source/script-spec.md':'source/storyboard-spec.md',
          ...(revision.path==='source/storyboard.md'?['source/image-prompts.md']:revision.path==='source/image-prompts.md'?['source/storyboard.md']:[])]
        : profile.capabilityIds.includes('short-fiction')&&['source/final/sales-package.md','source/final/sales-package.json','source/final/cover-prompt.md'].includes(revision.path)
          ? ['source/outline/v001.md','source/final/full.md']
          : profile.capabilityIds.includes('interactive-film')&&revision.path==='source/story-graph.json'
            ? ['source/delivery-requirements.json'] : [];
      const relatedIds = work.artifacts.filter(item=>item.revisions.some(version=>version.id===item.currentRevisionId&&relatedPaths.includes(version.path))).map(item=>item.id);
      for (const referenceId of new Set([...(params.referenceArtifactIds ?? []),...relatedIds])) {
        if (referenceId === artifact.id) continue;
        const reference = work.artifacts.find(item => item.id === referenceId);
        const version = reference?.revisions.find(item => item.id === reference.currentRevisionId);
        if (!reference || !version || (!version.contentType.startsWith("text/") && version.contentType !== "application/json")) throw new Error("Reference must be a current text artifact");
        const { bytes: referenceBytes } = await readArtifactRevision({ projectRoot: root, workId, artifactId: reference.id, revisionId: version.id });
        const text = referenceBytes.toString("utf8");
        sources.set(reference.id, text); paths.set(reference.id,version.path); versions.set(reference.id,{revisionId:version.id,checksum:version.checksum}); references.push({ artifactId: reference.id, revisionId: version.id, checksum: version.checksum });
      }
      const skills = resolveProfileSkillActivations((await loadAvailableAgentSkills({ projectRoot: root })).skills, profile, { includeRecommended: true });
      return pipeline.runWithAgentContext({ signal, activatedSkills: skills }, async () => {
        const worker = new ArtifactWorker(pipeline.createAgentContext(mode === "review" ? "auditor" : "reviser", workId));
        if (mode === "revise") {
          if(params.editRanges&&!revision.path.endsWith('.md'))throw Object.assign(new Error("Line-range revision requires a Markdown artifact"),{code:"ARTIFACT_EDIT_RANGE_FORMAT"});
          const authorRequest=currentExecutionAuthorRequest();
          const hasOriginalArtifact=baselineWork?.id===workId&&baselineWork.artifacts.some(item=>item.id===artifact.id&&item.currentRevisionId);
          const authorScope=hasOriginalArtifact&&authorRequest?.trim()&&revision.path.endsWith('.md')
            ? await new ArtifactWorker(pipeline.createAgentContext('auditor',workId)).selectAuthorScope(content,authorRequest) : undefined;
          if(authorScope)recordExecutionEvidence('edit-scope-selected',{workId,artifactId:artifact.id,revisionId:revision.id,authority:'author_request',ranges:authorScope.ranges});
          let result: { content: string };
          try {
            result = await worker.revise(content, authorScope ? authorRequest! : params.instruction, new Map([...sources].filter(([id]) => id !== artifact.id)),params.editRanges,authorScope);
          } catch (error) {
            if ((error as {code?:string}).code === "ARTIFACT_EDIT_RANGE_INVALID") {
              Object.assign(error as object, { recovery: { action: "workspace__read",
                parameters: { artifactId: artifact.id, workId, revisionId: revision.id },
                reason: "Select non-overlapping ranges from this revision's numbered source; do not exceed totalLines." } });
            }
            throw error;
          }
          return createReplaceWorkArtifactTool(root, workId).execute(id, { path: revision.path, content: result.content, expectedRevisionId: revision.id }, signal, onUpdate);
        }
        const authorRequest = currentExecutionAuthorRequest();
        const scope = authorRequest?.trim() ? authorRequest : params.instruction;
        let structure: (ReturnType<typeof inspectFilmGraph> & {revisionId:string;targetHash:string}) | undefined;
        if(profile.capabilityIds.includes('interactive-film')&&revision.path==='source/story-graph.json'){
          const requirementId=[...paths].find(([,path])=>path==='source/delivery-requirements.json')?.[0];
          const requirements=requirementId?Value.Parse(FilmRequirementsSchema,JSON.parse(sources.get(requirementId)!)) as FilmRequirements:undefined;
          structure={revisionId:revision.id,targetHash:revision.checksum,...inspectFilmGraph(StoryGraphSchema.parse(JSON.parse(content)),requirements)};
        }
        const review = await worker.review(sources, params.instruction, profile.qualityCriteria, paths, versions, comparison, structure);
        const observations = review.observations.map(observation => ({ ...observation,
          assessment: observation.assessment ?? "observation", scope, targetHash: revision.checksum, target: { workId, artifactId: artifact.id, revisionId: revision.id } }));
        const path = `source/reviews/${randomUUID()}.json`;
        await syncWorkSourceArtifacts({ projectRoot: root, workId, accept: true, acceptPaths: [path], writes: [{ relativePath: join("works", workId, path),
          content: JSON.stringify({ artifactId: artifact.id, revisionId: revision.id, targetHash: revision.checksum, measurements: measureSourceText(content), scope, ...(authorRequest?.trim()?{coordinatorInstruction:params.instruction,reviewBasis:"author_request"}:{}), references, comparison, ...(structure?{structure}:{}), summary: review.summary, observations }, null, 2),
        }] });
        return { content: [{ type: "text", text: review.summary }], details: { kind: "artifact_reviewed", workId, artifactId: artifact.id, revisionId: revision.id, targetHash: revision.checksum, measurements: measureSourceText(content), reviewedReferences: references, ...(comparison ? {comparison} : {}), ...(structure?{structure}:{}), path, observations } };
      });
    },
  }));
}
