import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runInteractiveFilmCreation,
  runScriptCreation,
  runStoryboardCreation,
  type StoryboardAssetsManifest,
} from "../pipeline/script-storyboard-runner.js";
import type { AgentContext } from "../agents/base.js";
import { loadStoryGraph } from "../interactive-film/graph-store.js";
import { PartialResponseError } from "../llm/provider.js";

const chatCompletionMock = vi.hoisted(() => vi.fn());
const generateStoryGraphMock = vi.hoisted(() => vi.fn());

vi.mock("../llm/provider.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../llm/provider.js")>(),
  chatCompletion: chatCompletionMock,
}));

vi.mock("../interactive-film/generate.js", () => ({
  generateStoryGraph: generateStoryGraphMock,
}));

describe("storyboard creation runner", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-storyboard-assets-"));
    chatCompletionMock.mockReset();
    generateStoryGraphMock.mockReset();
    generateStoryGraphMock.mockImplementation((
      _client: unknown,
      _model: string,
      input: { projectId: string; title: string },
      options?: { language?: "zh" | "en" },
    ) => {
      const en = options?.language === "en";
      return Promise.resolve({
        schemaVersion: 1,
        projectId: input.projectId,
        title: input.title,
        variables: [],
        nodes: [
          {
            id: "start",
            title: en ? "Opening" : "开场",
            type: "start",
            sceneDesc: en ? "The choice begins." : "抉择开始。",
            dialogue: [],
            choices: [{ id: "c1", text: en ? "Proceed" : "继续", targetNodeId: "branch-1", effects: [] }],
          },
          {
            id: "branch-1",
            title: en ? "First Choice" : "第一次选择",
            type: "branch",
            sceneDesc: en ? "Evidence surfaces." : "证据出现。",
            dialogue: [],
            choices: [
              { id: "c2", text: en ? "Reveal" : "公开", targetNodeId: "branch-2", effects: [] },
              { id: "c3", text: en ? "Hide" : "隐瞒", targetNodeId: "ending-secret", effects: [] },
            ],
          },
          {
            id: "branch-2",
            title: en ? "Final Choice" : "最终选择",
            type: "branch",
            sceneDesc: en ? "The truth demands a cost." : "真相要求代价。",
            dialogue: [],
            choices: [{ id: "c4", text: en ? "Publish" : "公布", targetNodeId: "ending-good", effects: [] }],
          },
          { id: "ending-good", title: en ? "Truth" : "真相", type: "ending", sceneDesc: "", dialogue: [], choices: [] },
          { id: "ending-secret", title: en ? "Silence" : "沉默", type: "ending", sceneDesc: "", dialogue: [], choices: [] },
        ],
        endings: [
          { id: "good", nodeId: "ending-good", title: en ? "Truth" : "真相", type: "good", description: "" },
          { id: "secret", nodeId: "ending-secret", title: en ? "Silence" : "沉默", type: "secret", description: "" },
        ],
      });
    });
    chatCompletionMock.mockResolvedValue({
      content: [
        "# 冷库账页 分镜",
        "",
        "## 分镜表",
        "镜头 1：女出纳推开冷库门。",
        "镜头 2：手电光扫过旧账页。",
        "",
        "## 图像提示词",
        "1. Prompt: 冷库门口，女出纳推门，冷色写实，9:16",
        "2. Prompt: 旧账页特写，手电光扫过红章",
      ].join("\n"),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes a first-class image asset manifest and asset directories", async () => {
    const result = await runStoryboardCreation({
      projectRoot: root,
      runtime: makeRuntime(root),
      title: "冷库账页",
      instruction: "把小说片段拆成分镜。",
      projectId: "cold-ledger",
      visualStyle: "写实冷色",
      aspectRatio: "9:16",
    });

    expect(result.assetsManifestPath).toBe("storyboards/cold-ledger/assets.json");
    expect(result.assetsDir).toBe("storyboards/cold-ledger/assets");
    expect((await stat(join(root, "storyboards/cold-ledger/assets/source"))).isDirectory()).toBe(true);
    expect((await stat(join(root, "storyboards/cold-ledger/assets/generated"))).isDirectory()).toBe(true);
    expect((await stat(join(root, "storyboards/cold-ledger/assets/selected"))).isDirectory()).toBe(true);

    const manifest = JSON.parse(
      await readFile(join(root, result.assetsManifestPath), "utf-8"),
    ) as StoryboardAssetsManifest;
    expect(manifest.kind).toBe("storyboard_assets");
    expect(manifest.storyboardPath).toBe(result.storyboardPath);
    expect(manifest.imagePromptsPath).toBe(result.imagePromptsPath);
    expect(manifest.assets.map((asset) => [asset.shotId, asset.prompt])).toEqual([
      ["shot-001", "冷库门口，女出纳推门，冷色写实，9:16"],
      ["shot-002", "旧账页特写，手电光扫过红章"],
    ]);
  });

  it("applies storyboard-specific Skill guidance without reusing the long-writing Skill", async () => {
    const runtime = makeRuntime(root, [{
      skill: {
        id: "inkos-storyboard",
        name: "Storyboard creation",
        description: "Visual shot design.",
        body: "Translate narrative beats into visible shots.",
        source: "builtin",
      },
      resources: [],
    }]);

    await runStoryboardCreation({
      projectRoot: root,
      runtime,
      title: "冷库账页",
      instruction: "把小说片段拆成分镜。",
      projectId: "cold-ledger-skilled",
    });

    const messages = chatCompletionMock.mock.calls[0]?.[2] as ReadonlyArray<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("inkos-storyboard");
    expect(messages[0]?.content).toContain("Translate narrative beats into visible shots.");
    expect(messages[0]?.content).not.toContain("inkos-long-writing");
  });

  it("continues a script after a confirmed model output limit before committing it", async () => {
    chatCompletionMock.mockReset();
    chatCompletionMock.mockRejectedValueOnce(new PartialResponseError(
      "# 监控里没有他\n\n## 剧本正文\n\n便利店。暴雨。\n陌生人推门。",
      new Error("model reached the output limit (length)"),
      "output-limit",
    ));
    chatCompletionMock.mockResolvedValueOnce({
      content: "陌生人推门。\n夜班员终于发现监控时间轴被店长远程覆盖。\n\n【剧终】",
      usage: { promptTokens: 2, completionTokens: 2, totalTokens: 4 },
    });
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# 监控里没有他",
        "",
        "## 人物",
        "- 夜班员",
        "- 陌生人",
        "",
        "## 剧本正文",
        "便利店。暴雨。",
        "陌生人推门。",
        "夜班员终于发现监控时间轴被店长远程覆盖。",
        "",
        "【剧终】",
      ].join("\n"),
      usage: { promptTokens: 3, completionTokens: 3, totalTokens: 6 },
    });

    const result = await runScriptCreation({
      projectRoot: root,
      runtime: makeRuntime(root),
      title: "监控里没有他",
      instruction: "十分钟单场景现实悬疑短剧。",
      projectId: "missing-on-camera",
      episodeCount: 1,
    });

    expect(chatCompletionMock).toHaveBeenCalledTimes(3);
    const continuationMessages = chatCompletionMock.mock.calls[1]?.[2] as ReadonlyArray<{
      role: string;
      content: string;
    }>;
    expect(continuationMessages.at(-2)).toMatchObject({
      role: "assistant",
      content: expect.stringContaining("便利店。暴雨。"),
    });
    expect(continuationMessages.at(-1)?.content).toContain("只输出缺失的后续内容");
    const recoveryMessages = chatCompletionMock.mock.calls[2]?.[2] as ReadonlyArray<{
      role: string;
      content: string;
    }>;
    expect(recoveryMessages[0]?.content).toContain("恢复唯一一份规范生产文档");

    const script = await readFile(join(root, result.scriptPath), "utf-8");
    expect(script).toContain("便利店。暴雨。");
    expect(script).toContain("监控时间轴被店长远程覆盖");
    expect(script.match(/陌生人推门。/gu)).toHaveLength(1);
    const status = JSON.parse(await readFile(join(root, "dramas/missing-on-camera/status.json"), "utf-8"));
    expect(status.status).toBe("complete");
  });

  it("does not commit a script with repeated deliverable sections", async () => {
    chatCompletionMock.mockReset();
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# 重复剧本",
        "## 人物",
        "甲",
        "## 剧本正文",
        "第一版。",
        "# 重复剧本",
        "## 人物",
        "甲",
        "## 剧本正文",
        "第二版。",
      ].join("\n"),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    await expect(runScriptCreation({
      projectRoot: root,
      runtime: makeRuntime(root),
      title: "重复剧本",
      instruction: "写完整剧本。",
      projectId: "duplicate-script",
    })).rejects.toThrow("且仅返回一份");
    await expect(access(join(root, "dramas/duplicate-script/status.json"))).rejects.toThrow();
  });

  it("does not publish a completed run when the model returns another confirmation instead of a script", async () => {
    chatCompletionMock.mockReset();
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# 停电后的第三声敲门",
        "",
        "请选择一个现实解释：",
        "- A. 邻居敲错门",
        "- B. 管道传声",
        "",
        "请回复字母，确认后再输出完整剧本。",
      ].join("\n"),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    await expect(runScriptCreation({
      projectRoot: root,
      runtime: makeRuntime(root),
      title: "停电后的第三声敲门",
      instruction: "五分钟单场景现实悬疑短剧。",
      projectId: "third-knock",
    })).rejects.toThrow("且仅返回一份 `## 人物`");

    await expect(stat(join(root, "dramas/third-knock/script.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(stat(join(root, "dramas/third-knock/status.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("generates large episodic storyboards in complete structural segments", async () => {
    chatCompletionMock.mockReset();
    for (const episode of [1, 2, 3]) {
      chatCompletionMock.mockResolvedValueOnce({
        content: [
          `# 风眼来电 第${episode}集分镜`,
          "",
          "## 分镜表",
          `镜头 ${episode}：第${episode}集完整镜头。`,
          "",
          "## 图像提示词",
          `Prompt: 第${episode}集写实冷峻画面，9:16`,
        ].join("\n"),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });
    }

    const result = await runStoryboardCreation({
      projectRoot: root,
      runtime: makeRuntime(root),
      title: "风眼来电分镜",
      instruction: "总计 81 镜；第1集 28 镜、第2集 27 镜、第3集 26 镜。",
      requirements: "保留证据特写与跨集连续性。",
      sourceText: [
        "# 风眼来电",
        "",
        "### 第1集《旧频率》",
        "第一集完整正文。",
        "",
        "### 第2集《抄页》",
        "第二集完整正文。",
        "",
        "### 第3集《赴约》",
        "第三集完整正文。",
      ].join("\n"),
      maxShots: 81,
      projectId: "storm-eye-storyboard",
    });

    expect(chatCompletionMock).toHaveBeenCalledTimes(3);
    for (const [index, call] of chatCompletionMock.mock.calls.entries()) {
      const messages = call[2] as ReadonlyArray<{ role: string; content: string }>;
      const prompt = messages[1]!.content;
      expect(prompt).toContain(`第${index + 1}集`);
      expect(prompt).toContain("总计 81 镜");
      expect(prompt).toContain(`（${index + 1}/3）`);
      if (index > 0) expect(prompt).not.toContain("第一集完整正文");
      if (index < 2) expect(prompt).not.toContain("第三集完整正文");
    }

    const storyboard = await readFile(join(root, result.storyboardPath), "utf-8");
    expect(storyboard).toContain("第1集完整镜头");
    expect(storyboard).toContain("第2集完整镜头");
    expect(storyboard).toContain("第3集完整镜头");
    const manifest = JSON.parse(
      await readFile(join(root, result.assetsManifestPath), "utf-8"),
    ) as StoryboardAssetsManifest;
    expect(manifest.assets).toHaveLength(3);
  });

  it("subdivides oversized episodes by explicit Markdown scene structure without dropping source", async () => {
    chatCompletionMock.mockReset();
    for (const segment of ["一场", "二场", "一集钩子", "三场", "四场", "二集钩子"]) {
      chatCompletionMock.mockResolvedValueOnce({
        content: `## 分镜表\n${segment}\n\n## 图像提示词\nPrompt: ${segment}画面`,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });
    }
    const sourceText = [
      "# 风眼来电",
      "### 第1集《旧频率》",
      "**场次1：广播室／夜／内**",
      "第一场唯一正文。",
      "**场次2：值班室／夜／内**",
      "第二场唯一正文。",
      "**集尾钩子**",
      "第一集钩子唯一正文。",
      "### 第2集《抄页》",
      "**场次1：广播室／夜／内**",
      "第三场唯一正文。",
      "**场次2：码头／夜／外**",
      "第四场唯一正文。",
      "**集尾钩子**",
      "第二集钩子唯一正文。",
    ].join("\n");

    await runStoryboardCreation({
      projectRoot: root,
      runtime: makeRuntime(root),
      title: "风眼来电分镜",
      instruction: "总计 60 镜，各场按确认数量执行。",
      sourceText,
      maxShots: 60,
      projectId: "storm-eye-scenes",
    });

    expect(chatCompletionMock).toHaveBeenCalledTimes(6);
    const prompts = chatCompletionMock.mock.calls.map((call) =>
      (call[2] as ReadonlyArray<{ content: string }>)[1]!.content);
    expect(prompts[0]).toContain("第一场唯一正文");
    expect(prompts[0]).not.toContain("第二场唯一正文");
    expect(prompts[2]).toContain("第一集钩子唯一正文");
    expect(prompts[3]).toContain("第三场唯一正文");
    expect(prompts[5]).toContain("第二集钩子唯一正文");
    expect(prompts.join("\n")).toContain("全局镜头上限不是本次镜头数");
    for (const call of chatCompletionMock.mock.calls) {
      expect(call[3]).toMatchObject({ maxTokens: 18_000 });
    }
  });

  it("writes interactive-film story tree, flags, script, storyboard, prompts, and image assets", async () => {
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# 盛世账页 互动影游方案",
        "",
        "## 剧情树（主干+分支）",
        "- N1 入宫查账 -> 选择 A 公开账页 / 选择 B 暗藏账页",
        "",
        "## 旗标与变量系统说明",
        "| 变量 | 含义 | 触发 |",
        "| --- | --- | --- |",
        "| trust_guard | 侍卫信任 | 选择交出证据 |",
        "",
        "## 多结局路径",
        "- 真相公开结局：trust_guard + ledger_public",
        "",
        "## 互动剧本（第1幕示例）",
        "### 节点 N1",
        "玩家选择：公开账页 / 暗藏账页",
        "",
        "## 分镜与图像提示词（关键镜头列表）",
        "镜头 1：女官在烛光下展开账页。",
        "**Prompt for C01**: 古装宫廷账页特写，女官手持账册，烛光，写实，16:9",
        "镜头 2：侍卫拦在宫门前。",
        "Prompt: 宫门雨夜，侍卫回头，压迫感，电影感，16:9",
      ].join("\n"),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    chatCompletionMock.mockResolvedValueOnce({
      content: JSON.stringify({
        schemaVersion: 1,
        projectId: "shengshi-ledger",
        title: "盛世账页",
        variables: [
          { name: "trust_guard", type: "relationship", default: 0, desc: "侍卫信任" },
        ],
        nodes: [
          {
            id: "start",
            title: "入宫查账",
            type: "start",
            sceneDesc: "女官在烛光下展开账页。",
            dialogue: [],
            choices: [{ id: "c1", text: "公开账页", targetNodeId: "branch-1", effects: [] }],
          },
          {
            id: "branch-1",
            title: "宫门选择",
            type: "branch",
            sceneDesc: "侍卫拦在宫门前。",
            dialogue: [],
            choices: [
              { id: "c2", text: "交出证据", targetNodeId: "ending-good", effects: [{ var: "trust_guard", op: "add", value: 1 }] },
              { id: "c3", text: "暗藏账页", targetNodeId: "ending-secret", effects: [] },
            ],
          },
          {
            id: "branch-2",
            title: "账页去向",
            type: "branch",
            sceneDesc: "玩家决定账页的最终去向。",
            dialogue: [],
            choices: [{ id: "c4", text: "留给御史", targetNodeId: "ending-good", effects: [] }],
          },
          { id: "ending-good", title: "真相公开", type: "ending", sceneDesc: "真相公开。", dialogue: [], choices: [] },
          { id: "ending-secret", title: "暗线潜行", type: "ending", sceneDesc: "暗线潜行。", dialogue: [], choices: [] },
        ],
        endings: [
          { id: "good", nodeId: "ending-good", title: "真相公开", type: "good", description: "账页公开。" },
          { id: "secret", nodeId: "ending-secret", title: "暗线潜行", type: "secret", description: "账页被藏起。" },
        ],
      }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    const result = await runInteractiveFilmCreation({
      projectRoot: root,
      runtime: makeRuntime(root),
      title: "盛世账页",
      instruction: "做一个盛世天下式多结局互动影游。",
      projectId: "shengshi-ledger",
      outDir: "interactive-films/shengshi-ledger",
      budget: "5000元",
      referenceMode: "盛世天下式多走向",
    });

    expect(result.baseDir).toBe("interactive-films/shengshi-ledger");
    expect(result).toMatchObject({
      storyGraphPath: "interactive-films/shengshi-ledger/story-graph.json",
    });
    await expect(readFile(join(root, result.specPath), "utf-8")).resolves.toContain("互动影游创作规格");
    await expect(readFile(join(root, result.storyTreePath), "utf-8")).resolves.toContain("N1 入宫查账");
    await expect(readFile(join(root, result.flagsPath), "utf-8")).resolves.toContain("trust_guard");
    await expect(readFile(join(root, result.scriptPath), "utf-8")).resolves.toContain("节点 N1");
    await expect(readFile(join(root, result.storyboardPath), "utf-8")).resolves.toContain("镜头 1");
    await expect(readFile(join(root, result.imagePromptsPath), "utf-8")).resolves.toContain("古装宫廷账页特写");

    const manifest = JSON.parse(
      await readFile(join(root, result.assetsManifestPath), "utf-8"),
    ) as StoryboardAssetsManifest;
    expect(manifest.assets.map((asset) => asset.prompt)).toEqual([
      "古装宫廷账页特写，女官手持账册，烛光，写实，16:9",
      "宫门雨夜，侍卫回头，压迫感，电影感，16:9",
    ]);

    const graph = await loadStoryGraph(root, "shengshi-ledger");
    expect(graph).not.toBeNull();
    if (!graph) throw new Error("Expected generated story graph");
    expect(graph.title).toBe("盛世账页");
    expect(graph.nodes.some((node) => node.type === "start")).toBe(true);
  });

  it("runs storyboard creation in English with English prompts and parses English section headings", async () => {
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# Cold Ledger Storyboard",
        "",
        "## Storyboard",
        "Shot 1: The cashier pushes open the cold-storage door.",
        "Shot 2: A flashlight beam sweeps across the old ledger pages.",
        "",
        "## Image Prompts",
        "1. Prompt: cold-storage doorway, female cashier pushing the door, desaturated realism, 9:16",
        "2. Prompt: close-up of an old ledger page, flashlight beam, oppressive mood",
      ].join("\n"),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    const result = await runStoryboardCreation({
      projectRoot: root,
      runtime: makeRuntime(root),
      title: "Cold Ledger",
      instruction: "Break the novel excerpt into a storyboard.",
      projectId: "cold-ledger-en",
      visualStyle: "desaturated realism",
      aspectRatio: "9:16",
      language: "en",
    });

    const [, , messages] = chatCompletionMock.mock.calls[0]!;
    const system = messages[0].content as string;
    const user = messages[1].content as string;
    expect(system).toContain("storyboard-creation tool");
    expect(system).not.toMatch(/[一-鿿]/);
    expect(user).toContain("## Storyboard Spec");
    expect(user).toContain("## Image Prompts");
    expect(user).not.toMatch(/[一-鿿]/);

    await expect(readFile(join(root, result.specPath), "utf-8")).resolves.toContain(
      "# Cold Ledger Storyboard Creation Spec",
    );
    const manifest = JSON.parse(
      await readFile(join(root, result.assetsManifestPath), "utf-8"),
    ) as StoryboardAssetsManifest;
    expect(manifest.assets.map((asset) => [asset.shotId, asset.prompt])).toEqual([
      ["shot-001", "cold-storage doorway, female cashier pushing the door, desaturated realism, 9:16"],
      ["shot-002", "close-up of an old ledger page, flashlight beam, oppressive mood"],
    ]);
  });

  it("runs interactive-film creation in English and splits the package by English headings", async () => {
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# Crown Feast Interactive Film Package",
        "",
        "## Story Tree",
        "- N1 The banquet hall -> choice A reveal the letter / choice B hide the letter",
        "",
        "## Variables and Flags",
        "| Variable | Meaning | Trigger |",
        "| --- | --- | --- |",
        "| trust_guard | Guard's trust | Hand over the evidence |",
        "",
        "## Ending Paths",
        "- Truth ending: trust_guard + letter_public",
        "",
        "## Interactive Script",
        "### Node N1",
        "Player choice: reveal the letter / hide the letter",
        "",
        "## Storyboard and Image Prompts",
        "Shot 1: The envoy unfolds the letter by candlelight.",
        "Prompt: medieval banquet hall, envoy holding a letter, candlelight, cinematic, 16:9",
      ].join("\n"),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    chatCompletionMock.mockResolvedValueOnce({
      content: "I cannot produce JSON, but I can summarize the plot.",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    const result = await runInteractiveFilmCreation({
      projectRoot: root,
      runtime: makeRuntime(root),
      title: "Crown Feast",
      instruction: "Build a multi-ending interactive film.",
      projectId: "crown-feast",
      language: "en",
    });

    const [, , messages] = chatCompletionMock.mock.calls[0]!;
    const system = messages[0].content as string;
    const user = messages[1].content as string;
    expect(system).toContain("interactive-film creation tool");
    expect(system).not.toMatch(/[一-鿿]/);
    expect(user).toContain("## Story Tree");
    expect(user).toContain("## Variables and Flags");
    expect(user).toContain("## Interactive Script");
    expect(user).toContain("## Storyboard and Image Prompts");
    expect(user).not.toMatch(/[一-鿿]/);

    await expect(readFile(join(root, result.specPath), "utf-8")).resolves.toContain(
      "Interactive Film Creation Spec",
    );
    const storyTree = await readFile(join(root, result.storyTreePath), "utf-8");
    expect(storyTree).toContain("N1 The banquet hall");
    expect(storyTree).not.toContain("trust_guard");
    await expect(readFile(join(root, result.flagsPath), "utf-8")).resolves.toContain("trust_guard");
    await expect(readFile(join(root, result.scriptPath), "utf-8")).resolves.toContain("Node N1");
    await expect(readFile(join(root, result.storyboardPath), "utf-8")).resolves.toContain("Shot 1");
    await expect(readFile(join(root, result.imagePromptsPath), "utf-8")).resolves.toContain(
      "medieval banquet hall",
    );

    const graph = await loadStoryGraph(root, "crown-feast");
    expect(graph).not.toBeNull();
    if (!graph) throw new Error("Expected fallback story graph");
    expect(graph.title).toBe("Crown Feast");
    expect(JSON.stringify(graph)).not.toMatch(/[一-鿿]/);
    expect(graph.nodes.find((node) => node.id === "start")?.title).toBe("Opening");
  });

  it("fails clearly when the structured story graph worker cannot submit a graph", async () => {
    generateStoryGraphMock.mockRejectedValueOnce(new Error("model did not submit a graph"));
    chatCompletionMock.mockResolvedValueOnce({
      content: [
        "# 回声剧场 互动影游方案",
        "",
        "## 剧情树",
        "- 开场：主角进入废弃剧场。",
        "- 分支：追逐回声 / 检查后台。",
        "",
        "## 变量与旗标表",
        "- echo_trust：回声可信度",
        "",
        "## 互动剧本",
        "### 开场",
        "玩家选择：追逐回声 / 检查后台",
        "",
        "## 分镜与图像提示词",
        "Prompt: 废弃剧场，红色帷幕，悬疑，16:9",
      ].join("\n"),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    chatCompletionMock.mockResolvedValueOnce({
      content: "我无法输出 JSON，但可以概括剧情。",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    await expect(runInteractiveFilmCreation({
      projectRoot: root,
      runtime: makeRuntime(root),
      title: "回声剧场",
      instruction: "做一个悬疑互动影游。",
      projectId: "echo-theater",
      episodeCount: 3,
    })).rejects.toThrow("model did not submit a graph");
    await expect(loadStoryGraph(root, "echo-theater")).resolves.toBeNull();
  });
});

function makeRuntime(root: string, activatedSkills?: AgentContext["activatedSkills"]): AgentContext {
  return {
    projectRoot: root,
    model: "test-model",
    client: {
      provider: "openai",
      apiFormat: "chat",
      stream: false,
      defaults: {
        temperature: 0.5,
        maxTokens: 4096,
        thinkingBudget: 0,
        extra: {},
      },
    },
    activatedSkills,
  };
}
