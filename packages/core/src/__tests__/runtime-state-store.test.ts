import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
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
    await mkdir(stateDir, { recursive: true });

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
    await mkdir(stateDir, { recursive: true });

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

    await expect(loadRuntimeStateSnapshot(bookDir)).rejects.toThrow(/duplicate_summary_chapter/i);
  });
});
