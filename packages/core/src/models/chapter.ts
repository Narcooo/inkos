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
  "accepted-with-findings",
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
    actualCostUsd: z.number().nonnegative().optional(),
  }).optional(),
  roleUsage: z.record(z.string(), z.object({
    promptTokens: z.number().int().default(0),
    completionTokens: z.number().int().default(0),
    totalTokens: z.number().int().default(0),
    actualCostUsd: z.number().nonnegative().optional(),
  })).optional(),
  autonomousReview: z.object({
    status: z.enum(["APPROVED", "ACCEPTED_WITH_FINDINGS", "BLOCKED_CRITICAL_FINDINGS", "HELD_AFTER_TWO_REVISIONS"]),
    grade: z.enum(["A", "B", "C", "D", "E"]),
    revisionCount: z.number().int().min(0).max(2),
  }).optional(),
});

export type ChapterMeta = z.infer<typeof ChapterMetaSchema>;
