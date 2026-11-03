import { z } from "zod";

export const WritingLanguageSchema = z.enum(["zh", "en", "ru"]);
export type WritingLanguage = z.infer<typeof WritingLanguageSchema>;

export const PlatformSchema = z.string().trim().min(1);
export type Platform = z.infer<typeof PlatformSchema>;

export const GenreSchema = z.string().min(1);
export type Genre = z.infer<typeof GenreSchema>;

export const BookStatusSchema = z.enum([
  "incubating",
  "outlining",
  "active",
  "paused",
  "completed",
  "dropped",
]);
export type BookStatus = z.infer<typeof BookStatusSchema>;

export const FanficModeSchema = z.string().trim().min(1);
export type FanficMode = z.infer<typeof FanficModeSchema>;

export const BookConfigSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  platform: PlatformSchema,
  genre: GenreSchema,
  status: BookStatusSchema,
  targetChapters: z.number().int().min(1),
  chapterWordCount: z.number().int().min(1),
  minChapterLength: z.number().int().min(1).optional(),
  maxChapterLength: z.number().int().min(1).optional(),
  language: WritingLanguageSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  parentBookId: z.string().optional(),
  fanficMode: FanficModeSchema.optional(),
}).strict();

export type BookConfig = z.infer<typeof BookConfigSchema>;
