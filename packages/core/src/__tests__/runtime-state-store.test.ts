import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRuntimeStateArtifacts,
  loadNarrativeMemorySeed,
  loadRuntimeStateSnapshot,
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

  it("arbitrates new hook candidates before applying structured state updates", async () => {
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
        hookId: "anonymous-source-scope",
        lastAdvancedChapter: 12,
      }),
    ]);
    expect(artifacts.snapshot.hooks.hooks).toHaveLength(1);
    expect(artifacts.snapshot.hooks.hooks[0]).toEqual(expect.objectContaining({
      hookId: "anonymous-source-scope",
      lastAdvancedChapter: 12,
    }));
  });
});
