import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPlayStartTool,
  createPlayReviseTool,
  createPlayStepTool,
  type PlayStartToolOptions,
} from "../agent/agent-tools.js";
import { PlayStore } from "../play/play-store.js";
import type { PlayReplayResult, PlayStepResult } from "../play/play-runner.js";
import type { PlayGraphDB } from "../play/play-db-factory.js";

const STEP_RESULT: PlayStepResult = {
  sceneText: "你翻开账本，发现最后一页夹着一张旧船票。",
  suggestedActions: ["藏起船票", "追问送账本的人"],
  action: {
    actionKind: "look",
    intent: "查看账本",
    manner: "",
    risk: "",
    ambiguity: "",
    secondaryActions: [],
  },
  mutation: {
    eventId: "evt-1",
    turn: 1,
    actionKind: "look",
    summary: "玩家发现旧船票。",
    entities: { upsert: [] },
    edges: { upsert: [], expire: [] },
    stateSlots: { upsert: [] },
    evidence: { transitions: [] },
    blocked: false,
    blockedReason: "",
    notes: [],
  },
};

const REPLAY_RESULT: PlayReplayResult = {
  ...STEP_RESULT,
  sceneText: "你重新翻开账本，这次先看见夹层里的红色印章。",
  suggestedActions: ["取出红色印章", "对照账本末页"],
  replayedInput: "我先检查账本夹层",
  previousVariantId: "v-old",
  variantId: "v-new",
};

function pipelineStub() {
  return {
    createAgentContext: vi.fn(() => ({})),
    runWithAgentContext: vi.fn(async (_context: unknown, task: () => Promise<unknown>) => task()),
  } as any;
}

function seedReadyGraph(db: PlayGraphDB): void {
  db.upsertEntity({ id: "actor_player", type: "actor", label: "玩家", summary: "当前玩家。" });
  db.upsertEntity({ id: "location_opening", type: "location", label: "开场地点", summary: "第一幕所在地点。" });
}

function readyRunnerFactory() {
  return ({ db }: { readonly db: PlayGraphDB }) => ({
    seedOpening: vi.fn(async () => {
      seedReadyGraph(db);
      return {
        mutation: {
          eventId: "evt-0",
          turn: 0,
          actionKind: "look" as const,
          summary: "播种开场状态。",
          entities: { upsert: [] },
          edges: { upsert: [], expire: [] },
          stateSlots: { upsert: [] },
          evidence: { transitions: [] },
          blocked: false,
          blockedReason: "",
          notes: [],
        },
      };
    }),
  });
}

function createReadyPlayStartTool(
  root: string,
  sessionId: string,
  playMode?: "open" | "guided",
  options: PlayStartToolOptions = {},
) {
  return createPlayStartTool(pipelineStub(), root, sessionId, playMode, {
    ...options,
    runnerFactory: options.runnerFactory ?? readyRunnerFactory(),
  });
}

describe("agent play tools", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-agent-play-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("binds the new play world to the chat session and persists the opening scene", async () => {
    const sessionId = "1700000000000-aaaa01";
    const tool = createReadyPlayStartTool(root, sessionId);
    const result = await tool.execute("tc-start", {
      title: "雨夜茶馆",
      premise: "玩家扮演欠债茶馆老板，雨夜有人带着账本上门。",
      mode: "open",
      initialScene: "雨一直下，柜台上的账本被敲了三下。",
      suggestedActions: ["查看账本", "问来人是谁"],
    });

    // worldId is the sessionId — the world is bound 1:1 to this chat session.
    expect(result.details).toMatchObject({
      kind: "play_world_started",
      worldId: sessionId,
      runId: "main",
      title: "雨夜茶馆",
      sceneText: "雨一直下，柜台上的账本被敲了三下。",
      suggestedActions: ["查看账本", "问来人是谁"],
    });
    const resultText = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(resultText).toBe("雨一直下，柜台上的账本被敲了三下。");
    expect(resultText).not.toContain("Interactive world");
    expect(resultText).not.toContain("Suggested actions");
    expect(resultText).not.toContain("查看账本");

    const store = new PlayStore(root);
    await expect(store.loadWorld(sessionId)).resolves.toMatchObject({
      title: "雨夜茶馆",
      mode: "open",
    });
    await expect(store.readTranscript(sessionId, "main")).resolves.toMatchObject([
      { role: "assistant", content: "雨一直下，柜台上的账本被敲了三下。" },
    ]);
    await expect(store.readProjection(sessionId, "main", "projections/scene.md"))
      .resolves.toContain("雨一直下");
  });

  it("persists confirmed natural-language contracts from play_start", async () => {
    const sessionId = "1700000000000-contract";
    const tool = createReadyPlayStartTool(root, sessionId);
    const result = await tool.execute("tc-start-contract", {
      title: "雾港修行录",
      premise: "玩家是港口小宗门外门弟子，今晚要护送一只来历不明的铜匣。",
      mode: "open",
      worldContract: "装备只按用户定义的凡器/灵器/秘宝表达珍惜程度，不引入数值、战斗公式或游戏面板。关键角色会按自己的目标行动。",
      visualContract: "珍惜程度通过材质、光泽、背景气氛和旁人反应体现，不要绿蓝紫橙边框。",
      initialScene: "雨雾压着港口，铜匣在你怀里轻轻发热。",
      suggestedActions: ["查看铜匣裂纹", "观察码头上的同门"],
    } as any);

    expect(result.details).toMatchObject({
      kind: "play_world_started",
      worldContract: expect.stringContaining("不引入数值"),
      visualContract: expect.stringContaining("不要绿蓝紫橙边框"),
    });

    const store = new PlayStore(root);
    await expect(store.loadWorld(sessionId)).resolves.toMatchObject({
      worldContract: expect.stringContaining("关键角色会按自己的目标行动"),
      visualContract: expect.stringContaining("材质、光泽"),
    });
  });

  it("uses confirmed action-payload contracts over model tool params", async () => {
    const sessionId = "1700000000000-contract-payload";
    const tool = createReadyPlayStartTool(root, sessionId, undefined, {
      actionPayload: {
        playStart: {
          title: "确认卡世界",
          premise: "确认卡里的世界设定。",
          worldContract: "确认卡里的世界契约优先：NPC 会离场、误导和主动追问。",
          visualContract: "确认卡里的视觉契约优先：线索可信度通过清晰度和环境危险性体现。",
          initialScene: "确认卡里的开场。",
        },
      } as any,
    });

    await tool.execute("tc-start-contract-payload", {
      title: "模型临时标题",
      premise: "模型临时设定。",
      worldContract: "模型临时契约。",
      visualContract: "模型临时视觉契约。",
      initialScene: "模型临时开场。",
    } as any);

    const store = new PlayStore(root);
    await expect(store.loadWorld(sessionId)).resolves.toMatchObject({
      title: "确认卡世界",
      premise: "确认卡里的世界设定。",
      worldContract: expect.stringContaining("NPC 会离场"),
      visualContract: expect.stringContaining("线索可信度"),
    });
  });

  it("normalizes object-shaped suggested actions at the tool boundary", async () => {
    const sessionId = "1700000000000-sug001";
    const tool = createReadyPlayStartTool(root, sessionId);
    const result = await tool.execute("tc-start-suggestions", {
      title: "老邮局",
      premise: "玩家在地下分拣室值夜班。",
      initialScene: "传送带自己启动，吐出一个写着玩家姓名的旧包裹。",
      suggestedActions: [
        { label: "拆开旧包裹", description: "检查里面到底装着什么" },
        { action: "检查待销毁信件区的铁门" },
      ],
    });

    expect(result.details).toMatchObject({
      kind: "play_world_started",
      suggestedActions: ["拆开旧包裹", "检查待销毁信件区的铁门"],
    });
  });

  it("seeds the opening graph through the play runner when a pipeline is available", async () => {
    const sessionId = "1700000000000-seed01";
    const seedOpening = vi.fn(async () => ({
      mutation: {
        eventId: "evt-0",
        turn: 0,
        actionKind: "look" as const,
        summary: "播种开场状态。",
        entities: { upsert: [] },
        edges: { upsert: [], expire: [] },
        stateSlots: { upsert: [] },
        evidence: { transitions: [] },
        blocked: false,
        blockedReason: "",
        notes: [],
      },
    }));
    const runnerFactory = vi.fn(({ db }: { readonly db: PlayGraphDB }) => ({
      seedOpening: async (...args: Parameters<typeof seedOpening>) => {
        seedReadyGraph(db);
        return seedOpening(...args);
      },
    }));
    const tool = createPlayStartTool(pipelineStub(), root, sessionId, undefined, { runnerFactory });

    const result = await tool.execute("tc-start-seed", {
      title: "雨夜档案",
      premise: "玩家在县医院档案室值夜班。",
      initialScene: "档案柜里只有一张无名婴儿照片。",
      suggestedActions: ["检查照片背面"],
    });

    expect(runnerFactory).toHaveBeenCalledWith(expect.objectContaining({
      worldId: sessionId,
      runId: "main",
    }));
    expect(seedOpening).toHaveBeenCalledWith({
      sceneText: "档案柜里只有一张无名婴儿照片。",
      suggestedActions: ["检查照片背面"],
    });
    expect(result.details).toMatchObject({
      kind: "play_world_started",
      seedMutation: expect.objectContaining({ turn: 0 }),
    });
  });

  it("refuses to create a play world without the Pi worker pipeline", async () => {
    const sessionId = "1700000000000-no-pipeline";
    const tool = createPlayStartTool(null, root, sessionId);

    await expect(tool.execute("tc-start-no-pipeline", {
      title: "不能伪成功的世界",
      premise: "没有模型管线时不应创建。",
      initialScene: "这段文字不能被当成成功产物。",
    })).rejects.toThrow("pipeline");
    await expect(new PlayStore(root).loadWorld(sessionId)).resolves.toBeNull();
  });

  it("removes a new world when opening seeding does not produce a usable graph", async () => {
    const sessionId = "1700000000000-empty-graph";
    const tool = createPlayStartTool(pipelineStub(), root, sessionId, undefined, {
      runnerFactory: () => ({
        seedOpening: vi.fn(async () => ({
          mutation: {
            eventId: "evt-0",
            turn: 0,
            actionKind: "look" as const,
            summary: "模型没有提交任何实体。",
            entities: { upsert: [] },
            edges: { upsert: [], expire: [] },
            stateSlots: { upsert: [] },
            evidence: { transitions: [] },
            blocked: false,
            blockedReason: "",
            notes: [],
          },
        })),
      }),
    });

    await expect(tool.execute("tc-start-empty-graph", {
      title: "空图谱世界",
      premise: "播种失败不能广播成功。",
      initialScene: "门外有人敲了三下。",
    })).rejects.toThrow("没有生成可用的玩家与世界图谱");
    await expect(new PlayStore(root).loadWorld(sessionId)).resolves.toBeNull();
  });

  it("runs opening seeding inside the abort scope and does not swallow user cancellation", async () => {
    const sessionId = "1700000000000-abort1";
    const controller = new AbortController();
    const runWithAgentContext = vi.fn(async (
      context: { readonly signal?: AbortSignal },
      task: () => Promise<unknown>,
    ) => {
      context.signal?.throwIfAborted();
      return task();
    });
    const pipeline = {
      createAgentContext: vi.fn(() => ({})),
      runWithAgentContext,
    };
    const seedOpening = vi.fn(async (_input: { sceneText: string; suggestedActions?: readonly string[] }) => null);
    const tool = createPlayStartTool(pipeline as never, root, sessionId, undefined, {
      runnerFactory: ({ db }) => ({
        seedOpening: async (...args) => {
          seedReadyGraph(db);
          return seedOpening(...args);
        },
      }),
    });

    await tool.execute("tc-start-abort-scope", {
      title: "雨夜档案",
      premise: "玩家在县医院档案室值夜班。",
      initialScene: "档案柜里只有一张无名婴儿照片。",
    }, controller.signal);

    expect(runWithAgentContext).toHaveBeenCalledWith(
      { signal: controller.signal, activatedSkills: [] },
      expect.any(Function),
    );

    const cancelledSessionId = "1700000000000-abort2";
    const cancelled = new AbortController();
    cancelled.abort();
    const cancelledTool = createPlayStartTool(pipeline as never, root, cancelledSessionId);
    await expect(cancelledTool.execute("tc-start-aborted", {
      title: "不应创建",
      premise: "这个世界不应在取消后落盘。",
    }, cancelled.signal)).rejects.toThrow();
    await expect(new PlayStore(root).loadWorld(cancelledSessionId)).resolves.toBeNull();
  });

  it("advances the play world bound to the session", async () => {
    const sessionId = "1700000000000-bbbb02";
    const store = new PlayStore(root);
    await store.createWorld({
      id: sessionId,
      title: "雨夜茶馆",
      premise: "玩家扮演茶馆老板。",
      mode: "open",
    });
    await store.ensureRun(sessionId, "main");
    await store.writeProjection(sessionId, "main", "projections/scene.md", "柜台上有一本潮湿账本。\n");

    const runnerFactory = vi.fn(() => ({ step: vi.fn(async () => STEP_RESULT) }));
    const tool = createPlayStepTool(pipelineStub(), root, sessionId, { runnerFactory });

    const result = await tool.execute("tc-step", {
      input: "我翻开账本看最后一页",
    });

    expect(runnerFactory).toHaveBeenCalledWith(expect.objectContaining({
      worldId: sessionId,
      runId: "main",
    }));
    expect(result.details).toMatchObject({
      kind: "play_turn_advanced",
      worldId: sessionId,
      runId: "main",
      sceneText: "你翻开账本，发现最后一页夹着一张旧船票。",
    });
  });

  it("runs Play inside its own professional Skill context", async () => {
    const sessionId = "1700000000000-skilled";
    const store = new PlayStore(root);
    await store.createWorld({
      id: sessionId,
      title: "雾港",
      premise: "玩家追查失踪的引航员。",
      mode: "open",
    });
    await store.ensureRun(sessionId, "main");
    const pipeline = pipelineStub();
    const playSkill = {
      skill: {
        id: "inkos-play-world",
        name: "Interactive world play",
        description: "Play method.",
        body: "Advance one adjacent dramatic beat.",
        source: "builtin" as const,
      },
      resources: [],
    };
    const tool = createPlayStepTool(pipeline, root, sessionId, {
      defaultSkills: [playSkill],
      runnerFactory: () => ({ step: vi.fn(async () => STEP_RESULT) }),
    });

    const result = await tool.execute("tc-step-skilled", { input: "检查码头绳结" });

    expect(pipeline.runWithAgentContext).toHaveBeenCalledWith(
      { signal: undefined, activatedSkills: [playSkill] },
      expect.any(Function),
    );
    expect(result.details).toMatchObject({
      kind: "play_turn_advanced",
      skillIds: ["inkos-play-world"],
    });
  });

  it("revises the latest play turn through the session-bound world", async () => {
    const sessionId = "1700000000000-revise1";
    const store = new PlayStore(root);
    await store.createWorld({
      id: sessionId,
      title: "雨夜茶馆",
      premise: "玩家扮演茶馆老板。",
      mode: "open",
    });
    await store.ensureRun(sessionId, "main");

    const regenerateLastTurn = vi.fn(async () => REPLAY_RESULT);
    const restoreVariant = vi.fn();
    const runnerFactory = vi.fn(() => ({ regenerateLastTurn, restoreVariant }));
    const tool = createPlayReviseTool(pipelineStub(), root, sessionId, { runnerFactory });

    const result = await tool.execute("tc-revise", {
      action: "edit_last_input",
      input: "我先检查账本夹层",
    });

    expect(runnerFactory).toHaveBeenCalledWith(expect.objectContaining({
      worldId: sessionId,
      runId: "main",
    }));
    expect(regenerateLastTurn).toHaveBeenCalledWith("我先检查账本夹层");
    expect(result.details).toMatchObject({
      kind: "play_turn_revised",
      worldId: sessionId,
      runId: "main",
      sceneText: "你重新翻开账本，这次先看见夹层里的红色印章。",
      replayedInput: "我先检查账本夹层",
      previousVariantId: "v-old",
      variantId: "v-new",
    });
  });

  it("restores a saved play turn variant through the revise tool", async () => {
    const sessionId = "1700000000000-revise2";
    const store = new PlayStore(root);
    await store.createWorld({
      id: sessionId,
      title: "雨夜茶馆",
      premise: "玩家扮演茶馆老板。",
      mode: "open",
    });
    await store.ensureRun(sessionId, "main");

    const regenerateLastTurn = vi.fn();
    const restoreVariant = vi.fn(async () => ({
      turn: 1,
      variantId: "v-old",
      sceneText: "你切回旧版本：旧船票仍夹在账本末页。",
    }));
    const tool = createPlayReviseTool(pipelineStub(), root, sessionId, {
      runnerFactory: vi.fn(() => ({ regenerateLastTurn, restoreVariant })),
    });

    const result = await tool.execute("tc-restore", {
      action: "restore_variant",
      turn: 1,
      variantId: "v-old",
    });

    expect(restoreVariant).toHaveBeenCalledWith({ turn: 1, variantId: "v-old" });
    expect(result.details).toMatchObject({
      kind: "play_variant_restored",
      turn: 1,
      variantId: "v-old",
      sceneText: "你切回旧版本：旧船票仍夹在账本末页。",
    });
  });

  it("uses the player-chosen playMode for the world, overriding the tool param", async () => {
    const sessionId = "1700000000000-cccc03";
    const tool = createReadyPlayStartTool(root, sessionId, "guided");
    await tool.execute("tc-mode", { title: "选项局", initialScene: "开场。" });
    const store = new PlayStore(root);
    await expect(store.loadWorld(sessionId)).resolves.toMatchObject({ mode: "guided" });
  });

  it("advances each session's own world, not the most recently created one", async () => {
    // Regression: play_step used to pick the globally newest world, so two
    // concurrent play sessions would advance each other's world. The world is
    // now bound to the session id, so session A always advances A's world even
    // when session B's world was created later.
    const sessionA = "1700000000000-aaaaaa";
    const sessionB = "1700000000001-bbbbbb";

    await createReadyPlayStartTool(root, sessionA).execute("tc-a", {
      title: "世界A",
      initialScene: "A 的开场。",
    });
    // World B is created AFTER A, so it is the most-recently-updated world.
    await createReadyPlayStartTool(root, sessionB).execute("tc-b", {
      title: "世界B",
      initialScene: "B 的开场。",
    });

    const runnerFactory = vi.fn(() => ({ step: vi.fn(async () => STEP_RESULT) }));
    const tool = createPlayStepTool(pipelineStub(), root, sessionA, { runnerFactory });
    const result = await tool.execute("tc-step-a", { input: "我在 A 世界行动" });

    expect(runnerFactory).toHaveBeenCalledWith(expect.objectContaining({
      worldId: sessionA,
    }));
    expect(result.details).toMatchObject({
      kind: "play_turn_advanced",
      worldId: sessionA,
    });
  });
});
