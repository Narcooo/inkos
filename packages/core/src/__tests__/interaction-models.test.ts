import { describe, expect, it } from "vitest";
import {
  AutomationModeSchema,
  BookCreationDraftSchema,
  InteractionIntentTypeSchema,
  ExecutionStatusSchema,
  InteractionSessionSchema,
  bindActiveBook,
  clearPendingDecision,
  isTerminalExecutionStatus,
  appendInteractionMessage,
  appendInteractionEvent,
  updateCreationDraft,
  clearCreationDraft,
} from "../index.js";

describe("interaction models", () => {
  it("parses supported automation modes", () => {
    expect(AutomationModeSchema.parse("auto")).toBe("auto");
    expect(AutomationModeSchema.parse("semi")).toBe("semi");
    expect(AutomationModeSchema.parse("manual")).toBe("manual");
  });

  it("parses supported interaction intents", () => {
    expect(InteractionIntentTypeSchema.parse("develop_book")).toBe("develop_book");
    expect(InteractionIntentTypeSchema.parse("create_book")).toBe("create_book");
    expect(InteractionIntentTypeSchema.parse("discard_book_draft")).toBe("discard_book_draft");
    expect(InteractionIntentTypeSchema.parse("chat")).toBe("chat");
    expect(InteractionIntentTypeSchema.parse("write_next")).toBe("write_next");
    expect(InteractionIntentTypeSchema.parse("rewrite_chapter")).toBe("rewrite_chapter");
    expect(InteractionIntentTypeSchema.parse("explain_failure")).toBe("explain_failure");
  });

  it("recognizes terminal execution statuses", () => {
    expect(isTerminalExecutionStatus(ExecutionStatusSchema.parse("completed"))).toBe(true);
    expect(isTerminalExecutionStatus(ExecutionStatusSchema.parse("failed"))).toBe(true);
    expect(isTerminalExecutionStatus(ExecutionStatusSchema.parse("idle"))).toBe(false);
    expect(isTerminalExecutionStatus(ExecutionStatusSchema.parse("writing"))).toBe(false);
  });

  it("binds the active book without disturbing unrelated session fields", () => {
    const session = InteractionSessionSchema.parse({
      sessionId: "session-1",
      projectRoot: "/tmp/project",
      automationMode: "semi",
      messages: [],
      pendingDecision: {
        kind: "approve-chapter",
        bookId: "book-a",
        chapterNumber: 3,
        summary: "Chapter 3 is waiting for review.",
      },
      currentExecution: {
        status: "waiting_human",
        bookId: "book-a",
        chapterNumber: 3,
        stageLabel: "waiting for approval",
      },
    });

    expect(bindActiveBook(session, "book-b")).toEqual({
      ...session,
      activeBookId: "book-b",
    });
  });

  it("clears pending decisions while keeping the rest of the session intact", () => {
    const session = InteractionSessionSchema.parse({
      sessionId: "session-2",
      projectRoot: "/tmp/project",
      activeBookId: "book-a",
      automationMode: "auto",
      messages: [],
      pendingDecision: {
        kind: "choose-repair-mode",
        bookId: "book-a",
        chapterNumber: 8,
        summary: "Choose whether to local-fix or rewrite chapter 8.",
      },
    });

    expect(clearPendingDecision(session)).toEqual({
      ...session,
      pendingDecision: undefined,
    });
  });

  it("appends interaction messages in timestamp order", () => {
    const session = InteractionSessionSchema.parse({
      sessionId: "session-3",
      projectRoot: "/tmp/project",
      automationMode: "semi",
      messages: [],
    });

    const next = appendInteractionMessage(session, {
      role: "user",
      content: "continue",
      timestamp: 1,
    });

    expect(next.messages).toEqual([{
      role: "user",
      content: "continue",
      timestamp: 1,
    }]);
  });

  it("appends interaction events in timestamp order", () => {
    const session = InteractionSessionSchema.parse({
      sessionId: "session-4",
      projectRoot: "/tmp/project",
      automationMode: "semi",
      messages: [],
      events: [],
    });

    const next = appendInteractionEvent(session, {
      kind: "task.completed",
      timestamp: 2,
      status: "completed",
      bookId: "harbor",
      detail: "Completed write_next for harbor.",
    });

    expect(next.events).toEqual([{
      kind: "task.completed",
      timestamp: 2,
      status: "completed",
      bookId: "harbor",
      detail: "Completed write_next for harbor.",
    }]);
  });

  it("stores and clears a creation draft inside the shared session", () => {
    const draft = BookCreationDraftSchema.parse({
      concept: "港风商战悬疑，主角从灰产洗白。",
      title: "夜港账本",
      genre: "urban",
      readyToCreate: false,
    });

    const session = InteractionSessionSchema.parse({
      sessionId: "session-5",
      projectRoot: "/tmp/project",
      automationMode: "semi",
      messages: [],
      events: [],
    });

    const withDraft = updateCreationDraft(session, draft);
    expect(withDraft.creationDraft?.title).toBe("夜港账本");
    expect(clearCreationDraft(withDraft).creationDraft).toBeUndefined();
  });
});
