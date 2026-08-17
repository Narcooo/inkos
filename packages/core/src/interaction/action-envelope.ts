import { z } from "zod";
import { PlayModeSchema, type PlayMode } from "./session.js";
import { StoryNodeSchema } from "../interactive-film/graph-schema.js";
import {
  SHORT_FICTION_EN_MAX_WORDS_PER_CHAPTER,
  SHORT_FICTION_EN_MIN_WORDS_PER_CHAPTER,
  SHORT_FICTION_MAX_CHARS_PER_CHAPTER,
  SHORT_FICTION_MIN_CHARS_PER_CHAPTER,
} from "../agents/short-fiction.js";

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
  "edit_artifact",
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
  platform: z.enum(["tomato", "qidian", "feilu", "other"]).optional(),
  language: z.enum(["zh", "en"]).optional(),
  targetChapters: z.number().int().min(1).optional(),
  chapterWordCount: z.number().int().min(1).optional(),
}).strict();

export const WriteNextActionPayloadSchema = z.object({
  chapterCount: z.number().int().min(1).max(20).default(1),
}).strict();

// charsPerChapter 的单位随语言变化：zh 是每章汉字数（900-1200），en 是每章英文单词数（600-800）。
// 这两个区间与 short-fiction-runner 的执行层校验共用同一组常量，保证确认卡和执行层不再各说各话。
export function shortRunCharsPerChapterRange(language: "zh" | "en"): {
  readonly min: number;
  readonly max: number;
} {
  return language === "en"
    ? { min: SHORT_FICTION_EN_MIN_WORDS_PER_CHAPTER, max: SHORT_FICTION_EN_MAX_WORDS_PER_CHAPTER }
    : { min: SHORT_FICTION_MIN_CHARS_PER_CHAPTER, max: SHORT_FICTION_MAX_CHARS_PER_CHAPTER };
}

export function shortRunCharsPerChapterError(value: number, language: "zh" | "en"): string {
  const { min, max } = shortRunCharsPerChapterRange(language);
  return language === "en"
    ? `charsPerChapter=${value} 超出英文短篇的合法范围（每章 ${min}-${max} 个英文单词）。`
      + `charsPerChapter=${value} is outside the valid range for English shorts (${min}-${max} words per chapter).`
    : `charsPerChapter=${value} 超出中文短篇的合法范围（每章 ${min}-${max} 个汉字）。`
      + `charsPerChapter=${value} is outside the valid range for Chinese shorts (${min}-${max} characters per chapter).`;
}

// language 与 charsPerChapter 同时存在时按语言分段校验，让非法组合（如 en+1100）
// 在确认卡阶段就被拒绝，而不是任务开跑后才在 runner 里抛错；language 缺省时维持
// 600-1200 并集（此时最终语言由会话默认决定，envelope 层无法预知）。
export const ShortRunActionPayloadSchema = z.object({
  title: z.string().min(1).optional(),
  direction: z.string().min(1).optional(),
  reference: z.string().min(1).optional(),
  storyId: z.string().min(1).optional(),
  language: z.enum(["zh", "en"]).optional(),
  chapters: z.number().int().min(12).max(18).optional(),
  charsPerChapter: z.number().int().min(600).max(1200).optional(),
  cover: z.boolean().optional(),
}).strict().superRefine((payload, ctx) => {
  if (payload.language === undefined || payload.charsPerChapter === undefined) return;
  const { min, max } = shortRunCharsPerChapterRange(payload.language);
  if (payload.charsPerChapter >= min && payload.charsPerChapter <= max) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["charsPerChapter"],
    message: shortRunCharsPerChapterError(payload.charsPerChapter, payload.language),
  });
});

export const PlayStartActionPayloadSchema = z.object({
  title: z.string().min(1).optional(),
  premise: z.string().min(1).optional(),
  worldContract: z.string().min(1).optional(),
  visualContract: z.string().min(1).optional(),
  mode: PlayModeSchema.optional(),
  initialScene: z.string().min(1).optional(),
  suggestedActions: z.array(z.string().min(1)).min(1).max(4).optional(),
}).strict();

export const GenerateCoverActionPayloadSchema = z.object({
  title: z.string().min(1).optional(),
  intro: z.string().min(1).optional(),
  sellingPoints: z.string().min(1).optional(),
  coverPrompt: z.string().min(1).optional(),
  outputDir: z.string().min(1).optional(),
}).strict();

export const ScriptTargetFormatSchema = z.enum([
  "vertical_short_drama",
  "screenplay",
  "audio_drama",
  "interactive_script",
  "general_script",
]);

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
  outDir: z.string().min(1).optional(),
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
  outDir: z.string().min(1).optional(),
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
  outDir: z.string().min(1).optional(),
}).strict();

export const TranslationCreateActionPayloadSchema = z.object({
  filePath: z.string().min(1).optional(),
  sourceLanguage: z.string().min(1).optional(),
  targetLanguage: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  segmentMaxChars: z.number().int().min(1).optional(),
}).strict();

export const FanficCreateActionPayloadSchema = z.object({
  title: z.string().min(1).optional(),
  sourceText: z.string().min(1).optional(),
  sourcePath: z.string().min(1).optional(),
  sourceName: z.string().min(1).optional(),
  mode: z.enum(["canon", "au", "ooc", "cp"]).optional(),
  genre: z.string().min(1).optional(),
  platform: z.enum(["tomato", "qidian", "feilu", "other"]).optional(),
  language: z.enum(["zh", "en"]).optional(),
  targetChapters: z.number().int().min(1).optional(),
  chapterWordCount: z.number().int().min(1).optional(),
}).strict().refine(
  (payload) => Boolean(payload.sourceText?.trim() || payload.sourcePath?.trim()),
  { message: "fanficCreate requires sourceText or sourcePath" },
);

export const ContinuationImportActionPayloadSchema = z.object({
  bookId: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  sourcePath: z.string().min(1).optional(),
  splitPattern: z.string().min(1).optional(),
  resumeFrom: z.number().int().min(1).optional(),
  genre: z.string().min(1).optional(),
  platform: z.enum(["tomato", "qidian", "feilu", "other"]).optional(),
  language: z.enum(["zh", "en"]).optional(),
  targetChapters: z.number().int().min(1).optional(),
  chapterWordCount: z.number().int().min(1).optional(),
}).strict();

export const SpinoffCreateActionPayloadSchema = z.object({
  title: z.string().min(1).optional(),
  parentBookId: z.string().min(1).optional(),
  direction: z.string().min(1).optional(),
  genre: z.string().min(1).optional(),
  platform: z.enum(["tomato", "qidian", "feilu", "other"]).optional(),
  language: z.enum(["zh", "en"]).optional(),
  targetChapters: z.number().int().min(1).optional(),
  chapterWordCount: z.number().int().min(1).optional(),
}).strict();

export const ImitationCreateActionPayloadSchema = z.object({
  title: z.string().min(1).optional(),
  referenceText: z.string().min(1).optional(),
  referencePath: z.string().min(1).optional(),
  storyIdea: z.string().min(1).optional(),
  sourceName: z.string().min(1).optional(),
  genre: z.string().min(1).optional(),
  platform: z.enum(["tomato", "qidian", "feilu", "other"]).optional(),
  language: z.enum(["zh", "en"]).optional(),
  targetChapters: z.number().int().min(1).optional(),
  chapterWordCount: z.number().int().min(1).optional(),
}).strict().refine(
  (payload) => Boolean(payload.referenceText?.trim() || payload.referencePath?.trim()),
  { message: "imitationCreate requires referenceText or referencePath" },
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
  }).optional(),
  connectChoice: z.object({
    projectId: z.string().min(1).optional(),
    node: StoryNodeSchema,
  }).optional(),
  removeNode: z.object({
    projectId: z.string().min(1).optional(),
    nodeId: z.string().min(1),
  }).optional(),
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
