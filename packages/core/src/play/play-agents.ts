import { z } from "zod";
import { Type, type Static } from "@mariozechner/pi-ai";
import { BaseAgent, type AgentContext } from "../agents/base.js";
import {
  PlayActionIntentSchema,
  PlayMutationSchema,
  isPlayEvidenceEntityType,
  type PlayActionIntent,
  type PlayMutation,
} from "../models/play.js";

export interface PlayOpeningStateInput {
  readonly turn: number;
  readonly sceneText: string;
  readonly suggestedActions: readonly string[];
  readonly context: string;
  readonly language?: "zh" | "en";
  readonly worldPremise?: string;
}

export interface PlayTurnInput {
  readonly validateMutation?: (mutation:PlayMutation)=>void;
  readonly currentSuggestedActions?: readonly string[];
  readonly choiceCount?:number;
  readonly turn: number;
  readonly input: string;
  readonly context: string;
  readonly replayContext?: string;
  readonly mode: "open" | "guided";
  readonly language?: "zh" | "en";
  readonly worldPremise?: string;
}

const PlaySceneRenderSchema = z.object({
  sceneText: z.string().min(1),
  suggestedActions: z.array(z.string().min(1)),
}).strict();
export type PlaySceneRender = z.infer<typeof PlaySceneRenderSchema>;

export interface PlayTurnResult extends PlaySceneRender {
  readonly action: PlayActionIntent;
  readonly mutation: PlayMutation;
}

const PlayEntityResultSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  type: Type.Union([
    Type.Literal("actor"), Type.Literal("location"), Type.Literal("item"),
    Type.Literal("evidence"), Type.Literal("clue"), Type.Literal("claim"),
    Type.Literal("proof_chain"), Type.Literal("organization"), Type.Literal("rule"),
    Type.Literal("scene"), Type.Literal("event"),
  ]),
  label: Type.String(),
  summary: Type.String(),
  status: Type.Optional(Type.String({description:"Current entity status. Update it explicitly when an entity is consumed, disappears, or otherwise intentionally ceases to have a tracked physical placement."})),
});

const PlayEdgeResultSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  fromId: Type.String(),
  type: Type.String(),
  toId: Type.String(),
  value: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {description:"For a physical entity -> current location/container relationship, set role=placement. For holder -> held object, set role=holding. These stable roles identify physical placement independently of the free-form type label."})),
  visibility: Type.Optional(Type.Record(Type.String(), Type.String())),
  strength: Type.Optional(Type.Number()),
});

const PlayStateSlotResultSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  ownerEntityId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  kind: Type.Union([
    Type.Literal("resource"), Type.Literal("relation"), Type.Literal("pressure"),
    Type.Literal("clue"), Type.Literal("evidence"), Type.Literal("flag"), Type.Literal("timer"),
  ]),
  label: Type.String(),
  value: Type.Unknown(),
});

const PlayMutationResultSchema = Type.Object({
  summary: Type.String(),
  timeAdvance: Type.Optional(Type.Object({
    elapsed: Type.String(),
    anchor: Type.String(),
    rationale: Type.String(),
    synchronized: Type.Array(Type.String()),
  })),
  entities: Type.Array(PlayEntityResultSchema),
  edges: Type.Array(PlayEdgeResultSchema, {description:"Upsert every new or changed current relationship. Include resulting locations and holders after movement, release or return, even when the same relationship existed earlier. Historical existence does not make an expired edge current."}),
  expiredEdges: Type.Array(Type.Object({
    edgeId: Type.String(),
    reason: Type.String(),
  }), {description:"End relationships that no longer hold. Expiring the old location or holder does not establish the new one; include that resulting relationship in edges."}),
  stateSlots: Type.Array(PlayStateSlotResultSchema),
  evidenceTransitions: Type.Array(Type.Object({
    entityId: Type.String(),
    to: Type.Union([
      Type.Literal("unknown"), Type.Literal("hinted"), Type.Literal("seen"),
      Type.Literal("collected"), Type.Literal("verified"), Type.Literal("weaponized"),
      Type.Literal("exposed"), Type.Literal("exhausted"),
    ]),
    reason: Type.Optional(Type.String()),
  })),
  blocked: Type.Boolean(),
  blockedReason: Type.String(),
  notes: Type.Array(Type.String()),
});

function validateMutationSubmission(
  raw: Static<typeof PlayMutationResultSchema>,
): Static<typeof PlayMutationResultSchema> {
  const submittedTypes = new Map(raw.entities.map((entity) => [entity.id, entity.type]));
  for (const transition of raw.evidenceTransitions) {
    const submittedType = submittedTypes.get(transition.entityId);
    if (submittedType && !isPlayEvidenceEntityType(submittedType)) {
      throw new Error(
        `evidenceTransitions may reference only evidence, clue, claim, or proof_chain entities; ${transition.entityId} is ${submittedType}. `
        + "Use an evidentiary entity type for a physical clue, or remove its evidence transition.",
      );
    }
  }
  for (const edge of raw.edges) {
    const targetType = submittedTypes.get(edge.toId);
    if (
      edge.fromId === "actor_player"
      && edge.value?.role === "holding"
      && targetType
      && isPlayEvidenceEntityType(targetType)
      && edge.value.physical !== true
    ) {
      throw new Error(
        `Holding edge ${edge.id} targets physical ${targetType} ${edge.toId}; set value.physical=true.`,
      );
    }
  }
  return raw;
}

const PlayActionResultSchema = Type.Object({
  actionKind: Type.String({ minLength: 1, description: "A short descriptive label for the player's action. This records the action; it does not select a command or constrain what the player can do." }),
  targetEntityLabel: Type.Optional(Type.String()),
  targetLocationLabel: Type.Optional(Type.String()),
  intent: Type.String(),
  manner: Type.Optional(Type.String()),
  risk: Type.Optional(Type.String()),
  ambiguity: Type.Optional(Type.String()),
  secondaryActions: Type.Optional(Type.Array(Type.String())),
});

const OPENING_STATE_TOOL = {
  name: "submit_opening_state",
  label: "Submit opening state",
  description: "Submit the world facts already established by the supplied opening scene. Host-owned event metadata is omitted.",
  parameters: PlayMutationResultSchema,
  validate: validateMutationSubmission,
} as const;

function playTurnTool(mode: "open" | "guided",choiceCount?:number,validateMutation?: (mutation:PlayMutation)=>void,turn=0) {
  return {
    name: "submit_play_turn",
    label: "Submit play turn",
    description: mode === "open"
      ? "Submit one coherent open-world turn: interpreted action, authoritative state transition, and rendered scene."
      : "Submit one coherent guided turn: interpreted action, authoritative state transition, rendered scene, and optional grounded choices.",
    parameters: Type.Object({
      action: PlayActionResultSchema,
      mutation: PlayMutationResultSchema,
      sceneText: Type.String({ minLength: 1 }),
      suggestedActions: mode === "open"
        ? Type.Array(Type.String({ minLength: 1 }), { maxItems: 0 })
        : Type.Array(Type.String({ minLength: 1 }),{uniqueItems:true,...(choiceCount!==undefined?{minItems:choiceCount,maxItems:choiceCount}:{})}),
    }),
    validate: (result: {
      readonly action: Static<typeof PlayActionResultSchema>;
      readonly mutation: Static<typeof PlayMutationResultSchema>;
      readonly sceneText: string;
      readonly suggestedActions: string[];
    }) => {
      const mutation=validateMutationSubmission(result.mutation);
      const transition=mutationFromStructuredResult(mutation,turn,result.action.actionKind);
      if(!hasMutationResult(transition))throw Object.assign(new Error("Play turn state was empty; submit a concrete state transition before committing the turn."),{code:"PLAY_MUTATION_EMPTY"});
      validateMutation?.(transition);
      return {...result,mutation};
    },
  } as const;
}

export class PlayOpeningStateAgent extends BaseAgent {
  constructor(ctx: AgentContext) {
    super(ctx);
  }

  get name(): string {
    return "play-opening-state";
  }

  async extract(input: PlayOpeningStateInput): Promise<PlayMutation> {
    const language = input.language ?? "zh";
    const { result } = await this.submitStructured([
      { role: "system", content: buildOpeningStateSystemPrompt(language) },
      { role: "user", content: buildOpeningStateUserPrompt(input, language) },
    ], OPENING_STATE_TOOL, {  maxTokens: 4096 });
    const mutation = mutationFromStructuredResult(result, input.turn, "look");
    if (!hasMutationResult(mutation)) {
      throw new Error("Play opening state was empty; the world was not started.");
    }
    return mutation;
  }
}

export class PlayTurnAgent extends BaseAgent {
  constructor(ctx: AgentContext) {
    super(ctx);
  }

  get name(): string {
    return "play-turn";
  }

  async run(input: PlayTurnInput): Promise<PlayTurnResult> {
    const language = input.language ?? "zh";
    const { result } = await this.submitStructured([
      { role: "system", content: buildTurnSystemPrompt(input.mode, language) },
      { role: "user", content: buildTurnUserPrompt(input, language) },
    ], playTurnTool(input.mode,input.choiceCount,input.validateMutation,input.turn), {  maxTokens: 8192 });
    const action = PlayActionIntentSchema.parse(result.action);
    const mutation = mutationFromStructuredResult(result.mutation, input.turn, action.actionKind);
    if (!hasMutationResult(mutation)) {
      throw new Error("Play turn state was empty; the turn was not committed.");
    }
    const scene = PlaySceneRenderSchema.parse({
      sceneText: result.sceneText,
      suggestedActions: result.suggestedActions,
    });
    return { ...scene, action, mutation };
  }

  async renderExisting(input: PlayTurnInput): Promise<PlaySceneRender> {
    const preserveChoices = input.currentSuggestedActions !== undefined;
    const { result } = await this.submitStructured([
      { role: "system", content: "Rewrite the supplied scene while preserving every established action, fact, count, time, identity and outcome. This is the settled scene after the previous action, not a new player turn. Current state and original scene are authoritative. " + (preserveChoices ? "Return only narrative sceneText. Keep the supplied choices possible; their labels are separate interface elements, so do not append the choice list to sceneText." : "Return narrative sceneText and grounded suggestedActions as separate fields; do not append the choice list to sceneText.") + " Do not invent or change world facts." },
      { role: "user", content: JSON.stringify({turn:input.turn,language:input.language??"zh",worldContract:input.worldPremise,
        settledContextAndScene:input.context,previousPlayerAction:input.input,rewriteRequest:input.replayContext,
        ...(preserveChoices?{unchangedSuggestedActions:input.currentSuggestedActions}:{})}) },
    ], {
      name: "submit_play_scene",
      label: "Submit rewritten scene",
      description: "Rewrite the existing scene without changing the applied world state.",
      parameters: preserveChoices ? Type.Object({ sceneText: Type.String({ minLength: 1 }) }, { additionalProperties: false }) : Type.Object({
        sceneText: Type.String({ minLength: 1 }),
        suggestedActions: Type.Array(Type.String({ minLength: 1 }), input.mode === "open" ? { maxItems: 0 } : {uniqueItems:true,...(input.choiceCount!==undefined?{minItems:input.choiceCount,maxItems:input.choiceCount}:{})}),
      }),
      validate: (value) => preserveChoices ? value : PlaySceneRenderSchema.parse(value),
    }, {  maxTokens: 4096 });
    return PlaySceneRenderSchema.parse({ sceneText: result.sceneText, suggestedActions: input.currentSuggestedActions ?? ("suggestedActions" in result ? result.suggestedActions : []) });
  }
}

function mutationFromStructuredResult(
  raw: Static<typeof PlayMutationResultSchema>,
  turn: number,
  actionKind: PlayActionIntent["actionKind"],
): PlayMutation {
  const eventId = `evt-${turn}`;
  const entities = raw.entities.map((entity) => ({
        ...(entity as Record<string, unknown>),
        createdEventId: eventId,
        updatedEventId: eventId,
      }));
  const edges = raw.edges.map((edge) => ({
        ...(edge as Record<string, unknown>),
        validFromEventId: eventId,
        validUntilEventId: null,
        sourceEventId: eventId,
      }));
  const stateSlots = raw.stateSlots.map((slot) => ({
        ...(slot as Record<string, unknown>),
        updatedEventId: eventId,
      }));

  return PlayMutationSchema.parse({
    eventId,
    turn,
    actionKind,
    summary: raw.summary,
    timeAdvance: raw.timeAdvance,
    entities: { upsert: entities },
    edges: {
      upsert: edges,
      expire: raw.expiredEdges.map((edge) => ({
        ...(edge as Record<string, unknown>),
        validUntilEventId: eventId,
      })),
    },
    stateSlots: { upsert: stateSlots },
    evidence: { transitions: raw.evidenceTransitions },
    blocked: raw.blocked,
    blockedReason: raw.blockedReason,
    notes: raw.notes,
  });
}

function hasMutationResult(mutation: PlayMutation): boolean {
  return mutation.blocked
    || Boolean(mutation.summary.trim())
    || Boolean(mutation.timeAdvance)
    || mutation.entities.upsert.length > 0
    || mutation.edges.upsert.length > 0
    || mutation.edges.expire.length > 0
    || mutation.stateSlots.upsert.length > 0
    || mutation.evidence.transitions.length > 0
    || mutation.notes.length > 0;
}

function buildOpeningStateSystemPrompt(language: "zh" | "en"): string {
  return language === "en"
    ? [
        "Extract the authoritative world state already established by the supplied opening scene and world contract.",
        "Do not rewrite the scene or add facts. Always create actor_player and the concrete people, places, objects, clues, and relationships needed to make the opening playable.",
        "Reuse stable readable ids. Physical placement points from entity to location/container with value.role=placement. Physical holdings point from holder to object with value.role=holding; knowledge is observed rather than held.",
        "Submit only the opening mutation. The host owns eventId, turn, and actionKind.",
      ].join("\n")
    : [
        "从给定开场正文和世界契约中提取已经成立的权威世界状态。",
        "不要改写开场，也不要添加正文没有的事实。必须建立 actor_player，以及让开场可玩的具体人物、地点、物件、线索和关系。",
        "使用稳定可读的 id。物理位置使用实体指向地点/容器且 value.role=placement；实际持有使用持有人指向物件且 value.role=holding。知道的信息属于 observed，不是 holding。",
        "只提交开场 mutation；eventId、turn、actionKind 由宿主负责。",
      ].join("\n");
}

function buildOpeningStateUserPrompt(input: PlayOpeningStateInput, language: "zh" | "en"): string {
  const premise = input.worldPremise?.trim();
  return language === "en"
    ? [
        `turn: ${input.turn}`,
        ...(premise ? ["World contract:", premise, ""] : []),
        "Opening scene:",
        input.sceneText,
        ...(input.suggestedActions.length > 0 ? ["", "Opening choices:", ...input.suggestedActions.map((action) => `- ${action}`)] : []),
        "",
        "Current context:",
        input.context,
      ].join("\n")
    : [
        `turn: ${input.turn}`,
        ...(premise ? ["世界契约：", premise, ""] : []),
        "开场正文：",
        input.sceneText,
        ...(input.suggestedActions.length > 0 ? ["", "开场选择：", ...input.suggestedActions.map((action) => `- ${action}`)] : []),
        "",
        "当前上下文：",
        input.context,
      ].join("\n");
}

function buildTurnSystemPrompt(mode: "open" | "guided", language: "zh" | "en"): string {
  const choiceRule = language === "en"
    ? mode === "open"
      ? "The open-world surface has no suggestedActions; submit an empty array."
      : "Use suggestedActions only for sparse, grounded choices at a genuine decision point."
    : mode === "open"
      ? "开放世界不提供 suggestedActions，必须提交空数组。"
      : "只在真实抉择点提供少量、基于当前场景的 suggestedActions。";
  return language === "en"
    ? [
        "Apply the activated play-world Skill and resolve one coherent interactive-fiction turn.",
        "In one submission, normalize the player's literal action, project the authoritative world mutation, and render the resulting scene. The prose and mutation must describe the same facts.",
        "Current active relationships and state slots take precedence over the opening premise and older entity descriptions. Check the actual holder, location and completed obligations before writing dialogue or choices. Do not restore a completed handover or payment merely because the opening described it as pending; another transfer requires a new supported action. Update an entity description when this turn makes its mutable facts obsolete.",
        "Reuse exact roster ids. The player id is always actor_player. Every concrete named person, place, object, clue, evidence item, organization, or relationship introduced in sceneText must exist in mutation or the supplied context.",
        "Physical placements point from entity to location/container with value.role=placement. Physical holdings point from holder to object with value.role=holding; when the held target is evidence, clue, claim, or proof_chain, also set value.physical=true. Knowledge is observed rather than held. Use stateSlots only when the world contract authorizes that tracking.",
        "Only evidence, clue, claim, and proof_chain entities may appear in evidenceTransitions. A tangible object that participates in an evidence lifecycle must use an evidentiary entity type rather than item.",
        "Record elapsed duration, resulting time anchor, rationale, and synchronized off-screen changes in timeAdvance. If the action cannot proceed, set blocked and render the grounded consequence.",
        choiceRule,
        "The host commits the whole submission atomically and owns event metadata.",
      ].join("\n")
    : [
        "应用已激活的开放世界 Skill，完成一个前后一致的互动叙事回合。",
        "一次提交中同时归一玩家原话、投影权威世界变化并写出结果场景；正文与 mutation 必须描述同一组事实。",
        "当前有效关系和状态槽优先于开场前提及较早的实体描述。写对白和选项前核对实际持有人、位置和已完成事项；不能因为开场曾要求归还或付款，就把已完成交接或付款重新当作待办。再次转移必须有新的实际动作支持。本回合让实体描述中的可变事实过时时，同时更新该实体描述。",
        "复用名册精确 id，玩家 id 永远是 actor_player。sceneText 中新增的具体具名人物、地点、物件、线索、证据、组织或关系，必须已经存在于 mutation 或给定上下文。",
        "物理位置使用实体指向地点/容器且 value.role=placement；实际持有使用持有人指向物件且 value.role=holding。持有的目标若是 evidence、clue、claim、proof_chain，还必须设置 value.physical=true。知道的信息属于 observed，不是 holding。只有世界契约允许时才使用 stateSlots。",
        "只有 evidence、clue、claim、proof_chain 实体可以进入 evidenceTransitions；需要证据生命周期的实物必须使用证据类实体类型，不能同时标成普通 item。",
        "在 timeAdvance 中记录经过时长、结束时间锚、理由和同期世界变化。动作无法执行时设置 blocked，并写出符合当前状态的结果。",
        choiceRule,
        "宿主原子提交整个结果，并负责事件元数据。",
      ].join("\n");
}

function buildTurnUserPrompt(input: PlayTurnInput, language: "zh" | "en"): string {
  const premise = input.worldPremise?.trim();
  return language === "en"
    ? [
        `turn: ${input.turn}`,
        ...(premise ? ["World contract:", premise, ""] : []),
        "Authoritative context before this turn:",
        input.context,
        "",
        "Player's words:",
        input.input,
        input.replayContext ? ["", "Replay constraints:", input.replayContext].join("\n") : "",
      ].join("\n")
    : [
        `turn: ${input.turn}`,
        ...(premise ? ["世界契约：", premise, ""] : []),
        "本回合前的权威上下文：",
        input.context,
        "",
        "玩家原话：",
        input.input,
        input.replayContext ? ["", "重写约束：", input.replayContext].join("\n") : "",
      ].join("\n");
}
