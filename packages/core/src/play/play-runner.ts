import type { AgentContext } from "../agents/base.js";
import { join } from "node:path";
import {
  PlayActionIntentSchema,
  PlayMutationSchema,
  type PlayEntity,
  type PlayActionIntent,
  type PlayActionIntentInput,
  type PlayMutation,
  type PlayMutationInput,
} from "../models/play.js";
import {
  PlayActionInterpreterAgent,
  PlaySceneReconcilerAgent,
  PlaySceneRendererAgent,
  PlayWorldMutatorAgent,
  type PlaySceneRender,
} from "./play-agents.js";
import { createPlayDB } from "./play-db-factory.js";
import { applyPlayMutation, seedPlayGraph, type PlayReducerDB } from "./play-reducer.js";
import { PlayStore, type PlayWorld } from "./play-store.js";
import type { PlayGraphSnapshot } from "./play-file-db.js";
import {
  createProductionRunSnapshot,
  writeProductionRunSnapshot,
  type ProductionObservation,
} from "../production/harness.js";

export interface PlayActionInterpreterLike {
  readonly interpret: (input: {
    readonly input: string;
    readonly sceneBrief: string;
    readonly language?: "zh" | "en";
  }) => Promise<PlayActionIntentInput>;
}

export interface PlayWorldMutatorLike {
  readonly proposeMutation: (input: {
    readonly turn: number;
    readonly input: string;
    readonly action: PlayActionIntentInput;
    readonly context: string;
    readonly language?: "zh" | "en";
  }) => Promise<PlayMutationInput>;
}

export interface PlaySceneRendererLike {
  readonly render: (input: {
    readonly input: string;
    readonly action: PlayActionIntentInput;
    readonly context?: string;
    readonly mutationSummary: string;
    readonly stateBrief: string;
    readonly replayContext?: string;
    readonly mode?: "open" | "guided";
    readonly language?: "zh" | "en";
    readonly worldPremise?: string;
  }) => Promise<PlaySceneRender>;
}

export interface PlaySceneReconcilerLike {
  readonly reconcile: (input: {
    readonly turn: number;
    readonly input: string;
    readonly action: PlayActionIntentInput;
    readonly mutation: PlayMutationInput;
    readonly sceneText: string;
    readonly context: string;
    readonly stateBrief: string;
    readonly language?: "zh" | "en";
    readonly worldPremise?: string;
  }) => Promise<PlayMutationInput>;
}

export interface PlayRunnerOptions {
  readonly projectRoot: string;
  readonly worldId: string;
  readonly runId: string;
  readonly ctx?: AgentContext;
  readonly store?: PlayStore;
  readonly db?: PlayReducerDB;
  readonly agents?: {
    readonly actionInterpreter?: PlayActionInterpreterLike;
    readonly worldMutator?: PlayWorldMutatorLike;
    readonly sceneRenderer?: PlaySceneRendererLike;
    readonly sceneReconciler?: PlaySceneReconcilerLike;
  };
}

export interface PlayStepResult extends PlaySceneRender {
  readonly action: PlayActionIntent;
  readonly mutation: PlayMutation;
}

export interface PlayReplayResult extends PlayStepResult {
  readonly previousVariantId?: string;
  readonly variantId?: string;
  readonly replayedInput: string;
}

export interface PlayVariantRestoreResult {
  readonly turn: number;
  readonly variantId: string;
  readonly sceneText: string;
}

export interface PlayOpeningSeedResult {
  readonly mutation: PlayMutation;
}

export class PlayOpeningSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlayOpeningSeedError";
  }
}

export class PlayRunner {
  private readonly store: PlayStore;
  private readonly db: PlayReducerDB;
  private readonly ownsDb: boolean;
  private dbClosed = false;
  private readonly actionInterpreter: PlayActionInterpreterLike;
  private readonly worldMutator: PlayWorldMutatorLike;
  private readonly sceneRenderer: PlaySceneRendererLike;
  private readonly sceneReconciler: PlaySceneReconcilerLike | null;

  constructor(private readonly options: PlayRunnerOptions) {
    this.store = options.store ?? new PlayStore(options.projectRoot);
    this.ownsDb = !options.db;
    this.db = options.db ?? createPlayDB(this.store.runDir(options.worldId, options.runId));
    if (!options.ctx && (!options.agents?.actionInterpreter || !options.agents.worldMutator || !options.agents.sceneRenderer)) {
      throw new Error("PlayRunner requires ctx when default play agents are used.");
    }
    const ctx = options.ctx;
    this.actionInterpreter = options.agents?.actionInterpreter ?? new PlayActionInterpreterAgent(ctx!);
    this.worldMutator = options.agents?.worldMutator ?? new PlayWorldMutatorAgent(ctx!);
    this.sceneRenderer = options.agents?.sceneRenderer ?? new PlaySceneRendererAgent(ctx!);
    this.sceneReconciler = options.agents?.sceneReconciler ?? (ctx ? new PlaySceneReconcilerAgent(ctx) : null);
  }

  /**
   * 关闭 runner 自己创建的数据库连接（外部传入的 db 由调用方负责关闭）。
   * SQLite 文件句柄不关闭时 Windows 上无法删除 play.db；node:sqlite 的
   * close 不允许二次调用，所以这里做幂等保护。
   */
  close(): void {
    if (this.ownsDb && !this.dbClosed) {
      this.dbClosed = true;
      (this.db as { close?: () => void }).close?.();
    }
  }

  async seedOpening(input: {
    readonly sceneText: string;
    readonly suggestedActions?: readonly string[];
  }): Promise<PlayOpeningSeedResult | null> {
    await this.store.ensureRun(this.options.worldId, this.options.runId);
    const existing = readGraphSnapshot(this.db);
    if (isOpeningGraphReady(existing)) {
      return null;
    }

    const world = await this.store.loadWorld(this.options.worldId);
    const language = world?.language ?? "zh";
    const action: PlayActionIntent = {
      actionKind: "look",
      intent: language === "en" ? "Seed the opening state for the first playable scene." : "播种第一幕已成立的开场状态。",
      manner: "",
      risk: "",
      ambiguity: "",
      secondaryActions: [],
    };
    const worldContext = renderPlayWorldContext(world, language);
    const context = await this.buildContextBrief(input.sceneText, language, world);
    const mutation = PlayMutationSchema.parse(await this.worldMutator.proposeMutation({
      turn: 0,
      input: buildOpeningSeedInput({
        sceneText: input.sceneText,
        suggestedActions: input.suggestedActions ?? [],
        language,
        premise: worldContext,
      }),
      action,
      context,
      language,
    }));
    const normalized = PlayMutationSchema.parse({
      ...mutation,
      eventId: "evt-0",
      turn: 0,
      actionKind: "look",
    });
    const stateBrief = renderStateBrief({ action, mutation: normalized });
    const finalMutation = this.sceneReconciler
      ? mergePlayMutations(normalized, PlayMutationSchema.parse(await this.sceneReconciler.reconcile({
        turn: 0,
        input: buildOpeningSeedInput({
          sceneText: input.sceneText,
          suggestedActions: input.suggestedActions ?? [],
          language,
          premise: worldContext,
        }),
        action,
        mutation: normalized,
        sceneText: input.sceneText,
        context,
        stateBrief,
        language,
        worldPremise: worldContext,
      })))
      : normalized;

    seedPlayGraph({
      db: this.db,
      mutation: finalMutation,
    });
    const seededGraph = readGraphSnapshot(this.db);
    if (finalMutation.blocked || !isOpeningGraphReady(seededGraph)) {
      throw new PlayOpeningSeedError(
        finalMutation.blockedReason
          || (language === "en"
            ? "The opening scene did not produce a usable player/world graph. Retry world creation."
            : "开场没有生成可用的玩家与世界图谱，请重试创建互动世界。"),
      );
    }
    await this.store.writeProjection(this.options.worldId, this.options.runId, "projections/state.md", renderStateBrief({ action, mutation: finalMutation }));
    return { mutation: finalMutation };
  }

  async step(input: string, options: { readonly replayContext?: string } = {}): Promise<PlayStepResult> {
    const rawInput = input.trim();
    if (!rawInput) throw new Error("Play input is empty.");

    await this.store.ensureRun(this.options.worldId, this.options.runId);
    const turn = (await this.store.readEvents(this.options.worldId, this.options.runId)).length + 1;
    await this.writeRunStatus(turn, "running", []);
    try {
      const result = await this.executeStep(rawInput, turn, options);
      const observations: ProductionObservation[] = result.mutation.blocked
        ? [{
            metric: "play-action",
            expected: "action advances or meaningfully responds to world state",
            actual: result.mutation.blockedReason || result.mutation.summary,
            severity: "info",
            evidence: result.mutation.blockedReason || result.mutation.summary,
            repairable: false,
          }]
        : [];
      await this.writeRunStatus(turn, "complete", observations);
      return result;
    } catch (error) {
      const cancelled = this.options.ctx?.signal?.aborted === true;
      await this.writeRunStatus(turn, cancelled ? "cancelled" : "failed", [], error).catch(() => undefined);
      throw error;
    }
  }

  private async executeStep(
    rawInput: string,
    turn: number,
    options: { readonly replayContext?: string },
  ): Promise<PlayStepResult> {
    const world = await this.store.loadWorld(this.options.worldId);
    const language = world?.language ?? "zh";
    const sceneBrief = await this.readOptionalProjection("projections/scene.md");
    const action = PlayActionIntentSchema.parse(await this.actionInterpreter.interpret({
      input: rawInput,
      sceneBrief: sceneBrief || (language === "en" ? "A new turn begins; carry over the current world state." : "新回合开始，沿用当前世界状态。"),
      language,
    }));
    const worldContext = renderPlayWorldContext(world, language);
    const context = await this.buildContextBrief(sceneBrief, language, world);
    const mutation = PlayMutationSchema.parse(await this.worldMutator.proposeMutation({
      turn,
      input: rawInput,
      action,
      context,
      language,
    }));
    const stateBrief = renderStateBrief({ action, mutation });

    // Render BEFORE any commit. Nothing about this turn (db mutation, event, state,
    // scene, transcript) is persisted until a valid scene is in hand, so rendering
    // failures remain retryable and cannot create a half-committed turn.
    const render = await this.sceneRenderer.render({
      input: rawInput,
      action,
      context,
      mutationSummary: mutation.summary || mutation.blockedReason,
      stateBrief,
      replayContext: options.replayContext,
      mode: world?.mode ?? "open",
      language,
      worldPremise: worldContext,
    });

    const finalMutation = this.sceneReconciler && !mutation.blocked
      ? mergePlayMutations(mutation, PlayMutationSchema.parse(await this.sceneReconciler.reconcile({
        turn,
        input: rawInput,
        action,
        mutation,
        sceneText: render.sceneText,
        context,
        stateBrief,
        language,
        worldPremise: worldContext,
      })))
      : mutation;
    const finalStateBrief = finalMutation === mutation ? stateBrief : renderStateBrief({ action, mutation: finalMutation });

    // Commit everything together, only after the scene and graph reconciliation are in hand.
    const beforeGraph = readGraphSnapshot(this.db);
    const rollbackSnapshot = beforeGraph && this.db.replaceWithSnapshot
      ? await this.store.captureRunSnapshot(this.options.worldId, this.options.runId, {
          id: `before-turn-${turn}`,
          turn,
          graph: beforeGraph,
        })
      : null;
    if (rollbackSnapshot) {
      await this.store.saveCheckpoint(this.options.worldId, this.options.runId, rollbackSnapshot);
    }

    try {
      const applied = applyPlayMutation({
        db: this.db,
        mutation: finalMutation,
        rawInput,
      });
      await this.store.appendEvent(this.options.worldId, this.options.runId, applied.event);
      await this.store.writeProjection(this.options.worldId, this.options.runId, "projections/state.md", finalStateBrief);
      await this.store.saveCurrentState(this.options.worldId, this.options.runId, {
        turn,
        lastEventId: applied.event.id,
        lastAction: action,
        lastSummary: finalMutation.summary,
        timeAdvance: finalMutation.timeAdvance ?? null,
        blocked: finalMutation.blocked,
        worldContract: world?.worldContract ?? "",
        visualContract: world?.visualContract ?? "",
      });
      await this.store.writeProjection(this.options.worldId, this.options.runId, "projections/scene.md", `${render.sceneText}\n`);
      await this.store.appendTranscriptTurn(this.options.worldId, this.options.runId, {
        role: "user",
        content: rawInput,
        timestamp: Date.now(),
      });
      await this.store.appendTranscriptTurn(this.options.worldId, this.options.runId, {
        role: "assistant",
        content: render.sceneText,
        timestamp: Date.now(),
      });
    } catch (error) {
      if (!rollbackSnapshot) throw error;
      try {
        await this.store.restoreRunSnapshot(
          this.options.worldId,
          this.options.runId,
          rollbackSnapshot,
          requireRestorableGraphDB(this.db),
        );
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `Play turn ${turn} failed and rollback was incomplete`);
      }
      throw error;
    }

    return {
      ...render,
      action,
      mutation: finalMutation,
    };
  }

  private async writeRunStatus(
    turn: number,
    status: "running" | "complete" | "failed" | "cancelled",
    observations: ReadonlyArray<ProductionObservation>,
    error?: unknown,
  ): Promise<void> {
    const runDir = join("worlds", this.options.worldId, "runs", this.options.runId);
    await writeProductionRunSnapshot({
      rootDir: this.options.projectRoot,
      runPath: join(runDir, "status.json"),
      run: createProductionRunSnapshot({
        kind: "play",
        id: `${this.options.worldId}:${this.options.runId}`,
        status,
        stage: `turn-${turn}`,
        artifacts: [
          join(runDir, "events.jsonl"),
          join(runDir, "transcript.jsonl"),
          join(runDir, "state", "current.json"),
          join(runDir, "projections", "scene.md"),
          join(runDir, "projections", "state.md"),
        ],
        observations,
        skillIds: this.options.ctx?.activatedSkills?.map((activation) => activation.skill.id),
        resumeCursor: String(turn),
        ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
      }),
    });
  }

  async regenerateLastTurn(input?: string): Promise<PlayReplayResult> {
    const events = await this.store.readEvents(this.options.worldId, this.options.runId);
    const last = events.at(-1);
    if (!last) throw new Error("No Play turn to regenerate.");
    const replayedInput = input?.trim() || last.rawInput;
    const db = requireRestorableGraphDB(this.db);
    const currentGraph = readGraphSnapshot(this.db);
    const previousVariantId = currentGraph
      ? await this.store.saveVariant(
          this.options.worldId,
          this.options.runId,
          last.turn,
          await this.store.captureRunSnapshot(this.options.worldId, this.options.runId, {
            id: `current-turn-${last.turn}`,
            turn: last.turn,
            graph: currentGraph,
          }),
        )
      : undefined;
    const checkpoint = await this.store.loadCheckpoint(this.options.worldId, this.options.runId, `before-turn-${last.turn}`);
    if (!checkpoint) {
      throw new Error(`Missing checkpoint before turn ${last.turn}; cannot regenerate safely.`);
    }
    await this.store.restoreRunSnapshot(this.options.worldId, this.options.runId, checkpoint, db);
    const result = await this.step(replayedInput, {
      replayContext: buildReplayContext({
        originalInput: last.rawInput,
        replacementInput: input?.trim(),
        language: (await this.store.loadWorld(this.options.worldId))?.language ?? "zh",
      }),
    });
    const nextGraph = readGraphSnapshot(this.db);
    const variantId = nextGraph
      ? await this.store.saveVariant(
          this.options.worldId,
          this.options.runId,
          last.turn,
          await this.store.captureRunSnapshot(this.options.worldId, this.options.runId, {
            id: `regenerated-turn-${last.turn}`,
            turn: last.turn,
            graph: nextGraph,
          }),
        )
      : undefined;
    return {
      ...result,
      previousVariantId,
      variantId,
      replayedInput,
    };
  }

  async restoreVariant(input: {
    readonly turn: number;
    readonly variantId: string;
  }): Promise<PlayVariantRestoreResult> {
    const db = requireRestorableGraphDB(this.db);
    const snapshot = await this.store.loadVariant(this.options.worldId, this.options.runId, input.turn, input.variantId);
    if (!snapshot) {
      throw new Error(`Play variant not found: turn ${input.turn} / ${input.variantId}`);
    }
    await this.store.restoreRunSnapshot(this.options.worldId, this.options.runId, snapshot, db);
    return {
      turn: input.turn,
      variantId: input.variantId,
      sceneText: snapshot.sceneProjection.trim(),
    };
  }

  private async buildContextBrief(sceneBrief: string, language: "zh" | "en", world: PlayWorld | null): Promise<string> {
    const stateBrief = await this.readOptionalProjection("projections/state.md");
    const isEn = language === "en";
    const worldContext = renderPlayWorldContext(world, language);
    const sceneLabel = isEn ? "Current scene:" : "当前场景：";
    const stateLabel = isEn ? "Current state:" : "当前状态：";
    const entityRoster = renderEntityRoster(readGraphSnapshot(this.db)?.entities ?? [], language);
    return [
      worldContext,
      entityRoster,
      sceneBrief ? `${sceneLabel}\n${sceneBrief}` : "",
      stateBrief ? `${stateLabel}\n${stateBrief}` : "",
    ].filter(Boolean).join("\n\n") || (isEn ? "No persisted state yet." : "暂无持久化状态。");
  }

  private async readOptionalProjection(relativePath: string): Promise<string> {
    try {
      return await this.store.readProjection(this.options.worldId, this.options.runId, relativePath);
    } catch {
      return "";
    }
  }
}

function isOpeningGraphReady(graph: PlayGraphSnapshot | null): boolean {
  if (!graph) return false;
  return graph.entities.some((entity) => entity.id === "actor_player")
    && graph.entities.some((entity) => entity.id !== "actor_player");
}

function buildOpeningSeedInput(input: {
  readonly sceneText: string;
  readonly suggestedActions: readonly string[];
  readonly language: "zh" | "en";
  readonly premise?: string;
}): string {
  const isEn = input.language === "en";
  const lines = isEn
    ? [
        "Seed only the state that already exists at the opening of this playable world.",
        "Do not advance time, do not solve the mystery, and do not narrate a new turn.",
        "If the premise or opening scene says the player already holds, carries, keeps, wears, or starts with a tangible object, that object is already established: create its entity and add an actor_player holding edge. Do not hide held objects inside the player summary.",
        input.premise ? `Premise:\n${input.premise}` : "",
        `Opening scene:\n${input.sceneText}`,
        input.suggestedActions.length > 0 ? `Suggested player actions:\n${input.suggestedActions.map((action) => `- ${action}`).join("\n")}` : "",
      ]
    : [
        "只播种这个互动世界开场已经成立的状态。",
        "不要推进时间，不要解谜，不要写新的回合剧情。",
        "如果世界前提或开场正文说玩家已经拿着、带着、揣着、穿着、携带或开局拥有某个实物，这就是已成立状态：必须为该实物建立实体，并补一条 actor_player 指向它、value.role=\"holding\" 的持有边。不要把已持有实物只藏在玩家 summary 里。",
        input.premise ? `世界前提：\n${input.premise}` : "",
        `开场正文：\n${input.sceneText}`,
        input.suggestedActions.length > 0 ? `建议动作：\n${input.suggestedActions.map((action) => `- ${action}`).join("\n")}` : "",
      ];
  return lines.filter(Boolean).join("\n\n");
}

function buildReplayContext(input: {
  readonly originalInput: string;
  readonly replacementInput?: string;
  readonly language: "zh" | "en";
}): string {
  const replacement = input.replacementInput?.trim();
  if (input.language === "en") {
    return [
      "This is a regeneration of the previous turn, not a new next turn.",
      `Original player input: ${input.originalInput}`,
      replacement && replacement !== input.originalInput ? `Replacement instruction from user: ${replacement}` : "",
      "Keep it as the same player action unless the replacement explicitly changes that action.",
      "The Current state summary is authoritative, especially the Time section. Do not move the clock backward, invent a different elapsed time, or write another timestamp.",
      "Do not add new player actions the user did not take. Vary prose, sensory detail, pressure, and emphasis while staying inside the same applied state.",
      "Concrete new facts, people, objects, locations, or clues must already be present in Applied changes or Current state summary.",
    ].filter(Boolean).join("\n");
  }
  return [
    "这是在重写上一回合，不是推进新的下一回合。",
    `原玩家动作：${input.originalInput}`,
    replacement && replacement !== input.originalInput ? `用户替换说明：${replacement}` : "",
    "除非替换说明明确改变动作，否则保持同一个玩家动作。",
    "当前状态摘要是权威，尤其是 Time/时间段：不得倒退时间，不得另写经过时长，也不得写另一个钟点。",
    "不要加入玩家没有做的新动作。可以换表达、感官细节、压迫和侧重点，但必须留在同一份已应用状态里。",
    "具体新事实、人物、物件、地点或线索必须已经出现在已应用变化或当前状态摘要中。",
  ].filter(Boolean).join("\n");
}

function renderPlayWorldContext(world: PlayWorld | null | undefined, language: "zh" | "en"): string {
  if (!world) return "";
  const premise = world.premise?.trim();
  const worldContract = world.worldContract?.trim();
  const visualContract = world.visualContract?.trim();
  const isEn = language === "en";
  const blocks = [
    premise
      ? `${isEn ? "World setting" : "世界设定"}:\n${premise}`
      : "",
    worldContract
      ? `${isEn ? "World contract (high priority; obey before genre defaults)" : "世界契约（高优先级，先于题材惯例）"}:\n${worldContract}`
      : "",
    visualContract
      ? `${isEn ? "Visual contract (for scene and image consistency)" : "视觉契约（保持场景和配图一致）"}:\n${visualContract}`
      : "",
  ].filter(Boolean);
  return blocks.join("\n\n");
}

function readGraphSnapshot(db: PlayReducerDB): PlayGraphSnapshot | null {
  const maybeSnapshot = (db as { readonly snapshot?: unknown }).snapshot;
  if (typeof maybeSnapshot !== "function") {
    return null;
  }
  try {
    return maybeSnapshot.call(db) as PlayGraphSnapshot;
  } catch {
    return null;
  }
}

function requireRestorableGraphDB(db: PlayReducerDB): PlayReducerDB & {
  snapshot: () => PlayGraphSnapshot;
  replaceWithSnapshot: (snapshot: PlayGraphSnapshot) => void;
} {
  if (typeof db.snapshot !== "function" || typeof db.replaceWithSnapshot !== "function") {
    throw new Error("Play graph database cannot restore snapshots.");
  }
  return db as PlayReducerDB & {
    snapshot: () => PlayGraphSnapshot;
    replaceWithSnapshot: (snapshot: PlayGraphSnapshot) => void;
  };
}

function mergePlayMutations(base: PlayMutation, supplement: PlayMutation): PlayMutation {
  if (isEmptyMutationSupplement(supplement)) return base;
  const summary = mergeMutationSummary(base.summary, supplement.summary);
  return PlayMutationSchema.parse({
    ...base,
    summary,
    entities: {
      upsert: mergeById([...base.entities.upsert, ...supplement.entities.upsert]),
    },
    edges: {
      upsert: mergeById([...base.edges.upsert, ...supplement.edges.upsert]),
      expire: [...base.edges.expire, ...supplement.edges.expire],
    },
    stateSlots: {
      upsert: mergeById([...base.stateSlots.upsert, ...supplement.stateSlots.upsert]),
    },
    evidence: {
      transitions: [...base.evidence.transitions, ...supplement.evidence.transitions],
    },
    timeAdvance: base.timeAdvance ?? supplement.timeAdvance,
    notes: [...base.notes, ...supplement.notes],
  });
}

function mergeById<T extends { readonly id: string }>(items: ReadonlyArray<T>): T[] {
  const order: string[] = [];
  const byId = new Map<string, T>();
  for (const item of items) {
    if (!byId.has(item.id)) order.push(item.id);
    byId.set(item.id, item);
  }
  return order.map((id) => byId.get(id)!);
}

function mergeMutationSummary(base: string, supplement: string): string {
  const left = base.trim();
  const right = supplement.trim();
  if (!right) return left;
  if (!left) return right;
  const normalizedLeft = normalizeSummaryForDedupe(left);
  const normalizedRight = normalizeSummaryForDedupe(right);
  if (normalizedLeft === normalizedRight) return left;
  if (normalizedLeft.includes(normalizedRight)) return left;
  if (normalizedRight.includes(normalizedLeft)) return right;
  return `${left}；${right}`;
}

function normalizeSummaryForDedupe(value: string): string {
  return value
    .replace(/[\s，,。.!！?？；;：:、"'“”‘’「」『』（）()[\]{}《》<>—\-…]+/g, "")
    .toLowerCase();
}

function isEmptyMutationSupplement(mutation: PlayMutation): boolean {
  return mutation.entities.upsert.length === 0
    && mutation.edges.upsert.length === 0
    && mutation.edges.expire.length === 0
    && mutation.stateSlots.upsert.length === 0
    && mutation.evidence.transitions.length === 0
    && mutation.notes.length === 0
    && !mutation.summary.trim()
    && !mutation.blocked;
}

function renderEntityRoster(entities: ReadonlyArray<PlayEntity>, language: "zh" | "en"): string {
  if (entities.length === 0) {
    return "";
  }
  const isEn = language === "en";
  const header = isEn
    ? "Current entity roster (reuse these ids; do not recreate the same person/thing):"
    : "当前实体名册（复用这些 id；不要把同一个人/物换新 id 重建）：";
  const lines = entities.slice(0, 40).map((entity) => {
    const detail = [entity.summary, entity.status ? `${isEn ? "status" : "状态"}: ${entity.status}` : ""]
      .filter(Boolean)
      .join(isEn ? "; " : "；");
    return `- ${entity.id} [${entity.type}]: ${entity.label}${detail ? ` — ${clampRosterText(detail)}` : ""}`;
  });
  return [header, ...lines].join("\n");
}

function clampRosterText(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

function renderStateBrief(input: {
  readonly action: PlayActionIntent;
  readonly mutation: PlayMutation;
}): string {
  const lines = [
    `# Play State`,
    "",
    `- action: ${input.action.actionKind} ${input.action.intent}`.trim(),
    `- summary: ${input.mutation.summary || input.mutation.blockedReason}`,
  ];
  if (input.mutation.entities.upsert.length > 0) {
    lines.push("", "## Entities");
    for (const entity of input.mutation.entities.upsert) {
      lines.push(`- ${entity.id} [${entity.type}]: ${entity.label}${entity.summary ? ` — ${entity.summary}` : ""}`);
    }
  }
  if (input.mutation.edges.upsert.length > 0) {
    lines.push("", "## Edges");
    for (const edge of input.mutation.edges.upsert) {
      const role = typeof edge.value?.role === "string" && edge.value.role.trim()
        ? ` role=${edge.value.role.trim()}`
        : "";
      lines.push(`- ${edge.fromId} -[${edge.type}${role}]-> ${edge.toId}`);
    }
  }
  if (input.mutation.stateSlots.upsert.length > 0) {
    lines.push("", "## State Slots");
    for (const slot of input.mutation.stateSlots.upsert) {
      lines.push(`- ${slot.id}: ${JSON.stringify(slot.value)}`);
    }
  }
  if (input.mutation.timeAdvance) {
    lines.push("", "## Time");
    if (input.mutation.timeAdvance.elapsed) {
      lines.push(`- elapsed: ${input.mutation.timeAdvance.elapsed}`);
    }
    if (input.mutation.timeAdvance.anchor) {
      lines.push(`- anchor: ${input.mutation.timeAdvance.anchor}`);
    }
    if (input.mutation.timeAdvance.rationale) {
      lines.push(`- rationale: ${input.mutation.timeAdvance.rationale}`);
    }
    if (input.mutation.timeAdvance.synchronized.length > 0) {
      lines.push("- synchronized:");
      for (const item of input.mutation.timeAdvance.synchronized) {
        lines.push(`  - ${item}`);
      }
    }
  }
  if (input.mutation.evidence.transitions.length > 0) {
    lines.push("", "## Evidence");
    for (const transition of input.mutation.evidence.transitions) {
      lines.push(`- ${transition.entityId}: ${transition.to}${transition.reason ? ` — ${transition.reason}` : ""}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
