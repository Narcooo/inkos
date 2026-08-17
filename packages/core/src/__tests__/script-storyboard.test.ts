import { describe, expect, it } from "vitest";
import {
  countMarkdownSections,
  extractMarkdownSection,
  extractProductionDocument,
  extractStoryboardImagePrompts,
  normalizeScriptEpisodeEndLabels,
  renderInteractiveFilmSpec,
  renderScriptSpec,
  renderStoryboardSpec,
} from "../agents/script-storyboard.js";
import { createStoryboardAssetsManifest } from "../pipeline/script-storyboard-runner.js";

describe("script and storyboard creation helpers", () => {
  it("renders a human-readable script spec without excerpting source text", () => {
    const sourceText = "第一章。".repeat(500);
    const spec = renderScriptSpec({
      title: "冷库账页",
      sourceKind: "小说",
      targetFormat: "vertical_short_drama",
      sourceText,
      requirements: "调查线七成，家怨三成。",
      episodeCount: 12,
      episodeDuration: "2分钟",
    });

    expect(spec).toContain("# 冷库账页 剧本创作规格");
    expect(spec).toContain("交付类型：竖屏短剧");
    expect(spec).toContain("集数/段落数：12");
    expect(spec).toContain("调查线七成，家怨三成");
    expect(spec).toContain("已提供完整源素材");
    expect(spec).toContain(`${sourceText.replace(/\s+/g, " ").trim().length} 字符`);
    expect(spec).not.toContain("第一章。第一章。第一章。");
    expect(spec).not.toContain("...");
  });

  it("renders storyboard specs as editable Markdown", () => {
    const spec = renderStoryboardSpec({
      title: "冷库账页",
      sourceKind: "剧本",
      visualStyle: "写实冷色",
      aspectRatio: "9:16",
      granularity: "按场景关键镜头拆分",
      maxShots: 18,
      requirements: "每镜头都要有关键道具。",
    });

    expect(spec).toContain("# 冷库账页 分镜创作规格");
    expect(spec).toContain("分镜粒度：按场景关键镜头拆分");
    expect(spec).toContain("画幅：9:16");
    expect(spec).toContain("视觉风格：写实冷色");
    expect(spec).toContain("镜头上限：18");
    expect(spec).toContain("每镜头都要有关键道具");
  });

  it("extracts only the storyboard image prompt section when present", () => {
    const prompts = extractStoryboardImagePrompts([
      "# 冷库账页分镜",
      "",
      "## 分镜表",
      "镜头 1：出纳推开冷库门。",
      "",
      "## 图像提示词",
      "1. Prompt: 冷库门口，女出纳，冷色写实，9:16",
      "2. Prompt: 旧账页特写，手电光，压迫感",
      "",
      "## 备注",
      "后续可扩展。",
    ].join("\n"));

    expect(prompts).toContain("冷库门口");
    expect(prompts).toContain("旧账页特写");
    expect(prompts).not.toContain("分镜表");
    expect(prompts).not.toContain("备注");
  });

  it("extracts only explicit prompt lines when the model embeds prompts in storyboard content", () => {
    const prompts = extractStoryboardImagePrompts([
      "# 冷库账页分镜",
      "",
      "## 分镜表",
      "| 镜号 | 画面 | 提示词 |",
      "| --- | --- | --- |",
      "| 1 | 女出纳推开冷库门 | Prompt: 冷库门口，女出纳推门，冷色写实，9:16 |",
      "| 2 | 手电扫过旧账页 | Prompt: 旧账页特写，手电光扫过红章 |",
      "",
      "这是一段普通解释，不应进入图片资产。",
    ].join("\n"));

    expect(prompts).toBe([
      "1. 冷库门口，女出纳推门，冷色写实，9:16",
      "2. 旧账页特写，手电光扫过红章",
    ].join("\n"));
  });

  it("matches markdown section headings with descriptive suffixes", () => {
    const section = extractMarkdownSection([
      "# 鸦冠之宴",
      "",
      "## 剧情树（主干+分支）",
      "- N1 宴会前厅 -> 选择 A 公开密信 / 选择 B 隐藏密信",
      "",
      "## 变量与旗标表",
      "| 变量 | 含义 |",
      "| --- | --- |",
    ].join("\n"), ["剧情树"]);

    expect(section).toContain("N1 宴会前厅");
    expect(section).not.toContain("变量与旗标表");
  });

  it("extracts the production document after model scratch text", () => {
    const document = extractProductionDocument([
      "先分析几个方案。",
      "这些内容不能进入交付稿。",
      "",
      "# 凌晨四点的空电梯",
      "",
      "## 人物",
      "苏晚",
      "",
      "## 剧本正文",
      "完整正文。",
    ].join("\n"), "凌晨四点的空电梯");

    expect(document).toMatch(/^# 凌晨四点的空电梯/u);
    expect(document).not.toContain("先分析几个方案");
    expect(countMarkdownSections(document, ["人物"])).toBe(1);
    expect(countMarkdownSections(document, ["剧本正文"])).toBe(1);
  });

  it("extracts markdown-bold prompt labels with shot ids", () => {
    const prompts = extractStoryboardImagePrompts([
      "# 鸦冠之宴",
      "",
      "## 分镜与图像提示词（关键镜头列表）",
      "**Prompt for C01**: dark-gold medieval court, candlelight, raven feathers, cinematic",
      "**提示词 C02**：石厅长桌，贵族交锋，蜡烛与暗金帷幕",
    ].join("\n"));

    expect(prompts).toBe([
      "1. dark-gold medieval court, candlelight, raven feathers, cinematic",
      "2. 石厅长桌，贵族交锋，蜡烛与暗金帷幕",
    ].join("\n"));
  });

  it("extracts inline-code Prompt lines emitted by storyboard models", () => {
    const prompts = extractStoryboardImagePrompts([
      "# 风眼旧频率",
      "",
      "## 分镜与图像提示词",
      "`Prompt: 写实台风海岛，渡船广播室，冷青雨夜，16:9`",
      "`Prompt: 走私船舱，妹妹敲击暗号，低照度写实电影感`",
    ].join("\n"));

    expect(prompts).toBe([
      "1. 写实台风海岛，渡船广播室，冷青雨夜，16:9",
      "2. 走私船舱，妹妹敲击暗号，低照度写实电影感",
    ].join("\n"));
  });

  it("extracts prompts from markdown tables with a Prompt column", () => {
    const prompts = extractStoryboardImagePrompts([
      "# 雾桥旅馆",
      "",
      "## 分镜与图像提示词",
      "| 幕次 | 场景 | Prompt |",
      "|------|------|--------|",
      "| 第一幕 | 旅馆大堂 | 冷色调互动影游场景，雨夜旅馆大堂内部，木制前台，三块监控屏幕 |",
      "| 第二幕 | 15号房 | 旅馆房间内部，行李箱暗格露出护照，冷色照明，雨夜窗外光线 |",
    ].join("\n"));

    expect(prompts).toBe([
      "1. 冷色调互动影游场景，雨夜旅馆大堂内部，木制前台，三块监控屏幕",
      "2. 旅馆房间内部，行李箱暗格露出护照，冷色照明，雨夜窗外光线",
    ].join("\n"));
  });

  it("does not treat whole storyboard prose as image prompts", () => {
    const prompts = extractStoryboardImagePrompts([
      "# 冷库账页分镜",
      "",
      "## 分镜表",
      "镜头 1：女出纳推开冷库门。",
      "镜头 2：手电光扫过旧账页。",
    ].join("\n"));

    expect(prompts).toBe("");
  });

  it("normalizes mismatched episode-end subtitle labels inside each episode section", () => {
    const script = normalizeScriptEpisodeEndLabels([
      "# 冷库账页",
      "### 第一集",
      "字幕：第一集完",
      "### 第三集",
      "字幕：第二集完",
    ].join("\n"));

    expect(script).toContain("字幕：第三集完");
    expect(script).not.toContain("字幕：第二集完");
  });

  it("renders an interactive-film spec with branch and flag boundaries", () => {
    const spec = renderInteractiveFilmSpec({
      title: "盛世账页",
      sourceKind: "投稿需求",
      requirements: "多结局，变量记录玩家每次关键抉择。",
      targetAudience: "欧美互动影游用户",
      budget: "5000元",
      referenceMode: "盛世天下式多走向",
    });

    expect(spec).toContain("# 盛世账页 互动影游创作规格");
    expect(spec).toContain("交付类型：互动影游");
    expect(spec).toContain("变量/旗标");
    expect(spec).toContain("多结局");
    expect(spec).toContain("5000元");
  });

  it("renders an English script spec with English headings and no Chinese text", () => {
    const sourceText = "Chapter one. ".repeat(300);
    const spec = renderScriptSpec({
      title: "Cold Ledger",
      sourceKind: "novel",
      targetFormat: "vertical_short_drama",
      sourceText,
      requirements: "70% investigation, 30% family grudge.",
      episodeCount: 12,
      episodeDuration: "2 minutes",
      language: "en",
    });

    expect(spec).toContain("# Cold Ledger Script Creation Spec");
    expect(spec).toContain("Deliverable: vertical short drama");
    expect(spec).toContain("- Episode/segment count: 12");
    expect(spec).toContain("70% investigation, 30% family grudge.");
    expect(spec).toContain("Full source material provided");
    expect(spec).toContain(`${sourceText.replace(/\s+/g, " ").trim().length} characters`);
    expect(spec).not.toMatch(/[一-鿿]/);
  });

  it("renders an English storyboard spec with English headings and no Chinese text", () => {
    const spec = renderStoryboardSpec({
      title: "Cold Ledger",
      sourceKind: "script",
      visualStyle: "desaturated realism",
      aspectRatio: "9:16",
      granularity: "split by scene and key shots",
      maxShots: 18,
      requirements: "Every shot needs a key prop.",
      language: "en",
    });

    expect(spec).toContain("# Cold Ledger Storyboard Creation Spec");
    expect(spec).toContain("- Shot granularity: split by scene and key shots");
    expect(spec).toContain("- Aspect ratio: 9:16");
    expect(spec).toContain("- Visual style: desaturated realism");
    expect(spec).toContain("- Shot cap: 18");
    expect(spec).toContain("Every shot needs a key prop.");
    expect(spec).not.toMatch(/[一-鿿]/);
  });

  it("renders an English interactive-film spec with English headings and no Chinese text", () => {
    const spec = renderInteractiveFilmSpec({
      title: "Crown Feast",
      sourceKind: "submission brief",
      requirements: "Multiple endings; variables track every key decision.",
      targetAudience: "Western interactive-film players",
      budget: "USD 800",
      referenceMode: "branch-heavy narrative",
      language: "en",
    });

    expect(spec).toContain("# Crown Feast Interactive Film Creation Spec");
    expect(spec).toContain("- Deliverable: interactive film");
    expect(spec).toContain("- Target audience: Western interactive-film players");
    expect(spec).toContain("- Budget constraint: USD 800");
    expect(spec).toContain("Multiple endings; variables track every key decision.");
    expect(spec).not.toMatch(/[一-鿿]/);
  });

  it("builds a storyboard image asset manifest from editable prompts", () => {
    const manifest = createStoryboardAssetsManifest({
      title: "冷库账页",
      projectId: "cold-ledger",
      baseDir: "storyboards/cold-ledger",
      storyboardPath: "storyboards/cold-ledger/storyboard.md",
      imagePromptsPath: "storyboards/cold-ledger/image-prompts.md",
      imagePrompts: [
        "1. Prompt: 冷库门口，女出纳推门，冷色写实，9:16",
        "2. Prompt: 旧账页特写，手电光扫过红章",
      ].join("\n"),
      createdAt: "2026-06-16T00:00:00.000Z",
    });

    expect(manifest.kind).toBe("storyboard_assets");
    expect(manifest.assetsDir).toBe("storyboards/cold-ledger/assets");
    expect(manifest.generatedDir).toBe("storyboards/cold-ledger/assets/generated");
    expect(manifest.selectedDir).toBe("storyboards/cold-ledger/assets/selected");
    expect(manifest.assets).toEqual([
      {
        shotId: "shot-001",
        prompt: "冷库门口，女出纳推门，冷色写实，9:16",
        sourceRefs: [],
        variants: [],
        status: "prompt_ready",
      },
      {
        shotId: "shot-002",
        prompt: "旧账页特写，手电光扫过红章",
        sourceRefs: [],
        variants: [],
        status: "prompt_ready",
      },
    ]);
  });
});
