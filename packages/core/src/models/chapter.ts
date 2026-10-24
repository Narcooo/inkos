import { z } from "zod";
import { LengthTelemetrySchema, LengthSpecSchema } from "./length-governance.js";
import { ObservationSchema } from "./observation.js";

export const ChapterMetaSchema = z.object({
  number: z.number().int().min(1),
  title: z.string(),
  wordCount: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  observations: z.array(ObservationSchema),
  provenance: z.enum(["generated", "imported", "edited"]),
  lengthTelemetry: LengthTelemetrySchema.optional(),
  lengthSpec: LengthSpecSchema.optional(),
  tokenUsage: z.object({
    promptTokens: z.number().int(),
    completionTokens: z.number().int(),
    totalTokens: z.number().int(),
  }).strict().optional(),
}).strict();

export type ChapterMeta = z.infer<typeof ChapterMetaSchema>;
