import { readFile } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { StoryGraphSchema, type StoryGraph } from "./graph-schema.js";
import { assertVariableTypes, assertDisplayText } from "./validation.js";
import { z } from "zod";
import { applyStoryGraphDelta, type StoryGraphDelta } from "./delta.js";
import { loadStoryGraph, storyGraphPath } from "./graph-store.js";
import { loadWorkManifest } from "../harness/work-store.js";
import { syncWorkSourceArtifacts } from "../harness/source-sync.js";
import { commitAtomicFileSet, type AtomicFileWrite } from "../utils/atomic-file-set.js";
import { withWorkMutationScope } from "../utils/work-mutation-scope.js";
import { StateManager } from "../state/manager.js";

// Per-project async mutex: concurrent applyGraphDelta calls to the same project
// run strictly one-at-a-time so no rev or update is silently lost.
const projectLocks = new Map<string, Promise<unknown>>();
async function withProjectLock<T>(root: string, projectId: string, fn: () => Promise<T>): Promise<T> {
  const key = `${root}::${projectId}`;
  const prev = projectLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  projectLocks.set(key, prev.then(() => gate));
  await prev.catch(() => {}); // wait for predecessor; ignore its error for ordering
  try {
    return await withWorkMutationScope(root,projectId,()=>new StateManager(root).acquireBookLock(projectId),fn);
  } finally {
    release();
  }
}

export interface AuthoringState {
  readonly phase: "world" | "scale" | "structure" | "workshop";
  readonly rev: number;
  readonly phaseRevs?: Record<string, number>;
}

const AuthoringStateSchema = z.object({
  phase: z.enum(["world", "scale", "structure", "workshop"]),
  rev: z.number().int().nonnegative(),
  phaseRevs: z.record(z.string(), z.number().int().nonnegative()).optional(),
}).strict();

const DEFAULT_STATE: AuthoringState = { phase: "world", rev: 0 };

function projectDir(projectRoot: string, projectId: string): string {
  return dirname(storyGraphPath(projectRoot, projectId));
}

export function authoringStatePath(projectRoot: string, projectId: string): string {
  return join(projectDir(projectRoot, projectId), "authoring-state.json");
}

export async function loadAuthoringState(
  projectRoot: string,
  projectId: string,
): Promise<AuthoringState> {
  try {
    const raw = await readFile(authoringStatePath(projectRoot, projectId), "utf-8");
    return AuthoringStateSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_STATE;
    throw error;
  }
}

function emptyGraph(projectId: string, title = projectId): StoryGraph {
  return StoryGraphSchema.parse({
    schemaVersion: 1, projectId, title, variables: [], nodes: [], endings: [], characters: [],
  });
}

function snapshotDir(projectRoot: string, projectId: string): string {
  return join(projectDir(projectRoot, projectId), "snapshots");
}

async function commitAuthoringFiles(root: string, projectId: string, writes: AtomicFileWrite[]): Promise<void> {
  try { await loadWorkManifest(root,projectId); }
  catch(error) {
    if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    await commitAtomicFileSet({rootDir:root,writes});return;
  }
  await syncWorkSourceArtifacts({projectRoot:root,workId:projectId,writes,accept:true});
}

/**
 * Applies a delta to the project's story graph and advances the authoring rev.
 *
 * The returned graph shares element references with the input; callers must
 * treat it as immutable — do not mutate nodes/arrays in place.
 *
 * Concurrent calls for the same project are serialized via a per-project async
 * mutex, preventing lost-update races (two callers both reading rev=N and both
 * writing rev=N+1).
 */
export async function applyGraphDelta(params: {
  projectRoot: string;
  projectId: string;
  delta: StoryGraphDelta;
  phase?: AuthoringState["phase"];
}): Promise<{ graph: StoryGraph; rev: number }> {
  return withProjectLock(params.projectRoot, params.projectId, async () => {
    let title=params.projectId;
    try {title=(await loadWorkManifest(params.projectRoot,params.projectId)).title;}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const current = (await loadStoryGraph(params.projectRoot, params.projectId)) ?? emptyGraph(params.projectId,title);
    const state = await loadAuthoringState(params.projectRoot, params.projectId);

    // Snapshot the pre-apply graph under the current rev so revert(rev) restores it.
    // Note: no snapshot is written for the latest rev — the live graph file IS the latest rev.
    const graph = applyStoryGraphDelta({ graph: current, delta: params.delta });
    assertVariableTypes(graph);
    // Validate submitted text while allowing legacy findings to be corrected
    // incrementally. Export validation checks the complete graph.
    assertDisplayText({...graph,title:'',nodes:params.delta.nodes?.upsert??[],
      endings:params.delta.endings?.upsert??[],characters:params.delta.characters?.upsert??[]});

    const nextRev = state.rev + 1;
    const nextState: AuthoringState = { phase: params.phase ?? state.phase, rev: nextRev, phaseRevs: state.phaseRevs };
    await commitAuthoringFiles(params.projectRoot,params.projectId,[
      {relativePath:relative(params.projectRoot,join(snapshotDir(params.projectRoot,params.projectId),`${state.rev}.json`)),content:JSON.stringify(current,null,2)},
      {relativePath:relative(params.projectRoot,storyGraphPath(params.projectRoot,params.projectId)),content:JSON.stringify(graph,null,2)},
      {relativePath:relative(params.projectRoot,authoringStatePath(params.projectRoot,params.projectId)),content:JSON.stringify(nextState,null,2)},
    ]);
    return { graph, rev: nextRev };
  });
}

export async function revertToSnapshot(params: {
  projectRoot: string;
  projectId: string;
  rev: number;
}): Promise<StoryGraph> {
  return withProjectLock(params.projectRoot,params.projectId,async()=>{
    const file = join(snapshotDir(params.projectRoot, params.projectId), `${params.rev}.json`);
    const graph = StoryGraphSchema.parse(JSON.parse(await readFile(file, "utf-8")));
    const current = await loadStoryGraph(params.projectRoot,params.projectId);
    const state = await loadAuthoringState(params.projectRoot,params.projectId);
    await commitAuthoringFiles(params.projectRoot,params.projectId,[
      ...(current?[{relativePath:relative(params.projectRoot,join(snapshotDir(params.projectRoot,params.projectId),`${state.rev}.json`)),content:JSON.stringify(current,null,2)}]:[]),
      {relativePath:relative(params.projectRoot,storyGraphPath(params.projectRoot,params.projectId)),content:JSON.stringify(graph,null,2)},
      {relativePath:relative(params.projectRoot,authoringStatePath(params.projectRoot,params.projectId)),content:JSON.stringify({...state,rev:state.rev+1},null,2)},
    ]);
    return graph;
  });
}

export async function recordPhaseVisit(
  projectRoot: string,
  projectId: string,
  phase: string,
): Promise<void> {
  return withProjectLock(projectRoot, projectId, async () => {
    const state = await loadAuthoringState(projectRoot, projectId);
    const next: AuthoringState = {
      ...state,
      phaseRevs: { ...(state.phaseRevs ?? {}), [phase]: state.rev },
    };
    await commitAuthoringFiles(projectRoot,projectId,[{relativePath:relative(projectRoot,authoringStatePath(projectRoot,projectId)),content:JSON.stringify(next,null,2)}]);
  });
}
