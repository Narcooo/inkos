import {
  ChapterSummariesStateSchema,
  CurrentStateStateSchema,
  HooksStateSchema,
  RuntimeStateDeltaSchema,
  StateManifestSchema,
  type HookRecord,
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
  readonly allowReapply?: boolean;
}): RuntimeStateSnapshot {
  const snapshot = {
    manifest: StateManifestSchema.parse(params.snapshot.manifest),
    currentState: CurrentStateStateSchema.parse(params.snapshot.currentState),
    hooks: HooksStateSchema.parse(params.snapshot.hooks),
    chapterSummaries: ChapterSummariesStateSchema.parse(params.snapshot.chapterSummaries),
  };
  const delta = RuntimeStateDeltaSchema.parse(params.delta);
  const allowReapply = params.allowReapply ?? false;

  if (allowReapply ? delta.chapter < snapshot.manifest.lastAppliedChapter : delta.chapter <= snapshot.manifest.lastAppliedChapter) {
    throw new Error(`delta chapter ${delta.chapter} goes backwards`);
  }

  if (delta.chapterSummary && delta.chapterSummary.chapter !== delta.chapter) {
    throw new Error(`chapter summary ${delta.chapterSummary.chapter} does not match delta chapter ${delta.chapter}`);
  }

  if (
    delta.chapterSummary
    && snapshot.chapterSummaries.rows.some((row) => row.chapter === delta.chapterSummary?.chapter)
    && !allowReapply
  ) {
    throw new Error(`duplicate summary row for chapter ${delta.chapterSummary.chapter}`);
  }

  const hooks = applyHookOps(snapshot.hooks, delta);
  const currentState = applyFactOps(snapshot.currentState, delta);
  const chapterSummaries = applySummaryDelta(snapshot.chapterSummaries, delta, allowReapply);

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
  const fatalIssues = issues.filter(
    (issue) =>
      !["missing_state_change", "unsupported_change", "temporal_impossibility", "validator_crash"].includes(
        issue.code,
      ),
  );
  if (fatalIssues.length > 0) {
    throw new Error(fatalIssues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
  }

  return next;
}

function applyHookOps(hooksState: HooksState, delta: RuntimeStateDelta): HooksState {
  const hooksById = new Map(hooksState.hooks.map((hook) => [hook.hookId, { ...hook }]));

  for (const hook of delta.hookOps.upsert) {
    const sameHook = hooksById.get(hook.hookId);
    if (sameHook) {
      hooksById.set(sameHook.hookId, mergeHookRecord(sameHook, hook));
      continue;
    }

    hooksById.set(hook.hookId, { ...hook });
  }

  for (const hookId of delta.hookOps.resolve) {
    const existing = hooksById.get(hookId);
    if (!existing) {
      throw new Error(`cannot resolve unknown hook ${hookId}`);
    }
    if (existing.status === "superseded") throw Object.assign(new Error(`Cannot resolve superseded hook ${hookId}`), { code: "HOOK_SUPERSEDED" });
    hooksById.set(hookId, {
      ...existing,
      status: "resolved",
      lastAdvancedChapter: Math.max(existing.lastAdvancedChapter, delta.chapter),
    });
  }

  for (const hookId of delta.hookOps.defer) {
    const existing = hooksById.get(hookId);
    if (!existing) {
      throw new Error(`cannot defer unknown hook ${hookId}`);
    }
    if (existing.status === "superseded") throw Object.assign(new Error(`Cannot defer superseded hook ${hookId}`), { code: "HOOK_SUPERSEDED" });
    hooksById.set(hookId, {
      ...existing,
      status: "deferred",
      // Postponing a promise is not evidence that its narrative advanced.
      // Keep the last supported advancement rather than inventing one here.
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

function mergeHookRecord(existing: HookRecord, incoming: HookRecord): HookRecord {
  if (existing.status === "superseded") return existing;
  if (incoming.status === "superseded") {
    if (existing.status === "resolved") throw Object.assign(new Error(`Cannot withdraw resolved history ${existing.hookId}`), { code: "HOOK_RESOLVED_HISTORY" });
    if (!incoming.notes.trim()) throw Object.assign(new Error(`Withdrawal authority is required for ${existing.hookId}`), { code: "HOOK_WITHDRAWAL_REASON_REQUIRED" });
    return { ...existing, status: "superseded", notes: `${existing.notes}\n${incoming.notes.trim()}`.trim() };
  }
  const advanced = Math.max(existing.lastAdvancedChapter, incoming.lastAdvancedChapter);

  return {
    ...existing,
    startChapter: Math.min(existing.startChapter, incoming.startChapter),
    type: incoming.type.trim() || existing.type,
    status: existing.status === "resolved" ? "resolved" : incoming.status,
    lastAdvancedChapter: advanced,
    expectedPayoff: incoming.expectedPayoff.trim() || existing.expectedPayoff,
    notes: incoming.notes.trim() || existing.notes,
  };
}

function applyFactOps(
  currentState: CurrentStateState,
  delta: RuntimeStateDelta,
): CurrentStateState {
  const nextFacts = currentState.facts.map((fact) => ({ ...fact }));
  const active = (fact: CurrentStateState["facts"][number]) => (
    fact.validUntilChapter === null || fact.validUntilChapter >= delta.chapter
  );
  const sameKey = (
    fact: CurrentStateState["facts"][number],
    selector: { readonly subject: string; readonly predicate: string; readonly object?: string },
  ) => fact.subject === selector.subject.trim()
    && fact.predicate === selector.predicate.trim()
    && (selector.object === undefined || fact.object === selector.object.trim());

  for (const selector of delta.factOps.expire) {
    for (const fact of nextFacts) {
      if (active(fact) && sameKey(fact, selector)) fact.validUntilChapter = Math.max(0, delta.chapter - 1);
    }
  }

  for (const input of delta.factOps.upsert) {
    const fact = {
      subject: input.subject.trim(),
      predicate: input.predicate.trim(),
      object: input.object.trim(),
    };
    const exact = nextFacts.some((candidate) => active(candidate) && sameKey(candidate, fact));
    if (exact) continue;
    for (const candidate of nextFacts) {
      if (active(candidate) && candidate.subject === fact.subject && candidate.predicate === fact.predicate) {
        candidate.validUntilChapter = Math.max(0, delta.chapter - 1);
      }
    }
    nextFacts.push({
      ...fact,
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
  allowReapply = false,
): ChapterSummariesState {
  if (!delta.chapterSummary) {
    return {
      rows: [...state.rows].sort((left, right) => left.chapter - right.chapter),
    };
  }

  return {
    rows: [
      ...(allowReapply ? state.rows.filter((row) => row.chapter !== delta.chapterSummary!.chapter) : state.rows),
      delta.chapterSummary,
    ].sort((left, right) => left.chapter - right.chapter),
  };
}
