import type { StoryGraph, StoryNode } from "./graph-schema.js";
import { enumerateRuntimePaths } from "./paths.js";

export interface ValidationIssue {
  readonly code: "DEAD_END" | "BROKEN_LINK" | "UNREACHABLE" | "NO_PATH_TO_ENDING" | "VARIABLE_UNWRITTEN" | "VARIABLE_UNUSED" | "VARIABLE_TYPE_MISMATCH" | "IMAGE_MISSING" | "GATED_UNREACHABLE" | "ENDING_UNREACHABLE" | "ILLUSORY_BRANCH" | "ISOLATED_NODE" | "ENCODED_DISPLAY_TEXT";
  readonly level: "error" | "warning" | "info";
  readonly message: string;
  readonly nodeIds: readonly string[];
  readonly path?: string;
}

export interface ValidationReport {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
}

function label(node: StoryNode): string {
  return node.title || node.id;
}

export function validateStoryGraph(graph: StoryGraph): ValidationReport {
  const issues: ValidationIssue[] = [...validateVariableTypes(graph), ...validateDisplayText(graph)];
  const ids = new Set(graph.nodes.map((n) => n.id));
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  // BROKEN_LINK
  for (const node of graph.nodes) {
    for (const c of node.choices) {
      if (!ids.has(c.targetNodeId)) {
        issues.push({
          code: "BROKEN_LINK",
          level: "error",
          message: `节点「${label(node)}」的选项「${c.text}」指向不存在的节点 ${c.targetNodeId}`,
          nodeIds: [node.id],
        });
      }
    }
  }

  // DEAD_END：非结局节点没有任何指向存在节点的出口
  for (const node of graph.nodes) {
    if (node.type === "ending") continue;
    const hasExit = node.choices.some((c) => ids.has(c.targetNodeId));
    if (!hasExit) {
      issues.push({
        code: "DEAD_END",
        level: "error",
        message: `节点「${label(node)}」是死路：没有任何有效出口`,
        nodeIds: [node.id],
      });
    }
  }

  // 可达性 BFS
  const start = graph.nodes.find((n) => n.type === "start") ?? graph.nodes[0];
  const reachable = new Set<string>();
  if (start) {
    const queue = [start.id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (reachable.has(cur)) continue;
      reachable.add(cur);
      const n = nodeMap.get(cur);
      if (!n) continue;
      for (const c of n.choices) {
        if (ids.has(c.targetNodeId) && !reachable.has(c.targetNodeId)) queue.push(c.targetNodeId);
      }
    }
  }

  // UNREACHABLE
  for (const node of graph.nodes) {
    if (graph.nodes.length > 1 && !reachable.has(node.id)) {
      issues.push({
        code: "UNREACHABLE",
        level: "warning",
        message: `节点「${label(node)}」从开场无法到达`,
        nodeIds: [node.id],
      });
    }
  }

  // NO_PATH_TO_ENDING
  if (start) {
    let canEnd = false;
    for (const id of reachable) {
      if (nodeMap.get(id)?.type === "ending") { canEnd = true; break; }
    }
    if (!canEnd) {
      issues.push({
        code: "NO_PATH_TO_ENDING",
        level: "error",
        message: `从开场节点「${label(start)}」出发无法到达任何结局`,
        nodeIds: [start.id],
      });
    }
  }

  return { ok: issues.every((i) => i.level !== "error"), issues };
}

// The default value defines the runtime scalar type; `type` is also used for
// domain labels such as resource/item/flag and is not a JavaScript type name.
export function validateVariableTypes(graph: StoryGraph): ValidationIssue[] {
  const variables = new Map(graph.variables.map(variable => [variable.name, variable]));
  const issues: ValidationIssue[] = [];
  for (const node of graph.nodes) {
    const owners = [
      ...node.choices.map(choice=>({label:`choice ${choice.id}`,operations:[...choice.effects,...(choice.condition?[choice.condition]:[])]})),
      ...node.dialogue.map((line,index)=>({label:`dialogue ${index+1}`,operations:line.condition?[line.condition]:[]})),
    ];
    for (const owner of owners) for (const operation of owner.operations) {
      const variable = variables.get(operation.var);
      if (!variable) continue; // An incremental authoring draft may declare it later.
      const numeric = ['add', 'sub', '>', '<', '>=', '<='].includes(operation.op);
      if (typeof operation.value !== typeof variable.default ||
          (numeric && typeof variable.default !== 'number')) {
        issues.push({code:'VARIABLE_TYPE_MISMATCH',level:'error',nodeIds:[node.id],
          message:`Variable ${variable.name} requires ${typeof variable.default} values; ${owner.label} uses an incompatible ${operation.op} operation`});
      }
    }
  }
  return issues;
}

export function assertVariableTypes(graph: StoryGraph): void {
  const issues = validateVariableTypes(graph);
  if (issues.length) throw Object.assign(new Error(issues.map(issue => issue.message).join('; ')), {
    code: 'VARIABLE_TYPE_MISMATCH', issues,
  });
}

/** Display fields must contain text rather than an entirely JSON-escaped copy.
 * Mixed prose/code and opaque variable values are left unchanged. */
export function validateDisplayText(graph: StoryGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const check = (path: string, value: string, nodeIds: string[] = []) => {
    if (/^(?:\\u[0-9a-f]{4})+$/i.test(value.trim())) issues.push({
      code:'ENCODED_DISPLAY_TEXT',level:'error',path,nodeIds,
      message:`${path} contains literal Unicode escapes instead of display text. Resubmit the actual characters in this field.`,
    });
  };
  check('/title',graph.title);
  graph.characters.forEach((character,index)=>check(`/characters/${index}/name`,character.name));
  graph.nodes.forEach((node,index)=>{
    check(`/nodes/${index}/title`,node.title,[node.id]);
    check(`/nodes/${index}/sceneDesc`,node.sceneDesc,[node.id]);
    node.dialogue.forEach((line,lineIndex)=>check(`/nodes/${index}/dialogue/${lineIndex}/text`,line.text,[node.id]));
    node.choices.forEach((choice,choiceIndex)=>check(`/nodes/${index}/choices/${choiceIndex}/text`,choice.text,[node.id]));
  });
  graph.endings.forEach((ending,index)=>{
    for(const field of ['title','type','description'] as const)check(`/endings/${index}/${field}`,ending[field],[ending.nodeId]);
  });
  return issues;
}

export function assertDisplayText(graph: StoryGraph): void {
  const issues=validateDisplayText(graph);
  if(issues.length)throw Object.assign(new Error(JSON.stringify({code:'ENCODED_DISPLAY_TEXT',issues})),{code:'ENCODED_DISPLAY_TEXT',issues});
}

export function reviewStoryGraph(graph: StoryGraph): ValidationReport {
  const issues: ValidationIssue[] = [...validateStoryGraph(graph).issues];

  const reads = new Set<string>();
  const writes = new Set<string>();
  for (const node of graph.nodes) {
    for (const line of node.dialogue) if (line.condition) reads.add(line.condition.var);
    for (const choice of node.choices) {
      if (choice.condition) reads.add(choice.condition.var);
      for (const effect of choice.effects) writes.add(effect.var);
    }
  }
  for (const v of reads) {
    if (!writes.has(v)) {
      issues.push({
        code: "VARIABLE_UNWRITTEN",
        level: "warning",
        message: `变量「${v}」被选项条件读取，但没有任何选项写入它——该条件门除默认值外永远不会改变`,
        nodeIds: [],
      });
    }
  }
  for (const v of graph.variables.map((vv) => vv.name)) {
    if (!reads.has(v) && !writes.has(v)) {
      issues.push({
        code: "VARIABLE_UNUSED",
        level: "info",
        message: `变量「${v}」声明了但没有任何选项写入、也没有任何条件读取它——这是个多余的声明`,
        nodeIds: [],
      });
    }
  }

  for (const node of graph.nodes) {
    if (node.type !== "ending" && !node.imageSlot?.assetRef) {
      issues.push({
        code: "IMAGE_MISSING",
        level: "info",
        message: `节点「${node.title || node.id}」还没有配图`,
        nodeIds: [node.id],
      });
    }
  }

  // --- P6 new rules ---
  const { paths, truncated } = enumerateRuntimePaths(graph);
  const reachedNodeIds = new Set<string>();
  for (const p of paths) {
    for (const id of p.nodeIds) reachedNodeIds.add(id);
  }
  const edgeReachable = computeEdgeReachable(graph);

  // GATED_UNREACHABLE and ENDING_UNREACHABLE rely on a complete path enumeration.
  // When enumeration is truncated (>200 paths), the reached-node set is incomplete,
  // so asserting unreachability would be unsound. Skip both loops in that case.
  if (!truncated) {
    // GATED_UNREACHABLE: edge-reachable but not runtime-reachable (endings are reported by ENDING_UNREACHABLE)
    for (const node of graph.nodes) {
      if (node.type === "start") continue;
      if (node.type === "ending") continue;
      if (edgeReachable.has(node.id) && !reachedNodeIds.has(node.id)) {
        issues.push({
          code: "GATED_UNREACHABLE",
          level: "warning",
          message: `节点「${node.title || node.id}」连边可达，但没有任何满足变量条件的路径能到达——它被一个永远不成立的条件挡住了`,
          nodeIds: [node.id],
        });
      }
    }

    // ENDING_UNREACHABLE: check by ending.nodeId presence in reached nodes (handles multiple endings sharing the same node)
    for (const ending of graph.endings) {
      if (!reachedNodeIds.has(ending.nodeId)) {
        issues.push({
          code: "ENDING_UNREACHABLE",
          level: "warning",
          message: `结局「${ending.title}」没有任何真实路径能到达`,
          nodeIds: [ending.nodeId],
        });
      }
    }
  }

  // ISOLATED_NODE (endings are reported by ENDING_UNREACHABLE, not as generic isolated nodes)
  // Skip nodes that already carry an UNREACHABLE issue from validateStoryGraph — that report
  // is more informative (BFS-based, not just topology), so the duplicate is noise.
  const incoming = new Set<string>();
  for (const n of graph.nodes) for (const c of n.choices) incoming.add(c.targetNodeId);
  for (const node of graph.nodes) {
    if (node.type !== "start" && node.type !== "ending" && !incoming.has(node.id)) {
      if (issues.some((i) => i.code === "UNREACHABLE" && (i.nodeIds as readonly string[]).includes(node.id))) continue;
      issues.push({
        code: "ISOLATED_NODE",
        level: "info",
        message: `节点「${node.title || node.id}」没有任何选项指向它——孤立节点`,
        nodeIds: [node.id],
      });
    }
  }

  // ILLUSORY_BRANCH: a branch where all choices share the same target and have no effects
  for (const node of graph.nodes) {
    if (node.choices.length >= 2) {
      const targets = new Set(node.choices.map((c) => c.targetNodeId));
      const allNoEffect = node.choices.every((c) => (c.effects?.length ?? 0) === 0);
      if (targets.size === 1 && allNoEffect) {
        issues.push({
          code: "ILLUSORY_BRANCH",
          level: "info",
          message: `节点「${node.title || node.id}」的所有选项都通向同一个节点且没有不同效果——这是个假分支`,
          nodeIds: [node.id],
        });
      }
    }
  }

  return { ok: issues.every((i) => i.level !== "error"), issues };
}

function computeEdgeReachable(graph: StoryGraph): Set<string> {
  const start = graph.nodes.find((n) => n.type === "start");
  const reachable = new Set<string>();
  if (!start) return reachable;
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const queue = [start.id];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (reachable.has(cur)) continue;
    reachable.add(cur);
    const node = nodeById.get(cur);
    if (!node) continue;
    for (const choice of node.choices) {
      if (!reachable.has(choice.targetNodeId)) queue.push(choice.targetNodeId);
    }
  }
  return reachable;
}
