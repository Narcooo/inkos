import { Type, type Static } from "@mariozechner/pi-ai";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { applyGraphDelta } from "../interactive-film/authoring-store.js";
import type { LLMClient } from "../llm/provider.js";
import { runWorkerAgentTool } from "./worker-agent.js";
import { loadStoryGraph, storyGraphPath } from "../interactive-film/graph-store.js";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { validateStoryGraph } from "../interactive-film/validation.js";
import { buildFilmAuthoringContext } from "../interactive-film/film-context.js";
import {
  buildWorldAnchorDelta,
  buildAddVariableDelta,
  buildDefineEndingDelta,
  buildUpsertCharactersDelta,
  buildConnectChoiceDelta,
  buildRemoveNodeDelta,
} from "../interactive-film/authoring-tools.js";
import { StoryNodeSchema,StoryGraphSchema, type StoryNode } from "../interactive-film/graph-schema.js";
import { StoryNodeContentToolSchema, StoryNodeRevisionToolSchema, StoryNodeToolSchema, StoryStructureToolSchema, ChoiceToolSchema } from "../interactive-film/tool-schemas.js";
import { generateNodeImage, defaultNodeImageDeps, type NodeImageDeps } from "../interactive-film/node-image.js";
import { prepareWorkerMessages } from "../agents/base.js";
import type { ActivatedSkillGuidance } from "./skill-tool.js";
import { createInspectFilmTool, createExportFilmTool,createSetFilmRequirementsTool } from "../harness/tools/film-delivery.js";
import{readFilmRequirements,checkFilmRequirements}from'../interactive-film/delivery-requirements.js';

// ---------------------------------------------------------------------------
// Local helper — textResult is not exported from agent-tools.ts
// ---------------------------------------------------------------------------

function textResult(text: string): AgentToolResult<undefined>;
function textResult<T>(text: string, details: T): AgentToolResult<T>;
function textResult<T = undefined>(text: string, details?: T): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details: details as T };
}

// ---------------------------------------------------------------------------
// set_world_anchor
// ---------------------------------------------------------------------------

const WorldAnchorParams = Type.Object({
  storyCore: Type.Optional(Type.String({ description: "one-sentence story core" })),
  theme: Type.Optional(Type.String({ description: "theme of the story" })),
  genre: Type.Optional(Type.String({ description: "genre, free text (e.g. suspense, romance)" })),
  worldRules: Type.Optional(Type.String({ description: "world rules that constrain the plot" })),
  durationMinutes: Type.Optional(Type.Number({ description: "target playthrough duration in minutes" })),
});

export function createSetWorldAnchorTool(projectRoot: string, projectId: string): AgentTool<typeof WorldAnchorParams> {
  return {
    name: "set_world_anchor",
    description: "interactive-film authoring: set/update the world anchor (story core, theme, rules, duration). Applies immediately.",
    label: "Set World Anchor",
    parameters: WorldAnchorParams,
    async execute(_id, params: Static<typeof WorldAnchorParams>) {
      const { graph, rev } = await applyGraphDelta({ projectRoot, projectId, delta: buildWorldAnchorDelta(params), phase: "world" });
      return textResult(`World anchor updated (rev ${rev}). core=${graph.worldAnchor?.storyCore ?? ""}`, { kind: "graph_updated", rev });
    },
  };
}

// ---------------------------------------------------------------------------
// add_variable
// ---------------------------------------------------------------------------

const AddVariableParams = Type.Object({
  name: Type.String({ description: "variable name (unique key)" }),
  type: Type.String({ description: "user-defined variable role, e.g. flag, relationship, clue-state, or another story-specific kind" }),
  default: Type.Union([Type.Number(), Type.String(), Type.Boolean()], { description: "default value" }),
  desc: Type.Optional(Type.String({ description: "what it tracks" })),
});

export function createAddVariableTool(projectRoot: string, projectId: string): AgentTool<typeof AddVariableParams> {
  return {
    name: "add_variable",
    description: "interactive-film authoring: add/update a variable. Applies immediately.",
    label: "Add Variable",
    parameters: AddVariableParams,
    async execute(_id, params: Static<typeof AddVariableParams>) {
      const { rev } = await applyGraphDelta({
        projectRoot,
        projectId,
        delta: buildAddVariableDelta({ name: params.name, type: params.type, default: params.default, desc: params.desc ?? "" }),
      });
      return textResult(`Variable "${params.name}" added (rev ${rev}).`, { kind: "graph_updated", rev });
    },
  };
}

// ---------------------------------------------------------------------------
// define_ending
// ---------------------------------------------------------------------------

const DefineEndingParams = Type.Object({
  id: Type.String({ description: "ending id" }),
  nodeId: Type.String({ description: "the ending node this describes (must exist)" }),
  title: Type.String(),
  type: Type.String({ description: "ending meaning in the work's own terms" }),
  description: Type.Optional(Type.String()),
});

export function createDefineEndingTool(projectRoot: string, projectId: string): AgentTool<typeof DefineEndingParams> {
  return {
    name: "define_ending",
    description: "interactive-film authoring: define/update an ending (its nodeId must exist). Applies immediately.",
    label: "Define Ending",
    parameters: DefineEndingParams,
    async execute(_id, params: Static<typeof DefineEndingParams>) {
      const { rev } = await applyGraphDelta({
        projectRoot,
        projectId,
        delta: buildDefineEndingDelta({ id: params.id, nodeId: params.nodeId, title: params.title, type: params.type, description: params.description ?? "" }),
      });
      return textResult(`Ending "${params.title}" defined (rev ${rev}).`, { kind: "graph_updated", rev });
    },
  };
}

// ---------------------------------------------------------------------------
// upsert_characters
// ---------------------------------------------------------------------------

const UpsertCharactersParams = Type.Object({
  characters: Type.Array(Type.Object({
    id: Type.String(),
    name: Type.String(),
    role: Type.Optional(Type.String({ description: "character role in the work's own terms" })),
    motivation: Type.Optional(Type.String()),
    voiceProfile: Type.Optional(Type.Object({
      speakingRhythm: Type.Optional(Type.String()),
      vocabulary: Type.Optional(Type.String()),
      sampleLines: Type.Optional(Type.Array(Type.String())),
    })),
  })),
});

export function createUpsertCharactersTool(projectRoot: string, projectId: string): AgentTool<typeof UpsertCharactersParams> {
  return {
    name: "upsert_characters",
    description: "interactive-film authoring: add/update characters with voice profiles. Applies immediately and records them to memory for cross-node voice consistency.",
    label: "Upsert Characters",
    parameters: UpsertCharactersParams,
    async execute(_id, params: Static<typeof UpsertCharactersParams>) {
      const chars = params.characters.map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role ?? "other" as const,
        motivation: c.motivation ?? "",
        voiceProfile: c.voiceProfile
          ? {
              speakingRhythm: c.voiceProfile.speakingRhythm ?? "",
              vocabulary: c.voiceProfile.vocabulary ?? "",
              sampleLines: c.voiceProfile.sampleLines ?? [],
            }
          : undefined,
      }));
      const { rev } = await applyGraphDelta({ projectRoot, projectId, delta: buildUpsertCharactersDelta(chars) });
      return textResult(`Upserted ${chars.length} character(s) (rev ${rev}).`, { kind: "graph_updated", rev });
    },
  };
}

// ---------------------------------------------------------------------------
// LLM-backed fill_node / revise_node
// ---------------------------------------------------------------------------

export interface FilmLLMDeps {
  readonly submitNode: (
    system: string,
    user: string,
    nodeId: string,
    signal?: AbortSignal,
    currentNode?: StoryNode,
    fields?: ReadonlyArray<"sceneDesc" | "dialogue">,
  ) => Promise<StoryNode>;
  readonly submitStructure: (
    system: string,
    user: string,
    signal?: AbortSignal,
  ) => Promise<ReadonlyArray<StoryNode>>;
  readonly skillIds?: () => ReadonlyArray<string>;
}

function defaultSubmitNode(
  client: LLMClient,
  model: string,
  activatedSkills?: () => ReadonlyArray<ActivatedSkillGuidance>,
): FilmLLMDeps["submitNode"] {
  return async (system, user, nodeId, signal, currentNode, fields) => {
    const submitted = await runWorkerAgentTool(client, model, await prepareWorkerMessages({ client, activatedSkills: activatedSkills?.(), signal }, [
      { role: "system", content: system },
      { role: "user", content: user },
    ], 4000, "film-node"), {
      name: currentNode ? "submit_story_node_revision" : "submit_story_node",
      label: currentNode ? "Submit node prose revision" : "Submit Story Node",
      description: currentNode ? "Submit only the selected prose fields. The host preserves every other node field."
        : "Submit the complete scene, dialogue, choices, and image direction for the requested node. The host owns the node id.",
      parameters: currentNode ? Type.Pick(StoryNodeRevisionToolSchema, fields ?? ["sceneDesc", "dialogue"]) : StoryNodeContentToolSchema,
    }, {  maxTokens: 4000, signal });
    return StoryNodeSchema.parse({ ...currentNode, ...submitted, id: nodeId });
  };
}

function defaultSubmitStructure(
  client: LLMClient,
  model: string,
  activatedSkills?: () => ReadonlyArray<ActivatedSkillGuidance>,
): FilmLLMDeps["submitStructure"] {
  return async (system, user, signal) => {
    const submitted = await runWorkerAgentTool(client, model, await prepareWorkerMessages({ client, activatedSkills: activatedSkills?.(), signal }, [
      { role: "system", content: system },
      { role: "user", content: user },
    ], 6000, "film-structure"), {
      name: "submit_story_structure",
      label: "Submit Story Structure",
      description: "Submit the complete branching node skeleton. Node ids and choice targets must form one connected playable graph.",
      parameters: StoryStructureToolSchema,
    }, {  maxTokens: 6000, signal });
    return submitted.nodes.map((node) => StoryNodeSchema.parse(node));
  };
}

const FillNodeParams = Type.Object({
  nodeId: Type.String({ description: "the node to fill/rewrite" }),
  instruction: Type.String({ description: "what this scene should contain (beats, who speaks, choices)" }),
});

const ReviseNodeParams = Type.Object({
  ...FillNodeParams.properties,
  fields: Type.Array(Type.Union([Type.Literal("sceneDesc"), Type.Literal("dialogue")]), {
    minItems: 1, uniqueItems: true,
    description: "Select only the fields the author permits changing. For dialogue-only edits select dialogue; for description-only edits select sceneDesc. Select both only when both are in scope.",
  }),
});

export type FilmAuthoringLanguage = "zh" | "en";

function nodeSystemPrompt(language: FilmAuthoringLanguage, revision = false): string {
  const operation = language === 'en'
    ? revision ? 'Use the activated interactive-film Skill to revise the requested node. Submit only the selected fields through submit_story_node_revision. All other node fields are read-only and preserved by the host.'
      : 'Use the activated interactive-film Skill and current graph context to submit the requested node through submit_story_node. Every choices[].targetNodeId must identify an existing node. The host owns the node id.'
    : revision ? '按已激活的互动影游 Skill 修改指定节点。通过 submit_story_node_revision 仅提交选定字段；其他节点字段是只读参考，由宿主保持。'
      : '按已激活的互动影游 Skill 和当前图上下文，通过 submit_story_node 提交指定节点。choices[].targetNodeId 必须指向已存在的节点，节点 id 由宿主提供。';
  const rendering = language === 'en'
    ? 'The player renders sceneDesc and condition-matching dialogue on entry, before a choice is made. Outgoing choice effects apply only after that choice; the destination node then renders with the resulting state. sceneDesc is unconditional. Node prose is player-facing; conditions belong in dialogue[].condition.'
    : '播放器进入节点后先显示 sceneDesc 和符合 condition 的对白，随后才让玩家选择。选项 effects 仅在点击该选项后生效，目标节点使用生效后的状态显示。sceneDesc 无条件显示。节点正文面向玩家，状态条件写在 dialogue[].condition 中。';
  return `${operation}\n${rendering}`;
}

function graphUpdatedDetails(rev: number, extra: Record<string, unknown> = {}) {
  return {
    kind: "graph_updated" as const,
    rev,
    ...extra,
  };
}

export function createFillNodeTool(
  projectRoot: string,
  projectId: string,
  deps: FilmLLMDeps,
  language: FilmAuthoringLanguage = "zh",
): AgentTool<typeof FillNodeParams> {
  return {
    name: "fill_node",
    description: "Write one node's scene and dialogue. Existing choices, variable effects and node identity remain unchanged; use connect_choice for topology changes.",
    label: "Fill Node",
    parameters: FillNodeParams,
    async execute(_id, params: Static<typeof FillNodeParams>, signal) {
      const graph = await loadStoryGraph(projectRoot, projectId);
      const context = graph ? JSON.parse(buildFilmAuthoringContext(graph)) : null;
      const systemPrompt = nodeSystemPrompt(language);
      const userPrompt = JSON.stringify({context, targetNodeId: params.nodeId, instruction: params.instruction});
      const node = await deps.submitNode(systemPrompt, userPrompt, params.nodeId, signal);
      const existing=graph?.nodes.find(n=>n.id===params.nodeId);
      const filled=existing?{...node,id:existing.id,type:existing.type,choices:existing.choices}:node;
      const { rev } = await applyGraphDelta({
        projectRoot,
        projectId,
        delta: { nodes: { upsert: [filled], remove: [] }, notes: [] },
        phase: "workshop",
      });
      return textResult(`Node ${params.nodeId} filled (rev ${rev}).`, graphUpdatedDetails(rev, {
        skillIds: deps.skillIds?.() ?? [],
      }));
    },
  };
}

export function createReviseNodeTool(
  projectRoot: string,
  projectId: string,
  deps: FilmLLMDeps,
  language: FilmAuthoringLanguage = "zh",
): AgentTool<typeof ReviseNodeParams> {
  return {
    name: "revise_node",
    description: "interactive-film authoring: revise the selected prose fields of one existing node. Select only fields authorized by the author. All unselected fields remain unchanged. Applies immediately.",
    label: "Revise Node",
    parameters: ReviseNodeParams,
    async execute(_id, params: Static<typeof ReviseNodeParams>, signal) {
      const graph = await loadStoryGraph(projectRoot, projectId);
      const context = graph ? JSON.parse(buildFilmAuthoringContext(graph)) : null;
      const current = graph?.nodes.find((n) => n.id === params.nodeId);
      const systemPrompt = nodeSystemPrompt(language, true);
      const userPrompt = JSON.stringify({context, targetNodeId: params.nodeId, fields: params.fields, instruction: params.instruction});
      if(!current)throw Object.assign(new Error('Select an existing node'),{code:'NODE_NOT_FOUND'});
      const generated = await deps.submitNode(systemPrompt, userPrompt, params.nodeId, signal, current, params.fields);
      const node={...current,
        ...(params.fields.includes("sceneDesc") ? {sceneDesc:generated.sceneDesc} : {}),
        ...(params.fields.includes("dialogue") ? {dialogue:generated.dialogue} : {}),
      };
      const { rev } = await applyGraphDelta({
        projectRoot,
        projectId,
        delta: { nodes: { upsert: [node], remove: [] }, notes: [] },
        phase: "workshop",
      });
      return textResult(`Node ${params.nodeId} revised (rev ${rev}).`, graphUpdatedDetails(rev, {
        skillIds: deps.skillIds?.() ?? [],
      }));
    },
  };
}

export function filmLLMDepsFromClient(
  client: LLMClient,
  model: string,
  options: { readonly activatedSkills?: () => ReadonlyArray<ActivatedSkillGuidance> } = {},
): FilmLLMDeps {
  return {
    submitNode: defaultSubmitNode(client, model, options.activatedSkills),
    submitStructure: defaultSubmitStructure(client, model, options.activatedSkills),
    skillIds: () => (options.activatedSkills?.() ?? []).map((activation) => activation.skill.id),
  };
}

// ---------------------------------------------------------------------------
// draft_structure — confirm-class: structured worker result → apply
// ---------------------------------------------------------------------------

const DraftStructureParams = Type.Object({
  instruction: Type.String({ description: "what skeleton to draft (acts, branch points, endings)" }),
  referenceWorkId: Type.Optional(Type.String({minLength:1,description:"Use only when the user explicitly requests reuse of an existing Work's exact topology. Reuse its node IDs, choices, conditions and variable defaults atomically; preserve this Work's authored text on matching node IDs. Reference scene/dialogue/image prose is never copied. Fill missing scenes afterward."})),
});

const STRUCT_SYSTEM_ZH = `按已激活的互动影游 Skill 和用户指令设计完整分支骨架。保持一个开场节点、真实分支和可达结局；规模由用户要求与作品本身决定。完成后调用 submit_story_structure。`;
const STRUCT_SYSTEM_EN = `Design the complete branching skeleton with the activated interactive-film Skill and user instruction. Keep one opening node, real branches, and reachable endings; let the requested work determine scale. Finish by calling submit_story_structure.`;

export function createDraftStructureTool(
  projectRoot: string,
  projectId: string,
  deps: FilmLLMDeps,
  language: FilmAuthoringLanguage = "zh",
): AgentTool<typeof DraftStructureParams> {
  return {
    name: "draft_structure",
    description: "interactive-film authoring: draft the branching node skeleton and topology under the current Profile confirmation policy.",
    label: "Draft Structure",
    parameters: DraftStructureParams,
    async execute(_id, params: Static<typeof DraftStructureParams>, signal) {
      const graph = await loadStoryGraph(projectRoot, projectId);
      if(params.referenceWorkId){
        if(params.referenceWorkId===projectId)throw Object.assign(new Error("Select another Work as the topology reference"),{code:"FILM_REFERENCE_SELF"});
        const referenceBytes=await readFile(storyGraphPath(projectRoot,params.referenceWorkId)).catch(error=>{
          if((error as NodeJS.ErrnoException).code==='ENOENT')throw Object.assign(new Error("The reference Work has no story graph"),{code:"FILM_REFERENCE_EMPTY"});throw error;
        });
        const reference=StoryGraphSchema.parse(JSON.parse(referenceBytes.toString('utf8')));
        if(!reference.nodes.length)throw Object.assign(new Error("The reference Work has no story graph"),{code:"FILM_REFERENCE_EMPTY"});
        const validation=validateStoryGraph(reference);
        if(!validation.ok)throw Object.assign(new Error("The reference topology has invalid links or state types"),{code:"FILM_REFERENCE_INVALID",issues:validation.issues});
        const nodes=reference.nodes.map(node=>{
          const own=graph?.nodes.find(item=>item.id===node.id);
          return StoryNodeSchema.parse({id:node.id,type:node.type,title:own?.title||node.title,choices:node.choices,
            sceneDesc:own?.sceneDesc??'',dialogue:own?.dialogue??[],imageSlot:own?.imageSlot,act:own?.act||node.act,position:own?.position??node.position});
        });
        const endings=reference.endings.map(ending=>graph?.endings.find(item=>item.id===ending.id&&item.nodeId===ending.nodeId)??{...ending,description:''});
        const variables=[...(graph?.variables??[]).filter(variable=>!reference.variables.some(item=>item.name===variable.name)),...reference.variables];
        const candidate=StoryGraphSchema.parse({...(graph??{schemaVersion:1,projectId,title:projectId}),nodes,endings,variables});
        const requirements=await readFilmRequirements(projectRoot,projectId);
        if(requirements){const report=checkFilmRequirements(candidate,requirements);if(report.status!=='checks_passed')throw Object.assign(new Error(JSON.stringify({code:'FILM_REFERENCE_REQUIREMENTS_UNMET',issues:report.issues})),{code:'FILM_REFERENCE_REQUIREMENTS_UNMET',issues:report.issues});}
        const sourceHash='sha256:'+createHash('sha256').update(referenceBytes).digest('hex');
        const {graph:next,rev}=await applyGraphDelta({projectRoot,projectId,phase:'structure',delta:{
          nodes:{upsert:nodes,remove:graph?.nodes.filter(node=>!nodes.some(item=>item.id===node.id)).map(node=>node.id)??[]},
          variables:{upsert:reference.variables,remove:[]},endings:{upsert:endings,remove:graph?.endings.filter(ending=>!endings.some(item=>item.id===ending.id)).map(ending=>ending.id)??[]},notes:[],
        }});
        const missingSceneNodeIds=next.nodes.filter(node=>!node.sceneDesc.trim()).map(node=>node.id);
        return textResult(`Reference topology applied: ${next.nodes.length} nodes; ${missingSceneNodeIds.length} scenes still need generation.`,graphUpdatedDetails(rev,{skillIds:deps.skillIds?.()??[],referenceTopology:{workId:params.referenceWorkId,sourceHash},missingSceneNodeIds}));
      }
      const context = graph ? buildFilmAuthoringContext(graph) : "(empty graph)";
      const systemPrompt = language === "en" ? STRUCT_SYSTEM_EN : STRUCT_SYSTEM_ZH;
      const userPrompt = language === "en"
        ? `${context}\n\nSkeleton instruction: ${params.instruction}`
        : `${context}\n\n骨架指令：${params.instruction}`;
      const requirements=await readFilmRequirements(projectRoot,projectId);
      let nodes:readonly StoryNode[]=[];
      let failures:unknown=[];
      for(let attempt=0;attempt<3;attempt++){
        nodes=await deps.submitStructure(systemPrompt,`${userPrompt}\nConfirmed requirements: ${JSON.stringify(requirements??{})}\n${attempt?`Correct these exact validation failures: ${JSON.stringify(failures)}`:''}`,signal);
        if(!requirements)break;
        const candidate=StoryGraphSchema.parse({...(graph??{schemaVersion:1,projectId,title:projectId}),nodes:[...nodes],endings:graph?.endings.filter(e=>nodes.some(n=>n.id===e.nodeId))??[]});
        const report=checkFilmRequirements(candidate,requirements);
        if(report.status==='checks_passed')break;
        failures=report.issues;
        if(attempt===2)throw Object.assign(new Error(JSON.stringify({code:'FILM_STRUCTURE_REQUIREMENTS_UNMET',issues:failures})),{code:'FILM_STRUCTURE_REQUIREMENTS_UNMET',issues:failures});
      }
      const removed=graph?.nodes.filter(n=>!nodes.some(next=>next.id===n.id)).map(n=>n.id)??[];
      const { graph: next, rev } = await applyGraphDelta({
        projectRoot,
        projectId,
        delta: { nodes: { upsert: [...nodes], remove: removed }, endings:{upsert:[],remove:graph?.endings.filter(e=>removed.includes(e.nodeId)).map(e=>e.id)??[]},notes: [] },
        phase: "structure",
      });
      return textResult(`Structure drafted: ${next.nodes.length} nodes (rev ${rev}).`, graphUpdatedDetails(rev, {
        skillIds: deps.skillIds?.() ?? [],
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// connect_choice — confirm-class: full StoryNode → buildConnectChoiceDelta → apply
// ---------------------------------------------------------------------------

const ConnectChoiceParams = Type.Object({
  nodeId: Type.Optional(Type.String({minLength:1,description:'Existing node whose connections should change; its scene and dialogue are preserved.'})),
  choices: Type.Optional(Type.Array(ChoiceToolSchema)),
  node: Type.Optional(Type.Composite([StoryNodeToolSchema], { description: "Full StoryNode for creating a node, or an existing full node with updated choices. Existing scene and dialogue are preserved." })),
});

export function createConnectChoiceTool(
  projectRoot: string,
  projectId: string,
): AgentTool<typeof ConnectChoiceParams> {
  return {
    name: "connect_choice",
    description: "interactive-film authoring: add or rewire a node's choices under the current Profile confirmation policy.",
    label: "Connect Choice",
    parameters: ConnectChoiceParams,
    async execute(_id, params: Static<typeof ConnectChoiceParams>) {
      const proposed = params.node === undefined ? undefined : StoryNodeSchema.parse(params.node);
      const nodeId=params.nodeId??proposed?.id;
      if(!nodeId)throw Object.assign(new Error('Supply nodeId with choices, or a full node'),{code:'NODE_REF_REQUIRED'});
      if(proposed&&params.nodeId&&proposed.id!==params.nodeId)throw Object.assign(new Error('Node references disagree'),{code:'NODE_REF_MISMATCH'});
      const current=(await loadStoryGraph(projectRoot,projectId))?.nodes.find(node=>node.id===nodeId);
      const suppliedChoices=params.choices??(params.node && typeof params.node==='object' && 'choices' in params.node ? proposed?.choices : undefined);
      if(current&&!suppliedChoices)throw Object.assign(new Error('Supply the updated choices'),{code:'CHOICES_REQUIRED'});
      const node=current?{...current,choices:suppliedChoices!}:proposed;
      if(!node)throw Object.assign(new Error('Node not found'),{code:'NODE_NOT_FOUND'});
      const { rev } = await applyGraphDelta({ projectRoot, projectId, delta: buildConnectChoiceDelta(node) });
      return textResult(`Choices updated on node ${node.id} (rev ${rev}).`, { kind: "graph_updated", rev });
    },
  };
}

// ---------------------------------------------------------------------------
// remove_node — versioned graph edit: nodeId → buildRemoveNodeDelta → apply
// ---------------------------------------------------------------------------

const RemoveNodeParams = Type.Object({
  nodeId: Type.String({ description: "node id to remove" }),
});

export function createRemoveNodeTool(
  projectRoot: string,
  projectId: string,
): AgentTool<typeof RemoveNodeParams> {
  return {
    name: "remove_node",
    description: "Remove a node and its incident choices from the current graph as a versioned edit. Earlier graph revisions remain available. Use to remove an unwanted or unreachable node, then inspect the resulting graph.",
    label: "Remove Node",
    parameters: RemoveNodeParams,
    async execute(_id, params: Static<typeof RemoveNodeParams>) {
      const { rev } = await applyGraphDelta({ projectRoot, projectId, delta: buildRemoveNodeDelta(params.nodeId) });
      return textResult(`Node ${params.nodeId} removed (rev ${rev}).`, { kind: "graph_updated", rev });
    },
  };
}

// ---------------------------------------------------------------------------
// generate_node_image
// ---------------------------------------------------------------------------

const GenerateNodeImageParams = Type.Object({
  nodeId: Type.String({ description: "the node to generate a shot image for (uses its imageSlot.prompt or sceneDesc)" }),
  size: Type.Optional(Type.Union([
    Type.Literal("1536x1024"),
    Type.Literal("1024x1536"),
    Type.Literal("1024x1024"),
  ], { description: "output image size; use 1536x1024 for landscape film frames, 1024x1536 for portrait, or 1024x1024 for square" })),
});

export function createGenerateNodeImageTool(projectRoot: string, projectId: string, deps?: NodeImageDeps): AgentTool<typeof GenerateNodeImageParams> {
  return {
    name: "generate_node_image",
    description: "interactive-film authoring: generate a shot image for a node (from its imageSlot.prompt or sceneDesc) and attach it. Applies immediately.",
    label: "Generate Node Image",
    parameters: GenerateNodeImageParams,
    async execute(_id, params: Static<typeof GenerateNodeImageParams>) {
      const graph = await loadStoryGraph(projectRoot, projectId);
      if (!graph) throw new Error(`interactive-film project ${projectId} has no story graph`);
      const node = graph.nodes.find((n) => n.id === params.nodeId);
      if (!node) throw new Error(`node ${params.nodeId} not found`);
      const imageDeps = deps ?? (await defaultNodeImageDeps(projectRoot));
      const { assetRef, delta } = await generateNodeImage({
        projectRoot,
        projectId,
        node,
        size: params.size,
        deps: imageDeps,
      });
      const { rev } = await applyGraphDelta({ projectRoot, projectId, delta });
      return textResult(`Generated image for node ${params.nodeId} (rev ${rev}).`, { kind: "graph_updated", rev, assetRef });
    },
  };
}

// ---------------------------------------------------------------------------
// Tool set selection + factory
// ---------------------------------------------------------------------------

/**
 * Returns the tool names that the interactive-film-authoring session should
 * provide given the current `confirmedIntent`.
 *
 * - No confirmed intent → versioned authoring tools + propose_action.
 * - Confirmed intent → exactly that one tool (already confirmed, execute it).
 */
export function buildFilmAuthoringToolNames(confirmedIntent: string | undefined): string[] {
  if (confirmedIntent === "draft_structure") return ["draft_structure"];
  if (confirmedIntent === "connect_choice") return ["connect_choice"];
  if (confirmedIntent === "remove_node") return ["remove_node"];
  return ["set_film_requirements","set_world_anchor", "upsert_characters", "add_variable", "define_ending", "draft_structure", "connect_choice", "remove_node", "fill_node", "revise_node", "inspect_story_graph", "export_interactive_film", "generate_node_image", "propose_action"];
}

/**
 * Instantiates the AgentTool objects for an interactive-film-authoring
 * session.  Keeps tool construction out of agent-session.ts so it can be
 * unit-tested independently.
 */
export function createFilmAuthoringTools(params: {
  readonly projectRoot: string;
  readonly projectId: string;
  readonly llm: FilmLLMDeps;
  readonly proposeActionTool?: AgentTool<any>;
  readonly confirmedIntent?: string;
  readonly language?: FilmAuthoringLanguage;
}): AgentTool<any>[] {
  const { projectRoot, projectId, llm } = params;
  const language = params.language ?? "zh";
  const names = buildFilmAuthoringToolNames(params.confirmedIntent);
  const byName: Record<string, () => AgentTool<any> | undefined> = {
    set_film_requirements:()=>createSetFilmRequirementsTool(projectRoot,projectId),
    set_world_anchor: () => createSetWorldAnchorTool(projectRoot, projectId),
    upsert_characters: () => createUpsertCharactersTool(projectRoot, projectId),
    add_variable: () => createAddVariableTool(projectRoot, projectId),
    define_ending: () => createDefineEndingTool(projectRoot, projectId),
    fill_node: () => createFillNodeTool(projectRoot, projectId, llm, language),
    revise_node: () => createReviseNodeTool(projectRoot, projectId, llm, language),
    generate_node_image: () => createGenerateNodeImageTool(projectRoot, projectId),
    draft_structure: () => createDraftStructureTool(projectRoot, projectId, llm, language),
    connect_choice: () => createConnectChoiceTool(projectRoot, projectId),
    remove_node: () => createRemoveNodeTool(projectRoot, projectId),
    inspect_story_graph: () => createInspectFilmTool(projectRoot,projectId),
    export_interactive_film: () => createExportFilmTool(projectRoot,projectId),
    propose_action: () => params.proposeActionTool,
  };
  return names.map((n) => byName[n]()).filter((tool): tool is AgentTool<any> => tool !== undefined);
}
