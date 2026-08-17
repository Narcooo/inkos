import { z } from "zod";
import { Type } from "@mariozechner/pi-ai";
import { BaseAgent, type AgentContext } from "../agents/base.js";
import {
  PlayActionIntentSchema,
  PlayMutationSchema,
  type PlayActionIntent,
  type PlayActionIntentInput,
  type PlayMutation,
  type PlayMutationInput,
} from "../models/play.js";
import { appendPromptPackGuidance } from "../prompts/prompt-pack.js";

export interface PlayActionInterpreterInput {
  readonly input: string;
  readonly sceneBrief: string;
  readonly language?: "zh" | "en";
}

export interface PlayWorldMutatorInput {
  readonly turn: number;
  readonly input: string;
  readonly action: PlayActionIntentInput;
  readonly context: string;
  readonly language?: "zh" | "en";
}

export interface PlaySceneRenderInput {
  readonly input: string;
  readonly action: PlayActionIntentInput;
  readonly context?: string;
  readonly mutationSummary: string;
  readonly stateBrief: string;
  readonly replayContext?: string;
  readonly language?: "zh" | "en";
  // The world's premise — a persistent anchor so the scene stays in the
  // established era/setting/genre and doesn't drift (a modern shop must not grow
  // night-watchmen and oil lamps).
  readonly worldPremise?: string;
}

export interface PlaySceneReconcileInput {
  readonly turn: number;
  readonly input: string;
  readonly action: PlayActionIntentInput;
  readonly mutation: PlayMutationInput;
  readonly sceneText: string;
  readonly context: string;
  readonly stateBrief: string;
  readonly language?: "zh" | "en";
  readonly worldPremise?: string;
}

const PlaySceneRenderSchema = z.object({
  sceneText: z.string().min(1),
  suggestedActions: z.array(z.string().min(1)).min(0).max(4).default([]),
});
export type PlaySceneRender = z.infer<typeof PlaySceneRenderSchema>;

const PlayEntityResultSchema = Type.Object({
  id: Type.Optional(Type.String()),
  type: Type.Union([
    Type.Literal("actor"), Type.Literal("location"), Type.Literal("item"),
    Type.Literal("evidence"), Type.Literal("clue"), Type.Literal("claim"),
    Type.Literal("proof_chain"), Type.Literal("organization"), Type.Literal("rule"),
    Type.Literal("scene"), Type.Literal("event"),
  ]),
  label: Type.String(),
  summary: Type.Optional(Type.String()),
  status: Type.Optional(Type.String()),
});

const PlayEdgeResultSchema = Type.Object({
  id: Type.Optional(Type.String()),
  fromId: Type.String(),
  type: Type.String(),
  toId: Type.String(),
  value: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  visibility: Type.Optional(Type.Record(Type.String(), Type.String())),
  strength: Type.Optional(Type.Number()),
  confidence: Type.Optional(Type.Number()),
});

const PlayStateSlotResultSchema = Type.Object({
  id: Type.Optional(Type.String()),
  ownerEntityId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  kind: Type.Union([
    Type.Literal("resource"), Type.Literal("relation"), Type.Literal("pressure"),
    Type.Literal("clue"), Type.Literal("evidence"), Type.Literal("flag"), Type.Literal("timer"),
  ]),
  label: Type.String(),
  value: Type.Unknown(),
});

const PlayMutationResultSchema = Type.Object({
  summary: Type.Optional(Type.String()),
  timeAdvance: Type.Optional(Type.Object({
    elapsed: Type.String(),
    anchor: Type.Optional(Type.String()),
    rationale: Type.Optional(Type.String()),
    synchronized: Type.Optional(Type.Array(Type.String())),
  })),
  entities: Type.Optional(Type.Array(PlayEntityResultSchema)),
  edges: Type.Optional(Type.Array(PlayEdgeResultSchema)),
  expiredEdges: Type.Optional(Type.Array(Type.Object({
    edgeId: Type.String(),
    reason: Type.Optional(Type.String()),
  }))),
  stateSlots: Type.Optional(Type.Array(PlayStateSlotResultSchema)),
  evidenceTransitions: Type.Optional(Type.Array(Type.Object({
    entityId: Type.String(),
    from: Type.Optional(Type.Union([
      Type.Literal("unknown"), Type.Literal("hinted"), Type.Literal("seen"),
      Type.Literal("collected"), Type.Literal("verified"), Type.Literal("weaponized"),
      Type.Literal("exposed"), Type.Literal("exhausted"),
    ])),
    to: Type.Union([
      Type.Literal("unknown"), Type.Literal("hinted"), Type.Literal("seen"),
      Type.Literal("collected"), Type.Literal("verified"), Type.Literal("weaponized"),
      Type.Literal("exposed"), Type.Literal("exhausted"),
    ]),
    reason: Type.Optional(Type.String()),
  }))),
  blocked: Type.Optional(Type.Boolean()),
  blockedReason: Type.Optional(Type.String()),
  notes: Type.Optional(Type.Array(Type.String())),
});

const WORLD_MUTATION_TOOL = {
  name: "submit_world_mutation",
  label: "Submit world mutation",
  description: "Submit the complete world-state transition caused by this action. Host-owned event metadata is intentionally omitted.",
  parameters: PlayMutationResultSchema,
} as const;

const GRAPH_RECONCILIATION_TOOL = {
  name: "submit_graph_reconciliation",
  label: "Submit graph reconciliation",
  description: "Submit only graph facts present in the rendered scene but missing from the applied mutation. Submit empty arrays when nothing is missing.",
  parameters: PlayMutationResultSchema,
} as const;

const PLAY_SCENE_RENDER_TOOL = {
  name: "submit_play_scene",
  label: "Submit play scene",
  description: "Submit the rendered scene and up to four immediate player actions grounded in the applied world state.",
  parameters: Type.Object({
    sceneText: Type.String({ minLength: 1 }),
    suggestedActions: Type.Array(Type.String({ minLength: 1 }), { maxItems: 4 }),
  }),
} as const;

// A play turn runs three internal LLM calls (interpret → mutate → render). The
// transport-level retry in the provider does NOT cover HTTP 502/503/429 or
// "temporarily unavailable", so a single flaky upstream response would break the
// whole turn. Retry those here; each agent then applies its own safe failure policy.
function isRetryableLlmError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return /50[0-9]|429|temporarily unavailable|timeout|timed out|socket|terminated|econn|network|fetch failed|bad gateway|service unavailable|rate limit/.test(msg);
}

async function chatWithRetry<T>(call: () => Promise<T>, retries = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await call();
    } catch (err) {
      lastErr = err;
      if (attempt >= retries || !isRetryableLlmError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

export class PlayActionInterpreterAgent extends BaseAgent {
  constructor(ctx: AgentContext) {
    super(ctx);
  }

  get name(): string {
    return "play-action-interpreter";
  }

  async interpret(input: PlayActionInterpreterInput): Promise<PlayActionIntent> {
    // Never throw: a transient upstream error (after retries) or unparseable output
    // degrades to a generic action (the player's raw text as a "do"), not a crash.
    let raw: unknown = {};
    try {
      const response = await chatWithRetry(() => this.chat([
        { role: "system", content: buildActionInterpreterSystemPrompt(input.language ?? "zh") },
        { role: "user", content: buildActionInterpreterUserPrompt(input, input.language ?? "zh") },
      ], { temperature: 0.15, maxTokens: 1024 }));
      raw = parseJson(response.content);
    } catch { /* transient/malformed → degrade below */ }
    const parsed = PlayActionIntentSchema.safeParse(raw);
    return parsed.success
      ? parsed.data
      : PlayActionIntentSchema.parse({ actionKind: "do", intent: input.input });
  }
}

export class PlayWorldMutatorAgent extends BaseAgent {
  constructor(ctx: AgentContext) {
    super(ctx);
  }

  get name(): string {
    return "play-world-mutator";
  }

  async proposeMutation(input: PlayWorldMutatorInput): Promise<PlayMutation> {
    const language = input.language ?? "zh";
    const actionKind = PlayActionIntentSchema.parse(input.action).actionKind;
    const systemPrompt = await appendPromptPackGuidance(
      buildWorldMutatorSystemPrompt(language),
      { promptId: "play.mutator", projectRoot: this.ctx.projectRoot },
    );
    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: buildWorldMutatorUserPrompt(input, language) },
    ];

    // Empty output cannot count as a completed turn: otherwise prose advances
    // while the canonical graph stays frozen. Give the model one repair turn,
    // then expose a blocked no-op instead of silently splitting state and prose.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await chatWithRetry(() => this.submitStructured(
          messages,
          WORLD_MUTATION_TOOL,
          { temperature: 0.25, maxTokens: 4096 },
        ));
        const mutation = mutationFromStructuredResult(raw, input.turn, actionKind);
        logDroppedMutationItems(raw, mutation, input.turn);
        if (hasMutationResult(mutation)) return mutation;
      } catch {
        // One operation-level retry below. Transport retries remain in the Pi harness.
      }
      if (attempt === 0) {
        messages.push({
          role: "user",
          content: language === "en"
            ? "No usable world result was submitted. Call submit_world_mutation with a summary and the concrete state, entity, relationship, or time changes. If the action cannot proceed, submit blocked=true with blockedReason."
            : "刚才没有提交可用的世界结算。调用 submit_world_mutation，写明 summary 和具体的状态、实体、关系或时间变化；动作不能执行时提交 blocked=true 与 blockedReason。",
        });
      }
    }

    return withHostMutationIdentity(PlayMutationSchema.parse({
      blocked: true,
      blockedReason: language === "en"
        ? "The model did not return a usable world-state transition. This turn did not advance."
        : "模型没有返回可用的世界状态变更，本回合未推进。",
    }), input.turn, actionKind);
  }
}

function mutationFromStructuredResult(
  raw: Record<string, unknown>,
  turn: number,
  actionKind: PlayActionIntent["actionKind"],
): PlayMutation {
  return withHostMutationIdentity(PlayMutationSchema.parse({
    summary: raw.summary,
    timeAdvance: raw.timeAdvance,
    entities: { upsert: raw.entities },
    edges: {
      upsert: raw.edges,
      expire: Array.isArray(raw.expiredEdges)
        ? raw.expiredEdges.map((edge) => ({
            ...(edge as Record<string, unknown>),
            validUntilEventId: `evt-${turn}`,
          }))
        : [],
    },
    stateSlots: { upsert: raw.stateSlots },
    evidence: { transitions: raw.evidenceTransitions },
    blocked: raw.blocked,
    blockedReason: raw.blockedReason,
    notes: raw.notes,
  }), turn, actionKind);
}

function withHostMutationIdentity(
  mutation: PlayMutation,
  turn: number,
  actionKind: PlayActionIntent["actionKind"],
): PlayMutation {
  return PlayMutationSchema.parse({
    ...mutation,
    eventId: `evt-${turn}`,
    turn,
    actionKind,
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

function rawUpsertCount(field: unknown): number {
  if (Array.isArray(field)) return field.length;
  if (field && typeof field === "object" && Array.isArray((field as { upsert?: unknown }).upsert)) {
    return (field as { upsert: unknown[] }).upsert.length;
  }
  return 0;
}

function logDroppedMutationItems(raw: unknown, mutation: PlayMutation, turn: number): void {
  if (!raw || typeof raw !== "object") return;
  const r = raw as Record<string, unknown>;
  const rawE = rawUpsertCount(r.entities);
  const rawEd = rawUpsertCount(r.edges);
  const rawS = rawUpsertCount(r.stateSlots);
  const keptE = mutation.entities.upsert.length;
  const keptEd = mutation.edges.upsert.length;
  const keptS = mutation.stateSlots.upsert.length;
  if (rawE > keptE || rawEd > keptEd || rawS > keptS) {
    // eslint-disable-next-line no-console -- intentional degradation observability
    console.warn(
      `[play-mutator] turn ${turn}: dropped malformed items — entities ${rawE}->${keptE}, edges ${rawEd}->${keptEd}, slots ${rawS}->${keptS}`,
    );
  }
}

export class PlaySceneRendererAgent extends BaseAgent {
  constructor(ctx: AgentContext) {
    super(ctx);
  }

  get name(): string {
    return "play-scene-renderer";
  }

  async render(input: PlaySceneRenderInput & { readonly mode?: "open" | "guided" }): Promise<PlaySceneRender> {
    const language = input.language ?? "zh";
    const systemPrompt = await appendPromptPackGuidance(
      buildSceneRendererSystemPrompt(input.mode ?? "open", language),
      { promptId: "play.renderer", projectRoot: this.ctx.projectRoot },
    );
    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: buildSceneRendererUserPrompt(input, language) },
    ];
    const raw = await chatWithRetry(() => this.submitStructured(
      messages,
      PLAY_SCENE_RENDER_TOOL,
      { temperature: 0.45, maxTokens: 4096 },
    ));
    return PlaySceneRenderSchema.parse(raw);
  }
}

export class PlaySceneReconcilerAgent extends BaseAgent {
  constructor(ctx: AgentContext) {
    super(ctx);
  }

  get name(): string {
    return "play-scene-reconciler";
  }

  async reconcile(input: PlaySceneReconcileInput): Promise<PlayMutationInput> {
    const language = input.language ?? "zh";
    const eventId = `evt-${input.turn}`;
    const actionKind = PlayActionIntentSchema.parse(input.action).actionKind;
    const empty = emptyReconciliation(input.turn, actionKind);
    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: buildSceneReconcilerSystemPrompt(language) },
      { role: "user", content: buildSceneReconcilerUserPrompt(input, language) },
    ];
    try {
      const raw = await chatWithRetry(() => this.submitStructured(
        messages,
        GRAPH_RECONCILIATION_TOOL,
        { temperature: 0.1, maxTokens: 2048 },
      ));
      return mutationFromStructuredResult(raw, input.turn, actionKind);
    } catch {
      return empty;
    }
  }
}

function emptyReconciliation(turn: number, actionKind: PlayActionIntent["actionKind"]): PlayMutationInput {
  return {
    eventId: `evt-${turn}`,
    turn,
    actionKind,
    summary: "",
    entities: { upsert: [] },
    edges: { upsert: [], expire: [] },
    stateSlots: { upsert: [] },
    evidence: { transitions: [] },
    blocked: false,
    blockedReason: "",
    notes: [],
  };
}

function buildSceneReconcilerSystemPrompt(language: "zh" | "en"): string {
  if (language === "en") {
    return [
      "You reconcile an interactive-fiction scene with the world graph.",
      "Compare the rendered prose against the already applied changes and current state summary.",
      "If the prose introduced a concrete named object, clue, evidence, location, organization, or person that is not represented in the applied changes/current state, submit ONLY those missing graph facts.",
      "Do not rewrite prose. Do not invent facts that are not in the rendered scene. If nothing is missing, submit empty arrays.",
      "Use the same eventId/turn/actionKind. For tangible things the player now physically holds, add a holding edge from actor_player with value.role=\"holding\"; if the target is evidence/clue/claim/proof_chain rather than an item, also set value.physical=true. Observed phenomena or learned facts are not holdings.",
      "Call submit_graph_reconciliation once. The host supplies eventId, turn, and actionKind.",
    ].join("\n");
  }
  return [
    "你负责把互动小说正文和世界图谱对齐。",
    "对照已经应用的本回合变化、当前状态摘要和最终正文。",
    "如果正文里出现了具体且具名的新物件、线索、证据、地点、组织或人物，但它还没有体现在已应用变化/当前状态里，只提交这些缺失图谱事实。",
    "不要改正文，不要发明正文没有的事实。没有缺失就提交空数组。",
    "沿用同一个 eventId/turn/actionKind。玩家获得或拿在手里的实物，需要补一条 actor_player 指向该实体、value.role=\"holding\" 的 edge；如果目标是 evidence/clue/claim/proof_chain 而不是 item，还要设置 value.physical=true。观察到的现象或知道的信息不是持有物。",
    "调用一次 submit_graph_reconciliation；eventId、turn、actionKind 由宿主补入。",
  ].join("\n");
}

function buildSceneReconcilerUserPrompt(input: PlaySceneReconcileInput, language: "zh" | "en"): string {
  const actionKind = PlayActionIntentSchema.parse(input.action).actionKind;
  const eventId = `evt-${input.turn}`;
  if (language === "en") {
    return [
      `eventId: ${eventId}`,
      `turn: ${input.turn}`,
      `actionKind: ${actionKind}`,
      "",
      ...(input.worldPremise ? ["World setting:", input.worldPremise, ""] : []),
      "Player input:",
      input.input,
      "",
      "Current context before this turn:",
      input.context,
      "",
      "Applied mutation:",
      JSON.stringify(PlayMutationSchema.parse(input.mutation), null, 2),
      "",
      "Current state summary:",
      input.stateBrief,
      "",
      "Rendered scene:",
      input.sceneText,
    ].join("\n");
  }
  return [
    `eventId: ${eventId}`,
    `turn: ${input.turn}`,
    `actionKind: ${actionKind}`,
    "",
    ...(input.worldPremise ? ["世界设定：", input.worldPremise, ""] : []),
    "玩家输入：",
    input.input,
    "",
    "本回合前的当前上下文：",
    input.context,
    "",
    "已应用 mutation：",
    JSON.stringify(PlayMutationSchema.parse(input.mutation), null, 2),
    "",
    "当前状态摘要：",
    input.stateBrief,
    "",
    "最终正文：",
    input.sceneText,
  ].join("\n");
}

function buildActionInterpreterSystemPrompt(language: "zh" | "en"): string {
  if (language === "en") {
    return [
      "You are an interactive-fiction action interpreter.",
      "Your job is to normalize one line of the player's natural language into one of five action kinds: look / say / move / do / wait.",
      "Do not add drama for the player, do not advance the plot, do not write scene prose.",
      "look = observe/examine/recall a clue; say = speak/probe/confront; move = move to a location; do = perform an action/use an item/investigate; wait = wait/stall/watch.",
      "Output strict JSON, no explanation.",
    ].join("\n");
  }
  return [
    "你是互动小说动作理解器。",
    "你的任务是把玩家一句自然语言，归一成五类动作之一：look / say / move / do / wait。",
    "不要替玩家加戏，不要直接推进剧情，不要写场景正文。",
    "look=观察/检查/回忆线索；say=说话/试探/质问；move=移动到地点；do=执行动作/使用物品/调查；wait=等待/拖延/旁观。",
    "输出严格 JSON，不要解释。",
  ].join("\n");
}

function buildActionInterpreterUserPrompt(input: PlayActionInterpreterInput, language: "zh" | "en"): string {
  if (language === "en") {
    return [
      "Current scene:",
      input.sceneBrief,
      "",
      "Player input:",
      input.input,
      "",
      "Output fields: actionKind, targetEntityLabel?, targetLocationLabel?, intent, manner, risk, ambiguity, secondaryActions.",
    ].join("\n");
  }
  return [
    "当前场景：",
    input.sceneBrief,
    "",
    "玩家输入：",
    input.input,
    "",
    "输出字段：actionKind, targetEntityLabel?, targetLocationLabel?, intent, manner, risk, ambiguity, secondaryActions。",
  ].join("\n");
}

function buildWorldMutatorSystemPrompt(language: "zh" | "en"): string {
  if (language === "en") {
    return [
      "You are an interactive-fiction world-state drafter.",
      "Based only on the player's action and the current context, propose this turn's possible state changes as a draft.",
      "Do not write final prose; do not commit to the store on the reducer's behalf; do not let key states jump to completion out of nowhere.",
      "This engine is genre-neutral: romance, adventure, wuxia, mystery, slice-of-life all use the same structure. Entity types: actor/location/item/evidence/clue/claim/proof_chain/organization/rule/scene/event — use as needed.",
      "Give every new or important entity a one-line summary (who/what it is and why it matters), not just a status word — the player expands this summary in the side panel.",
      "Tangible things the player discovers or holds (a clue, a document, a weapon, a token, key evidence) MUST be their own entity (item/evidence/clue), never folded into a person's status — only then can they enter the player's holdings and be tracked. Observed phenomena, knowledge, impressions, or environmental signs are NOT holdings.",
      "Use entity.status to record state progress for any genre, with status words suited to this world's genre, advancing step by step without skipping (e.g. relationship: stranger -> curious -> attracted -> lover; injury: healthy -> bleeding -> critical; clue: found -> collected -> confirmed).",
      "The player entity id is fixed: always use id actor_player for the player character. Never rename this id; only replace its label, summary, and status with this world's player identity.",
      "Whenever a meaningful relationship forms or shifts between entities (ally / rival / kin / suspicion / debt / master-servant …), record it in edges.upsert as {\"fromId\":\"<entity>\",\"type\":\"<relation>\",\"toId\":\"<entity>\",\"value\":{\"role\":\"relation\"}} — this is the ONLY source for the relationship panel, so over-record rather than skip; add a fresh edge when a relationship changes.",
      "When the player physically holds/carries/keeps/takes a tangible thing, record an edge from actor_player to that entity and set value.role=\"holding\". If the held target is evidence/clue/claim/proof_chain rather than an item, also set value.physical=true. If the player only observes or learns something, use value.role=\"observed\" or a normal relation, never holding.",
      "The current context may include an entity roster. Reuse those exact ids in entities, edges, evidence, and stateSlots. If you only know a name, use the exact roster label; never invent a new id for the same person/thing (or the panel shows duplicates).",
      "State tracking is optional and governed by the user's world contract. If the world contract rejects stats, numeric panels, levels, RPG framing, or quantified meters, do NOT output stateSlots; express progress as natural-language entity.status / summary / evidence transitions instead.",
      "When stateSlots are appropriate, prefer natural-language values unless the user explicitly asked for quantitative tracking or the fiction contains a concrete count/clock/deadline. Do not create numbers just because the schema supports them.",
      "Early on (the first few turns), seed only the state the premise already establishes: a concrete deadline may become a timer slot if the world permits quantified tracking; the central mystery/objective -> its first clue/evidence entity; already-named key characters -> actor entities with a one-line summary. Don't leave the opening world nearly empty.",
      "Restraint: only create entities and meters the story actually makes real — never invent gratuitous stats or items just to fill the panel.",
      "Only use evidence.transitions for the evidence lifecycle when this world is genuinely an investigation/mystery; otherwise leave it empty.",
      "If the player's action is invalid or information is insufficient, set blocked=true and write blockedReason.",
      "Time is a synchronization axis, not a fixed tick. For every non-opening turn, set timeAdvance with: elapsed = the natural-language duration spent by this action; anchor = the world time/phase after the action if the world has a clock, season, phase, day/night, retreat period, deadline, or other temporal anchor; rationale = why this duration is right; synchronized = what relevant NPCs/places/pressures changed during the same elapsed time. A glance may pass seconds, a trip half a day, cultivation three years — obey the user's world contract; never invent a universal turn length.",
      "Call submit_world_mutation once with summary, timeAdvance, entities, edges, stateSlots, evidenceTransitions, blocked, blockedReason, and notes. The host supplies eventId, turn, and actionKind.",
    ].join("\n");
  }
  return [
    "你是互动小说世界状态草案员。",
    "你只根据玩家动作和当前上下文，提出本回合可能发生的状态变化草案。",
    "不要写最终正文；不要越权替 reducer 落库；不要凭空让关键状态一步到位。",
    "这套引擎是品类中立的：恋情、冒险、武侠、悬疑、日常等都用同一套结构表达。实体类型用 actor/location/item/evidence/clue/claim/proof_chain/organization/rule/scene/event，按需选用。",
    "给每个新出现或重要的实体写一句 summary（他是谁/这是什么、为什么重要），不要只靠 status 一句话——玩家会在侧栏里展开看这条 summary。",
    "玩家发现或获得的「实物」（线索、文件、凶器、信物、关键证据等）必须建成独立实体（item/evidence/clue），不要塞进某个人物的 status——这样它们才能进入玩家的「持有物」并被追踪。观察到的现象、知识、印象、环境征兆不是持有物。",
    "用 entity.status 记录任意品类的状态推进，状态词按这个世界的题材自定，循序渐进、不要跳级（例如关系：陌生→好奇→心动→恋人；伤势：健康→流血→重伤；线索：发现→收集→坐实）。",
    "玩家本人实体 id 是固定保留字：必须始终用 actor_player。绝不要把它改成本局名字或别的 id；只替换 label、summary、status 为本局玩家身份。",
    "人物之间（或人物与组织/地点之间）一旦形成或改变有意义的关系（盟友/敌对/亲属/怀疑/欠债/上下级/师徒等），就在 edges.upsert 里记一条 {\"fromId\":\"<实体>\",\"type\":\"<关系词>\",\"toId\":\"<实体>\",\"value\":{\"role\":\"relation\"}}——这是侧栏「关系网」的唯一来源，宁可多记勿漏；关系一旦变化（如怀疑→敌对）也补一条新边。",
    "玩家实际持有/携带/收进包里/拿走某个实物时，必须记一条 actor_player 指向该实体的 edge，并设置 value.role=\"holding\"。如果目标是 evidence/clue/claim/proof_chain 而不是 item，还必须设置 value.physical=true。玩家只是观察或知道某件事时，用 value.role=\"observed\" 或普通关系，绝不能写成 holding。",
    "当前上下文可能包含实体名册。entities、edges、evidence、stateSlots 都优先复用名册里的精确 id；如果只知道名字，就用名册里的精确 label。绝不要把同一个人/物换个新 id 重建（否则侧栏会出现重复节点）。",
      "状态追踪是可选的，必须服从用户的世界契约。世界契约禁止数值、面板、等级、RPG 化或量化进度时，不要输出 stateSlots；改用 entity.status / summary / evidence transitions 写自然语言状态。",
      "确实需要 stateSlots 时，也优先用自然语言 value；只有用户明确要求量化追踪，或文本里存在具体倒计时/钟点/数量，才写数字。不要因为 schema 支持就硬造数值。",
      "开局阶段（前几回合），只播种前提里已经确立的状态：明确期限在世界允许量化时才可成为 timer；核心谜题/目标物→第一条 clue/evidence 实体；已点名的关键人物→actor 实体并配一句 summary。不要让开场世界几乎空着。",
    "克制：只建剧情真正落地的实体和数值，不要为了填满侧栏而硬造属性或物品。",
    "只有当这个世界确实是调查/推理题材时，才用 evidence.transitions 走证据生命周期；其他题材留空即可。",
    "如果玩家动作无效或信息不足，blocked=true 并写 blockedReason。",
    "时间是世界同步轴，不是固定 tick。每个非开场回合都要写 timeAdvance：elapsed=本动作按语义经过了多久；anchor=动作结束后世界处在什么时间/阶段（若本局有钟点、昼夜、季节、闭关期、期限、潮汐、巡逻节奏等时间锚点）；rationale=为什么是这段时间；synchronized=同一段时间里相关人物/地点/压力发生了什么同步变化。看一眼可能几息，赶路可能半天，闭关可能三年——遵守用户的世界契约，绝不要发明统一回合长度。",
    "调用一次 submit_world_mutation，提交 summary、timeAdvance、entities、edges、stateSlots、evidenceTransitions、blocked、blockedReason、notes；eventId、turn、actionKind 由宿主补入。",
  ].join("\n");
}

function buildWorldMutatorUserPrompt(input: PlayWorldMutatorInput, language: "zh" | "en"): string {
  if (language === "en") {
    return [
      `turn: ${input.turn}`,
      "Player's words:",
      input.input,
      "",
      "Action interpretation:",
      JSON.stringify(PlayActionIntentSchema.parse(input.action), null, 2),
      "",
      "Current context:",
      input.context,
      "",
      "Requirement: use eventId evt-" + input.turn + "; every new or referenced entity id must be stable, readable, and short.",
    ].join("\n");
  }
  return [
    `turn: ${input.turn}`,
    "玩家原话：",
    input.input,
    "",
    "动作理解：",
    JSON.stringify(PlayActionIntentSchema.parse(input.action), null, 2),
    "",
    "当前上下文：",
    input.context,
    "",
    "要求：eventId 使用 evt-" + input.turn + "；所有新增或引用的实体 id 要稳定、可读、短小。",
  ].join("\n");
}

export function buildSceneRendererSystemPrompt(mode: "open" | "guided" = "open", language: "zh" | "en" = "zh"): string {
  if (language === "en") {
    const base = [
      "You are an interactive-fiction scene-response author.",
      "Write the response only from the already-applied state; do not overturn the reducer's results.",
      "The scene must visibly carry out every completed part of the player's action recorded in Applied changes before writing its aftermath. Do not skip a requested examination, conversation, movement, or use of an item and jump straight to a reaction or decision point.",
      "The world setting and authoritative pre-action context preserve identity, ownership, relationships, persistent counts, and established facts. Keep them unchanged unless Applied changes explicitly update them.",
      "Concrete new objects, clues, evidence, locations, organizations, or named people can only appear if they are already present in Applied changes or Current state summary. If the prose needs a new concrete thing, it must have been created by the mutator first; otherwise describe mood, pressure, or an unnamed detail instead.",
      "If Current state summary includes a Time section, treat elapsed and anchor as canonical. Render the scene after exactly that elapsed interval, at that resulting world time/phase, and include the synchronized pressure/character movement naturally in prose. Do not invent another clock reading, another elapsed amount, or a fixed tick label.",
      "sceneText is narrative prose only. Choice hints belong only in suggestedActions, never as an A/B/C or bullet menu inside sceneText.",
    ];
    const actionsRule = mode === "guided"
      ? "suggestedActions: give 0-3 as optional springboards ('you could…'), ONLY at a genuine decision point — not every turn. They are hints, not the only way forward; the player can type freely or just stay put at any time."
      : "suggestedActions: 0-3 short hints, optional, never restricting the player's input; omit them when there is no real decision point.";
    return [...base, actionsRule, "Output strict JSON: sceneText, suggestedActions."].join("\n");
  }
  const base = [
    "你是互动小说场景回应作者。",
    "你只能根据已经应用后的状态写回应，不要推翻 reducer 结果。",
    "正文必须先把「已应用的本回合变化」里已经完成的玩家动作逐项写出来，再写动作后的反应；不得漏掉用户要求的观察、交谈、移动或使用物件，直接跳到余波或下一个抉择点。",
    "世界设定和本回合前的权威上下文保存人物身份、归属、关系、持续数量与既成事实；除非「已应用的本回合变化」明确修改，否则必须保持不变。",
    "具体的新物件、线索、证据、地点、组织、具名人物，只能来自「已应用的本回合变化」或「当前状态摘要」。如果正文需要一个新的具体东西，它必须先由 mutator 建成实体；否则只写氛围、压力或不具名的细节。",
    "如果当前状态摘要里有 Time/时间段，elapsed 和 anchor 是权威时间：正文必须按这段经过时长、这个动作后的世界时间/阶段来写，并把同步发生的压力、人物移动、远处变化自然溶进正文。不得另写一个钟点、另写一段经过时长，也不要写成固定 tick、回合标签或 UI 提示。",
    "sceneText 只写叙事散文。动作提示只能放在 suggestedActions，绝不能在 sceneText 里写 A/B/C 或项目符号菜单。",
  ];
  const actionsRule = mode === "guided"
    ? "suggestedActions：给 0-3 个，作为'你也许可以这样做'的跳板——只在真正出现抉择点时给，不必每回合都给；它们是参考、不是唯一前进方式，玩家随时可以自由输入、也可以只是待着。"
    : "suggestedActions：0-3 个短句，可选，只是参考、不限制玩家输入；没有明显抉择点时就不给。";
  return [...base, actionsRule, "输出严格 JSON：sceneText, suggestedActions。"].join("\n");
}

function buildSceneRendererUserPrompt(input: PlaySceneRenderInput, language: "zh" | "en"): string {
  const premise = input.worldPremise?.trim();
  const context = input.context?.trim();
  if (language === "en") {
    return [
      ...(premise ? ["World setting (always obey):", premise, ""] : []),
      ...(context ? ["Authoritative context before this action:", context, ""] : []),
      "Player's words:",
      input.input,
      "",
      "Action:",
      JSON.stringify(PlayActionIntentSchema.parse(input.action), null, 2),
      "",
      "Applied changes this turn:",
      input.mutationSummary,
      "",
      "Current state summary:",
      input.stateBrief,
      input.replayContext ? ["", "Replay constraints:", input.replayContext].join("\n") : "",
    ].join("\n");
  }
  return [
    ...(premise ? ["世界设定（始终遵守）：", premise, ""] : []),
    ...(context ? ["本回合前的权威上下文：", context, ""] : []),
    "玩家原话：",
    input.input,
    "",
    "动作：",
    JSON.stringify(PlayActionIntentSchema.parse(input.action), null, 2),
    "",
    "已应用的本回合变化：",
    input.mutationSummary,
    "",
    "当前状态摘要：",
    input.stateBrief,
    input.replayContext ? ["", "重写约束：", input.replayContext].join("\n") : "",
  ].join("\n");
}

function parseJson(raw: string): unknown {
  const trimmed = raw.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Play agent did not return JSON.");
  }
}
