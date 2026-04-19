import { describe, expect, it } from "vitest";
import type { HookRecord, RuntimeStateDelta } from "../models/runtime-state.js";
import {
  classifyHookDisposition,
  collectStaleHookDebt,
  evaluateHookAdmission,
} from "../utils/hook-governance.js";

function createHook(overrides: Partial<HookRecord> = {}): HookRecord {
  return {
    hookId: overrides.hookId ?? "H001",
    startChapter: overrides.startChapter ?? 1,
    type: overrides.type ?? "mystery",
    status: overrides.status ?? "open",
    lastAdvancedChapter: overrides.lastAdvancedChapter ?? 1,
    expectedPayoff: overrides.expectedPayoff ?? "Reveal the hidden ledger",
    notes: overrides.notes ?? "The hidden room is still sealed",
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
    subplotOps: overrides.subplotOps ?? [],
    emotionalArcOps: overrides.emotionalArcOps ?? [],
    characterMatrixOps: overrides.characterMatrixOps ?? [],
    notes: overrides.notes ?? [],
  };
}

describe("collectStaleHookDebt", () => {
  it("returns unresolved stale hooks and excludes resolved or deferred hooks", () => {
    const result = collectStaleHookDebt({
      hooks: [
        createHook({ hookId: "H001", status: "open", lastAdvancedChapter: 3 }),
        createHook({ hookId: "H002", status: "progressing", lastAdvancedChapter: 8 }),
        createHook({ hookId: "H003", status: "deferred", lastAdvancedChapter: 1 }),
        createHook({ hookId: "H004", status: "resolved", lastAdvancedChapter: 2 }),
      ],
      chapterNumber: 20,
      staleAfterChapters: 10,
    });

    expect(result.map((hook) => hook.hookId)).toEqual(["H001", "H002"]);
  });
});

describe("evaluateHookAdmission", () => {
  const activeHooks = [
    createHook({
      hookId: "H019",
      type: "mystery",
      expectedPayoff: "Reveal the hidden room behind the correction mark",
      notes: "The hidden room converts public disputes into standing questions",
    }),
  ];

  it("rejects hook candidates without payoff-bearing signal", () => {
    const decision = evaluateHookAdmission({
      candidate: {
        type: "mystery",
        expectedPayoff: "",
        notes: "   ",
      },
      activeHooks,
    });

    expect(decision).toEqual({
      admit: false,
      reason: "missing_payoff_signal",
    });
  });

  it("rejects hook candidates with blank type values", () => {
    const decision = evaluateHookAdmission({
      candidate: {
        type: "   ",
        expectedPayoff: "Reveal why the witness changed her statement",
        notes: "A courtroom contradiction keeps widening",
      },
      activeHooks,
    });

    expect(decision).toEqual({
      admit: false,
      reason: "missing_type",
    });
  });

  it("rejects duplicate or restated hook candidates", () => {
    const decision = evaluateHookAdmission({
      candidate: {
        type: "mystery",
        expectedPayoff: "Reveal the hidden room behind the correction mark",
        notes: "The hidden room still reframes public disputes as standing questions",
      },
      activeHooks,
    });

    expect(decision).toEqual({
      admit: false,
      reason: "duplicate_family",
      matchedHookId: "H019",
    });
  });

  it("admits materially distinct hook candidates", () => {
    const decision = evaluateHookAdmission({
      candidate: {
        type: "relationship",
        expectedPayoff: "Expose why the mentor buried the oath",
        notes: "A separate emotional debt keeps surfacing in private scenes",
      },
      activeHooks,
    });

    expect(decision).toEqual({
      admit: true,
      reason: "admit",
    });
  });

  it("rejects Chinese paraphrase candidates from the same hook family", () => {
    const decision = evaluateHookAdmission({
      candidate: {
        type: "神秘",
        expectedPayoff: "弄明白雨夜匿名来电背后是谁",
        notes: "一下雨就有陌生号码劝她远离旧码头",
      },
      activeHooks: [
        createHook({
          hookId: "H020",
          type: "神秘",
          expectedPayoff: "查出匿名号码为何总在雨夜响起",
          notes: "每次雨夜都有人用匿名电话提醒她别去旧码头",
        }),
      ],
    });

    expect(decision).toEqual({
      admit: false,
      reason: "duplicate_family",
      matchedHookId: "H020",
    });
  });
});

describe("classifyHookDisposition", () => {
  it("classifies mention, advance, resolve, and defer with strict priority", () => {
    expect(classifyHookDisposition({
      hookId: "H001",
      delta: createDelta({
        hookOps: {
          upsert: [],
          mention: ["H001"],
          resolve: [],
          defer: [],
        },
      }),
    })).toBe("mention");

    expect(classifyHookDisposition({
      hookId: "H002",
      delta: createDelta({
        chapter: 12,
        hookOps: {
          upsert: [createHook({ hookId: "H002", lastAdvancedChapter: 12 })],
          mention: [],
          resolve: [],
          defer: [],
        },
      }),
    })).toBe("advance");

    expect(classifyHookDisposition({
      hookId: "H003",
      delta: createDelta({
        hookOps: {
          upsert: [createHook({ hookId: "H003", lastAdvancedChapter: 12 })],
          mention: ["H003"],
          resolve: ["H003"],
          defer: [],
        },
      }),
    })).toBe("resolve");

    expect(classifyHookDisposition({
      hookId: "H004",
      delta: createDelta({
        hookOps: {
          upsert: [],
          mention: ["H004"],
          resolve: [],
          defer: ["H004"],
        },
      }),
    })).toBe("defer");
  });

  it("returns none when the hook is untouched in the chapter delta", () => {
    expect(classifyHookDisposition({
      hookId: "H099",
      delta: createDelta(),
    })).toBe("none");
  });

  it("reports defer when resolve and defer both target the same hook", () => {
    expect(classifyHookDisposition({
      hookId: "H021",
      delta: createDelta({
        chapter: 12,
        hookOps: {
          upsert: [createHook({ hookId: "H021", lastAdvancedChapter: 12 })],
          mention: ["H021"],
          resolve: ["H021"],
          defer: ["H021"],
        },
      }),
    })).toBe("defer");
  });
});
