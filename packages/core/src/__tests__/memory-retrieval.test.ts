import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as memoryRetrieval from "../utils/memory-retrieval.js";
import { retrieveMemorySelection } from "../utils/memory-retrieval.js";
import { MemoryDB } from "../state/memory-db.js";

const require = createRequire(import.meta.url);
const hasNodeSqlite = (() => {
  try {
    require("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();
const sqliteIt = hasNodeSqlite ? it : it.skip;

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
    if (hasNodeSqlite) {
      expect(result.dbPath).toContain("memory.db");
    } else {
      expect(result.dbPath).toBeUndefined();
    }
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

  sqliteIt("uses existing sqlite summaries and hooks without requiring markdown truth files", async () => {
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

  sqliteIt("backfills sqlite memory from structured state instead of stale markdown truth files", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-memory-retrieval-db-structured-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 9 |",
          "| Current Conflict | Old markdown conflict |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| markdown-hook | 1 | mystery | open | 9 | 12 | Old markdown hook |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 9 | Markdown Summary | Lin Yue | Old markdown events | Old markdown state | markdown-hook advanced | tense | fallback |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 12,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "current_state.json"),
        JSON.stringify({
          chapter: 12,
          facts: [
            {
              subject: "protagonist",
              predicate: "Current Conflict",
              object: "Structured conflict should win.",
              validFromChapter: 12,
              validUntilChapter: null,
              sourceChapter: 12,
            },
          ],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "hooks.json"),
        JSON.stringify({
          hooks: [
            {
              hookId: "structured-hook",
              startChapter: 10,
              type: "relationship",
              status: "progressing",
              lastAdvancedChapter: 12,
              expectedPayoff: "Structured payoff",
              notes: "Structured hook should win.",
            },
          ],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "chapter_summaries.json"),
        JSON.stringify({
          rows: [
            {
              chapter: 12,
              title: "Structured Summary",
              characters: "Lin Yue",
              events: "Structured events should win.",
              stateChanges: "Structured state should win.",
              hookActivity: "structured-hook advanced",
              mood: "tight",
              chapterType: "mainline",
            },
          ],
        }, null, 2),
        "utf-8",
      ),
    ]);

    const result = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 13,
      goal: "Bring the focus back to the structured hook.",
      mustKeep: ["Structured conflict should win."],
    });

    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          object: "Structured conflict should win.",
          sourceChapter: 12,
        }),
      ]),
    );
    expect(result.hooks.map((hook) => hook.hookId)).toContain("structured-hook");
    expect(result.hooks.map((hook) => hook.hookId)).not.toContain("markdown-hook");
    expect(result.summaries.map((summary) => summary.chapter)).toContain(12);
    expect(result.summaries.map((summary) => summary.title)).toContain("Structured Summary");
  });

  it("bootstraps structured runtime state from legacy markdown truth files during retrieval", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-memory-retrieval-bootstrap-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const stateDir = join(storyDir, "state");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 12 |",
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
          "| mentor-debt | 1 | relationship | open | 12 | 16 | The mentor debt remains unresolved |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 12 | Mentor Debt Echo | Lin Yue | Lin Yue returns to the mentor debt trail | Commitment hardens | mentor-debt advanced | tense | mainline |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const result = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 13,
      goal: "Pull focus back to the mentor debt.",
      mustKeep: ["Lin Yue does not abandon the mentor debt."],
    });

    const manifest = JSON.parse(await readFile(join(stateDir, "manifest.json"), "utf-8"));
    const currentState = JSON.parse(await readFile(join(stateDir, "current_state.json"), "utf-8"));
    const hooks = JSON.parse(await readFile(join(stateDir, "hooks.json"), "utf-8"));
    const summaries = JSON.parse(await readFile(join(stateDir, "chapter_summaries.json"), "utf-8"));

    expect(manifest.schemaVersion).toBe(2);
    expect(currentState.chapter).toBe(12);
    expect(hooks.hooks[0]?.hookId).toBe("mentor-debt");
    expect(summaries.rows[0]?.title).toBe("Mentor Debt Echo");
    expect(result.hooks.map((hook) => hook.hookId)).toContain("mentor-debt");
  });

  it("prefers structured state files over legacy markdown truth files when both exist", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-memory-retrieval-structured-preferred-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 9 |",
          "| Current Conflict | Old markdown conflict |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| markdown-hook | 1 | mystery | open | 9 | 12 | Old markdown hook |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 9 | Markdown Summary | Lin Yue | Old markdown event | Old markdown state | markdown-hook advanced | tense | fallback |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(join(stateDir, "manifest.json"), JSON.stringify({
        schemaVersion: 2,
        language: "en",
        lastAppliedChapter: 12,
        projectionVersion: 1,
        migrationWarnings: [],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "current_state.json"), JSON.stringify({
        chapter: 12,
        facts: [
          {
            subject: "protagonist",
            predicate: "Current Conflict",
            object: "Structured conflict should win.",
            validFromChapter: 12,
            validUntilChapter: null,
            sourceChapter: 12,
          },
        ],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "hooks.json"), JSON.stringify({
        hooks: [
          {
            hookId: "structured-hook",
            startChapter: 10,
            type: "relationship",
            status: "progressing",
            lastAdvancedChapter: 12,
            expectedPayoff: "Structured payoff",
            notes: "Structured hook should win.",
          },
        ],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "chapter_summaries.json"), JSON.stringify({
        rows: [
          {
            chapter: 12,
            title: "Structured Summary",
            characters: "Lin Yue",
            events: "Structured events should win.",
            stateChanges: "Structured state should win.",
            hookActivity: "structured-hook advanced",
            mood: "tight",
            chapterType: "mainline",
          },
        ],
      }, null, 2), "utf-8"),
    ]);

    const result = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 13,
      goal: "Bring the focus back to the structured hook.",
      mustKeep: ["Structured conflict should win."],
    });

    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          object: "Structured conflict should win.",
          sourceChapter: 12,
        }),
      ]),
    );
    expect(result.hooks.map((hook) => hook.hookId)).toContain("structured-hook");
    expect(result.hooks.map((hook) => hook.hookId)).not.toContain("markdown-hook");
    expect(result.summaries.map((summary) => summary.chapter)).toContain(12);
    expect(result.summaries.map((summary) => summary.title)).toContain("Structured Summary");
  });

  it("recalls stale open hooks alongside recent governed memory selections", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-memory-retrieval-stale-hook-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 25,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "current_state.json"),
        JSON.stringify({
          chapter: 25,
          facts: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "chapter_summaries.json"),
        JSON.stringify({
          rows: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "hooks.json"),
        JSON.stringify({
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
        }, null, 2),
        "utf-8",
      ),
    ]);

    const result = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 26,
      goal: "Keep the chapter on the mainline debt conflict.",
      mustKeep: ["The mentor debt is still unresolved."],
    });

    expect(result.hooks.map((hook) => hook.hookId)).toContain("recent-route");
    expect(result.hooks.map((hook) => hook.hookId)).toContain("stale-debt");
  });

  it("surfaces one stale unresolved hook beyond the primary quota while excluding stale resolved hooks", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-memory-retrieval-stale-quota-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 40,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "current_state.json"),
        JSON.stringify({
          chapter: 40,
          facts: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "chapter_summaries.json"),
        JSON.stringify({
          rows: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "hooks.json"),
        JSON.stringify({
          hooks: [
            {
              hookId: "recent-route",
              startChapter: 37,
              type: "route",
              status: "open",
              lastAdvancedChapter: 39,
              expectedPayoff: "Recent route payoff",
              notes: "Recent route remains active.",
            },
            {
              hookId: "recent-guild",
              startChapter: 36,
              type: "politics",
              status: "progressing",
              lastAdvancedChapter: 38,
              expectedPayoff: "Guild payoff",
              notes: "Recent guild pressure remains active.",
            },
            {
              hookId: "recent-token",
              startChapter: 35,
              type: "artifact",
              status: "open",
              lastAdvancedChapter: 37,
              expectedPayoff: "Token payoff",
              notes: "Recent token route remains active.",
            },
            {
              hookId: "stale-omega",
              startChapter: 3,
              type: "relationship",
              status: "open",
              lastAdvancedChapter: 8,
              expectedPayoff: "Old relic payoff",
              notes: "Dormant unresolved line.",
            },
            {
              hookId: "stale-resolved",
              startChapter: 2,
              type: "mystery",
              status: "resolved",
              lastAdvancedChapter: 7,
              expectedPayoff: "Already closed",
              notes: "Should not be resurfaced.",
            },
          ],
        }, null, 2),
        "utf-8",
      ),
    ]);

    const result = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 41,
      goal: "Keep the chapter on the harbor confrontation.",
      mustKeep: ["The harbor confrontation must stay central."],
    });

    expect(result.hooks.map((hook) => hook.hookId)).toEqual([
      "recent-route",
      "recent-guild",
      "recent-token",
      "stale-omega",
    ]);
    expect(result.hooks.map((hook) => hook.hookId)).not.toContain("stale-resolved");
  });
});
