import type { WritingLanguage } from "../models/book.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ChapterSummariesStateSchema,
  CurrentStateStateSchema,
  HooksStateSchema,
  StateManifestSchema,
  type RuntimeStateDelta,
  type HookRecord,
} from "../models/runtime-state.js";
import { renderChapterSummariesProjection, renderCurrentStateProjection, renderHooksProjection } from "./state-projections.js";
import { applyRuntimeStateDelta, type RuntimeStateSnapshot } from "./state-reducer.js";
import { validateRuntimeState } from "./state-validator.js";
import { arbitrateRuntimeStateDeltaHooks } from "../utils/hook-arbiter.js";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";

export interface RuntimeStateArtifacts {
  readonly snapshot: RuntimeStateSnapshot;
  readonly resolvedDelta: RuntimeStateDelta;
  readonly currentStateMarkdown: string;
  readonly hooksMarkdown: string;
  readonly chapterSummariesMarkdown: string;
}

export async function createInitialRuntimeState(input: {
  readonly bookDir: string;
  readonly language: WritingLanguage;
  readonly hooks?: ReadonlyArray<HookRecord>;
}): Promise<RuntimeStateSnapshot> {
  const snapshot: RuntimeStateSnapshot = {
    manifest: StateManifestSchema.parse({
      schemaVersion: 2,
      language: input.language,
      lastAppliedChapter: 0,
      projectionVersion: 1,
    }),
    currentState: CurrentStateStateSchema.parse({ chapter: 0, facts: [] }),
    hooks: HooksStateSchema.parse({ hooks: input.hooks ?? [] }),
    chapterSummaries: ChapterSummariesStateSchema.parse({ rows: [] }),
  };
  await saveRuntimeStateSnapshot(input.bookDir, snapshot);
  return snapshot;
}

export async function loadRuntimeStateSnapshot(bookDir: string): Promise<RuntimeStateSnapshot> {
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
  readonly language: WritingLanguage;
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

  throw new Error(`Structured runtime snapshot is incomplete at chapter ${params.chapterNumber}`);
}

export async function buildRuntimeStateArtifacts(params: {
  readonly bookDir: string;
  readonly delta: RuntimeStateDelta;
  readonly language: WritingLanguage;
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
  readonly language: WritingLanguage;
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
    snapshot: { ...next, manifest: { ...next.manifest, language: params.language } },
    resolvedDelta,
    currentStateMarkdown: renderCurrentStateProjection(next.currentState, params.language),
    hooksMarkdown: renderHooksProjection(next.hooks, params.language),
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
  const parsed = validateLoadedSnapshot(snapshot, "runtime state save");
  const language = parsed.manifest.language;
  await commitAtomicFileSet({
    rootDir: bookDir,
    writes: [
      { relativePath: join("story", "state", "manifest.json"), content: `${JSON.stringify(parsed.manifest, null, 2)}\n` },
      { relativePath: join("story", "state", "current_state.json"), content: `${JSON.stringify(parsed.currentState, null, 2)}\n` },
      { relativePath: join("story", "state", "hooks.json"), content: `${JSON.stringify(parsed.hooks, null, 2)}\n` },
      { relativePath: join("story", "state", "chapter_summaries.json"), content: `${JSON.stringify(parsed.chapterSummaries, null, 2)}\n` },
      { relativePath: join("story", "current_state.md"), content: renderCurrentStateProjection(parsed.currentState, language) },
      { relativePath: join("story", "pending_hooks.md"), content: renderHooksProjection(parsed.hooks, language) },
      { relativePath: join("story", "chapter_summaries.md"), content: renderChapterSummariesProjection(parsed.chapterSummaries, language) },
    ],
  });
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
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
