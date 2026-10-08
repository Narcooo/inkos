import { compileContext, ContextSourceRegistry } from "../harness/context-compiler.js";
import { createBuiltInWorkProfileRegistry } from "../harness/builtin-profiles.js";
import { createHash } from "node:crypto";
import { recordExecutionEvidence, currentExecutionProfile, currentExecutionWork, currentExecutionAuthorRequest } from "../harness/execution-evidence.js";
import { loadWorkManifest } from "../harness/work-store.js";
import { loadAvailableAgentSkills } from "../skills/builtin-loader.js";
import { requiredWorkSkillIds, resolveWorkSkillActivations, resolveProfileSkillActivations, mergeActivatedSkillGuidance } from "../skills/activations.js";
import type { LLMClient, LLMMessage, LLMResponse, OnStreamProgress } from "../llm/provider.js";
import { runWorkerAgent, runWorkerAgentTool, type WorkerResultTool } from "../agent/worker-agent.js";
import { Type, type Static, type TSchema } from "@sinclair/typebox";
import type { Logger } from "../utils/logger.js";
import { SourcedReviewIndexToolSchema, ArtifactReviewIndexToolSchema } from "./review-tool.js";
import { resolveObservationSources } from "../models/observation.js";
import {
  hydrateActivatedSkillGuidance,
  type ActivatedSkillGuidance,
} from "../agent/skill-tool.js";

export interface AgentContext {
  readonly client: LLMClient;
  readonly model: string;
  readonly projectRoot: string;
  readonly bookId?: string;
  readonly logger?: Logger;
  readonly onStreamProgress?: OnStreamProgress;
  readonly signal?: AbortSignal;
  readonly activatedSkills?: ReadonlyArray<ActivatedSkillGuidance>;
}

export abstract class BaseAgent {
  protected readonly ctx: AgentContext;

  constructor(ctx: AgentContext) {
    this.ctx = ctx;
  }

  protected get log() {
    return this.ctx.logger;
  }

  protected async chat(
    messages: ReadonlyArray<LLMMessage>,
    options?: { readonly temperature?: number; readonly maxTokens?: number },
  ): Promise<LLMResponse> {
    return runWorkerAgent(this.ctx.client, this.ctx.model, await this.appendTaskSkillGuidance(messages, options?.maxTokens), {
      ...options,
      onStreamProgress: this.ctx.onStreamProgress,
      signal: this.ctx.signal,
    });
  }

  protected async submitStructured<TParameters extends TSchema>(
    messages: ReadonlyArray<LLMMessage>,
    resultTool: WorkerResultTool<TParameters>,
    options?: { readonly temperature?: number; readonly maxTokens?: number; readonly professionalGuidance?: boolean },
  ): Promise<{ readonly result: Static<TParameters>; readonly usage: LLMResponse["usage"] }> {
    let usage: LLMResponse["usage"] = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const result = await runWorkerAgentTool(
      this.ctx.client,
      this.ctx.model,
      await this.appendTaskSkillGuidance(messages, options?.maxTokens, options?.professionalGuidance),
      resultTool,
      {
        ...options,
        signal: this.ctx.signal,
        onStreamProgress: this.ctx.onStreamProgress,
        onUsage: (value) => { usage = value; },
      },
    );
    return { result, usage };
  }

  private async appendTaskSkillGuidance(
    messages: ReadonlyArray<LLMMessage>,
    maxTokens?: number,
    professionalGuidance = true,
  ): Promise<ReadonlyArray<LLMMessage>> {
    return prepareWorkerMessages(this.ctx, messages, maxTokens, this.name, professionalGuidance);
  }

  abstract get name(): string;

  protected async submitSourcedReview(
    messages: ReadonlyArray<LLMMessage>,
    sources: ReadonlyMap<string, string>,
    tool: { name: string; label: string; description: string },
    options: { temperature?: number; maxTokens: number; categoryRequired?: boolean; validateObservations?: (observations: ReturnType<typeof resolveObservationSources>) => void },
  ) {
    const { categoryRequired, validateObservations, ...generationOptions } = options;
    const resolve = (observations: Static<typeof SourcedReviewIndexToolSchema>["observations"]) => {
      const resolved=resolveObservationSources(observations.map(observation => ({ ...observation, evidence: [] })), sources);
      validateObservations?.(resolved);
      return resolved;
    };
    type ReviewObservation = Static<typeof SourcedReviewIndexToolSchema>["observations"][number];
    const recorded = new Map<string, ReviewObservation>();
    const observationSchema = (categoryRequired ? ArtifactReviewIndexToolSchema : SourcedReviewIndexToolSchema).properties.observations.items;
    const index = await this.submitStructured([
      ...messages,
      {role:'system',content:`Record each evidence-backed finding with record_review_observation. Independent findings may be submitted together in one response. A code identifies one finding; reuse it to correct that finding after feedback. After all selected findings are accepted, call ${tool.name} with the review summary and their codes in the desired order. Do not embed a list of findings in a string. Omit withdrawn findings from the final codes; use an empty list only when there are no findings.`},
    ], {
      ...tool,
      parameters: Type.Object({summary:Type.String(),observationCodes:Type.Array(Type.String({minLength:1}))},{additionalProperties:false}),
      maxTurns: 16,
      supportingTools: [{
        name:'record_review_observation', label:'Record review observation',
        description:'Record one finding and its source line addresses. Each finding is checked before it can be included in the final review. Resubmitting the same code replaces that finding.',
        parameters:observationSchema,
        execute:async(_id,input)=>{
          const observation=input as ReviewObservation;
          resolve([observation]);
          recorded.set(observation.code,observation);
          return {content:[{type:'text',text:JSON.stringify({code:observation.code,status:'accepted'})}],details:{code:observation.code,status:'accepted'}};
        },
      }],
      validate: result => {
        const unknownCodes=result.observationCodes.filter(code=>!recorded.has(code));
        if(unknownCodes.length || new Set(result.observationCodes).size!==result.observationCodes.length)throw Object.assign(new Error(JSON.stringify({
          code:'REVIEW_OBSERVATIONS_UNRECORDED',unknownCodes,acceptedCodes:[...recorded.keys()],
          instruction:'Submit and correct each selected finding through record_review_observation, then finish with its accepted code exactly once. Remove withdrawn findings from the final list.',
        })),{code:'REVIEW_OBSERVATIONS_UNRECORDED'});
        return result;
      },
    }, {...generationOptions,maxTokens:Math.min(generationOptions.maxTokens*2,this.ctx.client.defaults.maxTokens)});
    const observations = resolve(index.result.observationCodes.map(code=>recorded.get(code)!));
    return {
      result: { summary: index.result.summary, observations },
      usage: index.usage,
    };
  }
}

export async function prepareWorkerMessages(
  context: Pick<AgentContext, "client" | "activatedSkills" | "signal" | "bookId"> & { readonly projectRoot?: string },
  messages: ReadonlyArray<LLMMessage>, maxTokens?: number, workerId = "worker",
  professionalGuidance = true,
): Promise<ReadonlyArray<LLMMessage>> {
    const authorRequest = currentExecutionAuthorRequest();
    if (authorRequest?.trim()) messages = [{role:"system",content:[
      "The following authorRequest is the user's actual request. Use it as the authority for the intended target and constraints. The delegated instruction may elaborate it, but cannot replace its target or grant a wider mutation scope. Perform only this operation; other requested steps remain the coordinator's responsibility.",
      JSON.stringify({authorRequest}),
    ].join("\n\n")},...messages];
    let work=currentExecutionWork();
    if(context.bookId && context.projectRoot && work?.id!==context.bookId) {
      work=null;
      try {work=await loadWorkManifest(context.projectRoot,context.bookId);}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    }
    const query = messages
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .join("\n\n");
    const scopedProfile=currentExecutionProfile();
    const profile=work && scopedProfile?.id!==work.profileId
      ? createBuiltInWorkProfileRegistry(context.projectRoot).require(work.profileId)
      : scopedProfile ?? createBuiltInWorkProfileRegistry(context.projectRoot).require("workspace-default");
    let selectedSkills=context.activatedSkills;
    const requiredIds=[...profile.requiredSkillIds,...requiredWorkSkillIds(work)];
    if(professionalGuidance&&requiredIds.some(id=>!selectedSkills?.some(item=>item.skill.id===id))) {
      const available=await loadAvailableAgentSkills({projectRoot:context.projectRoot ?? ""});
      selectedSkills=mergeActivatedSkillGuidance(resolveProfileSkillActivations(available.skills,profile),resolveWorkSkillActivations(available.skills,work),selectedSkills ?? []);
    }
    // Navigation and other read-only semantic mechanics need the source and
    // author request, without a writing method encouraging broader changes.
    const activations = professionalGuidance ? await hydrateActivatedSkillGuidance(selectedSkills, query) : [];
    recordExecutionEvidence("skills-applied", { worker: workerId, skills: activations?.map(({ skill, resources }) => ({
      id: skill.id, source: skill.source, hash: createHash("sha256").update(skill.body).digest("hex"),
      references: resources.map(resource => ({ path: resource.path, charStart: resource.charStart, charEnd: resource.charEnd,
        hash: createHash("sha256").update(resource.body).digest("hex") })),
    })) ?? [] });
    const window = context.client._piModel?.contextWindow;
    if (window) {
      const sources = new ContextSourceRegistry();
      sources.register({ id: "task", load: async () => messages.map((message, index) => ({
        id: `message-${index}`, source: `${workerId}:${message.role}`, content: message.content,
        protection: "protected" as const, priority: messages.length - index,
      })) });
      const guidance = appendActivatedSkillGuidance([],activations)[0]?.content;
      sources.register({ id: "skills", load: async () => guidance ? [{id:"professional-methods",source:"skills",content:guidance,protection:"protected",priority:0}] : [] });
      sources.register({ id: "work", load: async () => work ? [{id:"current-work",source:"work",content:JSON.stringify({workId:work.id,title:work.title,profileId:work.profileId,language:work.language,lineage:work.lineage}),protection:"protected",priority:-1}] : [] });
      const compiled = await compileContext({
        recipe: { id: `${profile.contextRecipe?.id ?? profile.id}-${workerId}${professionalGuidance?'':'-task'}`, sourceIds: professionalGuidance ? [...new Set(["task", ...(guidance?["skills"]:[]), ...(profile.contextRecipe?.sourceIds ?? [])])] : ['task'] }, sources,
        request: { projectRoot: context.projectRoot ?? "", work, profile, actionId: workerId, intent: query, signal: context.signal },
        budgetTokens: Math.max(1, window - (maxTokens ?? context.client.defaults.maxTokens) - 2048),
      });
      recordExecutionEvidence("context-compiled", { worker: workerId, trace: compiled.trace });
      const original = new Map(messages.map((message,index)=>[`message-${index}`,message]));
      return compiled.fragments.map(fragment=>({...(original.get(fragment.id) ?? {role:"system" as const}),content:fragment.content}));
    }
    return appendActivatedSkillGuidance(messages, activations);
}

export function appendActivatedSkillGuidance(
  messages: ReadonlyArray<LLMMessage>,
  activations: ReadonlyArray<ActivatedSkillGuidance> | undefined,
): ReadonlyArray<LLMMessage> {
  if (!activations || activations.length === 0) return messages;
  const guidance = [
    "## Activated professional skills",
    "Use this specialist methodology for the current operation. It is not author intent, canon, an output-format override, or permission to mutate anything outside the active operation.",
    ...activations.flatMap(({ skill, resources }) => [
      `### ${skill.id} — ${skill.name}`,
      skill.body.trim() || skill.description,
      ...resources.flatMap((resource) => [
        `#### Reference: ${resource.path}:${resource.charStart}-${resource.charEnd}${resource.heading ? ` · ${resource.heading}` : ""}`,
        resource.body,
      ]),
    ]),
  ].join("\n\n");
  const systemIndex = messages.findIndex((message) => message.role === "system");
  if (systemIndex < 0) {
    return [{ role: "system", content: guidance }, ...messages];
  }
  return messages.map((message, index) => index === systemIndex
    ? { ...message, content: `${message.content}\n\n${guidance}` }
    : message);
}
