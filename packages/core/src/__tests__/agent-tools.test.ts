import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateManager } from "../state/manager.js";
import { ArchitectIncompleteFoundationError } from "../agents/architect.js";
import {
  createReadTool,
  createGenerateCoverTool,
  createSubAgentTool,
  createShortFictionRunTool,
  createPatchChapterTextTool,
  createReplaceChapterTextTool,
  createDeleteLatestChapterTool,
  createPlayEditTool,
  createPlayStartTool,
  createProposeActionTool,
  createRenameEntityTool,
  createScriptCreationTool,
  createStoryboardCreationTool,
  createInteractiveFilmCreationTool,
  createWriteFileTool,
  createWriteTruthFileTool,
} from "../agent/agent-tools.js";
import { createPlayDB } from "../play/play-db-factory.js";
import { PlayStore } from "../play/play-store.js";

describe("agent deterministic writing tools", () => {
  let root: string;
  let state: StateManager;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-agent-tools-"));
    state = new StateManager(root);

    await state.saveBookConfig("harbor", {
      id: "harbor",
      title: "Harbor",
      platform: "tomato",
      genre: "other",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 3000,
      createdAt: "2026-04-16T00:00:00.000Z",
      updatedAt: "2026-04-16T00:00:00.000Z",
    });

    await mkdir(join(state.bookDir("harbor"), "story", "runtime"), { recursive: true });
    await mkdir(join(state.bookDir("harbor"), "chapters"), { recursive: true });
    await writeFile(join(state.bookDir("harbor"), "story", "story_bible.md"), "# Story Bible\n\nLin Yue guards the jade seal.\n", "utf-8");
    await writeFile(
      join(state.bookDir("harbor"), "chapters", "0003_Storm.md"),
      "# 第3章 风暴\n\nLin Yue kept the jade seal hidden under wet burlap, and she did not tell the guild.\n",
      "utf-8",
    );
    await state.saveChapterIndex("harbor", [{
      number: 3,
      title: "风暴",
      status: "ready-for-review",
      wordCount: 120,
      createdAt: "2026-04-16T00:00:00.000Z",
      updatedAt: "2026-04-16T00:00:00.000Z",
      auditIssues: [],
      lengthWarnings: [],
    }]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes truth files through the deterministic tool path", async () => {
    const tool = createWriteTruthFileTool({} as never, root, "harbor");

    const result = await tool.execute("tool-1", {
      fileName: "story_bible.md",
      content: "# Story Bible\n\nLin Yue now distrusts the guild.\n",
    });

    expect(result.content[0]?.type).toBe("text");
    await expect(readFile(join(state.bookDir("harbor"), "story", "story_bible.md"), "utf-8"))
      .resolves.toContain("distrusts the guild");
  });

  it("deletes only the latest chapter through the deterministic tool path", async () => {
    const snapshotDir = join(state.bookDir("harbor"), "story", "snapshots", "2");
    await mkdir(snapshotDir, { recursive: true });
    await writeFile(join(snapshotDir, "current_state.md"), "# Current State\n\nChapter 2.", "utf-8");
    await writeFile(join(snapshotDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8");
    await writeFile(join(state.bookDir("harbor"), "story", "current_state.md"), "# Current State\n\nChapter 3.", "utf-8");
    await writeFile(join(state.bookDir("harbor"), "story", "pending_hooks.md"), "# Pending Hooks\n", "utf-8");

    const tool = createDeleteLatestChapterTool(root, "harbor");
    const result = await tool.execute("tool-delete", { chapterNumber: 3 });

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Deleted latest chapter 3"),
    });
    expect(result.details).toMatchObject({
      kind: "chapter_deleted",
      bookId: "harbor",
      deletedChapter: 3,
      rolledBackTo: 2,
    });
    await expect(state.loadChapterIndex("harbor")).resolves.toEqual([]);
    await expect(readFile(
      join(state.bookDir("harbor"), "chapters", ".trash", "0003_Storm.md"),
      "utf-8",
    )).resolves.toContain("jade seal");
  });

  it("writes role cards through the deterministic truth-file tool path", async () => {
    const tool = createWriteTruthFileTool({} as never, root, "harbor");

    const result = await tool.execute("tool-role", {
      fileName: "roles/主要角色/林月.md",
      content: "# 林月\n\n- 动机：守住码头账册，但不再相信公会。\n",
    });

    expect(result.content[0]?.type).toBe("text");
    await expect(readFile(join(state.bookDir("harbor"), "story", "roles", "主要角色", "林月.md"), "utf-8"))
      .resolves.toContain("不再相信公会");
  });

  it("renames entities through the deterministic edit controller", async () => {
    const tool = createRenameEntityTool({} as never, root, "harbor");

    await tool.execute("tool-3", {
      oldValue: "Lin Yue",
      newValue: "Lin Yan",
    });

    await expect(readFile(join(state.bookDir("harbor"), "story", "story_bible.md"), "utf-8"))
      .resolves.toContain("Lin Yan");
    await expect(readFile(join(state.bookDir("harbor"), "chapters", "0003_Storm.md"), "utf-8"))
      .resolves.toContain("Lin Yan");
  });

  it("patches chapter text through the deterministic edit controller", async () => {
    const tool = createPatchChapterTextTool({} as never, root, "harbor");

    await tool.execute("tool-4", {
      chapterNumber: 3,
      targetText: "jade seal hidden",
      replacementText: "jade seal locked beneath the altar",
    });

    await expect(readFile(join(state.bookDir("harbor"), "chapters", "0003_Storm.md"), "utf-8"))
      .resolves.toContain("locked beneath the altar");
    await expect(state.loadChapterIndex("harbor")).resolves.toEqual([
      expect.objectContaining({
        number: 3,
        status: "audit-failed",
        auditIssues: expect.arrayContaining([
          expect.stringContaining("Manual text edit requires review"),
        ]),
      }),
    ]);
  });

  it("patches a high-confidence paragraph match when the model paraphrases the target text", async () => {
    const tool = createPatchChapterTextTool({} as never, root, "harbor");

    await tool.execute("tool-4-fuzzy", {
      chapterNumber: 3,
      targetText: "Lin Yue kept the jade seal under wet burlap and told no one from the guild.",
      replacementText: "Lin Yue locked the jade seal beneath the altar and let the guild keep guessing.",
    });

    const updated = await readFile(join(state.bookDir("harbor"), "chapters", "0003_Storm.md"), "utf-8");
    expect(updated).toContain("beneath the altar");
    expect(updated).not.toContain("wet burlap");
  });

  it("replaces whole chapter text through the deterministic edit controller", async () => {
    const tool = createReplaceChapterTextTool({} as never, root, "harbor");

    await tool.execute("tool-4b", {
      chapterNumber: 3,
      fullText: "# 第3章 整章替换\n\n这是用户提供的完整新正文。",
    });

    await expect(readFile(join(state.bookDir("harbor"), "chapters", "0003_Storm.md"), "utf-8"))
      .resolves.toContain("完整新正文");
    await expect(state.loadChapterIndex("harbor")).resolves.toEqual([
      expect.objectContaining({
        number: 3,
        status: "audit-failed",
        wordCount: expect.any(Number),
        auditIssues: expect.arrayContaining([
          expect.stringContaining("Manual chapter replacement requires review"),
        ]),
      }),
    ]);
  });

  it("requires an explicit title when the architect sub-agent creates a book", async () => {
    const pipeline = {
      initBook: vi.fn(async () => undefined),
    };
    const tool = createSubAgentTool(pipeline as never, null);

    const result = await tool.execute("tool-5", {
      agent: "architect",
      instruction: "写一本港风商战小说",
    });

    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("title is required");
    }
    expect(pipeline.initBook).not.toHaveBeenCalled();
  });

  it("localizes propose_action fallback copy", async () => {
    const zhTool = createProposeActionTool("zh");
    const enTool = createProposeActionTool("en");

    const zh = await zhTool.execute("proposal-zh", {
      action: "create_book",
      instruction: "写一本港风商战小说",
      createBook: {
        title: "港风商战",
      },
    });
    const en = await enTool.execute("proposal-en", {
      action: "generate_cover",
      instruction: "Generate a cover for Night Ledger.",
      generateCover: {
        title: "Night Ledger",
      },
    });

    expect(zh.content[0]?.type).toBe("text");
    expect(en.content[0]?.type).toBe("text");
    if (zh.content[0]?.type === "text") {
      expect(zh.content[0].text).toContain("创建长篇书籍");
      expect(zh.content[0].text).toContain("确认后会切换到对应入口");
    }
    if (en.content[0]?.type === "text") {
      expect(en.content[0].text).toContain("Generate cover");
      expect(en.content[0].text).toContain("After confirmation");
    }
  });

  it("marks in-surface confirmation proposals when requested", async () => {
    const tool = createProposeActionTool("zh", { sameSession: true });

    const result = await tool.execute("proposal-same-session", {
      action: "short_run",
      instruction: "写一篇婚姻反杀短篇",
    });

    expect(result.details).toMatchObject({
      kind: "proposed_action",
      action: "short_run",
      targetSessionKind: "short",
      sameSession: true,
    });
  });

  it("carries skills activated by the agent into the confirmed action", async () => {
    const activatedSkillIds = ["writer-distillation"];
    const tool = createProposeActionTool("zh", {
      requestedSkillIds: () => activatedSkillIds,
    });

    const result = await tool.execute("proposal-with-skill", {
      action: "short_run",
      instruction: "把这份素材蒸馏成一篇商业短篇",
    });

    expect(result.details).toMatchObject({
      kind: "proposed_action",
      action: "short_run",
      requestedSkills: ["writer-distillation"],
    });
  });

  it("carries structured execution payloads in proposed actions", async () => {
    const tool = createProposeActionTool("zh");

    const result = await tool.execute("proposal-book", {
      action: "create_book",
      instruction: "创建《夜间派送》，番茄，100章以内，每章2600字。",
      createBook: {
        title: "夜间派送",
        genre: "urban",
        platform: "tomato",
        targetChapters: 100,
        chapterWordCount: 2600,
        language: "zh",
      },
    });

    expect(result.details).toMatchObject({
      kind: "proposed_action",
      action: "create_book",
      actionPayload: {
        createBook: {
          title: "夜间派送",
          genre: "urban",
          platform: "tomato",
          targetChapters: 100,
          chapterWordCount: 2600,
          language: "zh",
        },
      },
    });
  });

  it("rejects truncated play initial scenes in confirmation payloads", async () => {
    const tool = createProposeActionTool("zh");

    await expect(tool.execute("proposal-play", {
      action: "play_start",
      instruction: "开一个旧戏院检修互动世界，从配电室和后台开始。",
      playStart: {
        title: "旧戏院夜巡",
        premise: "我在县城旧戏院做夜间检修，停电后舞台下传来拍板声。",
        mode: "open",
        initialScene: "剧目是《挑滑车》，主演栏里有个名字叫",
        suggestedActions: ["检查演出表", "走向配电室"],
      },
    })).rejects.toThrow("playStart.initialScene");
  });

  it("keeps play world and visual contracts in the structured confirmation payload", async () => {
    const tool = createProposeActionTool("zh");

    const result = await tool.execute("proposal-play-contract", {
      action: "play_start",
      instruction: "开一个合租屋关系互动世界，物件有心动层级但不要游戏数值。",
      playStart: {
        title: "雨夜合租屋",
        premise: "我刚搬进合租屋，室友们都在隐瞒停电夜的事。",
        mode: "open",
        worldContract: "时间按动作语义推进；室友会自主行动；物件按心动层级表达关系变化，不使用 RPG 稀有度。",
        visualContract: "心动层级通过摆放距离、磨损、光线和人物反应体现，不要绿蓝紫橙边框或游戏 UI。",
        initialScene: "雨刚停，餐桌上多了一只贴着我名字的旧瓷杯。",
        suggestedActions: ["拿起旧瓷杯", "观察室友的反应"],
      },
    });

    expect(result.details).toMatchObject({
      kind: "proposed_action",
      action: "play_start",
      actionPayload: {
        playStart: {
          worldContract: expect.stringContaining("室友会自主行动"),
          visualContract: expect.stringContaining("不要绿蓝紫橙边框"),
        },
      },
    });
  });

  it("keeps script creation specs in the structured confirmation payload", async () => {
    const tool = createProposeActionTool("zh");

    const result = await tool.execute("proposal-script", {
      action: "script_create",
      instruction: "把冷库账页改成 12 集竖屏短剧，调查线七成、家怨三成。",
      scriptCreate: {
        title: "冷库账页",
        sourceKind: "小说大纲",
        targetFormat: "vertical_short_drama",
        requirements: "保留账页、赔偿款、失踪孩子三条线。",
        episodeCount: 12,
        episodeDuration: "2分钟",
      },
    });

    expect(result.details).toMatchObject({
      kind: "proposed_action",
      action: "script_create",
      targetSessionKind: "script",
      actionPayload: {
        scriptCreate: {
          title: "冷库账页",
          targetFormat: "vertical_short_drama",
          episodeCount: 12,
        },
      },
    });
  });

  it("keeps storyboard specs in the structured confirmation payload", async () => {
    const tool = createProposeActionTool("zh");

    const result = await tool.execute("proposal-storyboard", {
      action: "storyboard_create",
      instruction: "把剧本拆成 9:16 分镜，写实冷色，每场给图像提示词。",
      storyboardCreate: {
        title: "冷库账页分镜",
        sourceKind: "剧本",
        visualStyle: "写实冷色",
        aspectRatio: "9:16",
        granularity: "按场景关键镜头拆分",
        maxShots: 18,
      },
    });

    expect(result.details).toMatchObject({
      kind: "proposed_action",
      action: "storyboard_create",
      targetSessionKind: "storyboard",
      actionPayload: {
        storyboardCreate: {
          title: "冷库账页分镜",
          visualStyle: "写实冷色",
          maxShots: 18,
        },
      },
    });
  });

  it("keeps interactive-film specs in the structured confirmation payload", async () => {
    const tool = createProposeActionTool("zh");

    const result = await tool.execute("proposal-interactive-film", {
      action: "interactive_film_create",
      instruction: "做一个盛世天下式多结局互动影游，包含剧情树、旗标、剧本和分镜。",
      interactiveFilmCreate: {
        title: "盛世账页",
        sourceKind: "投稿需求",
        requirements: "多分支，多结局，变量记录玩家每次关键抉择。",
        targetAudience: "欧美互动影游用户",
        budget: "5000元",
        referenceMode: "盛世天下式多走向",
      },
    });

    expect(result.details).toMatchObject({
      kind: "proposed_action",
      action: "interactive_film_create",
      targetSessionKind: "interactive-film",
      actionPayload: {
        interactiveFilmCreate: {
          title: "盛世账页",
          budget: "5000元",
        },
      },
    });
  });

  it("drops non-positive placeholder counts from interactive-film confirmation payloads", async () => {
    const tool = createProposeActionTool("zh");

    const result = await tool.execute("proposal-interactive-film-zero-count", {
      action: "interactive_film_create",
      instruction: "做一个多结局互动影游。",
      interactiveFilmCreate: {
        title: "第七阅览室",
        requirements: "多分支，变量记录，至少两个结局。",
        episodeCount: 0,
      },
    });

    expect(result.details).toMatchObject({
      kind: "proposed_action",
      action: "interactive_film_create",
      actionPayload: {
        interactiveFilmCreate: {
          title: "第七阅览室",
          requirements: "多分支，变量记录，至少两个结局。",
        },
      },
    });
    expect(JSON.stringify(result.details)).not.toContain("episodeCount");
  });

  it("falls back to the tool argument when confirmed play payload contains a truncated initial scene", async () => {
    let seededScene = "";
    const pipeline = {
      createAgentContext: vi.fn(() => ({})),
    };
    const tool = createPlayStartTool(pipeline as never, root, "play-session-truncated", "open", {
      actionPayload: {
        playStart: {
          title: "旧戏院夜巡",
          premise: "我在县城旧戏院做夜间检修，停电后舞台下传来拍板声。",
          mode: "open",
          initialScene: "剧目是《挑滑车》，主演栏里有个名字叫",
          suggestedActions: ["检查演出表"],
        },
      },
      runnerFactory: () => ({
        async seedOpening(input) {
          seededScene = input.sceneText;
          return null;
        },
      }),
    });

    await tool.execute("play-start", {
      title: "旧戏院夜巡",
      premise: "我在县城旧戏院做夜间检修，停电后舞台下传来拍板声。",
      mode: "open",
      initialScene: "我站在配电室门口，手电照到泛黄演出表，主演栏写着赵铁生。",
      suggestedActions: ["检查演出表"],
    });

    expect(seededScene).toContain("主演栏写着赵铁生");
    expect(seededScene).not.toContain("名字叫");
    await expect(readFile(join(root, "worlds", "play-session-truncated", "runs", "main", "projections", "scene.md"), "utf-8"))
      .resolves.toContain("主演栏写着赵铁生");
  });

  it("does not emit a confirmation card when the proposed action payload is invalid", async () => {
    const tool = createProposeActionTool("zh");

    await expect(tool.execute("proposal-invalid", {
      action: "create_book",
      instruction: "创建《夜间派送》",
      createBook: {
        title: "夜间派送",
        platform: "tomato",
        unsafeExtra: "must not reach the UI",
      },
    } as never)).rejects.toThrow("Invalid proposed action payload");
  });

  it("rejects Play confirmation cards without structured execution payload", async () => {
    const tool = createProposeActionTool("zh");

    await expect(tool.execute("proposal-play-missing-payload", {
      action: "play_start",
      title: "玄照山外门",
      summary: "卡内已提炼所有长期规则。",
      instruction: "启动玄照山外门开放世界，时间是世界同步轴，角色会自主行动。",
    })).rejects.toThrow("playStart.title");
  });

  it("can propose opening existing assisted creation workflows without claiming production", async () => {
    const tool = createProposeActionTool("zh");

    const cases = [
      { action: "fanfic_init", route: "import:fanfic", title: "打开同人创作" },
      { action: "spinoff_create", route: "import:spinoff", title: "打开番外创作" },
      { action: "style_imitation", route: "import:imitation", title: "打开仿写/文风分析" },
    ] as const;

    for (const item of cases) {
      const result = await tool.execute(`proposal-${item.action}`, {
        action: item.action,
        instruction: "打开对应 Studio 工具，等待用户补充材料。",
      });

      expect(result.content[0]?.type).toBe("text");
      if (result.content[0]?.type === "text") {
        expect(result.content[0].text).toContain(item.title);
        expect(result.content[0].text).toContain("不会直接生成成品");
      }
      expect(result.details).toMatchObject({
        kind: "proposed_action",
        action: item.action,
        targetSessionKind: "chat",
        targetRoute: item.route,
      });
    }
  });

  it("passes the explicit architect title straight into initBook", async () => {
    const pipeline = {
      initBook: vi.fn(async () => undefined),
    };
    const tool = createSubAgentTool(pipeline as never, null);

    await tool.execute("tool-6", {
      agent: "architect",
      title: "夜港账本",
      instruction: "写一本港风商战小说",
    });

    expect(pipeline.initBook).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "夜港账本",
      }),
      expect.objectContaining({
        externalContext: "写一本港风商战小说",
      }),
    );
  });

  it("uses confirmed create-book payload when architect tool args drift or omit defaults", async () => {
    const pipeline = {
      initBook: vi.fn(async () => undefined),
    };
    const tool = createSubAgentTool(pipeline as never, null, undefined, {
      actionPayload: {
        createBook: {
          title: "夜间派送",
          genre: "urban",
          platform: "tomato",
          targetChapters: 100,
          chapterWordCount: 2600,
          language: "zh",
        },
      },
    });

    await tool.execute("tool-confirmed-book", {
      agent: "architect",
      title: "夜间派送",
      platform: "other",
      targetChapters: 200,
      instruction: "创建《夜间派送》，番茄，100章以内。",
    } as any);

    expect(pipeline.initBook).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "夜间派送",
        genre: "urban",
        platform: "tomato",
        targetChapters: 100,
        chapterWordCount: 2600,
      }),
      expect.objectContaining({
        externalContext: "创建《夜间派送》，番茄，100章以内。",
      }),
    );
  });

  it("derives the confirmed book id from the confirmed title instead of model-supplied bookId", async () => {
    const pipeline = {
      initBook: vi.fn(async () => undefined),
    };
    const tool = createSubAgentTool(pipeline as never, null, undefined, {
      actionPayload: {
        createBook: {
          title: "Night Delivery",
          genre: "urban",
          platform: "tomato",
          language: "en",
        },
      },
    });

    const result = await tool.execute("tool-confirmed-book-id", {
      agent: "architect",
      bookId: "rogue-book",
      title: "Wrong Title",
      instruction: "Create Night Delivery.",
    } as any);

    expect(pipeline.initBook).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "night-delivery",
        title: "Night Delivery",
      }),
      expect.anything(),
    );
    expect(result.details).toMatchObject({
      kind: "book_created",
      bookId: "night-delivery",
      title: "Night Delivery",
    });
  });

  it("returns an architect incomplete result instead of throwing when foundation repair fails", async () => {
    const pipeline = {
      initBook: vi.fn(async () => {
        throw new ArchitectIncompleteFoundationError(
          ["roles", "pending_hooks"],
          "=== SECTION: story_frame ===\n已有世界观草稿",
          "基础设定没有生成完整。",
        );
      }),
    };
    const tool = createSubAgentTool(pipeline as never, null);

    const result = await tool.execute("tool-architect-incomplete", {
      agent: "architect",
      title: "夜港账本",
      instruction: "写一本港风商战小说",
    });

    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("基础设定没有生成完整");
      expect(result.content[0].text).toContain("roles");
      expect(result.content[0].text).toContain("pending_hooks");
      expect(result.content[0].text).toContain("继续补齐");
    }
    expect(result.details).toMatchObject({
      kind: "architect_incomplete",
      missing: ["roles", "pending_hooks"],
      partialContent: expect.stringContaining("已有世界观草稿"),
    });
  });

  it("passes chapterWordCount through the writer sub-agent", async () => {
    const pipeline = {
      writeNextChapter: vi.fn(async () => ({
        chapterNumber: 4,
        wordCount: 2600,
      })),
    };
    const tool = createSubAgentTool(pipeline as never, "harbor");

    await tool.execute("tool-7", {
      agent: "writer",
      bookId: "harbor",
      chapterWordCount: 2600,
      instruction: "继续写，控制在 2600 字",
    } as any);

    expect(pipeline.writeNextChapter).toHaveBeenCalledWith("harbor", 2600);
  });

  it("runs a requested chapter batch through one writer operation", async () => {
    const pipeline = {
      writeNextChapter: vi.fn(),
      writeChapters: vi.fn(async () => [
        { chapterNumber: 4, title: "第四章", wordCount: 2600, status: "ready-for-review" },
        { chapterNumber: 5, title: "第五章", wordCount: 2550, status: "ready-for-review" },
        { chapterNumber: 6, title: "第六章", wordCount: 2490, status: "audit-failed" },
      ]),
    };
    const tool = createSubAgentTool(pipeline as never, "harbor");

    const result = await tool.execute("tool-writer-batch", {
      agent: "writer",
      bookId: "harbor",
      chapterCount: 5,
      chapterWordCount: 2600,
      instruction: "连续写五章",
    } as any);

    expect(pipeline.writeChapters).toHaveBeenCalledWith(
      "harbor",
      5,
      expect.objectContaining({ wordCount: 2600 }),
    );
    expect(pipeline.writeNextChapter).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({
      kind: "chapters_written",
      requestedCount: 5,
      completedCount: 3,
      stoppedStatus: "audit-failed",
    });
  });

  it("runs the writer pipeline inside the tool AbortSignal scope", async () => {
    const controller = new AbortController();
    const pipeline = {
      runWithAbortSignal: vi.fn(async (_signal: AbortSignal, task: () => Promise<unknown>) => task()),
      writeNextChapter: vi.fn(async () => ({ chapterNumber: 4, wordCount: 2600 })),
    };
    const tool = createSubAgentTool(pipeline as never, "harbor");

    await tool.execute("tool-writer-abort", {
      agent: "writer",
      bookId: "harbor",
      instruction: "继续写下一章",
    } as any, controller.signal);

    expect(pipeline.runWithAbortSignal).toHaveBeenCalledWith(controller.signal, expect.any(Function));
    expect(pipeline.writeNextChapter).toHaveBeenCalledOnce();
  });

  it("does not claim writer success when the chapter audit failed", async () => {
    const pipeline = {
      writeNextChapter: vi.fn(async () => ({
        chapterNumber: 1,
        title: "雨棚账单",
        wordCount: 971,
        status: "audit-failed",
      })),
    };
    const tool = createSubAgentTool(pipeline as never, "harbor");

    const result = await tool.execute("tool-writer-audit-failed", {
      agent: "writer",
      bookId: "harbor",
      instruction: "继续写下一章",
    } as any);

    expect(result.details).toMatchObject({
      kind: "chapter_written",
      bookId: "harbor",
      chapterNumber: 1,
      status: "audit-failed",
    });
    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("audit-failed");
      expect(result.content[0].text).toContain("needs review");
      expect(result.content[0].text).not.toContain("Chapter written");
    }
  });

  it("surfaces writer sub-agent pipeline failures as tool errors", async () => {
    const pipeline = {
      writeNextChapter: vi.fn(async () => {
        throw new Error("disk write failed");
      }),
    };
    const tool = createSubAgentTool(pipeline as never, "harbor");

    await expect(tool.execute("tool-writer-fails", {
      agent: "writer",
      bookId: "harbor",
      instruction: "继续写下一章",
    } as any)).rejects.toThrow("disk write failed");
  });

  it("surfaces unchanged reviser results instead of claiming completion", async () => {
    const pipeline = {
      reviseDraft: vi.fn(async () => ({
        chapterNumber: 1,
        wordCount: 11132,
        fixedIssues: [],
        applied: false,
        status: "unchanged",
        skippedReason: "Manual revision kept original chapter: before blocking=2, critical=1, aiTell=3; after blocking=2, critical=1, aiTell=3.",
        revisionDiagnostics: {
          standard: "A revision is applied only when blocking, critical, and AI-tell counts do not worsen, and at least blocking or AI-tell issues improve.",
          before: { blockingCount: 2, criticalCount: 1, aiTellCount: 3 },
          after: { blockingCount: 2, criticalCount: 1, aiTellCount: 3 },
          remainingIssues: [
            { severity: "critical", category: "Chapter Memo Drift", description: "没有按用户要求重修本章。", suggestion: "重写主冲突。" },
          ],
        },
      })),
    };
    const tool = createSubAgentTool(pipeline as never, "harbor");

    const result = await tool.execute("tool-reviser-unchanged", {
      agent: "reviser",
      bookId: "harbor",
      chapterNumber: 1,
      mode: "rewrite",
      instruction: "整体重写第一章",
    } as any);

    expect(pipeline.reviseDraft).toHaveBeenCalledWith("harbor", 1, "rewrite", "整体重写第一章");
    expect(result.details).toMatchObject({
      kind: "chapter_revision",
      bookId: "harbor",
      chapterNumber: 1,
      mode: "rewrite",
      applied: false,
      status: "unchanged",
      skippedReason: expect.stringContaining("before blocking=2"),
      revisionDiagnostics: expect.objectContaining({
        before: { blockingCount: 2, criticalCount: 1, aiTellCount: 3 },
        after: { blockingCount: 2, criticalCount: 1, aiTellCount: 3 },
      }),
    });
    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("Revision not applied");
      expect(result.content[0].text).toContain("Revision gate");
      expect(result.content[0].text).toContain("Chapter Memo Drift");
      expect(result.content[0].text).not.toContain("Revision (rewrite) complete");
    }
  });

  it("uses the active book for writer when bookId is omitted", async () => {
    const pipeline = {
      writeNextChapter: vi.fn(async () => ({
        chapterNumber: 4,
        wordCount: 2600,
      })),
    };
    const tool = createSubAgentTool(pipeline as never, "harbor");

    await tool.execute("tool-writer-active", {
      agent: "writer",
      chapterWordCount: 2600,
      instruction: "继续写下一章",
    } as any);

    expect(pipeline.writeNextChapter).toHaveBeenCalledWith("harbor", 2600);
  });

  it("documents sub_agent bookId as an optional active-book override", () => {
    const tool = createSubAgentTool({} as never, "harbor");
    const schemaText = JSON.stringify(tool.parameters);

    expect(schemaText).toContain("current active book");
    expect(schemaText).not.toContain("required for all agents except architect");
  });

  it("blocks non-architect sub-agents when no book is active", async () => {
    const pipeline = {
      writeNextChapter: vi.fn(async () => ({
        chapterNumber: 4,
        wordCount: 2600,
      })),
    };
    const tool = createSubAgentTool(pipeline as never, null);

    const result = await tool.execute("tool-writer-no-book", {
      agent: "writer",
      instruction: "继续写下一章",
    } as any);

    expect(pipeline.writeNextChapter).not.toHaveBeenCalled();
    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("No active book");
    }
  });

  it("exposes a standalone short fiction tool without benchmark inputs", () => {
    const pipeline = {
      createAgentContext: vi.fn(),
    };
    const tool = createShortFictionRunTool(pipeline as never, root);
    const schemaText = JSON.stringify(tool.parameters);
    const toolText = JSON.stringify({ description: tool.description, parameters: tool.parameters });

    expect(tool.name).toBe("short_fiction_run");
    expect(schemaText).toContain("direction");
    expect(schemaText).toContain("coverModel");
    expect(schemaText).toContain("charsPerChapter");
    expect(schemaText).not.toContain("\"chars\"");
    expect(toolText).not.toContain("benchmark");
    expect(toolText).not.toContain("deconstruction");
  });

  it("exposes standalone cover generation as its own tool", () => {
    const tool = createGenerateCoverTool(root);
    const schemaText = JSON.stringify(tool.parameters);
    const toolText = JSON.stringify({ description: tool.description, parameters: tool.parameters });

    expect(tool.name).toBe("generate_cover");
    expect(schemaText).toContain("title");
    expect(schemaText).toContain("outputDir");
    expect(schemaText).toContain("coverPrompt");
    expect(toolText).toContain("revise the cover prompt");
    expect(schemaText).toContain("coverModel");
    expect(toolText).not.toContain("short_fiction_run");
  });

  it("exposes script, storyboard, and interactive-film creation as standalone production tools", () => {
    const pipeline = {
      createAgentContext: vi.fn(() => ({})),
    };
    const scriptTool = createScriptCreationTool(pipeline as never, root);
    const storyboardTool = createStoryboardCreationTool(pipeline as never, root);
    const interactiveFilmTool = createInteractiveFilmCreationTool(pipeline as never, root);

    expect(scriptTool.name).toBe("script_create");
    expect(JSON.stringify(scriptTool.parameters)).toContain("targetFormat");
    expect(JSON.stringify(scriptTool.parameters)).toContain("episodeCount");
    expect(JSON.stringify({ description: scriptTool.description, parameters: scriptTool.parameters }))
      .not.toContain("short_fiction_run");

    expect(storyboardTool.name).toBe("storyboard_create");
    expect(JSON.stringify(storyboardTool.parameters)).toContain("visualStyle");
    expect(JSON.stringify(storyboardTool.parameters)).toContain("maxShots");
    expect(JSON.stringify({ description: storyboardTool.description, parameters: storyboardTool.parameters }))
      .not.toContain("short_fiction_run");

    expect(interactiveFilmTool.name).toBe("interactive_film_create");
    expect(JSON.stringify(interactiveFilmTool.parameters)).toContain("referenceMode");
    expect(JSON.stringify(interactiveFilmTool.parameters)).toContain("budget");
    expect(JSON.stringify({ description: interactiveFilmTool.description, parameters: interactiveFilmTool.parameters }))
      .not.toContain("play_start");
  });

  it("allows architect revise mode to use the active book", async () => {
    const pipeline = {
      reviseFoundation: vi.fn(async () => undefined),
    };
    const tool = createSubAgentTool(pipeline as never, "harbor");

    const result = await tool.execute("tool-architect-revise-active", {
      agent: "architect",
      revise: true,
      feedback: "把角色目录改成一人一卡",
      instruction: "重写架构稿",
    } as any);

    expect(pipeline.reviseFoundation).toHaveBeenCalledWith("harbor", "把角色目录改成一人一卡");
    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("harbor");
    }
  });

  it("blocks architect revise mode when no book is active", async () => {
    const pipeline = {
      reviseFoundation: vi.fn(async () => undefined),
    };
    const tool = createSubAgentTool(pipeline as never, null);

    const result = await tool.execute("tool-architect-revise-no-book", {
      agent: "architect",
      bookId: "harbor",
      revise: true,
      feedback: "把角色目录改成一人一卡",
      instruction: "重写架构稿",
    } as any);

    expect(pipeline.reviseFoundation).not.toHaveBeenCalled();
    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("Open the book first");
    }
  });

  it("prefers explicit reviser mode over instruction guessing", async () => {
    const pipeline = {
      reviseDraft: vi.fn(async () => ({
        chapterNumber: 3,
        wordCount: 120,
        fixedIssues: [],
        applied: true,
        status: "ready-for-review" as const,
      })),
    };
    const tool = createSubAgentTool(pipeline as never, "harbor");

    await tool.execute("tool-8", {
      agent: "reviser",
      bookId: "harbor",
      chapterNumber: 3,
      mode: "spot-fix",
      instruction: "重写第3章",
    } as any);

    expect(pipeline.reviseDraft).toHaveBeenCalledWith("harbor", 3, "spot-fix", "重写第3章");
  });

  it("uses explicit exporter params instead of guessing from instruction", async () => {
    const pipeline = {};
    const tool = createSubAgentTool(pipeline as never, "harbor", root);

    const result = await tool.execute("tool-9", {
      agent: "exporter",
      bookId: "harbor",
      format: "md",
      approvedOnly: false,
      instruction: "导出成 epub",
    } as any);

    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain(".md");
    }
  });

  it("keeps read tool scoped to books by default", async () => {
    const outsidePath = join(root, "outside.md");
    await writeFile(outsidePath, "outside secret", "utf-8");
    const tool = createReadTool(root);

    const result = await tool.execute("tool-read-default", {
      path: outsidePath,
    });

    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("Path traversal blocked");
      expect(result.content[0].text).not.toContain("outside secret");
    }
  });

  it("does not silently truncate long read results", async () => {
    const longContent = `# Long File\n\n${"A".repeat(10_500)}TAIL`;
    await writeFile(join(state.bookDir("harbor"), "story", "long.md"), longContent, "utf-8");
    const tool = createReadTool(root);

    const result = await tool.execute("tool-read-long", {
      path: "harbor/story/long.md",
    });

    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toBe(longContent);
      expect(result.content[0].text).not.toContain("[truncated");
    }
  });

  it("reads absolute system paths when explicitly enabled", async () => {
    const outsidePath = join(root, "outside.md");
    await writeFile(outsidePath, "outside secret", "utf-8");
    const tool = createReadTool(root, { allowSystemPaths: true });

    const result = await tool.execute("tool-read-system", {
      path: outsidePath,
    });

    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("outside secret");
    }
  });

  it("creates nested files through the generic write tool", async () => {
    const tool = createWriteFileTool(root);

    const result = await tool.execute("tool-10", {
      path: "harbor/story/runtime/notes.md",
      content: "# Notes\n\nWatch the harbor ledger.\n",
    });

    expect(result.content[0]?.type).toBe("text");
    await expect(readFile(join(state.bookDir("harbor"), "story", "runtime", "notes.md"), "utf-8"))
      .resolves.toContain("Watch the harbor ledger");
  });

  it("writes Phase 5 outline truth files through write_truth_file", async () => {
    const tool = createWriteTruthFileTool({} as never, root, "harbor");

    const result = await tool.execute("tool-truth-outline", {
      fileName: "outline/story_frame.md",
      content: "# Story Frame\n\nThe harbor debt is the central pressure.\n",
    });

    expect(result.content[0]?.type).toBe("text");
    await expect(readFile(join(state.bookDir("harbor"), "story", "outline", "story_frame.md"), "utf-8"))
      .resolves.toContain("central pressure");
  });

  it("writes Phase 5 role truth files through write_truth_file", async () => {
    const tool = createWriteTruthFileTool({} as never, root, "harbor");

    const result = await tool.execute("tool-truth-role", {
      fileName: "roles/major/Lin Yan.md",
      content: "# Lin Yan\n\nKeeps the ledger hidden.\n",
    });

    expect(result.content[0]?.type).toBe("text");
    await expect(readFile(join(state.bookDir("harbor"), "story", "roles", "major", "Lin Yan.md"), "utf-8"))
      .resolves.toContain("ledger hidden");
  });

  it("rejects unsafe truth file names", async () => {
    const tool = createWriteTruthFileTool({} as never, root, "harbor");

    const result = await tool.execute("tool-truth-unsafe", {
      fileName: "../escape.md",
      content: "escape",
    });

    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("Invalid truth file name");
    }
  });

  it("persists Play world, visual, player persona, and entity edits without advancing a turn", async () => {
    const store = new PlayStore(root);
    await store.createWorld({
      id: "play-edit-session",
      title: "雨夜合租屋",
      premise: "我刚搬进合租屋。",
      mode: "open",
      worldContract: "时间按动作语义推进。",
      visualContract: "雨夜冷光，不使用游戏 UI。",
    });
    await store.ensureRun("play-edit-session", "main");
    await store.saveCurrentState("play-edit-session", "main", {
      scene: "餐桌上有一只旧瓷杯。",
    });
    const seedDb = createPlayDB(store.runDir("play-edit-session", "main"));
    seedDb.upsertEntity({
      id: "actor_player",
      type: "actor",
      label: "新租客",
      summary: "刚搬进合租屋。",
      status: "观察",
    });
    seedDb.upsertEntity({
      id: "actor_linqing",
      type: "actor",
      label: "室友林青",
      summary: "旧目标",
      status: "观望",
    });
    seedDb.close?.();

    const tool = createPlayEditTool(root, "play-edit-session");
    const result = await tool.execute("play-edit-1", {
      worldContractAppend: "室友会自主行动，玩家等待时她也会推进自己的目标。",
      visualContract: "物件情绪重量通过摆放距离、磨损、光线和人物反应体现。",
      playerPersona: "我是刚搬进来的租客，想查清停电夜。",
      entityUpdates: [{
        label: "室友林青",
        type: "actor",
        summary: "隐瞒停电夜真相，目标是试探玩家是否可信。",
        status: "戒备",
      }],
      note: "合租屋规则已更新。",
    });

    expect(result.content[0]?.type).toBe("text");
    expect(result.details).toMatchObject({
      kind: "play_world_updated",
      worldId: "play-edit-session",
      runId: "main",
      updatedWorldContract: true,
      updatedVisualContract: true,
      updatedEntities: 2,
    });
    const world = await store.loadWorld("play-edit-session");
    expect(world?.worldContract).toContain("室友会自主行动");
    expect(world?.visualContract).toContain("物件情绪重量");
    const stateJson = JSON.parse(await readFile(join(root, "worlds", "play-edit-session", "runs", "main", "state", "current.json"), "utf-8"));
    expect(stateJson.worldContract).toContain("室友会自主行动");
    expect(stateJson.visualContract).toContain("物件情绪重量");
    const db = createPlayDB(store.runDir("play-edit-session", "main"));
    const snapshot = db.snapshot();
    db.close?.();
    expect(snapshot.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "actor_player",
        label: "新租客",
        summary: "我是刚搬进来的租客，想查清停电夜。",
      }),
      expect.objectContaining({
        id: "actor_linqing",
        label: "室友林青",
        summary: "隐瞒停电夜真相，目标是试探玩家是否可信。",
        status: "戒备",
      }),
    ]));
  });

  it("replaces Play contract wording instead of appending conflicting rules", async () => {
    const store = new PlayStore(root);
    await store.createWorld({
      id: "play-contract-replace",
      title: "午夜药房",
      premise: "实习药剂师值夜班。",
      mode: "open",
      worldContract: "风险重量：普通差错 / 需要复核 / 可能追责 / 不能公开。时间按动作自然流动。",
      visualContract: "监控冷光。",
    });
    await store.ensureRun("play-contract-replace", "main");
    await store.saveCurrentState("play-contract-replace", "main", {
      turn: 0,
      worldContract: "风险重量：普通差错 / 需要复核 / 可能追责 / 不能公开。时间按动作自然流动。",
    });

    const tool = createPlayEditTool(root, "play-contract-replace");
    const result = await tool.execute("play-edit-replace", {
      worldContractReplacements: [{
        from: "普通差错 / 需要复核 / 可能追责 / 不能公开",
        to: "普通差错 / 需要复核 / 涉及追责 / 需要主任签字",
      }],
      note: "风险重量已替换。",
    });

    expect(result.details).toMatchObject({
      kind: "play_world_updated",
      updatedWorldContract: true,
    });
    const world = await store.loadWorld("play-contract-replace");
    expect(world?.worldContract).toContain("普通差错 / 需要复核 / 涉及追责 / 需要主任签字");
    expect(world?.worldContract).not.toContain("可能追责 / 不能公开");
    const stateJson = JSON.parse(await readFile(join(root, "worlds", "play-contract-replace", "runs", "main", "state", "current.json"), "utf-8"));
    expect(stateJson.turn).toBe(0);
    expect(stateJson.worldContract).toContain("普通差错 / 需要复核 / 涉及追责 / 需要主任签字");
    expect(stateJson.worldContract).not.toContain("可能追责 / 不能公开");
  });
});
