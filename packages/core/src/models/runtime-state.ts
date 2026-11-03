import { z } from "zod";

import { WritingLanguageSchema } from "./book.js";

export const RuntimeStateLanguageSchema = WritingLanguageSchema;
export type RuntimeStateLanguage = z.infer<typeof RuntimeStateLanguageSchema>;

export const StateManifestSchema = z.object({
  schemaVersion: z.literal(2),
  language: RuntimeStateLanguageSchema,
  lastAppliedChapter: z.number().int().min(0),
  projectionVersion: z.number().int().min(1),
}).strict();

export type StateManifest = z.infer<typeof StateManifestSchema>;

export const HookStatusSchema = z.enum(["open", "progressing", "deferred", "resolved", "superseded"]);
export type HookStatus = z.infer<typeof HookStatusSchema>;

export const HookRecordSchema = z.object({
  hookId: z.string().min(1),
  startChapter: z.number().int().min(0),
  type: z.string().min(1),
  status: HookStatusSchema,
  lastAdvancedChapter: z.number().int().min(0),
  // A stored hook may have an unspecified payoff. New candidates require one.
  expectedPayoff: z.string(),
  notes: z.string(),
  dependsOn: z.array(z.string().min(1)).optional(),
  paysOffInArc: z.string().optional(),
}).strict();

export type HookRecord = z.infer<typeof HookRecordSchema>;

export const HooksStateSchema = z.object({
  hooks: z.array(HookRecordSchema),
}).strict();

export type HooksState = z.infer<typeof HooksStateSchema>;

export const ChapterSummaryRowSchema = z.object({
  chapter: z.number().int().min(1),
  title: z.string().min(1),
  characters: z.string(),
  events: z.string(),
  stateChanges: z.string(),
  hookActivity: z.string(),
  mood: z.string(),
  chapterType: z.string(),
}).strict();

export type ChapterSummaryRow = z.infer<typeof ChapterSummaryRowSchema>;

export const ChapterSummariesStateSchema = z.object({
  rows: z.array(ChapterSummaryRowSchema),
}).strict();

export type ChapterSummariesState = z.infer<typeof ChapterSummariesStateSchema>;

export const CurrentStateFactSchema = z.object({
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  validFromChapter: z.number().int().min(0),
  validUntilChapter: z.number().int().min(0).nullable(),
  sourceChapter: z.number().int().min(0),
}).strict();

export type CurrentStateFact = z.infer<typeof CurrentStateFactSchema>;

export const CurrentStateStateSchema = z.object({
  chapter: z.number().int().min(0),
  facts: z.array(CurrentStateFactSchema),
}).strict();

export type CurrentStateState = z.infer<typeof CurrentStateStateSchema>;

export const StateFactInputSchema = z.object({
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
}).strict();

export type StateFactInput = z.infer<typeof StateFactInputSchema>;

export const StateFactSelectorSchema = z.object({
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1).optional(),
}).strict();

export type StateFactSelector = z.infer<typeof StateFactSelectorSchema>;

export const StateFactOpsSchema = z.object({
  upsert: z.array(StateFactInputSchema),
  expire: z.array(StateFactSelectorSchema),
}).strict();

export type StateFactOps = z.infer<typeof StateFactOpsSchema>;

export const HookOpsSchema = z.object({
  upsert: z.array(HookRecordSchema),
  mention: z.array(z.string().min(1)),
  resolve: z.array(z.string().min(1)),
  defer: z.array(z.string().min(1)),
}).strict();

export type HookOps = z.infer<typeof HookOpsSchema>;

export const NewHookCandidateSchema = z.object({
  type: z.string().min(1),
  expectedPayoff: z.string().min(1),
  notes: z.string(),
}).strict();

export type NewHookCandidate = z.infer<typeof NewHookCandidateSchema>;

export const RuntimeStateDeltaSchema = z.object({
  chapter: z.number().int().min(1),
  factOps: StateFactOpsSchema,
  hookOps: HookOpsSchema,
  newHookCandidates: z.array(NewHookCandidateSchema),
  chapterSummary: ChapterSummaryRowSchema.optional(),
}).strict();

export type RuntimeStateDelta = z.infer<typeof RuntimeStateDeltaSchema>;
