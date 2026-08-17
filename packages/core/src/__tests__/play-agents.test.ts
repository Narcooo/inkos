import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PlayActionInterpreterAgent,
  PlaySceneReconcilerAgent,
  PlaySceneRendererAgent,
  PlayWorldMutatorAgent,
  buildSceneRendererSystemPrompt,
} from "../play/play-agents.js";
import { PlayMutationSchema } from "../models/play.js";

const ctx = {
  client: { provider: "openai" } as never,
  model: "test-model",
  projectRoot: "/tmp/inkos-play-test",
};

describe("play agents", () => {
  it("interprets free user text into a bounded play action", async () => {
    const agent = new PlayActionInterpreterAgent(ctx);
    vi.spyOn(agent as unknown as { chat: PlayActionInterpreterAgent["chat"] }, "chat").mockResolvedValue({
      content: JSON.stringify({
        actionKind: "look",
        targetEntityLabel: "导航记录",
        intent: "查看常用地址统计",
        manner: "不让丈夫发现",
      }),
    } as never);

    await expect(agent.interpret({
      input: "我假装看天气，顺手点开车机导航记录",
      sceneBrief: "车内，丈夫刚把东西放进后备箱。",
    })).resolves.toMatchObject({
      actionKind: "look",
      targetEntityLabel: "导航记录",
      intent: "查看常用地址统计",
    });
  });

  it("keeps host-owned turn metadata authoritative when mutator output drifts", async () => {
    const agent = new PlayWorldMutatorAgent(ctx);
    vi.spyOn(agent as any, "submitStructured").mockResolvedValue({});

    const mutation = await agent.proposeMutation({
      turn: 1,
      input: "我打开导航",
      action: { actionKind: "look", intent: "查看导航" },
      context: "车内。",
    });
    expect(mutation.actionKind).toBe("look");
    expect(mutation.eventId).toBe("evt-1");
    expect(mutation.turn).toBe(1);
    expect(mutation.entities.upsert).toEqual([]);
  });

  it("repairs an empty mutator response instead of treating it as a completed state transition", async () => {
    const agent = new PlayWorldMutatorAgent(ctx);
    const submit = vi.spyOn(agent as any, "submitStructured")
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        summary: "司机确认母亲说的是孩子的哮喘药。",
        entities: [{
          id: "actor_child",
          type: "actor",
          label: "哮喘儿童",
          summary: "母亲怀里的孩子，缺的是他的哮喘药。",
        }],
      });

    const mutation = await agent.proposeMutation({
      turn: 4,
      input: "问母亲孩子的药还能撑多久",
      action: { actionKind: "say", intent: "询问孩子的药量" },
      context: "actor_mother 是 actor_child 的母亲；缺的是孩子的哮喘药。",
      language: "zh",
    });

    expect(submit).toHaveBeenCalledTimes(2);
    expect(mutation).toMatchObject({
      eventId: "evt-4",
      turn: 4,
      actionKind: "say",
      blocked: false,
    });
    expect(mutation.entities.upsert[0]?.label).toBe("哮喘儿童");
  });

  it("returns a visible blocked no-op when mutator repair still has no state result", async () => {
    const agent = new PlayWorldMutatorAgent(ctx);
    const submit = vi.spyOn(agent as any, "submitStructured").mockResolvedValue({});

    const mutation = await agent.proposeMutation({
      turn: 3,
      input: "继续问清楚",
      action: { actionKind: "say", intent: "追问关键信息" },
      context: "当前场景。",
      language: "zh",
    });

    expect(submit).toHaveBeenCalledTimes(2);
    expect(mutation).toMatchObject({
      eventId: "evt-3",
      turn: 3,
      actionKind: "say",
      blocked: true,
    });
    expect(mutation.blockedReason).toContain("状态变更");
  });

  it("uses the structured result schema without embedding example story data", async () => {
    const agent = new PlayWorldMutatorAgent(ctx);
    const submit = vi.spyOn(agent as any, "submitStructured").mockResolvedValue({ blocked: true, blockedReason: "测试" });

    await agent.proposeMutation({
      turn: 1,
      input: "我问老陈",
      action: { actionKind: "say", intent: "追问旧账" },
      context: "当前实体名册：actor_afu [actor]: 阿福",
      language: "zh",
    });

    const messages = submit.mock.calls[0]?.[0] as ReadonlyArray<{ readonly role: string; readonly content: string }>;
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    expect(system).not.toContain("周野");
    expect(system).not.toContain("账房先生");
    expect(system).not.toContain("示例线索");
    expect(system).not.toContain("示例钥匙");
    expect(system).not.toContain("actor_counterpart");
    expect(system).toContain("submit_world_mutation");
  });

  it("treats actor_player as the reserved player id in the Chinese mutator prompt", async () => {
    const agent = new PlayWorldMutatorAgent(ctx);
    const submit = vi.spyOn(agent as any, "submitStructured").mockResolvedValue({ blocked: true, blockedReason: "测试" });

    await agent.proposeMutation({
      turn: 1,
      input: "我检查背包里的车票",
      action: { actionKind: "look", intent: "检查车票" },
      context: "当前实体名册：actor_player [actor]: 临时维修员",
      language: "zh",
    });

    const messages = submit.mock.calls[0]?.[0] as ReadonlyArray<{ readonly role: string; readonly content: string }>;
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    expect(system).toContain("actor_player");
    expect(system).toContain("固定保留字");
    expect(system).toContain("绝不要把它改成");
  });

  it("treats actor_player as the reserved player id in the English mutator prompt", async () => {
    const agent = new PlayWorldMutatorAgent(ctx);
    const submit = vi.spyOn(agent as any, "submitStructured").mockResolvedValue({ blocked: true, blockedReason: "test" });

    await agent.proposeMutation({
      turn: 1,
      input: "I check the ticket in my bag.",
      action: { actionKind: "look", intent: "check the ticket" },
      context: "Entity roster: actor_player [actor]: night mechanic",
      language: "en",
    });

    const messages = submit.mock.calls[0]?.[0] as ReadonlyArray<{ readonly role: string; readonly content: string }>;
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    expect(system).toContain("The player entity id is fixed");
    expect(system).toContain("actor_player");
    expect(system).toContain("Never rename this id");
  });

  it("does not default to numeric meters when the world contract rejects panels or stats", async () => {
    const agent = new PlayWorldMutatorAgent(ctx);
    const submit = vi.spyOn(agent as any, "submitStructured").mockResolvedValue({ blocked: true, blockedReason: "测试" });

    await agent.proposeMutation({
      turn: 1,
      input: "我等照片完全显影，不打开任何系统面板。",
      action: { actionKind: "wait", intent: "等待照片显影并观察细节" },
      context: [
        "世界契约（高优先级，先于题材惯例）：",
        "不要 RPG、战斗、数值或等级。证据可信度只用自然语言表达，不要游戏面板。",
      ].join("\n"),
      language: "zh",
    });

    const messages = submit.mock.calls[0]?.[0] as ReadonlyArray<{ readonly role: string; readonly content: string }>;
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    expect(system).toContain("世界契约禁止数值");
    expect(system).toContain("不要输出 stateSlots");
    expect(system).toContain("自然语言状态");
  });

  it("loads project Play prompt-pack overrides into the mutator system prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-play-prompt-"));
    try {
      await mkdir(join(root, "prompt", "play"), { recursive: true });
      await writeFile(join(root, "prompt", "play", "mutator.md"), "PROJECT MUTATOR OVERRIDE: honor lantern rarity by atmosphere.");
      const agent = new PlayWorldMutatorAgent({ ...ctx, projectRoot: root });
      const submit = vi.spyOn(agent as any, "submitStructured").mockResolvedValue({ blocked: true, blockedReason: "测试" });

      await agent.proposeMutation({
        turn: 1,
        input: "我检查蓝色提灯",
        action: { actionKind: "look", intent: "检查蓝色提灯" },
        context: "世界契约：稀有度通过氛围表达。",
        language: "zh",
      });

      const messages = submit.mock.calls[0]?.[0] as ReadonlyArray<{ readonly role: string; readonly content: string }>;
      const system = messages.find((message) => message.role === "system")?.content ?? "";
      expect(system).toContain("Prompt Pack Guidance");
      expect(system).toContain("PROJECT MUTATOR OVERRIDE");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps beat-writing methodology out of the mutator protocol prompt", async () => {
    const agent = new PlayWorldMutatorAgent(ctx);
    const submit = vi.spyOn(agent as any, "submitStructured").mockResolvedValue({ blocked: true, blockedReason: "测试" });

    await agent.proposeMutation({
      turn: 1,
      input: "我冲下台阶去拔那把战斧",
      action: { actionKind: "do", intent: "冲下台阶并拔起战斧" },
      context: "当前场景：敌人正在合围，战斧在庭院废墟中。",
      language: "zh",
    });

    const messages = submit.mock.calls[0]?.[0] as ReadonlyArray<{ readonly role: string; readonly content: string }>;
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    expect(system).not.toContain("只推进相邻一拍");
    expect(system).not.toContain("不要替玩家越过过程");
    expect(system).toContain("submit_world_mutation");
  });

  it("renderer treats player negation and applied time as canonical", async () => {
    const prompt = buildSceneRendererSystemPrompt("open", "zh");
    expect(prompt).toContain("elapsed 和 anchor 是权威时间");
    expect(prompt).toContain("不得另写");
  });

  it("leaves scene-writing methodology to the Play Skill", () => {
    const prompt = buildSceneRendererSystemPrompt("open", "zh");
    expect(prompt).not.toContain("先承接玩家动作");
    expect(prompt).not.toContain("不要写总结性尾声");
    expect(prompt).toContain("suggestedActions");
  });

  it("renders from the authoritative pre-action context plus applied state", async () => {
    const agent = new PlaySceneRendererAgent(ctx);
    const submit = vi.spyOn(agent as any, "submitStructured").mockResolvedValue({
      sceneText: "车机屏幕亮了一下，常用地址统计弹出一行冷冰冰的数字。",
      suggestedActions: ["继续翻看医院记录", "套徐晋安的话"],
    });

    await expect(agent.render({
      input: "看导航",
      action: { actionKind: "look", intent: "查看导航" },
      mutationSummary: "发现新城花园 187 次。",
      stateBrief: "证据：常用地址统计=seen。",
      context: "当前实体名册：actor_husband [actor]: 丈夫。\n当前场景：丈夫仍坐在副驾驶。",
    })).resolves.toMatchObject({
      sceneText: expect.stringContaining("车机屏幕"),
      suggestedActions: ["继续翻看医院记录", "套徐晋安的话"],
    });

    const messages = submit.mock.calls[0]?.[0] as ReadonlyArray<{ readonly role: string; readonly content: string }>;
    const user = messages.find((message) => message.role === "user")?.content ?? "";
    expect(user).toContain("本回合前的权威上下文");
    expect(user).toContain("actor_husband [actor]: 丈夫");
    expect(submit.mock.calls[0]?.[1]).toMatchObject({ name: "submit_play_scene" });
  });

  it("loads project Play prompt-pack overrides into the renderer system prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-play-renderer-prompt-"));
    try {
      await mkdir(join(root, "prompt", "play"), { recursive: true });
      await writeFile(join(root, "prompt", "play", "renderer.md"), "PROJECT RENDERER OVERRIDE: render romance props through distance and touch.");
      const agent = new PlaySceneRendererAgent({ ...ctx, projectRoot: root });
      const submit = vi.spyOn(agent as any, "submitStructured").mockResolvedValue({
        sceneText: "她把那枚旧钥匙放回掌心。",
        suggestedActions: [],
      });

      await agent.render({
        input: "我看那把旧钥匙",
        action: { actionKind: "look", intent: "看旧钥匙" },
        mutationSummary: "旧钥匙仍在掌心。",
        stateBrief: "物件：旧钥匙。",
      });

      const messages = submit.mock.calls[0]?.[0] as ReadonlyArray<{ readonly role: string; readonly content: string }>;
      const system = messages.find((message) => message.role === "system")?.content ?? "";
      expect(system).toContain("Prompt Pack Guidance");
      expect(system).toContain("PROJECT RENDERER OVERRIDE");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("renderer rejects missing structured scene output instead of inventing a placeholder", async () => {
    const agent = new PlaySceneRendererAgent(ctx);
    vi.spyOn(agent as any, "submitStructured").mockRejectedValue(new Error("Model did not submit_play_scene"));
    await expect(agent.render({
      input: "我看着她",
      action: { actionKind: "look", intent: "看她" },
      mutationSummary: "",
      stateBrief: "",
    })).rejects.toThrow("submit_play_scene");
  });

  it("renderer rejects an empty structured scene instead of committing fake prose", async () => {
    const agent = new PlaySceneRendererAgent(ctx);
    vi.spyOn(agent as any, "submitStructured").mockResolvedValue({ sceneText: "", suggestedActions: [] });
    await expect(agent.render({
      input: "我推门进去",
      action: { actionKind: "move", intent: "进门" },
      mutationSummary: "",
      stateBrief: "",
    })).rejects.toThrow();
  });

  it("reconciler extracts supplemental graph facts from rendered prose", async () => {
    const agent = new PlaySceneReconcilerAgent(ctx);
    vi.spyOn(agent as any, "submitStructured").mockResolvedValue({
      summary: "补记黑色U盘。",
      entities: [{ id: "item_black_usb", type: "item", label: "黑色U盘", status: "已发现" }],
    });

    const mutation = PlayMutationSchema.parse(await agent.reconcile({
      turn: 2,
      input: "我检查抽屉",
      action: { actionKind: "look", intent: "检查抽屉" },
      mutation: { eventId: "evt-2", turn: 2, actionKind: "look", summary: "检查抽屉。" },
      sceneText: "抽屉夹层里卡着一只黑色U盘。",
      context: "当前实体名册：actor_player [actor]: 玩家",
      stateBrief: "# Play State\n- summary: 检查抽屉。\n",
      language: "zh",
    }));

    expect(mutation.entities.upsert[0]?.label).toBe("黑色U盘");
  });

  it("keeps reconciler event metadata host-owned", async () => {
    const agent = new PlaySceneReconcilerAgent(ctx);
    vi.spyOn(agent as any, "submitStructured").mockResolvedValue({ summary: "补记母子关系。" });

    const mutation = PlayMutationSchema.parse(await agent.reconcile({
      turn: 4,
      input: "问母亲孩子的药还能撑多久",
      action: { actionKind: "say", intent: "询问孩子的药量" },
      mutation: { eventId: "evt-4", turn: 4, actionKind: "say", summary: "追问药量。" },
      sceneText: "母亲低头看了一眼怀里的孩子。",
      context: "actor_mother 是 actor_child 的母亲。",
      stateBrief: "# Play State\n- summary: 追问药量。\n",
      language: "zh",
    }));

    expect(mutation).toMatchObject({ eventId: "evt-4", turn: 4, actionKind: "say" });
  });

  it("reconciler fails open to an empty supplement on malformed output", async () => {
    const agent = new PlaySceneReconcilerAgent(ctx);
    vi.spyOn(agent as any, "submitStructured").mockRejectedValue(new Error("model did not submit tool"));

    const mutation = PlayMutationSchema.parse(await agent.reconcile({
      turn: 2,
      input: "我检查抽屉",
      action: { actionKind: "look", intent: "检查抽屉" },
      mutation: { eventId: "evt-2", turn: 2, actionKind: "look", summary: "检查抽屉。" },
      sceneText: "抽屉里只有灰。",
      context: "当前实体名册：actor_player [actor]: 玩家",
      stateBrief: "# Play State\n- summary: 检查抽屉。\n",
      language: "zh",
    }));

    expect(mutation.entities.upsert).toEqual([]);
    expect(mutation.edges.upsert).toEqual([]);
  });
});

describe("scene renderer prompt by mode", () => {
  it("guided 模式把选项做成可选跳板，而非每回合强制", () => {
    const prompt = buildSceneRendererSystemPrompt("guided");
    expect(prompt).toContain("0-3");
    expect(prompt).toContain("不必每回合");
    expect(prompt).toContain("不是唯一前进方式");
    expect(prompt).not.toMatch(/必须给 2-4|每回合都要给/);
  });

  it("keeps runtime time authority while leaving world-progression craft to the Skill", () => {
    const prompt = buildSceneRendererSystemPrompt("guided");
    expect(prompt).not.toContain("世界不是死的");
    expect(prompt).toContain("时间段");
  });

  it("renderer treats applied typed state as the source of concrete facts", () => {
    const prompt = buildSceneRendererSystemPrompt("guided");
    expect(prompt).toContain("具体的新物件");
    expect(prompt).toContain("必须先由 mutator 建成实体");
    expect(prompt).toContain("已经完成的玩家动作逐项写出来");
  });

  it("open 模式不强制选项数量", () => {
    const prompt = buildSceneRendererSystemPrompt("open");
    expect(prompt).not.toContain("必须给 2-4");
  });

  it("renders the scene prompt in English when language is en", () => {
    const prompt = buildSceneRendererSystemPrompt("guided", "en");
    expect(prompt).toContain("interactive-fiction scene-response author");
    expect(prompt).toContain("suggestedActions");
    expect(prompt).not.toMatch(/[一-鿿]/); // no CJK leaks into the English prompt
  });
});
