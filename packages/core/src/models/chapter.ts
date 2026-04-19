import { z } from "zod";
import { LengthTelemetrySchema } from "./length-governance.js";

export const ChapterStatusSchema = z.enum([
  "card-generated",
  "drafting",
  "drafted",
  "auditing",
  "audit-passed",
  "audit-failed",
  "state-degraded",
  "revising",
  "ready-for-review",
  "approved",
  "rejected",
  "published",
  "imported",
]);
export type ChapterStatus = z.infer<typeof ChapterStatusSchema>;

export const ChapterMetaSchema = z.object({
  number: z.number().int().min(1),
  title: z.string(),
  status: ChapterStatusSchema,
  wordCount: z.number().int().default(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  auditIssues: z.array(z.string()).default([]),
  lengthWarnings: z.array(z.string()).default([]),
  reviewNote: z.string().optional(),
  detectionScore: z.number().min(0).max(1).optional(),
  detectionProvider: z.string().optional(),
  detectedAt: z.string().datetime().optional(),
  lengthTelemetry: LengthTelemetrySchema.optional(),
  tokenUsage: z.object({
    promptTokens: z.number().int().default(0),
    completionTokens: z.number().int().default(0),
    totalTokens: z.number().int().default(0),
  }).optional(),
});

export type ChapterMeta = z.infer<typeof ChapterMetaSchema>;
