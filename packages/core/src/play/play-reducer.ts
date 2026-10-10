import {
  PlayEventSchema,
  PlayMutationSchema,
  isPlayEvidenceEntityType,
  type PlayEdgeInput,
  type PlayEdge,
  type PlayEntity,
  type PlayEntityInput,
  type PlayEvent,
  type PlayEventInput,
  type PlayEvidenceStatus,
  type PlayMutationInput,
  type PlayStateSlot,
  type PlayStateSlotInput,
} from "../models/play.js";
import type { PlayGraphSnapshot } from "./play-db.js";

export interface PlayReducerDB {
  readonly snapshot?: () => PlayGraphSnapshot;
  readonly replaceWithSnapshot?: (snapshot: PlayGraphSnapshot) => void;
  readonly transaction?: <T>(fn: () => T) => T;
  readonly getEntity: (id: string) => PlayEntity | null;
  readonly upsertEntity: (entity: PlayEntityInput) => void;
  readonly upsertEdge: (edge: PlayEdgeInput) => void;
  readonly expireEdge: (edgeId: string, validUntilEventId: string) => void;
  readonly upsertStateSlot: (slot: PlayStateSlotInput) => void;
  readonly getStateSlotsForEntity: (entityId: string) => PlayStateSlot[];
  readonly recordEvent: (event: PlayEventInput) => void;
}

export interface ApplyPlayMutationInput {
  readonly db: PlayReducerDB;
  readonly mutation: PlayMutationInput;
  readonly rawInput: string;
  readonly createdAt?: string;
}

export interface ApplyPlayMutationResult {
  readonly event: PlayEvent;
  readonly blocked: boolean;
}

const EVIDENCE_ORDER: readonly PlayEvidenceStatus[] = [
  "unknown",
  "hinted",
  "seen",
  "collected",
  "verified",
  "weaponized",
  "exposed",
  "exhausted",
];

export function applyPlayMutation(input: ApplyPlayMutationInput): ApplyPlayMutationResult {
  const mutation = PlayMutationSchema.parse(input.mutation);
  const event = PlayEventSchema.parse({
    id: mutation.eventId,
    turn: mutation.turn,
    actionKind: mutation.actionKind,
    rawInput: input.rawInput,
    outcomeSummary: mutation.summary || mutation.blockedReason,
    timeAdvance: mutation.timeAdvance,
    createdAt: input.createdAt ?? new Date().toISOString(),
  });

  validatePlayMutation(input.db, mutation);

  const apply = () => {
    input.db.recordEvent(event);

    if (!mutation.blocked) {
      applyGraphChanges(input.db, mutation);
    }

    return { event, blocked: mutation.blocked };
  };

  return input.db.transaction ? input.db.transaction(apply) : apply();
}

export interface SeedPlayGraphInput {
  readonly db: PlayReducerDB;
  readonly mutation: PlayMutationInput;
}

export function seedPlayGraph(input: SeedPlayGraphInput): void {
  const mutation = PlayMutationSchema.parse(input.mutation);
  validatePlayMutation(input.db, mutation);
  const apply = () => {
    if (!mutation.blocked) applyGraphChanges(input.db, mutation);
  };
  if (input.db.transaction) input.db.transaction(apply);
  else apply();
}

export function validatePlayMutation(db: PlayReducerDB, input: PlayMutationInput): void {
  const mutation=PlayMutationSchema.parse(input);
  const upsertedEntityIds = new Set(mutation.entities.upsert.map((entity) => entity.id));
  const entityExists = (entityId: string): boolean => upsertedEntityIds.has(entityId) || db.getEntity(entityId) !== null;
  const findEntity = (entityId: string): PlayEntity | PlayEntityInput | null =>
    mutation.entities.upsert.find((entity) => entity.id === entityId) ?? db.getEntity(entityId);

  for (const edge of mutation.edges.upsert) {
    if (!entityExists(edge.fromId) || !entityExists(edge.toId)) {
      throw Object.assign(new Error(`Play mutation edge ${edge.id} references a missing endpoint: ${edge.fromId} -> ${edge.toId}`),{code:"PLAY_REFERENCE_MISSING",edgeId:edge.id,fromId:edge.fromId,toId:edge.toId});
    }
    const holding=(isRecord(edge.value)&&edge.value.role==="holding")||edge.type==="holding"||edge.type==="holds";
    if(holding&&edge.fromId===edge.toId)throw Object.assign(new Error(`Holding edge ${edge.id} cannot make an object hold itself; fromId must identify its holder, toId the held object.`),{code:"PLAY_HOLDING_SELF",edgeId:edge.id,fromId:edge.fromId,toId:edge.toId});
    if (isRecord(edge.value) && edge.value.role === "holding" && !isPhysicalHoldingTarget(findEntity(edge.toId), edge.value)) {
      throw new Error(`Play mutation edge ${edge.id} marks a non-physical target as held: ${edge.toId}`);
    }
  }

  for (const slot of mutation.stateSlots.upsert) {
    if (slot.ownerEntityId && !entityExists(slot.ownerEntityId)) {
      throw new Error(`Play mutation references missing entity in state slot ${slot.id}: ${slot.ownerEntityId}`);
    }
  }

  for (const transition of mutation.evidence.transitions) {
    const entity = findEntity(transition.entityId);
    if (!entity || !isPlayEvidenceEntityType(entity.type)) {
      throw Object.assign(new Error(`Play evidence transition references a non-evidence entity: ${transition.entityId}`),{code:'PLAY_EVIDENCE_ENTITY_TYPE',entityId:transition.entityId});
    }
    const current = currentEvidenceStatus(db, transition.entityId);
    if (transition.from && transition.from !== current) {
      throw new Error(`Play evidence transition expected ${transition.entityId}=${transition.from}, found ${current}`);
    }
    if (evidenceRank(transition.to) < evidenceRank(current)) {
      throw new Error(`Play evidence transition goes backwards for ${transition.entityId}: ${current} -> ${transition.to}`);
    }
  }
  validatePlacementContinuity(db, mutation);
}

/** Closing a tracked physical placement must not silently erase its outcome.
 * An explicit status change can record disappearance/consumption; its meaning
 * remains author/model supplied rather than inferred from action prose. */
function validatePlacementContinuity(db: PlayReducerDB, mutation: ReturnType<typeof PlayMutationSchema.parse>): void {
  if (mutation.blocked || !db.snapshot) return;
  const before = db.snapshot();
  const entities = new Map(before.entities.map(entity => [entity.id, entity]));
  for (const entity of mutation.entities.upsert) entities.set(entity.id, entity);
  const subject = (edge: PlayEdge): string | undefined => {
    const target = entities.get(edge.toId), source = entities.get(edge.fromId);
    if (edge.value.role === "placement") return edge.fromId;
    const held = edge.value.role === "holding" || edge.type === "holding" || edge.type === "holds";
    if (held && (target?.type === "item" || edge.value.physical === true)) return edge.toId;
    if ((source?.type === "actor" || source?.type === "item")
      && (edge.type === "at" && target?.type === "location"
        || edge.type === "within" && ["location", "item", "actor"].includes(target?.type ?? ""))) return edge.fromId;
    return undefined;
  };
  const active = before.edges.filter(edge => edge.validUntilEventId === null);
  const expired = new Set(mutation.edges.expire.map(edge => edge.edgeId));
  const after = new Map(active.filter(edge => !expired.has(edge.id)).map(edge => [edge.id, edge]));
  for (const edge of mutation.edges.upsert) {
    if (edge.validUntilEventId === null) after.set(edge.id, edge);
    else after.delete(edge.id);
  }
  const located = new Set([...after.values()].map(subject).filter(id => id !== undefined));
  const missing = new Map<string, string[]>();
  for (const edge of active) {
    const entityId = subject(edge);
    if (!entityId || located.has(entityId)) continue;
    const prior = before.entities.find(entity => entity.id === entityId);
    const updated = mutation.entities.upsert.find(entity => entity.id === entityId);
    if (updated?.status.trim() && updated.status !== prior?.status) continue;
    missing.set(entityId, [...(missing.get(entityId) ?? []), edge.id]);
  }
  if (missing.size) throw Object.assign(new Error(JSON.stringify({
    code: "PLAY_PLACEMENT_UNRESOLVED",
    entities: [...missing].map(([entityId, previousEdgeIds]) => ({entityId, previousEdgeIds})),
    instruction: "The proposed change removes the only tracked location or holder of these physical entities. Upsert each resulting placement, including return relations that existed earlier: entity -> location/container with value.role=placement, or holder -> item with value.role=holding. The free-form edge type is not a placement discriminator. If an entity intentionally disappears or is consumed, explicitly update its status to record that disposition. Keep the scene consistent with the submitted state. Nothing has been committed; correct this same turn.",
  })), {code: "PLAY_PLACEMENT_UNRESOLVED"});
}

function applyGraphChanges(db: PlayReducerDB, mutation: ReturnType<typeof PlayMutationSchema.parse>): void {
  for (const entity of mutation.entities.upsert) {
    const existing=db.getEntity(entity.id);
    db.upsertEntity(existing?{...entity,createdEventId:existing.createdEventId}:entity);
  }
  for (const edge of mutation.edges.expire) {
    db.expireEdge(edge.edgeId, edge.validUntilEventId);
  }
  for (const edge of mutation.edges.upsert) {
    db.upsertEdge(edge);
  }
  for (const slot of mutation.stateSlots.upsert) {
    db.upsertStateSlot(slot);
  }
  for (const transition of mutation.evidence.transitions) {
    db.upsertStateSlot({
      id: evidenceStatusSlotId(transition.entityId),
      ownerEntityId: transition.entityId,
      kind: "evidence",
      label: "证据状态",
      value: {
        previous: currentEvidenceStatus(db, transition.entityId),
        status: transition.to,
        reason: transition.reason,
      },
      updatedEventId: mutation.eventId,
    });
  }
}

function isPhysicalHoldingTarget(target: PlayEntity | PlayEntityInput | null, value: Record<string, unknown>): boolean {
  if (!target) return false;
  if (target.type === "item") return true;
  if (value.physical === true || value.portable === true) {
    return isPlayEvidenceEntityType(target.type);
  }
  return false;
}

function currentEvidenceStatus(db: PlayReducerDB, entityId: string): PlayEvidenceStatus {
  const slot = db.getStateSlotsForEntity(entityId)
    .find((candidate) => candidate.id === evidenceStatusSlotId(entityId) || candidate.kind === "evidence");
  if (!slot || !isRecord(slot.value)) return "unknown";
  const status = slot.value.status;
  return typeof status === "string" && (EVIDENCE_ORDER as readonly string[]).includes(status)
    ? status as PlayEvidenceStatus
    : "unknown";
}

function evidenceStatusSlotId(entityId: string): string {
  return `evidence:${entityId}:status`;
}

function evidenceRank(status: PlayEvidenceStatus): number {
  return EVIDENCE_ORDER.indexOf(status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
