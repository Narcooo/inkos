import { WritingLanguageSchema } from "../models/book.js";
import { z } from "zod";

// Narrative Forecast (issue #342): non-canonical multi-branch story projection.
// A forecast never becomes canon by itself — it is planning material stored
// under story/runtime/narrative-forecasts/ and compared by the author.

export const FORECAST_DEFAULT_BRANCHES = 3;
export const FORECAST_DEFAULT_HORIZON = 5;

export const ForecastRiskSchema = z.object({
  kind: z.string().min(1),
  description: z.string().min(1),
});
export type ForecastRisk = z.infer<typeof ForecastRiskSchema>;

export const ForecastBeatSchema = z.object({
  // Absolute chapter number the beat targets (baseChapter + offset).
  chapter: z.number().int().min(1),
  summary: z.string().min(1),
});
export type ForecastBeat = z.infer<typeof ForecastBeatSchema>;

export const ForecastCharacterDecisionSchema = z.object({
  character: z.string().min(1),
  decision: z.string().min(1),
});
export type ForecastCharacterDecision = z.infer<typeof ForecastCharacterDecisionSchema>;

export const ForecastProjectedChangesSchema = z.object({
  characters: z.array(z.string()),
  relationships: z.array(z.string()),
  world: z.array(z.string()),
  hooks: z.array(z.string()),
});
export type ForecastProjectedChanges = z.infer<typeof ForecastProjectedChangesSchema>;

export const ForecastBranchSchema = z.object({
  branchId: z.string().regex(/^branch-\d+$/),
  title: z.string().min(1),
  premise: z.string().min(1),
  beats: z.array(ForecastBeatSchema).min(1),
  characterDecisions: z.array(ForecastCharacterDecisionSchema),
  projectedChanges: ForecastProjectedChangesSchema,
  risks: z.array(ForecastRiskSchema),
  uncertainties: z.array(z.string()),
  intentRationale: z.string().min(1),
});
export type ForecastBranch = z.infer<typeof ForecastBranchSchema>;

export const ForecastStatusSchema = z.enum(["active", "stale"]);
export type ForecastStatus = z.infer<typeof ForecastStatusSchema>;

export const NarrativeForecastSchema = z.object({
  version: z.literal(1),
  forecastId: z.string().min(1),
  bookId: z.string().min(1),
  createdAt: z.string().min(1),
  language: WritingLanguageSchema,
  divergence: z.string().min(1),
  horizon: z.number().int().positive(),
  baseChapter: z.number().int().min(0),
  contextFingerprint: z.string().min(1),
  status: ForecastStatusSchema,
  branches: z.array(ForecastBranchSchema).min(1),
}).superRefine((forecast, ctx) => {
  const seen = new Set<string>();
  for (const branch of forecast.branches) {
    if (seen.has(branch.branchId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate branchId: ${branch.branchId}`,
        path: ["branches"],
      });
    }
    seen.add(branch.branchId);
  }
});
export type NarrativeForecast = z.infer<typeof NarrativeForecastSchema>;

// What the model must return. branchIds are assigned deterministically by the
// runner (branch-1..branch-N) so the model cannot collide or skip ids.
export const ForecastModelBranchSchema = ForecastBranchSchema.omit({ branchId: true });
export type ForecastModelBranch = z.infer<typeof ForecastModelBranchSchema>;

export const ForecastModelOutputSchema = z.object({
  branches: z.array(ForecastModelBranchSchema).min(1),
});
export type ForecastModelOutput = z.infer<typeof ForecastModelOutputSchema>;
