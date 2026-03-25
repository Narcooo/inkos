import { describe, expect, it } from "vitest";
import { applyRuntimeStateDelta } from "../state/state-reducer.js";
import { RuntimeStateDeltaSchema } from "../models/runtime-state.js";

describe("applyRuntimeStateDelta", () => {
  it("applies a chapter-local delta into structured state", () => {
    const result = applyRuntimeStateDelta({
      snapshot: {
        manifest: {
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 11,
          projectionVersion: 1,
          migrationWarnings: [],
        },
        currentState: {
          chapter: 11,
          facts: [],
        },
        hooks: {
          hooks: [
            {
              hookId: "mentor-debt",
              startChapter: 1,
              type: "relationship",
              status: "open",
              lastAdvancedChapter: 11,
              expectedPayoff: "Reveal the debt.",
              notes: "Still unresolved.",
            },
          ],
        },
        chapterSummaries: {
          rows: [
            {
              chapter: 11,
              title: "Old Ledger",
              characters: "Lin Yue",
              events: "Lin Yue finds the old ledger.",
              stateChanges: "The debt trail tightens.",
              hookActivity: "mentor-debt advanced",
              mood: "tense",
              chapterType: "mainline",
            },
          ],
        },
      },
      delta: RuntimeStateDeltaSchema.parse({
        chapter: 12,
        currentStatePatch: {
          currentGoal: "Trace the debt through the river-port ledger.",
        },
        hookOps: {
          upsert: [
            {
              hookId: "mentor-debt",
              startChapter: 1,
              type: "relationship",
              status: "progressing",
              lastAdvancedChapter: 12,
              expectedPayoff: "Reveal the debt.",
              notes: "The river-port ledger sharpens the clue.",
            },
          ],
          resolve: [],
          defer: [],
        },
        chapterSummary: {
          chapter: 12,
          title: "River-Port Ledger",
          characters: "Lin Yue",
          events: "Lin Yue cross-checks the river-port ledger.",
          stateChanges: "The debt trail narrows.",
          hookActivity: "mentor-debt advanced",
          mood: "tight",
          chapterType: "investigation",
        },
        notes: [],
      }),
    });

    expect(result.manifest.lastAppliedChapter).toBe(12);
    expect(result.currentState.chapter).toBe(12);
    expect(result.currentState.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          predicate: "Current Goal",
          object: "Trace the debt through the river-port ledger.",
          sourceChapter: 12,
        }),
      ]),
    );
    expect(result.hooks.hooks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hookId: "mentor-debt",
          status: "progressing",
          lastAdvancedChapter: 12,
        }),
      ]),
    );
    expect(result.chapterSummaries.rows.map((row) => row.chapter)).toEqual([11, 12]);
  });

  it("rejects duplicate summary rows for the same chapter", () => {
    expect(() =>
      applyRuntimeStateDelta({
        snapshot: {
          manifest: {
            schemaVersion: 2,
            language: "zh",
            lastAppliedChapter: 11,
            projectionVersion: 1,
            migrationWarnings: [],
          },
          currentState: {
            chapter: 11,
            facts: [],
          },
          hooks: {
            hooks: [],
          },
          chapterSummaries: {
            rows: [
              {
                chapter: 12,
                title: "河埠对账",
                characters: "林月",
                events: "林月核对货单。",
                stateChanges: "师债线索收束。",
                hookActivity: "mentor-debt 推进",
                mood: "紧绷",
                chapterType: "主线推进",
              },
            ],
          },
        },
        delta: RuntimeStateDeltaSchema.parse({
          chapter: 12,
          hookOps: {
            upsert: [],
            resolve: [],
            defer: [],
          },
          chapterSummary: {
            chapter: 12,
            title: "再写一版河埠对账",
            characters: "林月",
            events: "重复写入。",
            stateChanges: "重复写入。",
            hookActivity: "mentor-debt 推进",
            mood: "紧绷",
            chapterType: "主线推进",
          },
          notes: [],
        }),
      }),
    ).toThrow(/duplicate summary/i);
  });

  it("rejects resolve operations for unknown hooks", () => {
    expect(() =>
      applyRuntimeStateDelta({
        snapshot: {
          manifest: {
            schemaVersion: 2,
            language: "en",
            lastAppliedChapter: 11,
            projectionVersion: 1,
            migrationWarnings: [],
          },
          currentState: {
            chapter: 11,
            facts: [],
          },
          hooks: {
            hooks: [],
          },
          chapterSummaries: {
            rows: [],
          },
        },
        delta: RuntimeStateDeltaSchema.parse({
          chapter: 12,
          hookOps: {
            upsert: [],
            resolve: ["mentor-debt"],
            defer: [],
          },
          notes: [],
        }),
      }),
    ).toThrow(/unknown hook/i);
  });
});
