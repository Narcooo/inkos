import { z } from "zod";
import { AutomationModeSchema } from "./modes.js";

export const InteractionIntentTypeSchema = z.enum([
  "develop_book",
  "show_book_draft",
  "create_book",
  "discard_book_draft",
  "list_books",
  "select_book",
  "continue_book",
  "write_next",
  "pause_book",
  "resume_book",
  "revise_chapter",
  "rewrite_chapter",
  "patch_chapter_text",
  "edit_truth",
  "rename_entity",
  "update_focus",
  "update_author_intent",
  "chat",
  "explain_status",
  "explain_failure",
  "export_book",
  "switch_mode",
]);

export type InteractionIntentType = z.infer<typeof InteractionIntentTypeSchema>;

export const InteractionRequestSchema = z.object({
  intent: InteractionIntentTypeSchema,
  bookId: z.string().min(1).optional(),
  chapterNumber: z.number().int().min(1).optional(),
  title: z.string().min(1).optional(),
  genre: z.string().min(1).optional(),
  platform: z.string().min(1).optional(),
  language: z.enum(["zh", "en"]).optional(),
  chapterWordCount: z.number().int().min(1).optional(),
  targetChapters: z.number().int().min(1).optional(),
  blurb: z.string().min(1).optional(),
  worldPremise: z.string().min(1).optional(),
  settingNotes: z.string().min(1).optional(),
  protagonist: z.string().min(1).optional(),
  supportingCast: z.string().min(1).optional(),
  conflictCore: z.string().min(1).optional(),
  volumeOutline: z.string().min(1).optional(),
  constraints: z.string().min(1).optional(),
  authorIntent: z.string().min(1).optional(),
  currentFocus: z.string().min(1).optional(),
  fileName: z.string().min(1).optional(),
  format: z.enum(["txt", "md", "epub"]).optional(),
  approvedOnly: z.boolean().optional(),
  outputPath: z.string().min(1).optional(),
  oldValue: z.string().min(1).optional(),
  newValue: z.string().min(1).optional(),
  targetText: z.string().min(1).optional(),
  replacementText: z.string().min(1).optional(),
  instruction: z.string().min(1).optional(),
  mode: AutomationModeSchema.optional(),
});

export type InteractionRequest = z.infer<typeof InteractionRequestSchema>;
