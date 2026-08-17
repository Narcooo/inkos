import { describe, expect, it } from "vitest";
import type { HookRecord, RuntimeStateDelta } from "../models/runtime-state.js";
import { arbitrateRuntimeStateDeltaHooks } from "../utils/hook-arbiter.js";

function createHook(overrides: Partial<HookRecord> = {}): HookRecord {
  return {
    hookId: overrides.hookId ?? "H001",
    startChapter: overrides.startChapter ?? 1,
    type: overrides.type ?? "mystery",
    status: overrides.status ?? "open",
    lastAdvancedChapter: overrides.lastAdvancedChapter ?? 1,
    expectedPayoff: overrides.expectedPayoff ?? "Reveal the hidden ledger",
    notes: overrides.notes ?? "Still unresolved",
  };
}

function createDelta(overrides: Partial<RuntimeStateDelta> = {}): RuntimeStateDelta {
  return {
    chapter: overrides.chapter ?? 12,
    hookOps: {
      upsert: overrides.hookOps?.upsert ?? [],
      mention: overrides.hookOps?.mention ?? [],
      resolve: overrides.hookOps?.resolve ?? [],
      defer: overrides.hookOps?.defer ?? [],
    },
    newHookCandidates: overrides.newHookCandidates ?? [],
    subplotOps: [],
    emotionalArcOps: [],
    characterMatrixOps: [],
    notes: [],
  };
}

describe("arbitrateRuntimeStateDeltaHooks", () => {
  it("updates an existing hook only when the settler names its canonical id", () => {
    const result = arbitrateRuntimeStateDeltaHooks({
      hooks: [
        createHook({
          hookId: "anonymous-source-scope",
          type: "source-risk",
          startChapter: 3,
          lastAdvancedChapter: 8,
          expectedPayoff: "Reveal how much the anonymous source already knew about the route.",
          notes: "The source knowledge question remains unresolved.",
        }),
      ],
      delta: createDelta({
        hookOps: {
          upsert: [createHook({
            hookId: "anonymous-source-scope",
            type: "source-risk",
            startChapter: 3,
            lastAdvancedChapter: 12,
            status: "progressing",
            expectedPayoff: "Reveal how much the anonymous source already knew about the route and address.",
            notes: "This chapter adds the address angle to the anonymous source question.",
          })],
          mention: [],
          resolve: [],
          defer: [],
        },
      }),
    });

    expect(result.resolvedDelta.hookOps.upsert).toEqual([
      expect.objectContaining({
        hookId: "anonymous-source-scope",
        lastAdvancedChapter: 12,
      }),
    ]);
    expect(result.resolvedDelta.newHookCandidates).toEqual([]);
  });

  it("does not infer semantic identity for an unnamed candidate", () => {
    const result = arbitrateRuntimeStateDeltaHooks({
      hooks: [
        createHook({
          hookId: "mentor-debt",
          type: "relationship",
          expectedPayoff: "Reveal the real mentor debt.",
          notes: "The mentor debt is still unresolved.",
        }),
      ],
      delta: createDelta({
        newHookCandidates: [
          {
            type: "relationship",
            expectedPayoff: "Reveal the real mentor debt.",
            notes: "The mentor debt is still unresolved.",
          },
        ],
      }),
    });

    expect(result.resolvedDelta.hookOps.upsert).toHaveLength(1);
    expect(result.resolvedDelta.hookOps.upsert[0]?.hookId).not.toBe("mentor-debt");
    expect(result.resolvedDelta.newHookCandidates).toEqual([]);
    expect(result.decisions).toEqual([
      expect.objectContaining({ action: "created", reason: "admit" }),
    ]);
  });

  it("creates a canonical hook when the candidate is genuinely new", () => {
    const result = arbitrateRuntimeStateDeltaHooks({
      hooks: [
        createHook({
          hookId: "mentor-debt",
          type: "relationship",
          expectedPayoff: "Reveal the real mentor debt.",
        }),
      ],
      delta: createDelta({
        chapter: 15,
        newHookCandidates: [
          {
            type: "artifact",
            expectedPayoff: "Reveal why the seal answers only at midnight.",
            notes: "A fresh unresolved rule around the seal appears in this chapter.",
          },
        ],
      }),
    });

    expect(result.resolvedDelta.hookOps.upsert).toHaveLength(1);
    expect(result.resolvedDelta.hookOps.upsert[0]).toEqual(expect.objectContaining({
      startChapter: 15,
      lastAdvancedChapter: 15,
      type: "artifact",
      status: "open",
    }));
    expect(result.resolvedDelta.hookOps.upsert[0]?.hookId).not.toBe("mentor-debt");
    expect(result.resolvedDelta.newHookCandidates).toEqual([]);
  });

  it("can structurally forbid hook-set expansion without guessing semantic identity", () => {
    const result = arbitrateRuntimeStateDeltaHooks({
      hooks: [createHook({ hookId: "H012" })],
      allowNewHooks: false,
      delta: createDelta({
        hookOps: {
          upsert: [createHook({ hookId: "H012", status: "progressing", lastAdvancedChapter: 12 })],
          mention: [],
          resolve: [],
          defer: [],
        },
        newHookCandidates: [{
          type: "mystery",
          expectedPayoff: "Explain why the clock moved eleven minutes.",
          notes: "The same chapter-ending question as H012.",
        }],
      }),
    });

    expect(result.resolvedDelta.hookOps.upsert).toEqual([
      expect.objectContaining({ hookId: "H012", status: "progressing" }),
    ]);
    expect(result.decisions).toEqual([
      expect.objectContaining({ action: "rejected", reason: "new_hooks_disabled" }),
    ]);
  });

  it("rejects structurally incomplete candidates without inventing content", () => {
    const result = arbitrateRuntimeStateDeltaHooks({
      hooks: [],
      delta: createDelta({
        newHookCandidates: [{
          type: "mystery",
          expectedPayoff: "",
          notes: "",
        }],
      }),
    });

    expect(result.resolvedDelta.hookOps.upsert).toEqual([]);
    expect(result.decisions).toEqual([
      expect.objectContaining({ action: "rejected", reason: "missing_payoff_signal" }),
    ]);
  });
});
