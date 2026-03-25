import {
  ChapterSummariesStateSchema,
  CurrentStateStateSchema,
  HooksStateSchema,
  RuntimeStateDeltaSchema,
  StateManifestSchema,
  type ChapterSummariesState,
  type CurrentStateState,
  type HooksState,
  type RuntimeStateDelta,
  type StateManifest,
} from "../models/runtime-state.js";
import { validateRuntimeState } from "./state-validator.js";

export interface RuntimeStateSnapshot {
  readonly manifest: StateManifest;
  readonly currentState: CurrentStateState;
  readonly hooks: HooksState;
  readonly chapterSummaries: ChapterSummariesState;
}

export function applyRuntimeStateDelta(params: {
  readonly snapshot: RuntimeStateSnapshot;
  readonly delta: RuntimeStateDelta;
}): RuntimeStateSnapshot {
  const snapshot = {
    manifest: StateManifestSchema.parse(params.snapshot.manifest),
    currentState: CurrentStateStateSchema.parse(params.snapshot.currentState),
    hooks: HooksStateSchema.parse(params.snapshot.hooks),
    chapterSummaries: ChapterSummariesStateSchema.parse(params.snapshot.chapterSummaries),
  };
  const delta = RuntimeStateDeltaSchema.parse(params.delta);

  if (delta.chapter <= snapshot.manifest.lastAppliedChapter) {
    throw new Error(`delta chapter ${delta.chapter} goes backwards`);
  }

  if (delta.chapterSummary && delta.chapterSummary.chapter !== delta.chapter) {
    throw new Error(`chapter summary ${delta.chapterSummary.chapter} does not match delta chapter ${delta.chapter}`);
  }

  if (
    delta.chapterSummary
    && snapshot.chapterSummaries.rows.some((row) => row.chapter === delta.chapterSummary?.chapter)
  ) {
    throw new Error(`duplicate summary row for chapter ${delta.chapterSummary.chapter}`);
  }

  const hooks = applyHookOps(snapshot.hooks, delta);
  const currentState = applyCurrentStatePatch(
    snapshot.currentState,
    snapshot.manifest.language,
    delta,
  );
  const chapterSummaries = applySummaryDelta(snapshot.chapterSummaries, delta);

  const next: RuntimeStateSnapshot = {
    manifest: {
      ...snapshot.manifest,
      lastAppliedChapter: delta.chapter,
    },
    currentState,
    hooks,
    chapterSummaries,
  };

  const issues = validateRuntimeState(next);
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
  }

  return next;
}

function applyHookOps(hooksState: HooksState, delta: RuntimeStateDelta): HooksState {
  const hooksById = new Map(hooksState.hooks.map((hook) => [hook.hookId, { ...hook }]));

  for (const hook of delta.hookOps.upsert) {
    hooksById.set(hook.hookId, { ...hook });
  }

  for (const hookId of delta.hookOps.resolve) {
    const existing = hooksById.get(hookId);
    if (!existing) {
      throw new Error(`unknown hook: ${hookId}`);
    }
    hooksById.set(hookId, {
      ...existing,
      status: "resolved",
      lastAdvancedChapter: Math.max(existing.lastAdvancedChapter, delta.chapter),
    });
  }

  for (const hookId of delta.hookOps.defer) {
    const existing = hooksById.get(hookId);
    if (!existing) {
      throw new Error(`unknown hook: ${hookId}`);
    }
    hooksById.set(hookId, {
      ...existing,
      status: "deferred",
      lastAdvancedChapter: Math.max(existing.lastAdvancedChapter, delta.chapter),
    });
  }

  return {
    hooks: [...hooksById.values()].sort((left, right) => (
      left.startChapter - right.startChapter
      || left.lastAdvancedChapter - right.lastAdvancedChapter
      || left.hookId.localeCompare(right.hookId)
    )),
  };
}

function applyCurrentStatePatch(
  currentState: CurrentStateState,
  language: "zh" | "en",
  delta: RuntimeStateDelta,
): CurrentStateState {
  if (!delta.currentStatePatch) {
    return {
      chapter: delta.chapter,
      facts: [...currentState.facts],
    };
  }

  const nextFacts = [...currentState.facts];
  const labels = language === "en"
    ? {
      currentLocation: ["Current Location", "当前位置"],
      protagonistState: ["Protagonist State", "主角状态"],
      currentGoal: ["Current Goal", "当前目标"],
      currentConstraint: ["Current Constraint", "当前限制"],
      currentAlliances: ["Current Alliances", "Current Relationships", "当前敌我"],
      currentConflict: ["Current Conflict", "当前冲突"],
    }
    : {
      currentLocation: ["当前位置", "Current Location"],
      protagonistState: ["主角状态", "Protagonist State"],
      currentGoal: ["当前目标", "Current Goal"],
      currentConstraint: ["当前限制", "Current Constraint"],
      currentAlliances: ["当前敌我", "Current Alliances", "Current Relationships"],
      currentConflict: ["当前冲突", "Current Conflict"],
    };

  for (const [patchKey, aliases] of Object.entries(labels) as Array<[
    keyof typeof labels,
    string[],
  ]>) {
    const value = delta.currentStatePatch[patchKey];
    if (value === undefined) continue;

    for (let index = nextFacts.length - 1; index >= 0; index -= 1) {
      const predicate = nextFacts[index]?.predicate ?? "";
      if (aliases.some((alias) => alias.toLowerCase() === predicate.toLowerCase())) {
        nextFacts.splice(index, 1);
      }
    }

    nextFacts.push({
      subject: "protagonist",
      predicate: aliases[0]!,
      object: value,
      validFromChapter: delta.chapter,
      validUntilChapter: null,
      sourceChapter: delta.chapter,
    });
  }

  return {
    chapter: delta.chapter,
    facts: nextFacts.sort((left, right) => (
      left.predicate.localeCompare(right.predicate)
      || left.object.localeCompare(right.object)
    )),
  };
}

function applySummaryDelta(
  state: ChapterSummariesState,
  delta: RuntimeStateDelta,
): ChapterSummariesState {
  if (!delta.chapterSummary) {
    return {
      rows: [...state.rows].sort((left, right) => left.chapter - right.chapter),
    };
  }

  return {
    rows: [...state.rows, delta.chapterSummary].sort((left, right) => left.chapter - right.chapter),
  };
}
