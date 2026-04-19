import { z } from "zod";
import { HookPayoffTimingSchema } from "./runtime-state.js";

export const ChapterConflictSchema = z.object({
  type: z.string().min(1),
  resolution: z.string().min(1),
  detail: z.string().optional(),
});

export type ChapterConflict = z.infer<typeof ChapterConflictSchema>;

export const HookPressurePhaseSchema = z.enum(["opening", "middle", "late"]);
export type HookPressurePhase = z.infer<typeof HookPressurePhaseSchema>;

export const HookMovementSchema = z.enum([
  "quiet-hold",
  "refresh",
  "advance",
  "partial-payoff",
  "full-payoff",
]);
export type HookMovement = z.infer<typeof HookMovementSchema>;

export const HookPressureLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type HookPressureLevel = z.infer<typeof HookPressureLevelSchema>;

export const HookPressureReasonSchema = z.enum([
  "fresh-promise",
  "building-debt",
  "stale-promise",
  "ripe-payoff",
  "overdue-payoff",
  "long-arc-hold",
]);
export type HookPressureReason = z.infer<typeof HookPressureReasonSchema>;

export const HookPressureSchema = z.object({
  hookId: z.string().min(1),
  type: z.string().min(1),
  movement: HookMovementSchema,
  pressure: HookPressureLevelSchema,
  payoffTiming: HookPayoffTimingSchema.optional(),
  phase: HookPressurePhaseSchema,
  reason: HookPressureReasonSchema,
  blockSiblingHooks: z.boolean().default(false),
});

export type HookPressure = z.infer<typeof HookPressureSchema>;

export const HookAgendaSchema = z.object({
  pressureMap: z.array(HookPressureSchema).default([]),
  mustAdvance: z.array(z.string().min(1)).default([]),
  eligibleResolve: z.array(z.string().min(1)).default([]),
  staleDebt: z.array(z.string().min(1)).default([]),
  avoidNewHookFamilies: z.array(z.string().min(1)).default([]),
});

export type HookAgenda = z.infer<typeof HookAgendaSchema>;

export const ChapterIntentSchema = z.object({
  chapter: z.number().int().min(1),
  goal: z.string().min(1),
  outlineNode: z.string().optional(),
  sceneDirective: z.string().min(1).optional(),
  arcDirective: z.string().min(1).optional(),
  moodDirective: z.string().min(1).optional(),
  titleDirective: z.string().min(1).optional(),
  mustKeep: z.array(z.string()).default([]),
  mustAvoid: z.array(z.string()).default([]),
  styleEmphasis: z.array(z.string()).default([]),
  conflicts: z.array(ChapterConflictSchema).default([]),
  hookAgenda: HookAgendaSchema.default({
    pressureMap: [],
    mustAdvance: [],
    eligibleResolve: [],
    staleDebt: [],
    avoidNewHookFamilies: [],
  }),
});

export type ChapterIntent = z.infer<typeof ChapterIntentSchema>;

export const ContextSourceSchema = z.object({
  source: z.string().min(1),
  reason: z.string().min(1),
  excerpt: z.string().optional(),
});

export type ContextSource = z.infer<typeof ContextSourceSchema>;

export const ContextPackageSchema = z.object({
  chapter: z.number().int().min(1),
  selectedContext: z.array(ContextSourceSchema).default([]),
});

export type ContextPackage = z.infer<typeof ContextPackageSchema>;

export const RuleLayerScopeSchema = z.enum(["global", "book", "arc", "local"]);
export type RuleLayerScope = z.infer<typeof RuleLayerScopeSchema>;

export const RuleLayerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  precedence: z.number().int(),
  scope: RuleLayerScopeSchema,
});

export type RuleLayer = z.infer<typeof RuleLayerSchema>;

export const OverrideEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  allowed: z.boolean(),
  scope: z.string().min(1),
});

export type OverrideEdge = z.infer<typeof OverrideEdgeSchema>;

export const ActiveOverrideSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  target: z.string().min(1),
  reason: z.string().min(1),
});

export type ActiveOverride = z.infer<typeof ActiveOverrideSchema>;

export const RuleStackSectionsSchema = z.object({
  hard: z.array(z.string()).default([]),
  soft: z.array(z.string()).default([]),
  diagnostic: z.array(z.string()).default([]),
});

export type RuleStackSections = z.infer<typeof RuleStackSectionsSchema>;

export const RuleStackSchema = z.object({
  layers: z.array(RuleLayerSchema).min(1),
  sections: RuleStackSectionsSchema.default({
    hard: [],
    soft: [],
    diagnostic: [],
  }),
  overrideEdges: z.array(OverrideEdgeSchema).default([]),
  activeOverrides: z.array(ActiveOverrideSchema).default([]),
});

export type RuleStack = z.infer<typeof RuleStackSchema>;

export const ChapterTraceSchema = z.object({
  chapter: z.number().int().min(1),
  plannerInputs: z.array(z.string()),
  composerInputs: z.array(z.string()),
  selectedSources: z.array(z.string()),
  notes: z.array(z.string()).default([]),
});

export type ChapterTrace = z.infer<typeof ChapterTraceSchema>;
