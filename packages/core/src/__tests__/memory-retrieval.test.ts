import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as memoryRetrieval from "../utils/memory-retrieval.js";
import { retrieveMemorySelection } from "../utils/memory-retrieval.js";
import { MemoryDB } from "../state/memory-db.js";

describe("retrieveMemorySelection", () => {
  let root = "";

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = "";
    }
    vi.resetModules();
    vi.doUnmock("../state/memory-db.js");
  });

  it("indexes current state facts into sqlite-backed memory selection", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-memory-retrieval-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(
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
      ),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
    ]);

    const result = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 10,
      goal: "Bring the focus back to the vanished mentor conflict.",
      mustKeep: ["Lin Yue hides the broken oath token and the old wound has reopened."],
    });

    expect(result.facts.length).toBeGreaterThan(0);
    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          predicate: "Current Conflict",
          object: "Mentor debt with the vanished teacher blocks every choice.",
          validFromChapter: 9,
          sourceChapter: 9,
        }),
      ]),
    );
    expect(result.dbPath).toContain("memory.db");
  });

  it("extracts mentor-focused query terms without pulling guild-route negatives into English retrieval", () => {
    const extractQueryTerms = (memoryRetrieval as Record<string, unknown>).extractQueryTerms as
      | ((goal: string, outlineNode: string | undefined, mustKeep: ReadonlyArray<string>) => ReadonlyArray<string>)
      | undefined;

    expect(extractQueryTerms).toBeDefined();
    const terms = extractQueryTerms?.(
      "Pull focus back to the mentor debt and do not open a new frontier in this chapter.",
      "Handle guild noise without letting the guild route overtake the mentor-debt mainline.",
      ["Lin Yue does not abandon the mentor debt."],
    ) ?? [];

    expect(terms).toContain("mentor");
    expect(terms).toContain("debt");
    expect(terms).not.toContain("guild");
    expect(terms).not.toContain("route");
  });

  it("extracts 师债-focused query terms without pulling 商会路线 negatives into Chinese retrieval", () => {
    const extractQueryTerms = (memoryRetrieval as Record<string, unknown>).extractQueryTerms as
      | ((goal: string, outlineNode: string | undefined, mustKeep: ReadonlyArray<string>) => ReadonlyArray<string>)
      | undefined;

    expect(extractQueryTerms).toBeDefined();
    const terms = extractQueryTerms?.(
      "第51章把注意力拉回师债，不让商会路线盖过主线。",
      "处理商会噪音，但不允许商会路线盖过师债主线。",
      ["林月不会放弃师债。"],
    ) ?? [];

    expect(terms).toContain("师债");
    expect(terms).not.toContain("商会");
    expect(terms).not.toContain("商会路线");
  });

  it("prefers the mentor-debt recap chapter over nearby guild-noise chapters in English retrieval", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-memory-retrieval-en-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 10 |",
          "| Current Goal | Continue tracing the mentor debt |",
          "| Current Conflict | Mentor debt mainline vs guild safe route |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| mentor-debt | 1 | relationship | open | 10 | 16 | The mentor debt remains unresolved |",
          "| guild-route | 1 | mystery | open | 9 | 12 | The guild keeps offering a safer road |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 6 | Guild Pressure 6 | Lin Yue | Guild pressure keeps building around the safe route | Guild route remains noisy | guild-route probed | restrained | holding-pattern |",
          "| 7 | Guild Pressure 7 | Lin Yue | Guild pressure keeps building around the safe route | Guild route remains noisy | guild-route probed | restrained | holding-pattern |",
          "| 8 | Guild Pressure 8 | Lin Yue | Guild pressure keeps building around the safe route | Guild route remains noisy | guild-route probed | restrained | holding-pattern |",
          "| 9 | Guild Pressure 9 | Lin Yue | Guild pressure keeps building around the safe route | Guild route remains noisy | guild-route probed | restrained | holding-pattern |",
          "| 10 | Mentor Debt Echo 10 | Lin Yue | Lin Yue returns to the mentor debt trail and checks the oath token again | Commitment to the mentor debt hardens | mentor-debt advanced | tense | mainline |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const result = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 11,
      goal: "Pull focus back to the mentor debt and do not let the guild route overtake the mainline.",
      outlineNode: "Handle guild noise without letting the guild route overtake the mentor-debt mainline.",
      mustKeep: ["Lin Yue does not abandon the mentor debt."],
    });

    expect(result.summaries.map((summary) => summary.chapter)).toContain(10);
  });

  it("prefers the explicit 师债回响 chapter over nearby 商会噪音 chapters in Chinese retrieval", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-memory-retrieval-zh-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "| 字段 | 值 |",
          "| --- | --- |",
          "| 当前章节 | 50 |",
          "| 当前目标 | 继续追查师债 |",
          "| 当前冲突 | 师债主线 vs 商会安全路线 |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| mentor-debt | 1 | relationship | open | 50 | 60 | 师债真相与誓令碎片持续绑定 |",
          "| guild-route | 1 | mystery | open | 49 | 55 | 商会安全路线仍在诱导主角偏航 |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 46 | 商会余波46 | 林月 | 林月处理商会杂务与路引试探 | 继续压住商会支线 | guild-route 试探 | 克制 | 过渡牵制 |",
          "| 47 | 商会余波47 | 林月 | 林月处理商会杂务与路引试探 | 继续压住商会支线 | guild-route 试探 | 克制 | 过渡牵制 |",
          "| 48 | 商会余波48 | 林月 | 林月处理商会杂务与路引试探 | 继续压住商会支线 | guild-route 试探 | 克制 | 过渡牵制 |",
          "| 49 | 商会余波49 | 林月 | 林月处理商会杂务与路引试探 | 继续压住商会支线 | guild-route 试探 | 克制 | 过渡牵制 |",
          "| 50 | 师债回响50 | 林月 | 林月再次追查师债线索，并核对誓令碎片痕迹 | 对师债真相的执念更强 | mentor-debt 推进 | 紧绷 | 主线推进 |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const result = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 51,
      goal: "第51章把注意力拉回师债，不让商会路线盖过主线。",
      outlineNode: "处理商会噪音，但不允许商会路线盖过师债主线。",
      mustKeep: ["林月不会放弃师债。"],
    });

    expect(result.summaries.map((summary) => summary.chapter)).toContain(50);
  });

  it("keeps the mentor-debt recap chapter in markdown fallback mode for English books", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-memory-retrieval-en-fallback-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 10 |",
          "| Current Goal | Continue tracing the mentor debt |",
          "| Current Conflict | Mentor debt mainline vs guild safe route |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| mentor-debt | 1 | relationship | open | 10 | 16 | The mentor debt remains unresolved |",
          "| guild-route | 1 | mystery | open | 9 | 12 | The guild keeps offering a safer road |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 6 | Guild Pressure 6 | Lin Yue | Guild pressure keeps building around the safe route | Guild route remains noisy | guild-route probed | restrained | holding-pattern |",
          "| 7 | Guild Pressure 7 | Lin Yue | Guild pressure keeps building around the safe route | Guild route remains noisy | guild-route probed | restrained | holding-pattern |",
          "| 8 | Guild Pressure 8 | Lin Yue | Guild pressure keeps building around the safe route | Guild route remains noisy | guild-route probed | restrained | holding-pattern |",
          "| 9 | Guild Pressure 9 | Lin Yue | Guild pressure keeps building around the safe route | Guild route remains noisy | guild-route probed | restrained | holding-pattern |",
          "| 10 | Mentor Debt Echo 10 | Lin Yue | Lin Yue returns to the mentor debt trail and checks the oath token again | Commitment to the mentor debt hardens | mentor-debt advanced | tense | mainline |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    vi.resetModules();
    vi.doMock("../state/memory-db.js", () => ({
      MemoryDB: class {
        constructor() {
          throw new Error("sqlite unavailable");
        }
      },
    }));
    const { retrieveMemorySelection: retrieveFallback } = await import("../utils/memory-retrieval.js");

    const result = await retrieveFallback({
      bookDir,
      chapterNumber: 11,
      goal: "Pull focus back to the mentor debt and do not let the guild route overtake the mainline.",
      outlineNode: "Handle guild noise without letting the guild route overtake the mentor-debt mainline.",
      mustKeep: ["Lin Yue does not abandon the mentor debt."],
    });

    expect(result.dbPath).toBeUndefined();
    expect(result.summaries.map((summary) => summary.chapter)).toContain(10);
    expect(result.summaries.at(-1)?.chapter).toBe(10);
  });

  it("keeps the 师债回响 chapter in markdown fallback mode for Chinese books", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-memory-retrieval-zh-fallback-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "| 字段 | 值 |",
          "| --- | --- |",
          "| 当前章节 | 50 |",
          "| 当前目标 | 继续追查师债 |",
          "| 当前冲突 | 师债主线 vs 商会安全路线 |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| mentor-debt | 1 | relationship | open | 50 | 60 | 师债真相与誓令碎片持续绑定 |",
          "| guild-route | 1 | mystery | open | 49 | 55 | 商会安全路线仍在诱导主角偏航 |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 46 | 商会余波46 | 林月 | 林月处理商会杂务与路引试探 | 继续压住商会支线 | guild-route 试探 | 克制 | 过渡牵制 |",
          "| 47 | 商会余波47 | 林月 | 林月处理商会杂务与路引试探 | 继续压住商会支线 | guild-route 试探 | 克制 | 过渡牵制 |",
          "| 48 | 商会余波48 | 林月 | 林月处理商会杂务与路引试探 | 继续压住商会支线 | guild-route 试探 | 克制 | 过渡牵制 |",
          "| 49 | 商会余波49 | 林月 | 林月处理商会杂务与路引试探 | 继续压住商会支线 | guild-route 试探 | 克制 | 过渡牵制 |",
          "| 50 | 师债回响50 | 林月 | 林月再次追查师债线索，并核对誓令碎片痕迹 | 对师债真相的执念更强 | mentor-debt 推进 | 紧绷 | 主线推进 |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    vi.resetModules();
    vi.doMock("../state/memory-db.js", () => ({
      MemoryDB: class {
        constructor() {
          throw new Error("sqlite unavailable");
        }
      },
    }));
    const { retrieveMemorySelection: retrieveFallback } = await import("../utils/memory-retrieval.js");

    const result = await retrieveFallback({
      bookDir,
      chapterNumber: 51,
      goal: "第51章把注意力拉回师债，不让商会路线盖过主线。",
      outlineNode: "处理商会噪音，但不允许商会路线盖过师债主线。",
      mustKeep: ["林月不会放弃师债。"],
    });

    expect(result.dbPath).toBeUndefined();
    expect(result.summaries.map((summary) => summary.chapter)).toContain(50);
    expect(result.summaries.at(-1)?.chapter).toBe(50);
  });

  it("uses existing sqlite summaries and hooks without requiring markdown truth files", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-memory-retrieval-db-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await writeFile(
      join(storyDir, "current_state.md"),
      [
        "| Field | Value |",
        "| --- | --- |",
        "| Current Chapter | 9 |",
        "| Current Conflict | Mentor debt mainline vs guild safe route |",
        "",
      ].join("\n"),
      "utf-8",
    );

    const memoryDb = new MemoryDB(bookDir);
    try {
      memoryDb.upsertSummary({
        chapter: 9,
        title: "Mentor Debt Echo",
        characters: "Lin Yue",
        events: "Lin Yue returns to the mentor debt trail",
        stateChanges: "Commitment hardens",
        hookActivity: "mentor-debt advanced",
        mood: "tense",
        chapterType: "mainline",
      });
      memoryDb.upsertHook({
        hookId: "mentor-debt",
        startChapter: 1,
        type: "relationship",
        status: "open",
        lastAdvancedChapter: 9,
        expectedPayoff: "16",
        notes: "Mentor debt remains unresolved",
      });
    } finally {
      memoryDb.close();
    }

    const result = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 10,
      goal: "Pull focus back to the mentor debt.",
      mustKeep: ["Lin Yue does not abandon the mentor debt."],
    });

    expect(result.dbPath).toContain("memory.db");
    expect(result.summaries.map((summary) => summary.chapter)).toContain(9);
    expect(result.hooks.map((hook) => hook.hookId)).toContain("mentor-debt");
  });
});
