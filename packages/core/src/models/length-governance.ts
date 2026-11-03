import { z } from "zod";

export const LengthCountingModeSchema = z.enum(["zh_chars", "en_words", "ru_words"]);
export type LengthCountingMode = z.infer<typeof LengthCountingModeSchema>;

export const LengthSpecSchema = z.object({
  target: z.number().int().min(1),
  countingMode: LengthCountingModeSchema,
  minChapterLength: z.number().int().min(1).optional(),
  maxChapterLength: z.number().int().min(1).optional(),
}).strict();

export type LengthSpec = z.infer<typeof LengthSpecSchema>;

export const LengthTelemetrySchema = z.object({
  target: z.number().int().min(1),
  countingMode: LengthCountingModeSchema,
  writerCount: z.number().int().min(0),
  postReviseCount: z.number().int().min(0),
  finalCount: z.number().int().min(0),
  repairApplied: z.boolean(),
}).strict();

export type LengthTelemetry = z.infer<typeof LengthTelemetrySchema>;
