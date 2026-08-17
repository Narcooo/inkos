import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRuntimeStateArtifacts,
  loadNarrativeMemorySeed,
  loadRuntimeStateSnapshot,
  loadRuntimeStateSnapshotAtChapter,
  loadSnapshotCurrentStateFacts,
} from "../state/runtime-state-store.js";

describe("runtime-state-store memory helpers", () => {
  let root = "";

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("prefers structured runtime state over stale markdown projections for narrative memory", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-runtime-state-store-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const stateDir = join(storyDir, "state");
    const chaptersDir = join(bookDir, "chapters");
    await mkdir(stateDir, { recursive: true });
    await mkdir(chaptersDir, { recursive: true });
    await writeFile(
      join(chaptersDir, "index.json"),
      JSON.stringify([
        { number: 1, title: "Ch1", status: "approved" },
        { number: 2, title: "Ch2", status: "approved" },
        { number: 3, title: "Ch3", status: "approved" },
      ]),
      "utf-8",
    );

    await Promise.all([
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| markdown-hook | 1 | mystery | open | 1 | 4 | Old markdown hook |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 1 | Markdown Summary | Lin Yue | Old markdown event | Old markdown state | markdown-hook advanced | tense | fallback |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(join(stateDir, "manifest.json"), JSON.stringify({
        schemaVersion: 2,
        language: "en",
        lastAppliedChapter: 3,
        projectionVersion: 1,
        migrationWarnings: [],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "current_state.json"), JSON.stringify({
        chapter: 3,
        facts: [],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "hooks.json"), JSON.stringify({
        hooks: [
          {
            hookId: "structured-hook",
            startChapter: 2,
            type: "relationship",
            status: "progressing",
            lastAdvancedChapter: 3,
            expectedPayoff: "Reveal the mentor ledger.",
            notes: "Structured hook should win.",
          },
        ],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "chapter_summaries.json"), JSON.stringify({
        rows: [
          {
            chapter: 3,
            title: "Structured Summary",
            characters: "Lin Yue",
            events: "Structured runtime state event.",
            stateChanges: "Structured runtime state shift.",
            hookActivity: "structured-hook advanced",
            mood: "grim",
            chapterType: "mainline",
          },
        ],
      }, null, 2), "utf-8"),
    ]);

    const seed = await loadNarrativeMemorySeed(bookDir);

    expect(seed.hooks).toEqual([
      expect.objectContaining({
        hookId: "structured-hook",
        status: "progressing",
      }),
    ]);
    expect(seed.summaries).toEqual([
      expect.objectContaining({
        chapter: 3,
        title: "Structured Summary",
        events: "Structured runtime state event.",
      }),
    ]);
  });

  it("normalizes dormant and confirmed hook lifecycle terms from markdown projections", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-runtime-hook-status-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const chaptersDir = join(bookDir, "chapters");
    await mkdir(storyDir, { recursive: true });
    await mkdir(chaptersDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(chaptersDir, "index.json"),
        JSON.stringify([{ number: 1, title: "Ch1", status: "approved" }]),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| dormant-seed | 1 | evidence | 未激活 | 0 | 后续揭开封条日期 | 休眠种子，不应当成正在进行 |",
          "| waiting-seed | 1 | evidence | 待启动 | 0 | 后续揭开压力曲线 | 未来种子，不应当成正在进行 |",
          "| confirmed-hit | 1 | evidence | confirmed_hit | 1 | 已确认压力曲线异常 | 本章已命中，不应退回 open |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 1 | Ch1 | 夜班巡检员 | 发现工具箱。 | 种下压力异常。 | confirmed-hit advanced | tense | opening |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const snapshot = await loadRuntimeStateSnapshot(bookDir);

    expect(snapshot.hooks.hooks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ hookId: "dormant-seed", status: "deferred" }),
        expect.objectContaining({ hookId: "waiting-seed", status: "deferred" }),
        expect.objectContaining({ hookId: "confirmed-hit", status: "progressing" }),
      ]),
    );
  });

  it("prefers structured snapshot state over stale markdown snapshots for fact history rebuild", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-runtime-state-snapshot-"));
    const bookDir = join(root, "book");
    const snapshotDir = join(bookDir, "story", "snapshots", "5");
    const snapshotStateDir = join(snapshotDir, "state");
    await mkdir(snapshotStateDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(snapshotDir, "current_state.md"),
        [
          "# Current State",
          "",
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 5 |",
          "| Current Location | Markdown harbor |",
          "| Current Conflict | Old markdown conflict |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(join(snapshotStateDir, "current_state.json"), JSON.stringify({
        chapter: 5,
        facts: [
          {
            subject: "current",
            predicate: "Current Location",
            object: "Structured watchtower",
            validFromChapter: 5,
            validUntilChapter: null,
            sourceChapter: 5,
          },
          {
            subject: "protagonist",
            predicate: "Current Conflict",
            object: "Structured conflict replaces markdown drift.",
            validFromChapter: 5,
            validUntilChapter: null,
            sourceChapter: 5,
          },
        ],
      }, null, 2), "utf-8"),
    ]);

    const facts = await loadSnapshotCurrentStateFacts(bookDir, 5);

    expect(facts).toEqual([
      expect.objectContaining({
        predicate: "Current Location",
        object: "Structured watchtower",
      }),
      expect.objectContaining({
        predicate: "Current Conflict",
        object: "Structured conflict replaces markdown drift.",
      }),
    ]);
  });

  it("reconstructs a pre-chapter runtime snapshot from markdown without losing stable hook ids", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-runtime-revision-baseline-"));
    const bookDir = join(root, "book");
    const snapshotDir = join(bookDir, "story", "snapshots", "0");
    await mkdir(snapshotDir, { recursive: true });
    await Promise.all([
      writeFile(
        join(snapshotDir, "current_state.md"),
        [
          "# Current State",
          "",
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 0 |",
          "| Current Location | Clock repair shop |",
          "| Current Conflict | Sun Yuzhen disputes the twenty-minute clock drift. |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(snapshotDir, "pending_hooks.md"),
        [
          "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| H012 | 0 | mystery | 暂缓 | 0 | Explain the clock drift. | Sun Yuzhen owns the clock. |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const snapshot = await loadRuntimeStateSnapshotAtChapter({
      bookDir,
      chapterNumber: 0,
      language: "en",
    });

    expect(snapshot.manifest.lastAppliedChapter).toBe(0);
    expect(snapshot.hooks.hooks).toEqual([
      expect.objectContaining({
        hookId: "H012",
        status: "deferred",
        notes: "Sun Yuzhen owns the clock.",
      }),
    ]);
  });

  it("rejects persisted duplicate summary chapters in structured runtime state", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-runtime-state-invalid-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const stateDir = join(storyDir, "state");
    const chaptersDir = join(bookDir, "chapters");
    await mkdir(stateDir, { recursive: true });
    await mkdir(chaptersDir, { recursive: true });
    await writeFile(
      join(chaptersDir, "index.json"),
      JSON.stringify(
        Array.from({ length: 12 }, (_, i) => ({ number: i + 1, title: `Ch${i + 1}`, status: "approved" })),
      ),
      "utf-8",
    );

    await Promise.all([
      writeFile(join(stateDir, "manifest.json"), JSON.stringify({
        schemaVersion: 2,
        language: "zh",
        lastAppliedChapter: 12,
        projectionVersion: 1,
        migrationWarnings: [],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "current_state.json"), JSON.stringify({
        chapter: 12,
        facts: [],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "hooks.json"), JSON.stringify({
        hooks: [],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "chapter_summaries.json"), JSON.stringify({
        rows: [
          {
            chapter: 12,
            title: "河埠对账",
            characters: "林月",
            events: "第一次写入。",
            stateChanges: "第一次写入。",
            hookActivity: "mentor-debt 推进",
            mood: "紧绷",
            chapterType: "主线推进",
          },
          {
            chapter: 12,
            title: "重复河埠对账",
            characters: "林月",
            events: "第二次写入。",
            stateChanges: "第二次写入。",
            hookActivity: "mentor-debt 推进",
            mood: "紧绷",
            chapterType: "主线推进",
          },
        ],
      }, null, 2), "utf-8"),
    ]);

    // Duplicates are auto-repaired (deduped, keeping last occurrence), not rejected
    const snapshot = await loadRuntimeStateSnapshot(bookDir);
    expect(snapshot.chapterSummaries.rows).toHaveLength(1);
    expect(snapshot.chapterSummaries.rows[0]?.title).toBe("重复河埠对账");
  });

  it("repairs persisted hooks with empty type instead of failing the library load", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-runtime-state-hook-repair-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const stateDir = join(storyDir, "state");
    const chaptersDir = join(bookDir, "chapters");
    await mkdir(stateDir, { recursive: true });
    await mkdir(chaptersDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(chaptersDir, "index.json"),
        JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ number: i + 1, title: `Ch${i + 1}`, status: "approved" }))),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | payoff_timing | notes |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| h001--broken | 3 |  | open | 5 | 后续揭开账本来源。 | near-term | 模型生成了空 type。 |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(join(stateDir, "manifest.json"), JSON.stringify({
        schemaVersion: 2,
        language: "zh",
        lastAppliedChapter: 5,
        projectionVersion: 1,
        migrationWarnings: [],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "current_state.json"), JSON.stringify({
        chapter: 5,
        facts: [],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "hooks.json"), JSON.stringify({
        hooks: [
          {
            hookId: "h001--broken",
            startChapter: 3,
            type: "",
            status: "open",
            lastAdvancedChapter: 5,
            expectedPayoff: "后续揭开账本来源。",
            notes: "模型生成了空 type，旧版本会导致 books 接口整体报错。",
          },
        ],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "chapter_summaries.json"), JSON.stringify({
        rows: [],
      }, null, 2), "utf-8"),
    ]);

    const snapshot = await loadRuntimeStateSnapshot(bookDir);

    expect(snapshot.hooks.hooks[0]).toEqual(expect.objectContaining({
      hookId: "h001--broken",
      type: "unspecified",
    }));
    expect(snapshot.manifest.migrationWarnings.join("\n")).toContain("empty hook type");
  });

  it("canonicalizes structurally valid new hook candidates without semantic guessing", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-runtime-state-arbiter-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const stateDir = join(storyDir, "state");
    const chaptersDir = join(bookDir, "chapters");
    await mkdir(stateDir, { recursive: true });
    await mkdir(chaptersDir, { recursive: true });
    await writeFile(
      join(chaptersDir, "index.json"),
      JSON.stringify(
        Array.from({ length: 11 }, (_, i) => ({ number: i + 1, title: `Ch${i + 1}`, status: "approved" })),
      ),
      "utf-8",
    );

    await Promise.all([
      writeFile(join(stateDir, "manifest.json"), JSON.stringify({
        schemaVersion: 2,
        language: "en",
        lastAppliedChapter: 11,
        projectionVersion: 1,
        migrationWarnings: [],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "current_state.json"), JSON.stringify({
        chapter: 11,
        facts: [],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "hooks.json"), JSON.stringify({
        hooks: [
          {
            hookId: "anonymous-source-scope",
            startChapter: 3,
            type: "source-risk",
            status: "open",
            lastAdvancedChapter: 8,
            expectedPayoff: "Reveal how much the anonymous source already knew about the route.",
            notes: "The source knowledge question remains unresolved.",
          },
        ],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "chapter_summaries.json"), JSON.stringify({
        rows: [],
      }, null, 2), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "", "utf-8"),
    ]);

    const artifacts = await buildRuntimeStateArtifacts({
      bookDir,
      language: "en",
      delta: {
        chapter: 12,
        hookOps: {
          upsert: [],
          mention: [],
          resolve: [],
          defer: [],
        },
        newHookCandidates: [
          {
            type: "source-risk",
            expectedPayoff: "Reveal how much the anonymous source already knew about the route and address.",
            notes: "This chapter adds the address angle to the anonymous source question.",
          },
        ],
        notes: [],
        subplotOps: [],
        emotionalArcOps: [],
        characterMatrixOps: [],
      },
    });

    expect(artifacts.resolvedDelta.hookOps.upsert).toEqual([
      expect.objectContaining({
        hookId: expect.not.stringMatching(/^anonymous-source-scope$/),
        startChapter: 12,
        lastAdvancedChapter: 12,
      }),
    ]);
    expect(artifacts.snapshot.hooks.hooks).toHaveLength(2);
    expect(artifacts.snapshot.hooks.hooks.map((hook) => hook.hookId)).toContain("anonymous-source-scope");
  });
});
