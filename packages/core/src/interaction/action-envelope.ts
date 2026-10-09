import { z } from "zod";
import { PlayModeSchema, type PlayMode } from "./session.js";
import { PlatformSchema } from "../models/book.js";
import { StoryNodeSchema } from "../interactive-film/graph-schema.js";

export const ActionSourceSchema = z.enum(["free-text", "button", "slash", "quick-action"]);
export type ActionSource = z.infer<typeof ActionSourceSchema>;

export const SkillIdSchema = z.string()
  .trim()
  .min(1)
  .regex(/^[a-z][a-z0-9-]*$/i, "Skill id must use letters, numbers, and hyphens.");

export const RequestedIntentSchema = z.enum([
  "create_book",
  "write_next",
  "short_run",
  "play_start",
  "play_step",
  "generate_cover",
  "fanfic_init",
  "continuation_import",
  "spinoff_create",
  "style_imitation",
  "script_create",
  "storyboard_create",
  "interactive_film_create",
  "translation_create",
  "draft_structure",
  "connect_choice",
  "remove_node",
]);
export type RequestedIntent = z.infer<typeof RequestedIntentSchema>;

export const CreateBookActionPayloadSchema = z.object({
  title: z.string().min(1).optional(),
  genre: z.string().min(1).optional(),
  platform: PlatformSchema.optional(),
  language: z.enum(["zh", "en"]).optional(),
  targetChapters: z.number().int().min(1).optional(),
  chapterWordCount: z.number().int().min(1).optional(),
  minChapterLength:z.number().int().min(1).optional(),
  maxChapterLength:z.number().int().min(1).optional(),
}).strict();

export const WriteNextActionPayloadSchema = z.object({
  chapterCount: z.number().int().min(1).default(1),
}).strict();

export const ShortRunActionPayloadSchema = z.object({
  maxChapterLength:z.number().int().positive().optional(),
  minChapterLength:z.number().int().positive().optional(),
  openingHookChars:z.number().int().positive().optional(),
  minChapterLengthRatio:z.number().positive().max(1).optional(),
  title: z.string().min(1).optional(),
  direction: z.string().min(1).optional(),
  reference: z.string().min(1).optional(),
  storyId: z.string().min(1).optional(),
  language: z.enum(["zh", "en"]).optional(),
  chapters: z.number().int().min(1).optional(),
  charsPerChapter: z.number().int().min(1).optional(),
  cover: z.boolean().optional(),
}).strict();

export const PlayStartActionPayloadSchema = z.object({
  choiceCount:z.number().int().positive().optional(),
  title: z.string().min(1).optional(),
  premise: z.string().min(1).optional(),
  worldContract: z.string().min(1).optional(),
  visualContract: z.string().min(1).optional(),
  language: z.enum(["zh", "en"]).optional(),
  mode: PlayModeSchema.optional(),
  initialScene: z.string().min(1).optional(),
  suggestedActions: z.array(z.string().min(1)).optional(),
}).strict();

export const GenerateCoverActionPayloadSchema = z.object({
  title: z.string().min(1).optional(),
  intro: z.string().min(1).optional(),
  sellingPoints: z.array(z.string().min(1)).optional(),
  coverPrompt: z.string().min(1).optional(),
  outputDir: z.string().min(1).optional(),
}).strict();

export const ScriptTargetFormatSchema = z.string().trim().min(1);

export const ScriptCreateActionPayloadSchema = z.object({
  title: z.string().min(1).optional(),
  sourceKind: z.string().min(1).optional(),
  targetFormat: ScriptTargetFormatSchema.optional(),
  sourceText: z.string().min(1).optional(),
  sourcePath: z.string().min(1).optional(),
  requirements: z.string().min(1).optional(),
  episodeCount: z.number().int().min(1).optional(),
  episodeDuration: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
}).strict();

export const StoryboardCreateActionPayloadSchema = z.object({
  title: z.string().min(1).optional(),
  sourceKind: z.string().min(1).optional(),
  sourceText: z.string().min(1).optional(),
  sourcePath: z.string().min(1).optional(),
  requirements: z.string().min(1).optional(),
  visualStyle: z.string().min(1).optional(),
  aspectRatio: z.string().min(1).optional(),
  granularity: z.string().min(1).optional(),
  maxShots: z.number().int().min(1).optional(),
  projectId: z.string().min(1).optional(),
}).strict();

export const InteractiveFilmCreateActionPayloadSchema = z.object({
  title: z.string().min(1).optional(),
  sourceKind: z.string().min(1).optional(),
  sourceText: z.string().min(1).optional(),
  sourcePath: z.string().min(1).optional(),
  requirements: z.string().min(1).optional(),
  targetAudience: z.string().min(1).optional(),
  episodeCount: z.number().int().min(1).optional(),
  episodeDuration: z.string().min(1).optional(),
  budget: z.string().min(1).optional(),
  referenceMode: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
}).strict();

export const TranslationCreateActionPayloadSchema = z.object({
  sourceText: z.string().min(1).optional(),
  glossary: z.array(z.object({ source: z.string(), target: z.string(), note: z.string().optional() })).optional(),
  filePath: z.string().min(1).optional(),
  sourceLanguage: z.string().min(1).optional(),
  targetLanguage: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  segmentMaxChars: z.number().int().min(1).optional(),
}).strict();

const CreationSourceReferenceSchema = z.object({workId:z.string().min(1),artifactId:z.string().min(1),revisionId:z.string().min(1).optional()}).strict();

export const FanficCreateActionPayloadSchema = z.object({
  source: CreationSourceReferenceSchema.optional(),
  sources: z.array(CreationSourceReferenceSchema).min(1).optional(),
  title: z.string().min(1).optional(),
  sourceText: z.string().min(1).optional(),
  sourcePath: z.string().min(1).optional(),
  sourceName: z.string().min(1).optional(),
  mode: z.string().trim().min(1).optional(),
  genre: z.string().min(1).optional(),
  platform: PlatformSchema.optional(),
  language: z.enum(["zh", "en"]).optional(),
  targetChapters: z.number().int().min(1).optional(),
  chapterWordCount: z.number().int().min(1).optional(),
  minChapterLength:z.number().int().min(1).optional(),
  maxChapterLength:z.number().int().min(1).optional(),
}).strict().refine(
  (payload) => Boolean(payload.source || payload.sources?.length || payload.sourceText?.trim() || payload.sourcePath?.trim()),
  { message: "fanficCreate requires source, sources, sourceText or sourcePath" },
);

export const ContinuationImportActionPayloadSchema = z.object({
  instruction: z.string().min(1).optional(),
  bookId: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  sourcePath: z.string().min(1).optional(),
  splitPattern: z.string().min(1).optional(),
  resumeFrom: z.number().int().min(1).optional(),
  genre: z.string().min(1).optional(),
  platform: PlatformSchema.optional(),
  language: z.enum(["zh", "en"]).optional(),
  targetChapters: z.number().int().min(1).optional(),
  chapterWordCount: z.number().int().min(1).optional(),
  minChapterLength:z.number().int().min(1).optional(),
  maxChapterLength:z.number().int().min(1).optional(),
}).strict();

export const SpinoffCreateActionPayloadSchema = z.object({
  source: CreationSourceReferenceSchema.optional(),
  sources: z.array(CreationSourceReferenceSchema).min(1).optional(),
  title: z.string().min(1).optional(),
  parentBookId: z.string().min(1).optional(),
  direction: z.string().min(1).optional(),
  genre: z.string().min(1).optional(),
  platform: PlatformSchema.optional(),
  language: z.enum(["zh", "en"]).optional(),
  targetChapters: z.number().int().min(1).optional(),
  chapterWordCount: z.number().int().min(1).optional(),
  minChapterLength:z.number().int().min(1).optional(),
  maxChapterLength:z.number().int().min(1).optional(),
}).strict();

export const ImitationCreateActionPayloadSchema = z.object({
  source: CreationSourceReferenceSchema.optional(),
  sources: z.array(CreationSourceReferenceSchema).min(1).optional(),
  title: z.string().min(1).optional(),
  referenceText: z.string().min(1).optional(),
  referencePath: z.string().min(1).optional(),
  storyIdea: z.string().min(1).optional(),
  sourceName: z.string().min(1).optional(),
  genre: z.string().min(1).optional(),
  platform: PlatformSchema.optional(),
  language: z.enum(["zh", "en"]).optional(),
  targetChapters: z.number().int().min(1).optional(),
  chapterWordCount: z.number().int().min(1).optional(),
  minChapterLength:z.number().int().min(1).optional(),
  maxChapterLength:z.number().int().min(1).optional(),
}).strict().refine(
  (payload) => Boolean(payload.source || payload.sources?.length || payload.referenceText?.trim() || payload.referencePath?.trim()),
  { message: "imitationCreate requires source, sources, referenceText or referencePath" },
);

export const ActionPayloadSchema = z.object({
  createBook: CreateBookActionPayloadSchema.optional(),
  writeNext: WriteNextActionPayloadSchema.optional(),
  shortRun: ShortRunActionPayloadSchema.optional(),
  playStart: PlayStartActionPayloadSchema.optional(),
  generateCover: GenerateCoverActionPayloadSchema.optional(),
  scriptCreate: ScriptCreateActionPayloadSchema.optional(),
  storyboardCreate: StoryboardCreateActionPayloadSchema.optional(),
  interactiveFilmCreate: InteractiveFilmCreateActionPayloadSchema.optional(),
  translationCreate: TranslationCreateActionPayloadSchema.optional(),
  fanficCreate: FanficCreateActionPayloadSchema.optional(),
  continuationImport: ContinuationImportActionPayloadSchema.optional(),
  spinoffCreate: SpinoffCreateActionPayloadSchema.optional(),
  imitationCreate: ImitationCreateActionPayloadSchema.optional(),
  draftStructure: z.object({
    projectId: z.string().min(1).optional(),
    instruction: z.string().default(""),
  }).strict().optional(),
  connectChoice: z.object({
    projectId: z.string().min(1).optional(),
    node: StoryNodeSchema,
  }).strict().optional(),
  removeNode: z.object({
    projectId: z.string().min(1).optional(),
    nodeId: z.string().min(1),
  }).strict().optional(),
}).strict();

export type ActionPayload = z.infer<typeof ActionPayloadSchema>;

export function normalizeSkillIdList(value: unknown): string[] {
  if (value === undefined || value === null || value === "") return [];
  const values = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of values) {
    const parsed = SkillIdSchema.parse(item).toLowerCase();
    if (seen.has(parsed)) continue;
    seen.add(parsed);
    out.push(parsed);
  }
  return out;
}

export function normalizeActionSource(value: unknown): ActionSource {
  if (value === undefined || value === null || value === "") return "free-text";
  return ActionSourceSchema.parse(value);
}

export function normalizeRequestedIntent(value: unknown): RequestedIntent | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return RequestedIntentSchema.parse(value);
}

export function normalizeActionPayload(value: unknown): ActionPayload | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return ActionPayloadSchema.parse(value);
}

export function normalizePlayMode(value: unknown): PlayMode | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return PlayModeSchema.parse(value);
}
