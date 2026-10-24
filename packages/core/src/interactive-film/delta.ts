import { z } from "zod";
import {
  StoryGraphSchema,
  WorldAnchorSchema,
  CharacterSchema,
  StoryNodeSchema,
  VariableSchema,
  EndingSchema,
  type StoryGraph,
} from "./graph-schema.js";

const upsertRemove = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    upsert: z.array(item).default([]),
    remove: z.array(z.string()).default([]),
  }).strict();

export const StoryGraphDeltaSchema = z.object({
  worldAnchor: WorldAnchorSchema.partial().optional(),
  characters: upsertRemove(CharacterSchema).optional(),
  nodes: upsertRemove(StoryNodeSchema).optional(),
  variables: upsertRemove(VariableSchema).optional(),
  endings: upsertRemove(EndingSchema).optional(),
  notes: z.array(z.string()).default([]),
}).strict();
export type StoryGraphDelta = z.infer<typeof StoryGraphDeltaSchema>;

function applyUpsertRemove<T>(
  current: readonly T[],
  ops: { upsert: T[]; remove: string[] } | undefined,
  key: (item: T) => string,
): T[] {
  if (!ops) return [...current];
  const map = new Map(current.map((item) => [key(item), item]));
  for (const id of ops.remove) map.delete(id);
  for (const item of ops.upsert) map.set(key(item), item);
  return [...map.values()];
}

/**
 * Returns a new StoryGraph with the delta applied. The returned graph shares
 * element references with the input; callers must treat it as immutable —
 * do not mutate nodes/arrays in place.
 */
export function applyStoryGraphDelta(params: {
  graph: StoryGraph;
  delta: StoryGraphDelta;
}): StoryGraph {
  const graph = StoryGraphSchema.parse(params.graph);
  const delta = StoryGraphDeltaSchema.parse(params.delta);

  const worldAnchor = delta.worldAnchor
    ? WorldAnchorSchema.parse({ ...(graph.worldAnchor ?? {}), ...delta.worldAnchor })
    : graph.worldAnchor;

  // Remove a node together with its existing graph references. An upsert of
  // the same id is a replacement, so its ending registrations stay intact.
  const replacementIds=new Set(delta.nodes?.upsert.map(node=>node.id)??[]);
  const removedNodeIds=new Set((delta.nodes?.remove??[]).filter(id=>!replacementIds.has(id)));
  const currentNodes=graph.nodes.map(node=>({...node,
    choices:node.choices.filter(choice=>!removedNodeIds.has(choice.targetNodeId)),
  }));
  const currentEndings=graph.endings.filter(ending=>!removedNodeIds.has(ending.nodeId));

  const next = StoryGraphSchema.parse({
    ...graph,
    worldAnchor,
    characters: applyUpsertRemove(graph.characters, delta.characters, (c) => c.id),
    nodes: applyUpsertRemove(currentNodes, delta.nodes, (n) => n.id),
    variables: applyUpsertRemove(graph.variables, delta.variables, (v) => v.name),
    endings: applyUpsertRemove(currentEndings, delta.endings, (e) => e.id),
  });

  // Referential integrity (blocking): every ending must point at an existing node.
  // choice.targetNodeId dangling is left advisory to validateStoryGraph (Phase 1).
  const nodeIds = new Set(next.nodes.map((n) => n.id));
  for (const ending of next.endings) {
    if (!nodeIds.has(ending.nodeId)) {
      throw Object.assign(new Error(`ending ${ending.id} references missing node ${ending.nodeId}`),{
        code:'ENDING_NODE_NOT_FOUND',endingId:ending.id,nodeId:ending.nodeId,
      });
    }
  }
  return next;
}
