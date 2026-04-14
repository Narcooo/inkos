import { z } from "zod";
import { AutomationModeSchema, type AutomationMode } from "./modes.js";
import { ExecutionStateSchema, InteractionEventSchema, type InteractionEvent } from "./events.js";

export const PendingDecisionSchema = z.object({
  kind: z.string().min(1),
  bookId: z.string().min(1),
  chapterNumber: z.number().int().min(1).optional(),
  summary: z.string().min(1),
});

export type PendingDecision = z.infer<typeof PendingDecisionSchema>;

export const PipelineStageSchema = z.object({
  label: z.string(),
  status: z.enum(["pending", "active", "completed"]),
});

export type PipelineStage = z.infer<typeof PipelineStageSchema>;

export const ToolExecutionSchema = z.object({
  id: z.string(),
  tool: z.string(),
  agent: z.string().optional(),
  label: z.string(),
  status: z.enum(["running", "processing", "completed", "error"]),
  args: z.record(z.unknown()).optional(),
  result: z.string().optional(),
  error: z.string().optional(),
  stages: z.array(PipelineStageSchema).optional(),
  startedAt: z.number(),
  completedAt: z.number().optional(),
});

export type ToolExecution = z.infer<typeof ToolExecutionSchema>;

export const InteractionMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
  thinking: z.string().optional(),
  toolExecutions: z.array(ToolExecutionSchema).optional(),
  timestamp: z.number().int().nonnegative(),
});

export type InteractionMessage = z.infer<typeof InteractionMessageSchema>;

export const BookCreationDraftSchema = z.object({
  concept: z.string().min(1),
  title: z.string().min(1).optional(),
  genre: z.string().min(1).optional(),
  platform: z.string().min(1).optional(),
  language: z.enum(["zh", "en"]).optional(),
  targetChapters: z.number().int().min(1).optional(),
  chapterWordCount: z.number().int().min(1).optional(),
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
  nextQuestion: z.string().min(1).optional(),
  missingFields: z.array(z.string().min(1)).default([]),
  readyToCreate: z.boolean().default(false),
});

export type BookCreationDraft = z.infer<typeof BookCreationDraftSchema>;

export const DraftRoundSchema = z.object({
  roundId: z.number().int().min(1),
  userMessage: z.string(),
  assistantRaw: z.string(),
  fieldsUpdated: z.array(z.string()).default([]),
  summary: z.string().default(""),
  timestamp: z.number().int().nonnegative(),
});

export type DraftRound = z.infer<typeof DraftRoundSchema>;

export const InteractionSessionSchema = z.object({
  sessionId: z.string().min(1),
  projectRoot: z.string().min(1),
  activeBookId: z.string().min(1).optional(),
  activeChapterNumber: z.number().int().min(1).optional(),
  creationDraft: BookCreationDraftSchema.optional(),
  draftRounds: z.array(DraftRoundSchema).default([]),
  automationMode: AutomationModeSchema.default("semi"),
  messages: z.array(InteractionMessageSchema).default([]),
  events: z.array(InteractionEventSchema).default([]),
  pendingDecision: PendingDecisionSchema.optional(),
  currentExecution: ExecutionStateSchema.optional(),
});

export type InteractionSession = z.infer<typeof InteractionSessionSchema>;

// -- Per-book session --

export const BookSessionSchema = z.object({
  sessionId: z.string().min(1),
  bookId: z.string().nullable(),
  messages: z.array(InteractionMessageSchema).default([]),
  creationDraft: BookCreationDraftSchema.optional(),
  draftRounds: z.array(DraftRoundSchema).default([]),
  events: z.array(InteractionEventSchema).default([]),
  currentExecution: ExecutionStateSchema.optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type BookSession = z.infer<typeof BookSessionSchema>;

// -- Global session (simplified) --

export const GlobalSessionSchema = z.object({
  activeBookId: z.string().min(1).optional(),
  automationMode: AutomationModeSchema.default("semi"),
});

export type GlobalSession = z.infer<typeof GlobalSessionSchema>;

export function createBookSession(bookId: string | null): BookSession {
  const now = Date.now();
  return {
    sessionId: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    bookId,
    messages: [],
    draftRounds: [],
    events: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function appendBookSessionMessage(
  session: BookSession,
  message: InteractionMessage,
): BookSession {
  return {
    ...session,
    messages: [...session.messages, message].sort((a, b) => a.timestamp - b.timestamp),
    updatedAt: Date.now(),
  };
}

export function bindActiveBook(
  session: InteractionSession,
  bookId: string,
  chapterNumber?: number,
): InteractionSession {
  return {
    ...session,
    activeBookId: bookId,
    ...(chapterNumber !== undefined ? { activeChapterNumber: chapterNumber } : {}),
  };
}

export function clearPendingDecision(session: InteractionSession): InteractionSession {
  if (!session.pendingDecision) {
    return session;
  }

  return {
    ...session,
    pendingDecision: undefined,
  };
}

export function updateCreationDraft(
  session: InteractionSession,
  draft: BookCreationDraft,
): InteractionSession {
  return {
    ...session,
    creationDraft: draft,
  };
}

export function clearCreationDraft(session: InteractionSession): InteractionSession {
  if (!session.creationDraft) {
    return session;
  }

  return {
    ...session,
    creationDraft: undefined,
    draftRounds: [],
  };
}

export function updateAutomationMode(
  session: InteractionSession,
  automationMode: AutomationMode,
): InteractionSession {
  return {
    ...session,
    automationMode,
  };
}

export function appendInteractionMessage(
  session: InteractionSession,
  message: InteractionMessage,
): InteractionSession {
  return {
    ...session,
    messages: [...session.messages, message].sort((left, right) => left.timestamp - right.timestamp),
  };
}

export function appendInteractionEvent(
  session: InteractionSession,
  event: InteractionEvent,
): InteractionSession {
  return {
    ...session,
    events: [...session.events, event],
  };
}
