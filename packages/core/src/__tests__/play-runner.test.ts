import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PlayActionIntentInput,
  PlayEdge,
  PlayEdgeInput,
  PlayEntity,
  PlayEntityInput,
  PlayEventInput,
  PlayMutationInput,
  PlayStateSlot,
  PlayStateSlotInput,
} from "../models/play.js";
import { PlayRunner } from "../play/play-runner.js";
import type { PlaySceneRender } from "../play/play-agents.js";
import { PlayStore, type PlayTranscriptTurn } from "../play/play-store.js";
import type { PlayGraphSnapshot } from "../play/play-file-db.js";

class FakePlayDB {
  entities = new Map<string, PlayEntity>();
  edges = new Map<string, PlayEdge>();
  stateSlots = new Map<string, PlayStateSlot>();
  events: PlayEventInput[] = [];

  transaction<T>(fn: () => T): T {
    return fn();
  }

  upsertEntity(entity: PlayEntityInput): void {
    this.entities.set(entity.id, { summary: "", status: "", ...entity });
  }

  getEntity(id: string): PlayEntity | null {
    return this.entities.get(id) ?? null;
  }

  upsertEdge(edge: PlayEdgeInput): void {
    this.edges.set(edge.id, {
      value: {},
      validUntilEventId: null,
      visibility: {},
      ...edge,
    });
  }

  expireEdge(edgeId: string, validUntilEventId: string): void {
    const edge = this.edges.get(edgeId);
    if (edge) this.edges.set(edgeId, { ...edge, validUntilEventId });
  }

  upsertStateSlot(slot: PlayStateSlotInput): void {
    this.stateSlots.set(slot.id, { ownerEntityId: null, ...slot });
  }

  getStateSlotsForEntity(entityId: string): PlayStateSlot[] {
    return [...this.stateSlots.values()].filter((slot) => slot.ownerEntityId === entityId);
  }

  recordEvent(event: PlayEventInput): void {
    this.events.push(event);
  }

  snapshot(): PlayGraphSnapshot {
    return {
      entities: [...this.entities.values()],
      edges: [...this.edges.values()],
      stateSlots: [...this.stateSlots.values()],
      events: this.events as PlayGraphSnapshot["events"],
    };
  }

  replaceWithSnapshot(snapshot: PlayGraphSnapshot): void {
    this.entities = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
    this.edges = new Map(snapshot.edges.map((edge) => [edge.id, edge]));
    this.stateSlots = new Map(snapshot.stateSlots.map((slot) => [slot.id, slot]));
    this.events = [...snapshot.events];
  }
}

class FailingTranscriptStore extends PlayStore {
  private failed = false;

  override async appendTranscriptTurn(
    worldId: string,
    runId: string,
    turn: PlayTranscriptTurn,
  ): Promise<void> {
    if (!this.failed && turn.role === "assistant") {
      this.failed = true;
      throw new Error("simulated transcript persistence failure");
    }
    await super.appendTranscriptTurn(worldId, runId, turn);
  }
}

describe("PlayRunner", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-play-runner-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("runs one player action end to end and persists event, transcript, and projections", async () => {
    const db = new FakePlayDB();
    const action: PlayActionIntentInput = {
      actionKind: "look",
      targetEntityLabel: "导航记录",
      intent: "查看常用地址统计",
    };
    const mutation: PlayMutationInput = {
      eventId: "evt-1",
      turn: 1,
      actionKind: "look",
      summary: "发现新城花园 187 次。",
      timeAdvance: {
        elapsed: "几秒",
        anchor: "仍在停车场刚上车的片刻",
        rationale: "宋词只是顺手点开车机记录。",
        synchronized: ["徐晋安放完东西坐进车里，尚未察觉她看见统计。"],
      },
      entities: {
        upsert: [
          { id: "player", type: "actor", label: "宋词" },
          { id: "nav-stats", type: "evidence", label: "常用地址统计" },
        ],
      },
      edges: {
        upsert: [
          { fromId: "player", type: "持有", toId: "nav-stats", value: { role: "holding" } },
        ],
      },
      stateSlots: {
        upsert: [{
          id: "pressure:player:danger",
          ownerEntityId: "player",
          kind: "pressure",
          label: "被发现风险",
          value: { current: 20, min: 0, max: 100 },
          updatedEventId: "evt-1",
        }],
      },
      evidence: {
        transitions: [{
          entityId: "nav-stats",
          to: "seen",
          reason: "车机弹出统计。",
        }],
      },
    };
    const render: PlaySceneRender = {
      sceneText: "屏幕弹出新城花园 187 次，宋词握着手机没有抬头。",
      suggestedActions: ["继续看医院记录", "问徐晋安今晚去哪"],
    };

    const renderSpy = vi.fn(async (_input: unknown) => render);
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "betrayal-car",
      runId: "run-1",
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => action) },
        worldMutator: { proposeMutation: vi.fn(async () => mutation) },
        sceneRenderer: { render: renderSpy },
      },
    });

    const result = await runner.step("我假装看天气，顺手点开车机导航记录");

    expect(result.sceneText).toContain("新城花园");
    expect(result.suggestedActions).toEqual(["继续看医院记录", "问徐晋安今晚去哪"]);
    expect(db.events).toHaveLength(1);
    expect(db.entities.get("nav-stats")?.type).toBe("evidence");
    const renderInput = renderSpy.mock.calls[0]?.[0] as { stateBrief: string } | undefined;
    expect(renderInput?.stateBrief).toContain("player -[持有 role=holding]-> nav-stats");
    expect(renderInput?.stateBrief).toContain("## Time");
    expect(renderInput?.stateBrief).toContain("elapsed: 几秒");
    expect(renderInput?.stateBrief).toContain("anchor: 仍在停车场刚上车的片刻");
    expect(db.stateSlots.get("evidence:nav-stats:status")?.value).toMatchObject({ status: "seen" });

    const runDir = join(root, "worlds", "betrayal-car", "runs", "run-1");
    await expect(readFile(join(runDir, "events.jsonl"), "utf-8"))
      .resolves.toContain("\"id\":\"evt-1\"");
    await expect(readFile(join(runDir, "events.jsonl"), "utf-8"))
      .resolves.toContain("\"elapsed\":\"几秒\"");
    await expect(readFile(join(runDir, "events.jsonl"), "utf-8"))
      .resolves.toContain("\"anchor\":\"仍在停车场刚上车的片刻\"");
    await expect(readFile(join(runDir, "transcript.jsonl"), "utf-8"))
      .resolves.toContain("我假装看天气");
    await expect(readFile(join(runDir, "projections", "state.md"), "utf-8"))
      .resolves.toContain("发现新城花园 187 次");
    await expect(readFile(join(runDir, "state", "current.json"), "utf-8"))
      .resolves.toContain("\"elapsed\": \"几秒\"");
    await expect(readFile(join(runDir, "state", "current.json"), "utf-8"))
      .resolves.toContain("\"anchor\": \"仍在停车场刚上车的片刻\"");
    await expect(readFile(join(runDir, "projections", "scene.md"), "utf-8"))
      .resolves.toContain("屏幕弹出新城花园 187 次");
    await expect(readFile(join(runDir, "status.json"), "utf-8"))
      .resolves.toContain('"status": "complete"');
  });

  it("rolls back graph and run files when a turn fails during persistence", async () => {
    const db = new FakePlayDB();
    const store = new FailingTranscriptStore(root);
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "rollback-world",
      runId: "main",
      store,
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => ({ actionKind: "look", intent: "检查门缝" })) },
        worldMutator: {
          proposeMutation: vi.fn(async () => ({
            eventId: "evt-1",
            turn: 1,
            actionKind: "look",
            summary: "门缝里出现一张票根。",
            entities: { upsert: [{ id: "ticket", type: "evidence", label: "旧票根" }] },
          })),
        },
        sceneRenderer: { render: vi.fn(async () => ({ sceneText: "门缝里压着一张旧票根。", suggestedActions: [] })) },
      },
    });

    await expect(runner.step("检查门缝")).rejects.toThrow("simulated transcript persistence failure");
    expect(db.events).toHaveLength(0);
    expect(db.entities.has("ticket")).toBe(false);

    const runDir = join(root, "worlds", "rollback-world", "runs", "main");
    await expect(readFile(join(runDir, "events.jsonl"), "utf-8")).resolves.toBe("");
    await expect(readFile(join(runDir, "transcript.jsonl"), "utf-8")).resolves.toBe("");
    await expect(readFile(join(runDir, "status.json"), "utf-8"))
      .resolves.toContain('"status": "failed"');
  });

  it("does not commit state when scene rendering fails", async () => {
    const db = new FakePlayDB();
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "render-failure",
      runId: "main",
      db,
      agents: {
        actionInterpreter: {
          interpret: vi.fn(async () => ({ actionKind: "look" as const, intent: "检查封条" })),
        },
        worldMutator: {
          proposeMutation: vi.fn(async () => ({
            eventId: "evt-1",
            turn: 1,
            actionKind: "look" as const,
            summary: "玩家发现封条有新划痕。",
            entities: {
              upsert: [{ id: "evidence_seal", type: "evidence" as const, label: "封条划痕" }],
            },
          })),
        },
        sceneRenderer: {
          render: vi.fn(async () => {
            throw new Error("Model did not submit_play_scene");
          }),
        },
      },
    });

    await expect(runner.step("检查封条")).rejects.toThrow("submit_play_scene");

    expect(db.events).toHaveLength(0);
    expect(db.entities.has("evidence_seal")).toBe(false);
    const runDir = join(root, "worlds", "render-failure", "runs", "main");
    await expect(readFile(join(runDir, "events.jsonl"), "utf-8")).rejects.toThrow();
    await expect(readFile(join(runDir, "projections", "scene.md"), "utf-8")).rejects.toThrow();
    await expect(readFile(join(runDir, "transcript.jsonl"), "utf-8")).rejects.toThrow();
  });

  it("seeds opening graph state without consuming the first player turn", async () => {
    const db = new FakePlayDB();
    const store = new PlayStore(root);
    await store.createWorld({
      id: "opening-seed",
      title: "雨夜档案",
      premise: "玩家是县医院档案室临时工，暴雨夜寻找二十年前的手术记录。",
      language: "zh",
    });
    await store.ensureRun("opening-seed", "main");
    await store.writeProjection("opening-seed", "main", "projections/scene.md", "档案柜里只有一张无名婴儿照片。\n");

    const seedMutation: PlayMutationInput = {
      eventId: "evt-0",
      turn: 0,
      actionKind: "look",
      summary: "播种开场已成立的档案室状态。",
      entities: {
        upsert: [
          { id: "actor_player", type: "actor", label: "我", summary: "县医院档案室临时工。", status: "值夜班", updatedEventId: "evt-0" },
          { id: "evidence_baby_photo", type: "evidence", label: "无名婴儿照片", summary: "替代手术记录出现的照片。", status: "已发现", updatedEventId: "evt-0" },
        ],
      },
      edges: {
        upsert: [
          { id: "edge_actor_player_持有_evidence_baby_photo", fromId: "actor_player", type: "持有", toId: "evidence_baby_photo", value: { role: "holding", physical: true }, validFromEventId: "evt-0", sourceEventId: "evt-0" },
        ],
      },
      stateSlots: {
        upsert: [
          { id: "slot_callback_timer", kind: "timer", label: "护士长回拨倒计时", value: 15, updatedEventId: "evt-0" },
        ],
      },
    };
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "opening-seed",
      runId: "main",
      store,
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => ({ actionKind: "look", intent: "开场播种" })) },
        worldMutator: { proposeMutation: vi.fn(async () => seedMutation) },
        sceneRenderer: { render: vi.fn(async () => ({ sceneText: "不会被调用", suggestedActions: [] })) },
      },
    });

    const result = await runner.seedOpening({
      sceneText: "档案柜里只有一张无名婴儿照片。",
      suggestedActions: ["检查照片背面"],
    });

    expect(result?.mutation.turn).toBe(0);
    expect(db.entities.get("evidence_baby_photo")?.label).toBe("无名婴儿照片");
    expect([...db.edges.values()].some((edge) => edge.value?.role === "holding")).toBe(true);
    expect(db.stateSlots.get("slot_callback_timer")?.value).toBe(15);
    expect(db.events).toHaveLength(0);
    await expect(readFile(join(root, "worlds", "opening-seed", "runs", "main", "events.jsonl"), "utf-8"))
      .rejects
      .toThrow();
    await expect(readFile(join(root, "worlds", "opening-seed", "runs", "main", "projections", "state.md"), "utf-8"))
      .resolves
      .toContain("无名婴儿照片");
  });

  it("reconciles opening prose into the graph when the opening mutator returns no facts", async () => {
    const db = new FakePlayDB();
    const store = new PlayStore(root);
    await store.createWorld({
      id: "opening-reconcile",
      title: "零点十七分的隧道",
      premise: "玩家是公交司机，对车上十名乘客负责。一个哮喘儿童由母亲抱着，老人要回去拿胰岛素。",
      language: "zh",
    });
    await store.ensureRun("opening-reconcile", "main");

    const reconcile = vi.fn(async () => ({
      eventId: "evt-0",
      turn: 0,
      actionKind: "look" as const,
      summary: "补记开场已经出现的司机、母亲、孩子和老人。",
      entities: {
        upsert: [
          { id: "actor_player", type: "actor" as const, label: "公交司机", summary: "对十名乘客负责。", updatedEventId: "evt-0" },
          { id: "actor_mother", type: "actor" as const, label: "母亲", summary: "抱着哮喘儿童。", updatedEventId: "evt-0" },
          { id: "actor_child", type: "actor" as const, label: "哮喘儿童", summary: "缺的是他的哮喘药。", updatedEventId: "evt-0" },
          { id: "actor_elder", type: "actor" as const, label: "老人", summary: "需要取回自己的胰岛素。", updatedEventId: "evt-0" },
        ],
      },
      edges: {
        upsert: [{
          id: "edge_actor_mother_照顾_actor_child",
          fromId: "actor_mother",
          type: "照顾",
          toId: "actor_child",
          value: { role: "relation" },
          validFromEventId: "evt-0",
          sourceEventId: "evt-0",
        }],
      },
    }));
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "opening-reconcile",
      runId: "main",
      store,
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => ({ actionKind: "look", intent: "开场播种" })) },
        worldMutator: {
          proposeMutation: vi.fn(async () => ({ eventId: "evt-0", turn: 0, actionKind: "look" })),
        },
        sceneRenderer: { render: vi.fn(async () => ({ sceneText: "不会被调用", suggestedActions: [] })) },
        sceneReconciler: { reconcile },
      },
    });

    const sceneText = "你是司机。第三排的哮喘儿童被母亲抱着，老人说胰岛素落在行李舱。";
    const result = await runner.seedOpening({ sceneText, suggestedActions: [] });

    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({
      turn: 0,
      sceneText,
      context: expect.stringContaining("十名乘客"),
    }));
    expect(result?.mutation.entities.upsert).toHaveLength(4);
    expect(db.entities.get("actor_child")?.summary).toContain("他的哮喘药");
    expect([...db.edges.values()].some((edge) => edge.fromId === "actor_mother" && edge.toId === "actor_child")).toBe(true);
    expect(db.events).toHaveLength(0);
  });

  it("tells the opening seeder to turn already-held objects into holding edges", async () => {
    const db = new FakePlayDB();
    const store = new PlayStore(root);
    await store.createWorld({
      id: "opening-held-object",
      title: "雨季合租屋",
      premise: "玩家是刚搬来的住户，开场手里拿着房东给的备用钥匙。",
      language: "zh",
    });
    await store.ensureRun("opening-held-object", "main");
    await store.writeProjection("opening-held-object", "main", "projections/scene.md", "你站在门口，手里攥着备用钥匙。\n");

    let mutatorInput = "";
    const seedMutation: PlayMutationInput = {
      eventId: "evt-0",
      turn: 0,
      actionKind: "look",
      summary: "播种开场状态。",
      entities: {
        upsert: [
          { id: "actor_player", type: "actor", label: "刚搬来的住户", summary: "手里攥着备用钥匙。", status: "警觉", updatedEventId: "evt-0" },
          { id: "item_spare_key", type: "item", label: "备用钥匙", summary: "房东给的备用钥匙。", status: "已持有", updatedEventId: "evt-0" },
        ],
      },
      edges: {
        upsert: [
          { id: "edge_actor_player_持有_item_spare_key", fromId: "actor_player", type: "持有", toId: "item_spare_key", value: { role: "holding" }, validFromEventId: "evt-0", sourceEventId: "evt-0" },
        ],
      },
    };
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "opening-held-object",
      runId: "main",
      store,
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => ({ actionKind: "look", intent: "开场播种" })) },
        worldMutator: {
          proposeMutation: vi.fn(async (input) => {
            mutatorInput = input.input;
            return seedMutation;
          }),
        },
        sceneRenderer: { render: vi.fn(async () => ({ sceneText: "不会被调用", suggestedActions: [] })) },
      },
    });

    await runner.seedOpening({
      sceneText: "你站在门口，手里攥着备用钥匙。",
      suggestedActions: [],
    });

    expect(mutatorInput).toContain("已成立状态");
    expect(mutatorInput).toContain("actor_player");
    expect(mutatorInput).toContain("value.role=\"holding\"");
    expect(mutatorInput).toContain("不要把已持有实物只藏在玩家 summary");
    expect([...db.edges.values()].some((edge) => edge.toId === "item_spare_key" && edge.value?.role === "holding")).toBe(true);
  });

  it("does not persist a one-sided user transcript when mutation application fails", async () => {
    const db = new FakePlayDB();
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "bad-turn",
      runId: "run-1",
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => ({ actionKind: "look", intent: "看墙上的钟" })) },
        worldMutator: {
          proposeMutation: vi.fn(async () => ({
            eventId: "evt-1",
            turn: 1,
            actionKind: "look",
            summary: "错误地引用了不存在的人。",
            stateSlots: {
              upsert: [{
                id: "slot_missing",
                ownerEntityId: "missing_actor",
                kind: "pressure",
                label: "压力",
                value: 10,
                updatedEventId: "evt-1",
              }],
            },
          })),
        },
        sceneRenderer: { render: vi.fn(async () => ({ sceneText: "钟停在十二点。", suggestedActions: [] })) },
      },
    });

    await expect(runner.step("我看墙上的钟")).rejects.toThrow(/missing entity/);
    await expect(readFile(join(root, "worlds", "bad-turn", "runs", "run-1", "transcript.jsonl"), "utf-8"))
      .resolves
      .toBe("");
  });

  it("feeds the world premise and existing entity roster to the mutator so it can reuse ids", async () => {
    const db = new FakePlayDB();
    db.upsertEntity({
      id: "actor_laochen",
      type: "actor",
      label: "老陈",
      summary: "雨夜茶馆掌柜，知道镖队旧账。",
      status: "戒备",
      updatedEventId: "evt-0",
    });
    db.upsertEntity({
      id: "org_tieshou_escort",
      type: "organization",
      label: "铁手镖队",
      summary: "本地押镖组织，和旧账有关。",
      status: "盘踞城南",
      updatedEventId: "evt-0",
    });
    const store = new PlayStore(root);
    await store.createWorld({
      id: "rain-teahouse",
      title: "雨夜茶馆",
      premise: "玩家扮演阿福，雨夜茶馆跑堂，被一笔镖队旧账拖进江湖纠纷。",
      language: "zh",
      worldContract: "时间是世界同步轴：问话可能只过几分钟，赶路可能过半天，闭关可能跨年；老陈和铁手镖队会在同一段时间里按自己的目标行动，不能只等玩家触发。",
      visualContract: "旧账和镖队信物的重量通过纸张磨损、光线压迫和旁人反应体现，不要游戏 UI。",
    });
    await store.ensureRun("rain-teahouse", "run-1");
    await store.writeProjection("rain-teahouse", "run-1", "projections/scene.md", "雨夜茶馆里，老陈在柜台后拨算盘。\n");

    const action: PlayActionIntentInput = {
      actionKind: "say",
      targetEntityLabel: "老陈",
      intent: "问他旧账怎么回事",
    };
    const mutation: PlayMutationInput = {
      eventId: "evt-1",
      turn: 1,
      actionKind: "say",
      summary: "阿福向老陈追问镖队旧账。",
      edges: {
        upsert: [{
          id: "edge_ask_laochen",
          fromId: "actor_laochen",
          type: "被追问",
          toId: "org_tieshou_escort",
          validFromEventId: "evt-1",
          sourceEventId: "evt-1",
        }],
      },
    };
    let mutatorContext = "";
    const proposeMutation = vi.fn(async (input: { readonly context: string }) => {
      mutatorContext = input.context;
      return mutation;
    });

    const renderSpy = vi.fn(async (_input: unknown) => ({ sceneText: "老陈指节一顿，算盘珠子碰出一声脆响。", suggestedActions: [] }));
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "rain-teahouse",
      runId: "run-1",
      store,
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => action) },
        worldMutator: { proposeMutation },
        sceneRenderer: { render: renderSpy },
      },
    });

    await runner.step("我压低声音问老陈，铁手镖队那笔旧账到底是谁欠的？");

    expect(mutatorContext).toContain("世界设定");
    expect(mutatorContext).toContain("阿福");
    expect(mutatorContext).toContain("世界契约");
    expect(mutatorContext).toContain("时间是世界同步轴");
    expect(mutatorContext).toContain("视觉契约");
    expect(mutatorContext).toContain("不要游戏 UI");
    expect(mutatorContext).toContain("当前实体名册");
    expect(mutatorContext).toContain("actor_laochen [actor]: 老陈");
    expect(mutatorContext).toContain("org_tieshou_escort [organization]: 铁手镖队");
    expect(renderSpy).toHaveBeenCalledWith(expect.objectContaining({
      worldPremise: expect.stringContaining("世界契约"),
      context: expect.stringContaining("actor_laochen [actor]: 老陈"),
    }));
  });

  it("does not duplicate a reconciler summary that repeats the mutator summary", async () => {
    const db = new FakePlayDB();
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "summary-dedupe",
      runId: "main",
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => ({ actionKind: "wait", intent: "屏息观察" })) },
        worldMutator: {
          proposeMutation: vi.fn(async () => ({
            eventId: "evt-1",
            turn: 1,
            actionKind: "wait",
            summary: "你屏住呼吸，默默数着门外那人的呼吸节奏。",
          })),
        },
        sceneRenderer: {
          render: vi.fn(async () => ({
            sceneText: "门外的人也停了一息。",
            suggestedActions: [],
          })),
        },
        sceneReconciler: {
          reconcile: vi.fn(async () => ({
            eventId: "evt-1",
            turn: 1,
            actionKind: "wait",
            summary: "你屏住呼吸，默默数着门外那人的呼吸节奏。",
          })),
        },
      },
    });

    await runner.step("我不碰铜匣，先屏住呼吸。");

    expect(db.events[0]?.outcomeSummary).toBe("你屏住呼吸，默默数着门外那人的呼吸节奏。");
    await expect(readFile(join(root, "worlds", "summary-dedupe", "runs", "main", "events.jsonl"), "utf-8"))
      .resolves
      .not
      .toContain("；你屏住呼吸");
  });

  it("reconciles concrete entities introduced by renderer prose back into the graph", async () => {
    const db = new FakePlayDB();
    const action: PlayActionIntentInput = {
      actionKind: "look",
      intent: "检查抽屉夹层",
    };
    const mutation: PlayMutationInput = {
      eventId: "evt-1",
      turn: 1,
      actionKind: "look",
      summary: "玩家检查抽屉夹层。",
      entities: {
        upsert: [{
          id: "actor_player",
          type: "actor",
          label: "玩家",
          summary: "当前玩家角色。",
          status: "检查抽屉",
          updatedEventId: "evt-1",
        }],
      },
    };
    const sceneText = "抽屉夹层里卡着一只黑色U盘，边角被胶带缠过。";
    const reconcile = vi.fn(async () => ({
      eventId: "evt-1",
      turn: 1,
      actionKind: "look",
      summary: "补记场景正文中新出现的黑色U盘。",
      entities: {
        upsert: [{
          id: "item_black_usb",
          type: "item",
          label: "黑色U盘",
          summary: "抽屉夹层里发现的实物，可能存有关键资料。",
          status: "已发现",
          updatedEventId: "evt-1",
        }],
      },
      edges: {
        upsert: [{
          id: "edge_actor_player_持有_item_black_usb",
          fromId: "actor_player",
          type: "持有",
          toId: "item_black_usb",
          value: { role: "holding" },
          validFromEventId: "evt-1",
          sourceEventId: "evt-1",
        }],
      },
    }));
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "renderer-noun",
      runId: "run-1",
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => action) },
        worldMutator: { proposeMutation: vi.fn(async () => mutation) },
        sceneRenderer: { render: vi.fn(async () => ({ sceneText, suggestedActions: [] })) },
        sceneReconciler: { reconcile },
      },
    });

    await runner.step("我检查抽屉夹层");

    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ sceneText }));
    expect(db.entities.get("item_black_usb")?.label).toBe("黑色U盘");
    expect([...db.edges.values()].some((edge) => edge.toId === "item_black_usb" && edge.value?.role === "holding")).toBe(true);
    await expect(readFile(join(root, "worlds", "renderer-noun", "runs", "run-1", "projections", "state.md"), "utf-8"))
      .resolves
      .toContain("黑色U盘");
  });

  it("deduplicates same-id entity updates before writing the state projection", async () => {
    const db = new FakePlayDB();
    const action: PlayActionIntentInput = {
      actionKind: "look",
      intent: "观察白帆船间隔",
    };
    const mutation: PlayMutationInput = {
      eventId: "evt-1",
      turn: 1,
      actionKind: "look",
      summary: "玩家确认白帆船规律绕行。",
      entities: {
        upsert: [{
          id: "actor_white_sailboat",
          type: "actor",
          label: "白帆船",
          summary: "一艘没有航灯、没有登记的白帆船。",
          status: "绕行",
          updatedEventId: "evt-1",
        }],
      },
    };
    const reconcile = vi.fn(async () => ({
      eventId: "evt-1",
      turn: 1,
      actionKind: "look",
      summary: "玩家确认白帆船规律绕行。",
      entities: {
        upsert: [{
          id: "actor_white_sailboat",
          type: "actor",
          label: "白帆船",
          summary: "一艘没有航灯、没有登记的白帆船，正按灯光旋转周期规律绕行。",
          status: "规律绕行",
          updatedEventId: "evt-1",
        }],
      },
    }));
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "dedupe-projection",
      runId: "run-1",
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => action) },
        worldMutator: { proposeMutation: vi.fn(async () => mutation) },
        sceneRenderer: { render: vi.fn(async () => ({ sceneText: "白帆船再次滑进光锥。", suggestedActions: [] })) },
        sceneReconciler: { reconcile },
      },
    });

    await runner.step("我数白帆船下一次进灯光边缘的间隔");

    const state = await readFile(join(root, "worlds", "dedupe-projection", "runs", "run-1", "projections", "state.md"), "utf-8");
    expect(state.match(/actor_white_sailboat/g)?.length).toBe(1);
    expect(state).toContain("正按灯光旋转周期规律绕行");
    expect(state).not.toContain("一艘没有航灯、没有登记的白帆船。");
  });

  it("regenerates the latest turn from a checkpoint and keeps both variants", async () => {
    const db = new FakePlayDB();
    const store = new PlayStore(root);
    await store.createWorld({
      id: "regenerate-turn",
      title: "雨夜车站",
      premise: "玩家在末班车站台追查一张旧车票。",
      language: "zh",
    });
    await store.ensureRun("regenerate-turn", "main");
    await store.writeProjection("regenerate-turn", "main", "projections/scene.md", "末班车还没进站。\n");

    let version = "A";
    const renderInputs: unknown[] = [];
    const renderReplay = vi.fn(async (input: unknown) => {
      renderInputs.push(input);
      return {
        sceneText: `版本${version}：旧车票从长椅缝里露出一角。`,
        suggestedActions: [`继续追查版本${version}`],
      };
    });
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "regenerate-turn",
      runId: "main",
      store,
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => ({ actionKind: "look", intent: "查看旧车票" })) },
        worldMutator: {
          proposeMutation: vi.fn(async () => ({
            eventId: "evt-1",
            turn: 1,
            actionKind: "look",
            summary: `记录版本${version}的车票发现。`,
            entities: {
              upsert: [{
                id: `evidence_ticket_${version.toLowerCase()}`,
                type: "evidence",
                label: `版本${version}旧车票`,
                summary: "站台上发现的旧车票。",
                status: "已发现",
                updatedEventId: "evt-1",
              }],
            },
          })),
        },
        sceneRenderer: { render: renderReplay },
      },
    });

    await runner.step("我检查长椅缝隙");
    version = "B";
    const replay = await runner.regenerateLastTurn();

    expect(replay.replayedInput).toBe("我检查长椅缝隙");
    expect(replay.sceneText).toContain("版本B");
    expect(replay.previousVariantId).toBeTruthy();
    expect(replay.variantId).toBeTruthy();
    const replayRenderInput = renderInputs[1] as { replayContext?: string } | undefined;
    expect(replayRenderInput?.replayContext).toContain("重写上一回合");
    expect(replayRenderInput?.replayContext).toContain("不得倒退时间");
    expect(replayRenderInput?.replayContext).toContain("不要加入玩家没有做的新动作");
    expect(db.events).toHaveLength(1);
    expect(db.entities.has("evidence_ticket_a")).toBe(false);
    expect(db.entities.has("evidence_ticket_b")).toBe(true);

    const runDir = join(root, "worlds", "regenerate-turn", "runs", "main");
    await expect(readFile(join(runDir, "events.jsonl"), "utf-8"))
      .resolves
      .toContain("记录版本B的车票发现");
    await expect(readFile(join(runDir, "projections", "scene.md"), "utf-8"))
      .resolves
      .toContain("版本B");
    await expect(readFile(join(runDir, "variants", "turn-1", `${replay.previousVariantId}.json`), "utf-8"))
      .resolves
      .toContain("版本A");
    await expect(readFile(join(runDir, "variants", "turn-1", `${replay.variantId}.json`), "utf-8"))
      .resolves
      .toContain("版本B");
  });

  it("close() does not close a caller-provided db", () => {
    const db = new FakePlayDB() as FakePlayDB & { close: () => void };
    db.close = vi.fn();
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "close-owned-db",
      runId: "main",
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn() },
        worldMutator: { proposeMutation: vi.fn() },
        sceneRenderer: { render: vi.fn() },
      },
    });

    runner.close();

    expect(db.close).not.toHaveBeenCalled();
  });

  it("close() releases the self-created db and is idempotent", async () => {
    const store = new PlayStore(root);
    await store.createWorld({
      id: "close-self-db",
      title: "收摊测试",
      premise: "验证 runner 自建数据库连接会被关闭。",
      language: "zh",
      mode: "open",
    });
    await store.ensureRun("close-self-db", "main");
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "close-self-db",
      runId: "main",
      agents: {
        actionInterpreter: { interpret: vi.fn() },
        worldMutator: { proposeMutation: vi.fn() },
        sceneRenderer: { render: vi.fn() },
      },
    });

    runner.close();
    // Windows 上句柄未释放会让 play.db 无法删除；这里至少保证重复 close 不抛异常。
    runner.close();

    await expect(rm(join(root, "worlds", "close-self-db"), { recursive: true })).resolves.toBeUndefined();
  });
});
