import { z } from "zod";
import { PlayModeSchema, SessionKindSchema, type PlayMode, type SessionKind } from "./session.js";
import {RequestDeliveryStateSchema} from '../harness/contracts.js';
export type { SessionKind };
export type { PlayMode };

export const TranscriptRoleSchema = z.enum(["user", "assistant", "toolResult", "system"]);
export type TranscriptRole = z.infer<typeof TranscriptRoleSchema>;

const BaseEventSchema = z.object({
  version: z.literal(1),
  sessionId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  timestamp: z.number().int().nonnegative(),
}).strict();

export const SessionCreatedEventSchema = BaseEventSchema.extend({
  type: z.literal("session_created"),
  bookId: z.string().nullable(),
  sessionKind: SessionKindSchema.optional(),
  profileId: z.string().min(1).optional(),
  workId: z.string().min(1).nullable().optional(),
  proposalAction: z.string().min(1).optional(),
  playMode: PlayModeSchema.optional(),
  modelOverride: z.string().min(1).optional(),
  serviceOverride: z.string().min(1).optional(),
  title: z.string().nullable().default(null),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const SessionMetadataUpdatedEventSchema = BaseEventSchema.extend({
  type: z.literal("session_metadata_updated"),
  bookId: z.string().nullable().optional(),
  sessionKind: SessionKindSchema.optional(),
  profileId: z.string().min(1).optional(),
  workId: z.string().min(1).nullable().optional(),
  proposalAction: z.string().min(1).optional(),
  playMode: PlayModeSchema.optional(),
  modelOverride: z.string().min(1).optional(),
  serviceOverride: z.string().min(1).optional(),
  title: z.string().nullable().optional(),
  updatedAt: z.number().int().nonnegative(),
});

export const RequestStartedEventSchema = BaseEventSchema.extend({
  type: z.literal("request_started"),
  requestId: z.string().min(1),
  sessionKind: SessionKindSchema.optional(),
  profileId: z.string().min(1).optional(),
  workId: z.string().min(1).nullable().optional(),
  input: z.string(),
});

export const RequestCommittedEventSchema = BaseEventSchema.extend({
  type: z.literal("request_committed"),
  requestId: z.string().min(1),
});

export const RequestFailedEventSchema = BaseEventSchema.extend({
  type: z.literal("request_failed"),
  requestId: z.string().min(1),
  error: z.string(),
});

export const RequestDeliveryEventSchema=BaseEventSchema.extend({
  type:z.literal('request_delivery'),requestId:z.string().min(1),state:RequestDeliveryStateSchema,
});

export const MessageEventSchema = BaseEventSchema.extend({
  type: z.literal("message"),
  requestId: z.string().min(1),
  uuid: z.string().min(1),
  parentUuid: z.string().min(1).nullable(),
  role: TranscriptRoleSchema,
  visibility: z.enum(["conversation", "model"]).optional(),
  piTurnIndex: z.number().int().nonnegative().optional(),
  toolCallId: z.string().min(1).optional(),
  sourceToolAssistantUuid: z.string().min(1).optional(),
  display: z.object({
    completion: z.object({
      status: z.enum(["answered", "delivered", "needs_input", "blocked"]),
      message: z.string(),
    }).strict().optional(),
    userInput: z.object({
      text: z.string(),
      language: z.enum(["zh", "en"]),
      attachments: z.array(z.object({ filename: z.string() }).strict()),
    }).strict().optional(),
    thinking: z.string().optional(),
    toolExecutions: z.array(z.unknown()).optional(),
  }).strict().optional(),
  message: z.unknown(),
});

export const TranscriptEventSchema = z.discriminatedUnion("type", [
  SessionCreatedEventSchema,
  SessionMetadataUpdatedEventSchema,
  RequestStartedEventSchema,
  RequestCommittedEventSchema,
  RequestFailedEventSchema,
  RequestDeliveryEventSchema,
  MessageEventSchema,
]);

export type SessionCreatedEvent = z.infer<typeof SessionCreatedEventSchema>;
export type SessionMetadataUpdatedEvent = z.infer<typeof SessionMetadataUpdatedEventSchema>;
export type RequestStartedEvent = z.infer<typeof RequestStartedEventSchema>;
export type RequestCommittedEvent = z.infer<typeof RequestCommittedEventSchema>;
export type RequestFailedEvent = z.infer<typeof RequestFailedEventSchema>;
export type MessageEvent = z.infer<typeof MessageEventSchema>;
export type TranscriptEvent = z.infer<typeof TranscriptEventSchema>;
