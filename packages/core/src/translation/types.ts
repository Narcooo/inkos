import { ObservationSchema, type Observation } from "../models/observation.js";
import { posix } from "node:path";

export function normalizeTranslationArtifactPath(projectId: string, path: string): string {
  const normalized=posix.normalize(path.replaceAll('\\','/'));
  if(!normalized.startsWith(`works/${projectId}/source/`))throw Object.assign(new Error('Translation artifact must remain inside its Work'),{code:'TRANSLATION_MANIFEST_INVALID'});
  return normalized;
}

export function validateTranslationManifestOwnership(manifest: TranslationProjectManifest, projectId: string): TranslationProjectManifest {
  if(manifest.id!==projectId)throw Object.assign(new Error('Translation manifest belongs to another Work'),{code:'TRANSLATION_MANIFEST_INVALID'});
  const numbers=new Set<number>(),paths=new Set<string>();
  const chapters=manifest.chapters.map(chapter=>{
    const sourcePath=normalizeTranslationArtifactPath(projectId,chapter.sourcePath),translatedPath=normalizeTranslationArtifactPath(projectId,chapter.translatedPath);
    if(numbers.has(chapter.number)||paths.has(sourcePath)||paths.has(translatedPath)||sourcePath===translatedPath)throw Object.assign(new Error('Translation chapters require distinct identities and paths'),{code:'TRANSLATION_MANIFEST_INVALID'});
    numbers.add(chapter.number);paths.add(sourcePath);paths.add(translatedPath);
    return {...chapter,sourcePath,translatedPath};
  });
  return {...manifest,chapters};
}

export type TranslationSourceKind = "text" | "markdown" | "pdf" | "epub";
export type TranslationExportFormat = "txt" | "md" | "epub";

export interface CreateTranslationProjectInput {
  readonly filePath?: string;
  readonly sourceText?: string;
  readonly glossary?: ReadonlyArray<TranslationGlossaryTerm>;
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
  readonly title?: string;
  readonly segmentMaxChars?: number;
}

export interface TranslationSourceManifest {
  readonly kind: TranslationSourceKind;
  readonly path: string;
  readonly charCount: number;
  readonly totalPages?: number;
}

export interface TranslationChapterManifest {
  readonly number: number;
  readonly title: string;
  readonly sourcePath: string;
  readonly translatedPath: string;
  readonly segmentCount: number;
  readonly charCount: number;
  readonly translatedSegments: number;
  readonly reviewSummary?: string;
  readonly observations?: ReadonlyArray<Observation>;
}

export interface TranslationProjectManifest {
  readonly id: string;
  readonly title: string;
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly source: TranslationSourceManifest;
  readonly chapters: ReadonlyArray<TranslationChapterManifest>;
}

export interface TranslationSegment {
  readonly index: number;
  readonly source: string;
  readonly target?: string;
  readonly notes?: string;
}

export interface TranslationChapterFile {
  readonly number: number;
  readonly title: string;
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
  readonly segments: ReadonlyArray<TranslationSegment>;
}

export interface TranslationProjectCreateResult {
  readonly projectDir: string;
  readonly manifestPath: string;
  readonly manifest: TranslationProjectManifest;
}

export interface TranslationGlossaryTerm {
  readonly source: string;
  readonly target: string;
  readonly note?: string;
}

export const TranslationSourceManifestSchema = z.object({
  kind: z.enum(["text", "markdown", "pdf", "epub"]),
  path: z.string().min(1),
  charCount: z.number().int().nonnegative(),
  totalPages: z.number().int().positive().optional(),
}).strict();

export const TranslationChapterManifestSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1),
  sourcePath: z.string().min(1),
  translatedPath: z.string().min(1),
  segmentCount: z.number().int().nonnegative(),
  charCount: z.number().int().nonnegative(),
  translatedSegments: z.number().int().nonnegative(),
  reviewSummary: z.string().optional(),
  observations: z.array(ObservationSchema).optional(),
}).strict();

export const TranslationProjectManifestSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  sourceLanguage: z.string().min(1),
  targetLanguage: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  source: TranslationSourceManifestSchema,
  chapters: z.array(TranslationChapterManifestSchema),
}).strict();

export const TranslationSegmentSchema = z.object({
  index: z.number().int().nonnegative(),
  source: z.string(),
  target: z.string().optional(),
  notes: z.string().optional(),
}).strict();

export const TranslationChapterFileSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1),
  sourceLanguage: z.string().min(1),
  targetLanguage: z.string().min(1),
  segments: z.array(TranslationSegmentSchema),
}).strict();

export const TranslationGlossaryTermSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  note: z.string().optional(),
}).strict();

export const TranslationGlossarySchema = z.object({
  terms: z.array(TranslationGlossaryTermSchema).default([]),
}).strict();

export interface TranslationModelPort {
  readonly reviseSegment?: (input:{
    readonly sourceLanguage:string;readonly targetLanguage:string;readonly chapterTitle:string;
    readonly segment:TranslationSegment;readonly neighbors:ReadonlyArray<TranslationSegment>;
    readonly glossary:ReadonlyArray<TranslationGlossaryTerm>;readonly instruction:string;
  })=>Promise<{readonly target:string}>;
  readonly translateSegments: (input: {
    readonly sourceLanguage: string;
    readonly targetLanguage: string;
    readonly chapterTitle: string;
    readonly segments: ReadonlyArray<TranslationSegment>;
    readonly glossary: ReadonlyArray<TranslationGlossaryTerm>;
  }) => Promise<{
    readonly chapterTitle?: string;
    readonly segments: ReadonlyArray<{
      readonly index: number;
      readonly target: string;
      readonly notes?: string;
    }>;
    readonly glossary?: ReadonlyArray<TranslationGlossaryTerm>;
  }>;
  readonly reviewChapter?: (input: {
    readonly sourceLanguage: string;
    readonly targetLanguage: string;
    readonly chapterTitle: string;
    readonly segments: ReadonlyArray<TranslationSegment>;
    readonly glossary: ReadonlyArray<TranslationGlossaryTerm>;
  }) => Promise<{
    readonly summary: string;
    readonly observations: ReadonlyArray<Observation>;
  }>;
}

export interface RunTranslationProjectResult {
  readonly observations: ReadonlyArray<Observation>;
  readonly projectId: string;
  readonly translatedSegments: number;
  readonly reviewedChapters: number;
  readonly reviewSourcePaths: readonly string[];
  readonly reportPath: string;
  readonly totalSegments:number;
  readonly completedSegments:number;
  readonly pendingSegments:number;
}

export interface TranslationExportResult {
  readonly exportSourcePaths: readonly string[];
  readonly outputPath: string;
  readonly format: TranslationExportFormat;
  readonly chaptersExported: number;
}
import { z } from "zod";
