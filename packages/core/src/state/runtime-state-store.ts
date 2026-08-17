import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ChapterSummariesStateSchema,
  CurrentStateStateSchema,
  HooksStateSchema,
  StateManifestSchema,
  type RuntimeStateDelta,
} from "../models/runtime-state.js";
import type { Fact, StoredHook, StoredSummary } from "./memory-db.js";
import {
  bootstrapStructuredStateFromMarkdown,
  parseChapterSummariesMarkdown,
  parseCurrentStateFacts,
  parsePendingHooksMarkdown,
} from "./state-bootstrap.js";
import { renderChapterSummariesProjection, renderCurrentStateProjection, renderHooksProjection } from "./state-projections.js";
import { applyRuntimeStateDelta, type RuntimeStateSnapshot } from "./state-reducer.js";
import { validateRuntimeState } from "./state-validator.js";
import { arbitrateRuntimeStateDeltaHooks } from "../utils/hook-arbiter.js";

export interface RuntimeStateArtifacts {
  readonly snapshot: RuntimeStateSnapshot;
  readonly resolvedDelta: RuntimeStateDelta;
  readonly currentStateMarkdown: string;
  readonly hooksMarkdown: string;
  readonly chapterSummariesMarkdown: string;
}

export interface NarrativeMemorySeed {
  readonly summaries: ReadonlyArray<StoredSummary>;
  readonly hooks: ReadonlyArray<StoredHook>;
}

export async function loadRuntimeStateSnapshot(bookDir: string): Promise<RuntimeStateSnapshot> {
  await bootstrapStructuredStateFromMarkdown({ bookDir });
  const stateDir = join(bookDir, "story", "state");

  const [manifest, currentState, hooks, chapterSummaries] = await Promise.all([
    readJson(join(stateDir, "manifest.json"), StateManifestSchema),
    readJson(join(stateDir, "current_state.json"), CurrentStateStateSchema),
    readJson(join(stateDir, "hooks.json"), HooksStateSchema),
    readJson(join(stateDir, "chapter_summaries.json"), ChapterSummariesStateSchema),
  ]);

  const snapshot = {
    manifest,
    currentState,
    hooks,
    chapterSummaries,
  };

  return validateLoadedSnapshot(snapshot, "persisted runtime state");
}

export async function loadRuntimeStateSnapshotAtChapter(params: {
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly language: "zh" | "en";
}): Promise<RuntimeStateSnapshot> {
  const snapshotDir = join(
    params.bookDir,
    "story",
    "snapshots",
    String(params.chapterNumber),
  );
  const stateDir = join(snapshotDir, "state");
  const [manifest, currentState, hooks, chapterSummaries] = await Promise.all([
    readJsonOrNull(join(stateDir, "manifest.json"), StateManifestSchema),
    readJsonOrNull(join(stateDir, "current_state.json"), CurrentStateStateSchema),
    readJsonOrNull(join(stateDir, "hooks.json"), HooksStateSchema),
    readJsonOrNull(join(stateDir, "chapter_summaries.json"), ChapterSummariesStateSchema),
  ]);

  if (manifest && currentState && hooks && chapterSummaries) {
    return validateLoadedSnapshot(
      { manifest, currentState, hooks, chapterSummaries },
      `runtime snapshot at chapter ${params.chapterNumber}`,
    );
  }

  const [currentStateMarkdown, hooksMarkdown, summariesMarkdown] = await Promise.all([
    readFile(join(snapshotDir, "current_state.md"), "utf-8"),
    readFile(join(snapshotDir, "pending_hooks.md"), "utf-8"),
    readFile(join(snapshotDir, "chapter_summaries.md"), "utf-8").catch(() => ""),
  ]);
  const markdownSnapshot: RuntimeStateSnapshot = {
    manifest: StateManifestSchema.parse({
      schemaVersion: 2,
      language: params.language,
      lastAppliedChapter: params.chapterNumber,
      projectionVersion: 1,
      migrationWarnings: [
        `runtime snapshot ${params.chapterNumber} reconstructed from markdown`,
      ],
    }),
    currentState: CurrentStateStateSchema.parse({
      chapter: params.chapterNumber,
      facts: parseCurrentStateFacts(currentStateMarkdown, params.chapterNumber),
    }),
    hooks: HooksStateSchema.parse({
      hooks: parsePendingHooksMarkdown(hooksMarkdown),
    }),
    chapterSummaries: ChapterSummariesStateSchema.parse({
      rows: parseChapterSummariesMarkdown(summariesMarkdown),
    }),
  };
  return validateLoadedSnapshot(
    markdownSnapshot,
    `markdown runtime snapshot at chapter ${params.chapterNumber}`,
  );
}

export async function buildRuntimeStateArtifacts(params: {
  readonly bookDir: string;
  readonly delta: RuntimeStateDelta;
  readonly language: "zh" | "en";
  readonly allowReapply?: boolean;
  readonly allowNewHooks?: boolean;
}): Promise<RuntimeStateArtifacts> {
  const snapshot = await loadRuntimeStateSnapshot(params.bookDir);
  return buildRuntimeStateArtifactsFromSnapshot({
    snapshot,
    delta: params.delta,
    language: params.language,
    allowReapply: params.allowReapply,
    allowNewHooks: params.allowNewHooks,
  });
}

export function buildRuntimeStateArtifactsFromSnapshot(params: {
  readonly snapshot: RuntimeStateSnapshot;
  readonly delta: RuntimeStateDelta;
  readonly language: "zh" | "en";
  readonly allowReapply?: boolean;
  readonly allowNewHooks?: boolean;
}): RuntimeStateArtifacts {
  const { resolvedDelta } = arbitrateRuntimeStateDeltaHooks({
    hooks: params.snapshot.hooks.hooks,
    delta: params.delta,
    allowNewHooks: params.allowNewHooks,
  });
  const next = applyRuntimeStateDelta({
    snapshot: params.snapshot,
    delta: resolvedDelta,
    allowReapply: params.allowReapply,
  });

  return {
    snapshot: next,
    resolvedDelta,
    currentStateMarkdown: renderCurrentStateProjection(next.currentState, params.language),
    // Pass the chapter number so the projection can tag stale / blocked hooks.
    hooksMarkdown: renderHooksProjection(next.hooks, params.language, {
      currentChapter: resolvedDelta.chapter,
    }),
    chapterSummariesMarkdown: renderChapterSummariesProjection(next.chapterSummaries, params.language),
  };
}

function validateLoadedSnapshot(
  snapshot: RuntimeStateSnapshot,
  label: string,
): RuntimeStateSnapshot {
  const issues = validateRuntimeState(snapshot);
  if (issues.length > 0) {
    const summary = issues
      .map((issue) => `${issue.code}${issue.path ? `@${issue.path}` : ""}`)
      .join(", ");
    throw new Error(`Invalid ${label}: ${summary}`);
  }
  return snapshot;
}

export async function saveRuntimeStateSnapshot(
  bookDir: string,
  snapshot: RuntimeStateSnapshot,
): Promise<void> {
  const stateDir = join(bookDir, "story", "state");
  await mkdir(stateDir, { recursive: true });

  await Promise.all([
    writeFile(join(stateDir, "manifest.json"), JSON.stringify(snapshot.manifest, null, 2), "utf-8"),
    writeFile(join(stateDir, "current_state.json"), JSON.stringify(snapshot.currentState, null, 2), "utf-8"),
    writeFile(join(stateDir, "hooks.json"), JSON.stringify(snapshot.hooks, null, 2), "utf-8"),
    writeFile(join(stateDir, "chapter_summaries.json"), JSON.stringify(snapshot.chapterSummaries, null, 2), "utf-8"),
  ]);
}

export async function loadNarrativeMemorySeed(bookDir: string): Promise<NarrativeMemorySeed> {
  const snapshot = await loadRuntimeStateSnapshot(bookDir);

  return {
    summaries: snapshot.chapterSummaries.rows.map((row) => ({
      chapter: row.chapter,
      title: row.title,
      characters: row.characters,
      events: row.events,
      stateChanges: row.stateChanges,
      hookActivity: row.hookActivity,
      mood: row.mood,
      chapterType: row.chapterType,
    })),
      hooks: snapshot.hooks.hooks.map((hook) => ({
        hookId: hook.hookId,
        startChapter: hook.startChapter,
        type: hook.type,
        status: hook.status,
        lastAdvancedChapter: hook.lastAdvancedChapter,
        expectedPayoff: hook.expectedPayoff,
        payoffTiming: hook.payoffTiming,
        notes: hook.notes,
      })),
  };
}

export async function loadSnapshotCurrentStateFacts(
  bookDir: string,
  chapterNumber: number,
): Promise<ReadonlyArray<Fact>> {
  const snapshotDir = join(bookDir, "story", "snapshots", String(chapterNumber));
  const structuredState = await readJsonOrNull(
    join(snapshotDir, "state", "current_state.json"),
    CurrentStateStateSchema,
  );
  if (structuredState) {
    return structuredState.facts;
  }

  const markdown = await readFile(join(snapshotDir, "current_state.md"), "utf-8").catch(() => "");
  return parseCurrentStateFacts(markdown, chapterNumber);
}

async function readJson<T>(
  path: string,
  schema: { parse(value: unknown): T },
): Promise<T> {
  const raw = await readFile(path, "utf-8");
  return schema.parse(JSON.parse(raw));
}

async function readJsonOrNull<T>(
  path: string,
  schema: { parse(value: unknown): T },
): Promise<T | null> {
  try {
    return await readJson(path, schema);
  } catch {
    return null;
  }
}
