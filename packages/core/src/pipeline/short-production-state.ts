import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ObservationSchema } from "../models/observation.js";
import { safeChildPath } from "../utils/path-safety.js";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";

export const ShortStageSchema = z.object({
  status: z.enum(["completed", "failed"]),
  inputHash: z.string(),
  requestHash: z.string().optional(),
  reviewHash:z.string().optional(),
  reviewedArtifact:z.object({artifactId:z.string(),revisionId:z.string()}).strict().optional(),
  comparison: z.object({
    scope: z.enum(["episode_start", "parent_revision"]),
    before: z.object({artifactId:z.string(),revisionId:z.string(),checksum:z.string()}).strict(),
    after: z.object({artifactId:z.string(),revisionId:z.string(),checksum:z.string()}).strict(),
  }).strict().optional(),
  updatedAt: z.string(),
  observations: z.array(ObservationSchema),
  error: z.string().optional(),
}).strict();
export const ShortProductionStateSchema = z.object({
  version: z.literal(2),
  intent: z.string(),
  target: z.object({
    title:z.string().min(1).optional(),
    chapterCount:z.number().int().positive(),
    charsPerChapter:z.number().int().positive(),
    minChapterLength:z.number().int().positive().optional(),
    maxChapterLength:z.number().int().positive().optional(),
    openingHookChars:z.number().int().positive().optional(),
    coverRequired:z.boolean().optional(),
    language:z.enum(["zh","en"]),
  }).optional(),
  revisionRequest: z.string().optional(),
  reviewScope: z.string().optional(),
  delivery: z.object({
    status:z.enum(['checks_passed','needs_revision','unverified']),inputHash:z.string(),observations:z.array(ObservationSchema),
    measurements:z.object({
      title:z.string(),chapterCount:z.number().int().nonnegative(),totalLength:z.number().int().nonnegative(),
      unit:z.enum(["non-whitespace-characters","words"]),openingHookLength:z.number().int().nonnegative(),
      chapterLengths:z.array(z.object({number:z.number().int().positive(),length:z.number().int().nonnegative()})),
    }).optional(),
    target:z.record(z.unknown()).optional(),
  }).strict().optional(),
  stages: z.object({
    review: ShortStageSchema.optional(),
    package: ShortStageSchema.optional(),
    cover: ShortStageSchema.optional(),
  }).strict(),
}).strict();
export type ShortProductionState = z.infer<typeof ShortProductionStateSchema>;
export type ShortStage = z.infer<typeof ShortStageSchema>;
export function shortInputHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export async function readShortProductionState(root: string, baseDir: string): Promise<ShortProductionState | undefined> {
  try {
    return ShortProductionStateSchema.parse(JSON.parse(await readFile(safeChildPath(root, join(baseDir, "production-state.json")), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
export async function writeShortProductionState(root: string, baseDir: string, state: ShortProductionState): Promise<void> {
  await commitAtomicFileSet({ rootDir: root, writes: [{
    relativePath: join(baseDir, "production-state.json"),
    content: `${JSON.stringify(ShortProductionStateSchema.parse(state), null, 2)}\n`,
  }] });
}
