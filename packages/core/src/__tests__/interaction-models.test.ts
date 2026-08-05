import { describe, expect, it } from "vitest";
import {
  AutomationModeSchema,
  ActionPayloadSchema,
  ActionSourceSchema,
  BookCreationDraftSchema,
  InteractionIntentTypeSchema,
  ExecutionStatusSchema,
  InteractionSessionSchema,
  PlayModeSchema,
  RequestedIntentSchema,
  InteractiveFilmCreateActionPayloadSchema,
  ScriptCreateActionPayloadSchema,
  ScriptTargetFormatSchema,
  SessionKindSchema,
  StoryboardCreateActionPayloadSchema,
  bindActiveBook,
  clearPendingDecision,
  isTerminalExecutionStatus,
  isExplicitWriteChapterCommand,
  isUsablePlayInitialScene,
  isWriteNextInstruction,
  normalizeActionSource,
  normalizePlayMode,
  normalizeRequestedIntent,
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

  it("parses Studio/agent action envelope fields from one shared schema", () => {
    expect(ActionSourceSchema.parse("free-text")).toBe("free-text");
    expect(ActionSourceSchema.parse("button")).toBe("button");
    expect(RequestedIntentSchema.parse("create_book")).toBe("create_book");
    expect(RequestedIntentSchema.parse("play_start")).toBe("play_start");
    expect(RequestedIntentSchema.parse("script_create")).toBe("script_create");
    expect(RequestedIntentSchema.parse("storyboard_create")).toBe("storyboard_create");
    expect(RequestedIntentSchema.parse("interactive_film_create")).toBe("interactive_film_create");
    expect(RequestedIntentSchema.parse("fanfic_init")).toBe("fanfic_init");
    expect(RequestedIntentSchema.parse("style_imitation")).toBe("style_imitation");
    expect(SessionKindSchema.parse("script")).toBe("script");
    expect(SessionKindSchema.parse("storyboard")).toBe("storyboard");
    expect(SessionKindSchema.parse("interactive-film")).toBe("interactive-film");
    expect(ScriptTargetFormatSchema.parse("vertical_short_drama")).toBe("vertical_short_drama");
    expect(PlayModeSchema.parse("guided")).toBe("guided");

    expect(normalizeActionSource(undefined)).toBe("free-text");
    expect(normalizeActionSource("slash")).toBe("slash");
    expect(normalizeRequestedIntent("short_run")).toBe("short_run");
    expect(normalizeRequestedIntent("")).toBeUndefined();
    expect(normalizePlayMode("open")).toBe("open");
    expect(normalizePlayMode(null)).toBeUndefined();

    expect(ActionPayloadSchema.parse({
      writeNext: { chapterCount: 5 },
    })).toEqual({
      writeNext: { chapterCount: 5 },
    });
    expect(ActionPayloadSchema.safeParse({
      writeNext: { chapterCount: 21 },
    }).success).toBe(false);
  });

  it("validates structured script and storyboard creation payloads", () => {
    expect(ScriptCreateActionPayloadSchema.parse({
      title: "冷库账页",
      targetFormat: "vertical_short_drama",
      episodeCount: 12,
      episodeDuration: "2分钟",
      requirements: "保留调查线七成、家怨三成。",
    })).toMatchObject({
      title: "冷库账页",
      targetFormat: "vertical_short_drama",
      episodeCount: 12,
    });

    expect(StoryboardCreateActionPayloadSchema.parse({
      title: "冷库账页分镜",
      visualStyle: "写实冷色",
      aspectRatio: "9:16",
      granularity: "按关键镜头拆分",
      maxShots: 18,
    })).toMatchObject({
      title: "冷库账页分镜",
      visualStyle: "写实冷色",
      maxShots: 18,
    });

    expect(InteractiveFilmCreateActionPayloadSchema.parse({
      title: "盛世账页",
      requirements: "多分支，多结局，变量记录关键抉择。",
      targetAudience: "欧美互动影游用户",
      budget: "5000元",
      referenceMode: "盛世天下式多走向",
    })).toMatchObject({
      title: "盛世账页",
      budget: "5000元",
    });
  });

  it("uses one write-next detector across Studio and TUI entrypoints", () => {
    expect(isWriteNextInstruction("继续写")).toBe(true);
    expect(isWriteNextInstruction("write next")).toBe(true);
    expect(isWriteNextInstruction("/write")).toBe(false);
    expect(isWriteNextInstruction("/write", { allowSlashWrite: true })).toBe(true);
    expect(isWriteNextInstruction("我们讨论一下要不要继续写")).toBe(false);
  });

  it("recognizes only explicit natural-language chapter writing commands", () => {
    expect(isExplicitWriteChapterCommand("开始写第一章。")).toBe(true);
    expect(isExplicitWriteChapterCommand("请写下一章，写完后落盘。")).toBe(true);
    expect(isExplicitWriteChapterCommand("write chapter 1")).toBe(true);
    expect(isExplicitWriteChapterCommand("连续写5章")).toBe(false);
    expect(isExplicitWriteChapterCommand("write 5 chapters")).toBe(false);
    expect(isExplicitWriteChapterCommand("写第5章")).toBe(false);
    expect(isExplicitWriteChapterCommand("继续")).toBe(false);
    expect(isExplicitWriteChapterCommand("我们讨论一下要不要写下一章")).toBe(false);
    expect(isExplicitWriteChapterCommand("我觉得第一章应该怎么写？")).toBe(false);
  });

  it("rejects obviously truncated play initial scenes before they become execution payloads", () => {
    expect(isUsablePlayInitialScene("暴雨敲着铁皮门，封存档案箱压在门口。")).toBe(true);
    expect(isUsablePlayInitialScene("剧目是《挑滑车》，主演栏里有个名字叫")).toBe(false);
    expect(isUsablePlayInitialScene("主演栏：赵铁生。后台传来第二声拍板。")).toBe(true);
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
