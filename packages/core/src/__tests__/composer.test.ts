import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BookConfig } from "../models/book.js";
import type { PlanChapterOutput } from "../agents/planner.js";
import { ComposerAgent, composeGovernedChapter } from "../agents/composer.js";

const require = createRequire(import.meta.url);
const hasNodeSqlite = (() => {
  try {
    require("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

describe("ComposerAgent", () => {
  let root: string;
  let bookDir: string;
  let storyDir: string;
  let book: BookConfig;
  let plan: PlanChapterOutput;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-composer-test-"));
    bookDir = join(root, "books", "composer-book");
    storyDir = join(bookDir, "story");
    await mkdir(join(storyDir, "runtime"), { recursive: true });

    book = {
      id: "composer-book",
      title: "Composer Book",
      platform: "tomato",
      genre: "xuanhuan",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 3000,
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    };

    await Promise.all([
      writeFile(join(storyDir, "author_intent.md"), "# Author Intent\n\nKeep the pressure on the mentor conflict.\n", "utf-8"),
      writeFile(join(storyDir, "current_focus.md"), "# Current Focus\n\nBring the focus back to the mentor conflict.\n", "utf-8"),
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 4\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n\n- Keep the prose restrained.\n", "utf-8"),
    ]);

    const runtimePath = join(storyDir, "runtime", "chapter-0004.intent.md");
    await writeFile(runtimePath, "# Chapter Intent\n\n## Goal\nBring the focus back to the mentor conflict.\n", "utf-8");

    plan = {
      intent: {
        chapter: 4,
        goal: "Bring the focus back to the mentor conflict.",
        outlineNode: "Track the merchant guild trail.",
        mustKeep: [
          "Lin Yue still hides the broken oath token.",
          "The jade seal cannot be destroyed.",
        ],
        mustAvoid: ["Do not reveal the mastermind."],
        styleEmphasis: ["character conflict", "tight POV"],
      },
      memo: {
        chapter: 4,
        goal: "Bring the focus back to the mentor conflict.",
        isGoldenOpening: false,
        body: "",
        threadRefs: [],
      },
      intentMarkdown: "# Chapter Intent\n",
      plannerInputs: [
        join(storyDir, "author_intent.md"),
        join(storyDir, "current_focus.md"),
        join(storyDir, "story_bible.md"),
        join(storyDir, "volume_outline.md"),
        join(storyDir, "current_state.md"),
      ],
      runtimePath,
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("selects only the relevant context and writes a context package", async () => {
    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 4,
      plan,
    });

    const selectedSources = result.contextPackage.selectedContext.map((entry) => entry.source);
    expect(selectedSources.slice(0, 4)).toEqual([
      "runtime/chapter_memo",
      "story/current_focus.md",
      "story/author_intent.md",
      "story/current_state.md",
    ]);
    expect(selectedSources[4]).toMatch(/^story\/story_bible\.md#/);
    expect(selectedSources[5]).toMatch(/^story\/volume_outline\.md#/);
    // The user's long-term direction must reach the writer's context, not be dropped.
    expect(selectedSources).toContain("story/author_intent.md");
    expect(selectedSources.some((source) => source.startsWith("story/pending_hooks.md"))).toBe(true);
    expect(selectedSources).not.toContain("story/style_guide.md");
    await expect(readFile(result.contextPath, "utf-8")).resolves.toContain("current_focus.md");
  });

  it("adds semantically selected book references as traceable compressible context", async () => {
    const result = await composeGovernedChapter({
      book,
      bookDir,
      chapterNumber: 4,
      plan,
      referenceContextProvider: async (request) => {
        expect(request).toMatchObject({
          chapterNumber: 4,
          goal: "Bring the focus back to the mentor conflict.",
          outlineNode: "Track the merchant guild trail.",
          language: "zh",
        });
        expect(request.mustKeep).toContain("The jade seal cannot be destroyed.");
        return {
          entries: [{
            source: "reference/material-1#relationship-arc",
            reason: "User-bound reference for relationship pacing.",
            excerpt: "# Relationship Arc\nCooperate before trust.",
          }],
          notes: ["book-reference-context-selected"],
        };
      },
    });

    const reference = result.contextPackage.selectedContext.find((entry) =>
      entry.source === "reference/material-1#relationship-arc",
    );
    expect(reference?.excerpt).toContain("Cooperate before trust");
    expect(result.trace.selectedSources).toContain("reference/material-1#relationship-arc");
    expect(result.trace.contextTiers.compressibleSources).toContain("reference/material-1#relationship-arc");
    expect(result.trace.contextTiers.protectedSources).not.toContain("reference/material-1#relationship-arc");
    expect(result.trace.notes).toContain("book-reference-context-selected");
  });

  it("preserves later author-intent constraints instead of reducing them to the first line", async () => {
    await writeFile(
      join(storyDir, "author_intent.md"),
      [
        "# Author Intent",
        "",
        "标题：《桥洞来信》",
        "",
        "必须使用第一人称叙事，不得改成第三人称。",
        "主角的每次决定都要围绕“我不再替别人背债”展开。",
      ].join("\n"),
      "utf-8",
    );

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 4,
      plan,
    });

    const authorIntentEntry = result.contextPackage.selectedContext.find((entry) =>
      entry.source === "story/author_intent.md",
    );
    expect(authorIntentEntry?.excerpt).toContain("标题：《桥洞来信》");
    expect(authorIntentEntry?.excerpt).toContain("必须使用第一人称叙事，不得改成第三人称。");
    expect(authorIntentEntry?.excerpt).toContain("我不再替别人背债");
  });

  it("preserves later canon constraints from file context instead of first-line excerpts", async () => {
    await writeFile(
      join(storyDir, "parent_canon.md"),
      [
        "# Parent Canon",
        "",
        "档案编号：旧城案",
        "",
        "父本正典约束：导师直到第二卷才知道档案馆火灾。",
        "本章不能提前泄露档案馆火灾的真正纵火者。",
      ].join("\n"),
      "utf-8",
    );

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 4,
      plan,
    });

    const parentCanonEntry = result.contextPackage.selectedContext.find((entry) =>
      entry.source === "story/parent_canon.md",
    );
    expect(parentCanonEntry?.excerpt).toContain("档案编号：旧城案");
    expect(parentCanonEntry?.excerpt).toContain("导师直到第二卷才知道档案馆火灾");
    expect(parentCanonEntry?.excerpt).toContain("不能提前泄露档案馆火灾的真正纵火者");
  });

  it("emits a rule stack with hard, soft, and diagnostic sections", async () => {
    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 4,
      plan,
    });

    // Phase hotfix 6: section names track Phase 5 authoritative paths.
    expect(result.ruleStack.sections.hard).toContain("story_frame");
    expect(result.ruleStack.sections.hard).toContain("roles");
    expect(result.ruleStack.sections.soft).toContain("author_intent");
    expect(result.ruleStack.sections.soft).toContain("volume_map");
    expect(result.ruleStack.sections.diagnostic).toContain("anti_ai_checks");
    // activeOverrides now derived from the plan: 1 mustAvoid + 2 styleEmphasis.
    expect(result.ruleStack.activeOverrides.length).toBeGreaterThan(0);
    const reasons = result.ruleStack.activeOverrides.map((o) => o.reason);
    expect(reasons).toContain("Do not reveal the mastermind.");
    expect(reasons).toContain("character conflict");
    expect(reasons).toContain("tight POV");
    // All overrides target the current chapter.
    for (const override of result.ruleStack.activeOverrides) {
      expect(override.target).toContain("chapter:4");
    }
  });

  it("writes trace output describing planner inputs and selected sources", async () => {
    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 4,
      plan,
    });

    expect(result.trace.plannerInputs).toEqual(plan.plannerInputs);
    expect(result.trace.selectedSources).toContain("story/current_focus.md");
    expect(result.trace).not.toHaveProperty("usedSkills");
    expect(result.trace).not.toHaveProperty("contextNeeds");
    expect(result.trace.contextTiers.protectedSources).toContain("story/current_focus.md");
    expect(result.trace.contextTiers.protectedSources).toContain("story/author_intent.md");
    expect(result.trace.contextTiers.compressibleSources).not.toContain("story/author_intent.md");
    expect(result.trace.tokenBudget.protectedTokens).toBeGreaterThan(0);
    expect(result.trace.tokenBudget.totalSelectedTokens).toBeGreaterThanOrEqual(
      result.trace.tokenBudget.protectedTokens,
    );
    // trace.notes dropped with ChapterConflict removal (Phase 1 transitional)
    expect(result.trace.notes).toEqual([]);
    await expect(readFile(result.tracePath, "utf-8")).resolves.toContain("story/current_focus.md");
  });

  it("compiles only compressible context when selected context exceeds budget", async () => {
    const longTitle = `旧章标题${"旧案".repeat(800)}`;
    await writeFile(
      join(storyDir, "chapter_summaries.md"),
      [
        "# Chapter Summaries",
        "",
        "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        `| 1 | ${longTitle} | Lin Yue | Old archive noise | None | none | tight | investigation |`,
        "| 2 | Second Trail | Lin Yue | More old trail noise | None | none | tight | investigation |",
        "",
      ].join("\n"),
      "utf-8",
    );

    let compileRequest: {
      protectedSources: string[];
      compressibleSources: string[];
    } | undefined;

    const result = await composeGovernedChapter({
      book,
      bookDir,
      chapterNumber: 4,
      plan,
      contextBudget: {
        contextWindowTokens: 900,
        reservedOutputTokens: 0,
      },
      compressibleContextCompiler: async (request: {
        readonly protectedEntries: ReadonlyArray<{ readonly source: string }>;
        readonly compressibleEntries: ReadonlyArray<{ readonly source: string }>;
      }) => {
        compileRequest = {
          protectedSources: request.protectedEntries.map((entry) => entry.source),
          compressibleSources: request.compressibleEntries.map((entry) => entry.source),
        };
        return "压缩后的旧章标题历史：只保留旧案连续调查的节奏提醒。";
      },
    });

    const sources = result.contextPackage.selectedContext.map((entry) => entry.source);
    const authorIntent = result.contextPackage.selectedContext.find((entry) =>
      entry.source === "story/author_intent.md",
    );
    const compiled = result.contextPackage.selectedContext.find((entry) =>
      entry.source === "runtime/compiled-compressible-context",
    );

    expect(compileRequest).toBeDefined();
    expect(compileRequest!.protectedSources).toContain("story/author_intent.md");
    expect(compileRequest!.compressibleSources).toContain("story/chapter_summaries.md#recent_titles");
    expect(sources).toContain("story/author_intent.md");
    expect(sources).not.toContain("story/chapter_summaries.md#recent_titles");
    expect(authorIntent?.excerpt).toContain("Keep the pressure on the mentor conflict.");
    expect(compiled?.excerpt).toContain("压缩后的旧章标题历史");
    expect(result.trace.notes).toContain("compiled-compressible-context");
    expect(result.trace.compression).toMatchObject({
      compiledSource: "runtime/compiled-compressible-context",
      compressedSources: expect.arrayContaining(["story/chapter_summaries.md#recent_titles"]),
      protectedSources: expect.arrayContaining(["story/author_intent.md"]),
    });
  });

  it("emits story context compression lifecycle events when compiling compressible context", async () => {
    await writeFile(
      join(storyDir, "chapter_summaries.md"),
      [
        "# Chapter Summaries",
        "",
        "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        `| 1 | ${"旧章".repeat(1000)} | Lin Yue | Old archive noise | None | none | tight | investigation |`,
      ].join("\n"),
      "utf-8",
    );
    const events: Array<{ readonly category: string; readonly phase: string; readonly sources?: readonly string[] }> = [];

    await composeGovernedChapter({
      book,
      bookDir,
      chapterNumber: 4,
      plan,
      contextBudget: { contextWindowTokens: 900, reservedOutputTokens: 0 },
      compressibleContextCompiler: async () => "压缩后的旧章标题历史。",
      onContextCompression: (event) => events.push(event),
    });

    expect(events.map((event) => [event.category, event.phase])).toEqual([
      ["story_context", "start"],
      ["story_context", "end"],
    ]);
    expect(events[0].sources).toContain("story/chapter_summaries.md#recent_titles");
  });

  it("fails loudly when protected context alone exceeds the input budget", async () => {
    await writeFile(
      join(storyDir, "author_intent.md"),
      `# Author Intent\n\n${"protected author intent ".repeat(5000)}`,
      "utf-8",
    );

    await expect(composeGovernedChapter({
      book,
      bookDir,
      chapterNumber: 4,
      plan,
      contextBudget: {
        contextWindowTokens: 300,
        reservedOutputTokens: 0,
      },
      compressibleContextCompiler: async () => "should not be called",
    })).rejects.toThrow(/Protected context exceeds available input budget/);
  });

  it("fails loudly when context needs compilation but no compiler was provided", async () => {
    await writeFile(
      join(storyDir, "chapter_summaries.md"),
      [
        "# Chapter Summaries",
        "",
        "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        `| 1 | ${"旧案".repeat(1200)} | Lin Yue | Old archive noise | None | none | tight | investigation |`,
      ].join("\n"),
      "utf-8",
    );

    await expect(composeGovernedChapter({
      book,
      bookDir,
      chapterNumber: 4,
      plan,
      contextBudget: {
        contextWindowTokens: 900,
        reservedOutputTokens: 0,
      },
    })).rejects.toThrow(/no compressible context compiler/);
  });

  it("fails loudly when the compressible context compiler returns empty output", async () => {
    await writeFile(
      join(storyDir, "chapter_summaries.md"),
      [
        "# Chapter Summaries",
        "",
        "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        `| 1 | ${"旧案".repeat(1200)} | Lin Yue | Old archive noise | None | none | tight | investigation |`,
      ].join("\n"),
      "utf-8",
    );

    await expect(composeGovernedChapter({
      book,
      bookDir,
      chapterNumber: 4,
      plan,
      contextBudget: {
        contextWindowTokens: 900,
        reservedOutputTokens: 0,
      },
      compressibleContextCompiler: async () => "   ",
    })).rejects.toThrow(/compiler returned empty output/);
  });

  it("selects relevant legacy outline sections instead of protecting whole legacy files", async () => {
    const unrelatedNoise = "IRRELEVANT-LEGACY-NOISE ".repeat(2500);
    await Promise.all([
      writeFile(
        join(storyDir, "story_bible.md"),
        [
          "# Story Bible",
          "",
          "## Unrelated Archive",
          unrelatedNoise,
          "",
          "## World Rules",
          "The jade seal cannot be destroyed. Lin Yue still hides the broken oath token.",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "## Chapter 1",
          unrelatedNoise,
          "",
          "## Chapter 4",
          "Track the merchant guild trail while keeping the mentor conflict active.",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const result = await composeGovernedChapter({
      book,
      bookDir,
      chapterNumber: 4,
      plan,
    });

    const storyBibleEntry = result.contextPackage.selectedContext.find((entry) =>
      entry.source.startsWith("story/story_bible.md#"),
    );
    const volumeEntry = result.contextPackage.selectedContext.find((entry) =>
      entry.source.startsWith("story/volume_outline.md#"),
    );

    expect(storyBibleEntry?.excerpt).toContain("jade seal cannot be destroyed");
    expect(storyBibleEntry?.excerpt).not.toContain("IRRELEVANT-LEGACY-NOISE");
    expect(volumeEntry?.excerpt).toContain("Chapter 4");
    expect(volumeEntry?.excerpt).not.toContain("IRRELEVANT-LEGACY-NOISE");
  });

  it("selects relevant outline sections instead of protecting whole large outline files", async () => {
    await mkdir(join(storyDir, "outline"), { recursive: true });
    const unrelatedNoise = "IRRELEVANT-ARCHIVE-NOISE ".repeat(2500);
    await Promise.all([
      writeFile(
        join(storyDir, "outline", "story_frame.md"),
        [
          "# 故事框架",
          "",
          "## 一、主题和价值",
          unrelatedNoise,
          "",
          "## 三、世界观底色",
          "商会债务规则不能被破坏；导师冲突来自旧誓约和账册证据。",
          "本章必须维持玄幻壳下的调查压迫，不得突然改成轻喜剧。",
          "",
          "## 四、终局压力",
          "终局是师债和商会路线在审判场合合流。",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "outline", "volume_map.md"),
        [
          "# 分卷地图",
          "",
          "## 第1-3章 旧案噪声",
          unrelatedNoise,
          "",
          "## 第4章 商会轨迹",
          "Track the merchant guild trail. 林越要沿商会账册重新逼近导师冲突。",
          "这一章只推进商会路线和旧誓约压力，不提前揭露幕后主使。",
          "",
          "## 第5章 河口回声",
          "导师债务在河口继续升级。",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const result = await composeGovernedChapter({
      book,
      bookDir,
      chapterNumber: 4,
      plan,
      contextBudget: {
        contextWindowTokens: 2000,
        reservedOutputTokens: 0,
      },
    });

    const sources = result.contextPackage.selectedContext.map((entry) => entry.source);
    expect(sources).not.toContain("story/outline/story_frame.md");
    expect(sources).not.toContain("story/outline/volume_map.md");
    expect(sources.some((source) => source.startsWith("story/outline/story_frame.md#"))).toBe(true);
    expect(sources.some((source) => source.startsWith("story/outline/volume_map.md#"))).toBe(true);

    const outlineText = result.contextPackage.selectedContext
      .filter((entry) => entry.source.startsWith("story/outline/"))
      .map((entry) => entry.excerpt ?? "")
      .join("\n");
    expect(outlineText).toContain("商会债务规则不能被破坏");
    expect(outlineText).toContain("Track the merchant guild trail");
    expect(outlineText).not.toContain("IRRELEVANT-ARCHIVE-NOISE");
    expect(result.trace.contextTiers.protectedSources.some((source) =>
      source.startsWith("story/outline/story_frame.md#"),
    )).toBe(true);
    expect(result.trace.contextTiers.protectedSources.some((source) =>
      source.startsWith("story/outline/volume_map.md#"),
    )).toBe(true);
  });

  it("lets a semantic outline selector override keyword-based section selection", async () => {
    await mkdir(join(storyDir, "outline"), { recursive: true });
    await Promise.all([
      writeFile(
        join(storyDir, "outline", "story_frame.md"),
        [
          "# 故事框架",
          "",
          "## 一、世界观底色",
          "这一段有世界观关键词，但不是本章要用的暗线。",
          "",
          "## 二、隐藏账册",
          "这里承载导师债务的真正语义关联，虽然标题没有核心冲突、规则、终局等关键词。",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "outline", "volume_map.md"),
        [
          "# 分卷地图",
          "",
          "## 第4章 明线",
          "普通追查。",
          "",
          "## 第4章 暗账",
          "导师债务和隐藏账册在这一章真正合流。",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const result = await composeGovernedChapter({
      book,
      bookDir,
      chapterNumber: 4,
      plan,
      outlineSectionSelector: async (request) => request.fileName === "outline/story_frame.md"
        ? ["story/outline/story_frame.md#二-隐藏账册"]
        : ["story/outline/volume_map.md#第4章-暗账"],
    });

    const outlineText = result.contextPackage.selectedContext
      .filter((entry) => entry.source.startsWith("story/outline/"))
      .map((entry) => entry.excerpt ?? "")
      .join("\n");
    expect(outlineText).toContain("导师债务的真正语义关联");
    expect(outlineText).toContain("导师债务和隐藏账册在这一章真正合流");
    expect(outlineText).not.toContain("这一段有世界观关键词");
    expect(outlineText).not.toContain("普通追查。");
  });

  it("retrieves summary and hook evidence chunks instead of whole long memory files", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "# Pending Hooks",
          "",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| guild-route | 1 | mystery | open | 2 | 6 | Merchant guild trail |",
          "| mentor-oath | 8 | relationship | open | 9 | 11 | Mentor oath debt with Lin Yue |",
          "| old-seal | 3 | artifact | resolved | 3 | 3 | Jade seal already recovered |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| 1 | Guild Trail | Merchant guild flees west | Route clues only | None | guild-route seeded | tense | action |",
          "| 7 | Broken Letter | Lin Yue | A torn letter mentions the mentor | Lin Yue reopens the old oath | mentor-oath seeded | uneasy | mystery |",
          "| 8 | River Camp | Lin Yue, Mentor Witness | Mentor debt becomes personal | Lin Yue cannot let go | mentor-oath advanced | raw | confrontation |",
          "| 9 | Trial Echo | Lin Yue | Mentor left without explanation | Oath token matters again | mentor-oath advanced | aching | fallout |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const longRangePlan: PlanChapterOutput = {
      ...plan,
      intent: {
        ...plan.intent,
        chapter: 10,
        goal: "Bring the focus back to the mentor oath conflict.",
        outlineNode: "Track the merchant guild trail.",
      },
    };

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 10,
      plan: longRangePlan,
    });

    const selectedSources = result.contextPackage.selectedContext.map((entry) => entry.source);
    expect(selectedSources).toContain("story/pending_hooks.md#mentor-oath");
    expect(selectedSources).toContain("story/chapter_summaries.md#9");
    expect(selectedSources).not.toContain("story/pending_hooks.md");
    if (hasNodeSqlite) {
      await expect(stat(join(storyDir, "memory.db"))).resolves.toBeTruthy();
    }
  });

  it("surfaces stale unresolved hook evidence in governed context selection", async () => {
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    await Promise.all([
      writeFile(join(stateDir, "manifest.json"), JSON.stringify({
        schemaVersion: 2,
        language: "en",
        lastAppliedChapter: 25,
        projectionVersion: 1,
        migrationWarnings: [],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "current_state.json"), JSON.stringify({
        chapter: 25,
        facts: [],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "chapter_summaries.json"), JSON.stringify({
        rows: [],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "hooks.json"), JSON.stringify({
        hooks: [
          {
            hookId: "recent-route",
            startChapter: 22,
            type: "route",
            status: "open",
            lastAdvancedChapter: 24,
            expectedPayoff: "Recent route payoff",
            notes: "Recent but not critical.",
          },
          {
            hookId: "stale-debt",
            startChapter: 3,
            type: "relationship",
            status: "open",
            lastAdvancedChapter: 8,
            expectedPayoff: "Mentor debt payoff",
            notes: "Long-stale but still unresolved.",
          },
        ],
      }, null, 2), "utf-8"),
    ]);

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 26,
      plan: {
        ...plan,
        intent: {
          ...plan.intent,
          chapter: 26,
          goal: "Keep the chapter on the mainline debt conflict.",
        },
      },
    });

    const selectedSources = result.contextPackage.selectedContext.map((entry) => entry.source);
    expect(selectedSources).toContain("story/pending_hooks.md#recent-route");
    expect(selectedSources).toContain("story/pending_hooks.md#stale-debt");
  });

  it("adds current-state fact evidence retrieved from sqlite-backed memory", async () => {
    await writeFile(
      join(storyDir, "current_state.md"),
      [
        "# Current State",
        "",
        "| Field | Value |",
        "| --- | --- |",
        "| Current Chapter | 9 |",
        "| Current Location | Ashen ferry crossing |",
        "| Protagonist State | Lin Yue hides the broken oath token and the old wound has reopened. |",
        "| Current Goal | Find the vanished mentor before the guild covers its tracks. |",
        "| Current Conflict | Mentor debt with the vanished teacher blocks every choice. |",
        "",
      ].join("\n"),
      "utf-8",
    );

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 10,
      plan: {
        ...plan,
        intent: {
          ...plan.intent,
          chapter: 10,
          goal: "Bring the focus back to the vanished mentor conflict.",
        },
      },
    });

    const factEntry = result.contextPackage.selectedContext.find((entry) =>
      entry.source === "story/current_state.md#current-conflict",
    );

    expect(factEntry).toBeDefined();
    expect(factEntry?.excerpt).toContain("Current Conflict");
    expect(factEntry?.excerpt).toContain("Mentor debt with the vanished teacher");
  });

  it("adds relevant volume-summary evidence for long-span retrieval after consolidation", async () => {
    await writeFile(
      join(storyDir, "volume_summaries.md"),
      [
        "# Volume Summaries",
        "",
        "## Volume 1 (Ch.1-40)",
        "",
        "Lin Yue's mentor oath becomes the core unresolved debt, while the guild route keeps trying to pull him away from the mainline.",
        "",
        "## Volume 2 (Ch.41-80)",
        "",
        "The guild route dominates logistics noise, but the mentor debt recedes into the background.",
        "",
      ].join("\n"),
      "utf-8",
    );

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 81,
      plan: {
        ...plan,
        intent: {
          ...plan.intent,
          chapter: 81,
          goal: "Bring the focus back to the mentor oath conflict.",
        },
      },
    });

    const volumeEntry = result.contextPackage.selectedContext.find((entry) =>
      entry.source.startsWith("story/volume_summaries.md#"),
    );

    expect(volumeEntry).toBeDefined();
    expect(volumeEntry?.excerpt).toContain("mentor oath");
  });

  it("adds explicit title history, mood trail, and canon evidence for governed writing", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 1 | Ledger in Rain | Lin Yue | First ledger clue appears | None | none | tight | investigation |",
          "| 2 | Ledger at Dusk | Lin Yue | Second ledger clue appears | None | none | tight | investigation |",
          "| 3 | Harbor Ledger | Lin Yue | Third ledger clue appears | None | none | tight | investigation |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "parent_canon.md"),
        "# Parent Canon\n\nThe mentor does not learn about the archive fire until volume two.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "fanfic_canon.md"),
        "# Fanfic Canon\n\nMara may diverge from the archive route, but the oath debt logic must stay intact.\n",
        "utf-8",
      ),
    ]);

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 4,
      plan,
    });

    const selectedSources = result.contextPackage.selectedContext.map((entry) => entry.source);
    expect(selectedSources).toContain("story/chapter_summaries.md#recent_titles");
    expect(selectedSources).toContain("story/chapter_summaries.md#recent_mood_type_trail");
    expect(selectedSources).toContain("story/parent_canon.md");
    expect(selectedSources).toContain("story/fanfic_canon.md");

    const titleEntry = result.contextPackage.selectedContext.find((entry) =>
      entry.source === "story/chapter_summaries.md#recent_titles",
    );
    const moodEntry = result.contextPackage.selectedContext.find((entry) =>
      entry.source === "story/chapter_summaries.md#recent_mood_type_trail",
    );
    const parentCanonEntry = result.contextPackage.selectedContext.find((entry) =>
      entry.source === "story/parent_canon.md",
    );
    const fanficCanonEntry = result.contextPackage.selectedContext.find((entry) =>
      entry.source === "story/fanfic_canon.md",
    );

    expect(titleEntry?.excerpt).toContain("Ledger in Rain");
    expect(moodEntry?.excerpt).toContain("tight / investigation");
    expect(parentCanonEntry?.excerpt).toContain("archive fire");
    expect(fanficCanonEntry?.excerpt).toContain("oath debt logic");
  });

  it("includes dedicated audit drift guidance instead of relying on current_state pollution", async () => {
    await writeFile(
      join(storyDir, "audit_drift.md"),
      [
        "# Audit Drift",
        "",
        "## 审计纠偏（自动生成，下一章写作前参照）",
        "",
        "> - [warning] 节奏单调: 最近4章章节类型持续停留在“调查章”。",
      ].join("\n"),
      "utf-8",
    );

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 4,
      plan,
    });

    const driftEntry = result.contextPackage.selectedContext.find((entry) =>
      entry.source === "story/audit_drift.md",
    );
    expect(driftEntry).toBeDefined();
    expect(driftEntry?.excerpt).toContain("节奏单调");
  });

  it("emits hook debt briefs for agenda-targeted hooks", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "# Pending Hooks",
          "",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 回收节奏 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| mentor-oath | 8 | relationship | progressing | 9 | 揭开师债为何断裂 | 慢烧 | 师债需要跨更大弧线回收 |",
          "| guild-route | 1 | mystery | open | 2 | 查清商会路线背后的买家 | 近期 | 商会路线仍在旁支干扰 |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| 7 | Broken Letter | Lin Yue | A torn letter mentions the mentor | Lin Yue reopens the old oath | mentor-oath seeded | uneasy | mystery |",
          "| 8 | River Camp | Lin Yue | Mentor debt becomes personal | Lin Yue cannot let go | mentor-oath advanced | raw | confrontation |",
          "| 9 | Trial Echo | Lin Yue | Mentor left without explanation | Oath token matters again | mentor-oath advanced | aching | fallout |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 10,
      plan: {
        ...plan,
        intent: {
          ...plan.intent,
          chapter: 10,
          goal: "Bring the focus back to the mentor oath conflict.",
        },
        memo: {
          ...plan.memo,
          chapter: 10,
          goal: "Bring the focus back to the mentor oath conflict.",
          threadRefs: ["mentor-oath"],
        },
      },
    });

    const hookDebtEntry = result.contextPackage.selectedContext.find((entry) => entry.source === "runtime/hook_debt#mentor-oath");
    expect(hookDebtEntry).toBeDefined();
    expect(hookDebtEntry?.excerpt).toContain("mentor-oath");
    expect(hookDebtEntry?.excerpt).toContain("备忘引用旧债");
    expect(hookDebtEntry?.excerpt).toContain("读者承诺");
    expect(hookDebtEntry?.excerpt).toContain("River Camp");
    expect(hookDebtEntry?.excerpt).toContain("Trial Echo");
  });

  it("includes memo-referenced hook ids in hook debt retrieval", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "# Pending Hooks",
          "",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 回收节奏 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| black-ring | 6 | mystery | open | 7 | 揭开黑戒来源 | 中程 | 这一根还没进旧 hookAgenda |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| 6 | Black Ring | Lin Yue | Black ring first surfaces | Pressure rises | black-ring seeded | uneasy | mystery |",
          "| 7 | Wet Dock | Lin Yue | Ring clue points to the dock | Stakes rise | black-ring advanced | tense | pursuit |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const composer = new ComposerAgent({
      client: {} as ConstructorParameters<typeof ComposerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber: 8,
      plan: {
        ...plan,
        intent: {
          ...plan.intent,
          chapter: 8,
          goal: "Follow the black ring pressure.",
          mustKeep: [],
        },
        memo: {
          ...plan.memo,
          chapter: 8,
          goal: "Follow the black ring pressure.",
          threadRefs: ["black-ring"],
        },
      },
    });

    expect(result.contextPackage.selectedContext.map((entry) => entry.source)).toContain("runtime/hook_debt#black-ring");
  });
});
