import type { ActionResult } from "./contracts.js";

/** Preserve bounded failure context without copying model prompts or partial drafts. */
export function actionFailureFacts(error: unknown) {
  const detail: Record<string, unknown> = {};
  const seen = new Set<object>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const layer = current as Record<string, unknown>;
    for (const key of ["code", "resultTool", "stopReason", "attempts", "recovery"]) {
      if (detail[key] === undefined && layer[key] !== undefined) detail[key] = layer[key];
    }
    current = layer.cause;
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    ...(typeof detail.code === "string" ? { code: detail.code } : {}),
    ...(typeof detail.resultTool === "string" ? { resultTool: detail.resultTool } : {}),
    ...(typeof detail.stopReason === "string" ? { stopReason: detail.stopReason } : {}),
    ...(typeof detail.attempts === "number" && Number.isInteger(detail.attempts) && detail.attempts >= 0
      ? { attempts: detail.attempts } : {}),
    ...(detail.recovery !== undefined ? { recovery: detail.recovery } : {}),
  };
}

function observationFacts(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const { evidence: _evidence, scope: _scope, sourceRefs, ...finding } = value as Record<string, unknown>;
  return { ...finding, ...(Array.isArray(sourceRefs) ? {
    sourceRefs: sourceRefs.map(ref => ({ sourceId: (ref as { sourceId: string }).sourceId })),
  } : {}) };
}

function artifactAddresses(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map(item => {
    if (!item || typeof item !== "object") return item;
    // The logical location distinguishes chapter numbers and production copies.
    // Keep it alongside the opaque ID; only domain bodies are compacted away.
    return { ...item as Record<string, unknown> };
  });
}

function deliveryFacts(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const delivery = value as Record<string, unknown>;
  return { ...delivery, ...(Array.isArray(delivery.observations) ? {
    observations: delivery.observations.map(observationFacts),
  } : {}) };
}

/** Control facts shared by the model observation and compacted progress.
 * Manuscripts, graphs and full transcripts remain in artifacts/domain readers.
 */
export function actionResultFacts(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const data = value as Record<string, unknown>;
  const facts: Record<string, unknown> = {};
  const prose = new Set(["sceneText", "content", "text", "displayText", "summary", "premise", "worldContract", "visualContract", "instruction", "replayedInput"]);
  for (const [key, item] of Object.entries(data)) {
    if (!prose.has(key) && ["string", "number", "boolean"].includes(typeof item)) facts[key] = item;
  }
  if (data.delivery !== undefined) facts.delivery = deliveryFacts(data.delivery);
  if (data.artifacts !== undefined) facts.artifacts = artifactAddresses(data.artifacts);
  for (const key of ["nextRead", "structure", "suggestedActions", "lineage", "measurements", "reviewedReferences", "changedRegion", "editPermission", "comparison", "revisionChanges"]) {
    if (data[key] !== undefined) facts[key] = data[key];
  }
  if (data.currentState && typeof data.currentState === "object") {
    const state = data.currentState as Record<string, unknown>;
    facts.state = { turn: state.turn, lastEventId: state.lastEventId, blocked: state.blocked };
  }
  return facts;
}

export function actionObservation(result: ActionResult) {
  const facts = actionResultFacts(result.data);
  return {
    status: result.status,
    summary: result.summary,
    // The Work inventory already contains its complete identity and artifact
    // addresses. Sending its human display a second time only duplicates it.
    ...(result.content && facts.kind !== "work_inspected" ? { content: result.content } : {}),
    artifacts: artifactAddresses(result.artifacts),
    observations: result.observations.map(observationFacts),
    ...(result.operationReceipts?.length ? {operationReceipts: result.operationReceipts} : {}),
    facts,
  };
}
