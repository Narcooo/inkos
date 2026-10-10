import { z } from "zod";
import { ObservationSchema } from "../models/observation.js";
import type { Observation } from "../models/observation.js";

export const HARNESS_VERSION = 2 as const;

export const HarnessIdSchema = z.string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/i, "ID must be filesystem-safe");

const UNSAFE_RESOURCE_ID_RE = /[\u0000-\u001f\u007f/\\:*?"'`{}<>|]/u;

export const WorkResourceIdSchema = z.string()
  .min(1)
  .max(120)
  .refine((value) => value.trim() === value, "Resource ID must not have surrounding whitespace")
  .refine((value) => value !== "." && value !== ".." && !value.includes(".."), "Resource ID cannot traverse directories")
  .refine((value) => !UNSAFE_RESOURCE_ID_RE.test(value), "Resource ID contains unsafe path characters");

export const RelativeArtifactPathSchema = z.string()
  .min(1)
  .refine((value) => (
    !value.startsWith("/")
    && !value.startsWith("\\")
    && !/^[a-z]:[\\/]/i.test(value)
    && !value.split(/[\\/]+/).includes("..")
  ), "Artifact paths must stay inside the work directory");

export const WorkLineageSchema = z.object({
  relation: HarnessIdSchema,
  sourceWorkId: WorkResourceIdSchema,
  sourceArtifactId: WorkResourceIdSchema.optional(),
  sourceRevisionId: HarnessIdSchema.optional(),
}).strict();
export type WorkLineage = z.infer<typeof WorkLineageSchema>;

export const ArtifactRevisionStatusSchema = z.enum(["candidate", "current", "superseded"]);
export type ArtifactRevisionStatus = z.infer<typeof ArtifactRevisionStatusSchema>;

export const ArtifactRevisionSchema = z.object({
  id: HarnessIdSchema,
  parentRevisionId: HarnessIdSchema.nullable(),
  path: RelativeArtifactPathSchema,
  snapshotPath: RelativeArtifactPathSchema.optional(),
  contentType: z.string().min(1),
  status: ArtifactRevisionStatusSchema,
  checksum: z.string().min(1),
  byteLength: z.number().int().nonnegative(),
  episodeId: HarnessIdSchema.optional(),
  createdAt: z.string().min(1),
}).strict();
export type ArtifactRevision = z.infer<typeof ArtifactRevisionSchema>;

export const ArtifactManifestSchema = z.object({
  id: WorkResourceIdSchema,
  kind: HarnessIdSchema,
  currentRevisionId: HarnessIdSchema.nullable(),
  revisions: z.array(ArtifactRevisionSchema),
  metadata: z.record(z.string(), z.unknown()),
}).strict().superRefine((artifact, context) => {
  const revisionIds = new Set(artifact.revisions.map((revision) => revision.id));
  if (artifact.currentRevisionId !== null && !revisionIds.has(artifact.currentRevisionId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["currentRevisionId"],
      message: "currentRevisionId must reference a known revision",
    });
  }
  const currentRevisions = artifact.revisions.filter((revision) => revision.status === "current");
  if (currentRevisions.length > 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["revisions"],
      message: "An artifact can have only one current revision",
    });
  }
  if (artifact.currentRevisionId === null && currentRevisions.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["currentRevisionId"],
      message: "currentRevisionId is required when a revision is current",
    });
  }
  if (artifact.currentRevisionId !== null && currentRevisions[0]?.id !== artifact.currentRevisionId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["currentRevisionId"],
      message: "currentRevisionId must identify the revision whose status is current",
    });
  }
});
export type ArtifactManifest = z.infer<typeof ArtifactManifestSchema>;

export const WorkManifestSchema = z.object({
  version: z.literal(HARNESS_VERSION),
  id: WorkResourceIdSchema,
  title: z.string().min(1),
  profileId: HarnessIdSchema,
  language: z.string().min(1),
  status: z.enum(["draft", "active", "archived"]),
  lineage: z.array(WorkLineageSchema),
  artifacts: z.array(ArtifactManifestSchema),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict();
export type WorkManifest = z.infer<typeof WorkManifestSchema>;

export const ConfirmationPolicySchema = z.object({
  inferredMutation: z.enum(["execute", "confirm"]),
  explicitRecoverableMutation: z.enum(["execute", "confirm"]),
  destructiveMutation: z.literal("confirm"),
}).strict();
export type ConfirmationPolicy = z.infer<typeof ConfirmationPolicySchema>;

export const WorkProfileSchema = z.object({
  version: z.literal(HARNESS_VERSION),
  id: HarnessIdSchema,
  title: z.string().min(1),
  description: z.string(),
  capabilityIds: z.array(HarnessIdSchema).min(1),
  requiredSkillIds: z.array(HarnessIdSchema),
  recommendedSkillIds: z.array(HarnessIdSchema),
  artifactKinds: z.array(HarnessIdSchema),
  confirmation: ConfirmationPolicySchema,
  contextRecipe: z.object({ id: HarnessIdSchema, sourceIds: z.array(HarnessIdSchema) }).optional(),
  artifactSchemas: z.record(z.string(), z.enum(["text", "json", "short-manuscript", "short-package", "translation-manifest", "translation-glossary", "translation-chapter", "story-graph"])).default({}),
  qualityCriteria: z.array(z.string()).default([]),
  production: z.object({ maxChaptersPerCall: z.number().int().positive().optional(), minChapterLengthRatio: z.number().positive().max(1).optional() }).default({}),
}).strict();
export type WorkProfile = z.infer<typeof WorkProfileSchema>;

export const ActionRiskSchema = z.enum(["read", "recoverable-write", "destructive-write"]);
export type ActionRisk = z.infer<typeof ActionRiskSchema>;

export const ActionArtifactRefSchema = z.object({
  workId: WorkResourceIdSchema,
  artifactId: WorkResourceIdSchema,
  revisionId: HarnessIdSchema.optional(),
  path: RelativeArtifactPathSchema.optional(),
}).strict();
export type ActionArtifactRef = z.infer<typeof ActionArtifactRefSchema>;

export const OperationReceiptSchema = z.object({
  operation: z.enum(["review", "export"]),
  sources: z.array(ActionArtifactRefSchema.extend({revisionId: HarnessIdSchema})).min(1),
}).strict();
export type OperationReceipt = z.infer<typeof OperationReceiptSchema>;

export const DeliveryTargetSchema=ActionArtifactRefSchema.omit({path:true}).extend({version:z.enum(['current','fixed']).default('current')});
export const DeliveryRequirementSchema=z.object({
  id:z.string().min(1),operation:z.enum(['review','export']),sourceQuote:z.string().trim().min(1),
  targets:z.array(DeliveryTargetSchema).default([]),
}).strict();
export const RequestDeliveryStateSchema=z.object({
  version:z.literal(1),authorRequest:z.string(),declared:z.boolean(),
  // Historical provenance only; completion does not classify creation to gate quality opinions.
  newContentQuote:z.string().nullable().optional(),
  steps:z.array(DeliveryRequirementSchema),receipts:z.array(OperationReceiptSchema),
}).strict();
export type RequestDeliveryState=z.infer<typeof RequestDeliveryStateSchema>;

export const ActionObservationSchema = ObservationSchema;
export type ActionObservation = Observation;

export const ActionResultSchema = z.object({
  status: z.literal("success"),
  summary: z.string().min(1),
  content: z.string().optional(),
  artifacts: z.array(ActionArtifactRefSchema),
  observations: z.array(ActionObservationSchema),
  operationReceipts: z.array(OperationReceiptSchema).optional(),
  data: z.unknown().optional(),
}).strict();
export type ActionResult = z.infer<typeof ActionResultSchema>;

export const EpisodeStatusSchema = z.enum(["running", "completed", "failed", "cancelled"]);
export type EpisodeStatus = z.infer<typeof EpisodeStatusSchema>;

export const CreativeEpisodeSchema = z.object({
  version: z.literal(HARNESS_VERSION),
  id: HarnessIdSchema,
  workId: WorkResourceIdSchema.nullable(),
  profileId: HarnessIdSchema.nullable(),
  status: EpisodeStatusSchema,
  startedAt: z.string().min(1),
  completedAt: z.string().min(1).nullable(),
}).strict();
export type CreativeEpisode = z.infer<typeof CreativeEpisodeSchema>;

export const CreativeEpisodeEventSchema = z.object({
  version: z.literal(HARNESS_VERSION),
  episodeId: HarnessIdSchema,
  seq: z.number().int().nonnegative(),
  timestamp: z.string().min(1),
  type: HarnessIdSchema,
  workId: WorkResourceIdSchema.nullable(),
  capabilityId: HarnessIdSchema.optional(),
  actionId: HarnessIdSchema.optional(),
  payload: z.record(z.string(), z.unknown()),
}).strict();
export type CreativeEpisodeEvent = z.infer<typeof CreativeEpisodeEventSchema>;
