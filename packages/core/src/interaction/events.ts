import { z } from "zod";

export const ExecutionStatusSchema = z.enum([
  "idle",
  "planning",
  "composing",
  "writing",
  "assessing",
  "repairing",
  "persisting",
  "waiting_human",
  "blocked",
  "completed",
  "failed",
]);

export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;

export const ExecutionStateSchema = z.object({
  status: ExecutionStatusSchema,
  bookId: z.string().min(1).optional(),
  chapterNumber: z.number().int().min(1).optional(),
  stageLabel: z.string().min(1).optional(),
});

export type ExecutionState = z.infer<typeof ExecutionStateSchema>;

export const InteractionEventSchema = z.object({
  kind: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
  status: ExecutionStatusSchema,
  bookId: z.string().min(1).optional(),
  chapterNumber: z.number().int().min(1).optional(),
  detail: z.string().min(1).optional(),
});

export type InteractionEvent = z.infer<typeof InteractionEventSchema>;

export function isTerminalExecutionStatus(status: ExecutionStatus): boolean {
  return status === "completed" || status === "failed" || status === "blocked";
}
