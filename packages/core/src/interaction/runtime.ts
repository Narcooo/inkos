import type { AutomationMode } from "./modes.js";
import { routeInteractionRequest } from "./request-router.js";
import type { InteractionRequest } from "./intents.js";
import type { ExecutionState, InteractionEvent } from "./events.js";
import type { PendingDecision, InteractionSession, DraftRound } from "./session.js";
import {
  appendInteractionEvent,
  bindActiveBook,
  clearCreationDraft,
  clearPendingDecision,
  updateCreationDraft,
  updateAutomationMode,
} from "./session.js";

type ReviseMode = "local-fix" | "rewrite";
type RuntimeLanguage = "zh" | "en";

export interface InteractionRuntimeTools {
  readonly listBooks: () => Promise<ReadonlyArray<string>>;
  readonly developBookDraft?: (
    input: string,
    existingDraft?: InteractionSession["creationDraft"],
  ) => Promise<unknown>;
  readonly createBook?: (input: {
    readonly title: string;
    readonly genre?: string;
    readonly platform?: string;
    readonly language?: "zh" | "en";
    readonly chapterWordCount?: number;
    readonly targetChapters?: number;
    readonly blurb?: string;
    readonly worldPremise?: string;
    readonly settingNotes?: string;
    readonly protagonist?: string;
    readonly supportingCast?: string;
    readonly conflictCore?: string;
    readonly volumeOutline?: string;
    readonly constraints?: string;
    readonly authorIntent?: string;
    readonly currentFocus?: string;
  }) => Promise<unknown>;
  readonly exportBook?: (bookId: string, options: {
    readonly format?: "txt" | "md" | "epub";
    readonly approvedOnly?: boolean;
    readonly outputPath?: string;
  }) => Promise<unknown>;
  readonly chat?: (
    input: string,
    options: {
      readonly bookId?: string;
      readonly automationMode: AutomationMode;
    },
  ) => Promise<unknown>;
  readonly writeNextChapter: (bookId: string) => Promise<unknown>;
  readonly reviseDraft: (bookId: string, chapterNumber: number, mode: ReviseMode) => Promise<unknown>;
  readonly patchChapterText: (
    bookId: string,
    chapterNumber: number,
    targetText: string,
    replacementText: string,
  ) => Promise<unknown>;
  readonly renameEntity: (
    bookId: string,
    oldValue: string,
    newValue: string,
  ) => Promise<unknown>;
  readonly updateCurrentFocus: (bookId: string, content: string) => Promise<unknown>;
  readonly updateAuthorIntent: (bookId: string, content: string) => Promise<unknown>;
  readonly writeTruthFile: (bookId: string, fileName: string, content: string) => Promise<unknown>;
}

export interface InteractionRuntimeResult {
  readonly session: InteractionSession;
  readonly responseText?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

interface InteractionToolMetadata {
  readonly events?: ReadonlyArray<InteractionEvent>;
  readonly activeChapterNumber?: number;
  readonly currentExecution?: ExecutionState;
  readonly pendingDecision?: PendingDecision;
  readonly responseText?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

function extractToolMetadata(value: unknown): InteractionToolMetadata {
  const chapterNumber = typeof value === "object" && value !== null && "chapterNumber" in value
    && typeof (value as { chapterNumber?: unknown }).chapterNumber === "number"
    ? (value as { chapterNumber: number }).chapterNumber
    : undefined;

  if (!value || typeof value !== "object" || !("__interaction" in value)) {
    return {
      ...(chapterNumber !== undefined ? { activeChapterNumber: chapterNumber } : {}),
    };
  }

  const interaction = (value as {
    readonly __interaction?: InteractionToolMetadata;
  }).__interaction;

  return {
    ...interaction,
    ...(interaction?.activeChapterNumber === undefined && chapterNumber !== undefined
      ? { activeChapterNumber: chapterNumber }
      : {}),
  };
}

function resolveRuntimeLanguage(request: InteractionRequest): RuntimeLanguage {
  return request.language === "en" ? "en" : "zh";
}

function localize<T>(language: RuntimeLanguage, messages: { zh: T; en: T }): T {
  return language === "en" ? messages.en : messages.zh;
}

function localizeMode(mode: AutomationMode, language: RuntimeLanguage): string {
  if (language === "en") {
    return mode;
  }

  return {
    auto: "自动",
    semi: "半自动",
    manual: "手动",
  }[mode] ?? mode;
}

function renderCreationDraft(
  draft: NonNullable<InteractionSession["creationDraft"]>,
  language: RuntimeLanguage,
): string {
  const lines = language === "en"
    ? [
        "# Current Book Draft",
        draft.title ? `- Title: ${draft.title}` : undefined,
        draft.genre ? `- Genre: ${draft.genre}` : undefined,
        draft.platform ? `- Platform: ${draft.platform}` : undefined,
        draft.worldPremise ? `- World: ${draft.worldPremise}` : undefined,
        draft.protagonist ? `- Protagonist: ${draft.protagonist}` : undefined,
        draft.conflictCore ? `- Core Conflict: ${draft.conflictCore}` : undefined,
        draft.volumeOutline ? `- Volume Direction: ${draft.volumeOutline}` : undefined,
        draft.blurb ? `- Blurb: ${draft.blurb}` : undefined,
        draft.nextQuestion ? `- Next: ${draft.nextQuestion}` : undefined,
      ]
    : [
        "# 当前创作草案",
        draft.title ? `- 书名：${draft.title}` : undefined,
        draft.genre ? `- 题材：${draft.genre}` : undefined,
        draft.platform ? `- 平台：${draft.platform}` : undefined,
        draft.worldPremise ? `- 世界观：${draft.worldPremise}` : undefined,
        draft.protagonist ? `- 主角：${draft.protagonist}` : undefined,
        draft.conflictCore ? `- 核心冲突：${draft.conflictCore}` : undefined,
        draft.volumeOutline ? `- 卷纲方向：${draft.volumeOutline}` : undefined,
        draft.blurb ? `- 简介：${draft.blurb}` : undefined,
        draft.nextQuestion ? `- 下一步：${draft.nextQuestion}` : undefined,
      ];
  return lines.filter(Boolean).join("\n");
}

function buildTaskStartedState(
  session: InteractionSession,
  request: InteractionRequest,
  language: RuntimeLanguage,
): ExecutionState {
  switch (request.intent) {
    case "write_next":
    case "continue_book":
      return {
        status: "planning",
        bookId: request.bookId ?? session.activeBookId,
        chapterNumber: session.activeChapterNumber,
        stageLabel: localize(language, {
          zh: "准备章节输入",
          en: "preparing chapter inputs",
        }),
      };
    case "develop_book":
      return {
        status: "planning",
        bookId: request.bookId ?? session.activeBookId,
        stageLabel: localize(language, {
          zh: "收敛创作草案",
          en: "developing book draft",
        }),
      };
    case "create_book":
      return {
        status: "planning",
        bookId: request.bookId ?? session.activeBookId,
        stageLabel: localize(language, {
          zh: "创建作品基础",
          en: "creating book foundation",
        }),
      };
    case "export_book":
      return {
        status: "persisting",
        bookId: request.bookId ?? session.activeBookId,
        chapterNumber: session.activeChapterNumber,
        stageLabel: localize(language, {
          zh: "导出作品文件",
          en: "exporting book artifacts",
        }),
      };
    case "revise_chapter":
    case "rewrite_chapter":
      return {
        status: "repairing",
        bookId: request.bookId ?? session.activeBookId,
        chapterNumber: request.chapterNumber ?? session.activeChapterNumber,
        stageLabel: request.intent === "rewrite_chapter"
          ? localize(language, { zh: "重写章节", en: "rewriting chapter" })
          : localize(language, { zh: "修订章节", en: "revising chapter" }),
      };
    case "update_focus":
    case "update_author_intent":
    case "edit_truth":
      return {
        status: "persisting",
        bookId: request.bookId ?? session.activeBookId,
        chapterNumber: session.activeChapterNumber,
        stageLabel: localize(language, {
          zh: "应用项目修改",
          en: "applying project edit",
        }),
      };
    case "pause_book":
    case "discard_book_draft":
      return {
        status: "blocked",
        bookId: request.bookId ?? session.activeBookId,
        chapterNumber: session.activeChapterNumber,
        stageLabel: localize(language, {
          zh: "已由用户暂停",
          en: "paused by user",
        }),
      };
    default:
      return {
        status: "planning",
        bookId: request.bookId ?? session.activeBookId,
        chapterNumber: session.activeChapterNumber,
        stageLabel: localize(language, {
          zh: `处理中：${request.intent}`,
          en: `handling ${request.intent}`,
        }),
      };
  }
}

function shouldWaitForHuman(
  automationMode: AutomationMode,
  request: InteractionRequest,
): boolean {
  const contentIntent = request.intent === "write_next"
    || request.intent === "continue_book"
    || request.intent === "revise_chapter"
    || request.intent === "rewrite_chapter"
    || request.intent === "patch_chapter_text";
  const editIntent = request.intent === "update_focus"
    || request.intent === "update_author_intent"
    || request.intent === "edit_truth"
    || request.intent === "rename_entity";

  if (automationMode === "auto") {
    return false;
  }
  if (automationMode === "semi") {
    return contentIntent;
  }
  return contentIntent || editIntent;
}

function buildPendingDecision(
  session: InteractionSession,
  request: InteractionRequest,
  language: RuntimeLanguage,
  chapterNumber?: number,
): PendingDecision | undefined {
  if (!shouldWaitForHuman(session.automationMode, request)) {
    return undefined;
  }

  const bookId = request.bookId ?? session.activeBookId;
  if (!bookId) {
    return undefined;
  }

  return {
    kind: "review-next-step",
    bookId,
    ...(chapterNumber !== undefined ? { chapterNumber } : {}),
    summary: session.automationMode === "manual"
      ? localize(language, {
          zh: "执行已完成。请明确选择下一步操作。",
          en: "Execution finished. Choose the next action explicitly.",
        })
      : localize(language, {
          zh: "执行已完成，等待你的下一步决定。",
          en: "Execution finished. Waiting for your next decision.",
        }),
  };
}

function buildWaitingExecution(
  session: InteractionSession,
  request: InteractionRequest,
  language: RuntimeLanguage,
  chapterNumber?: number,
): ExecutionState {
  return {
    status: "waiting_human",
    bookId: request.bookId ?? session.activeBookId,
    ...(chapterNumber !== undefined ? { chapterNumber } : {}),
    stageLabel: localize(language, {
      zh: "等待你的下一步决定",
      en: "waiting for your next decision",
    }),
  };
}

function appendToolEvents(
  session: InteractionSession,
  events: ReadonlyArray<InteractionEvent> | undefined,
): InteractionSession {
  if (!events || events.length === 0) {
    return session;
  }

  const baseTimestamp = Date.now();
  return events.reduce((nextSession, event, index) => appendInteractionEvent(nextSession, {
    ...event,
    timestamp: baseTimestamp - events.length + index,
  }), session);
}

interface RuntimeRequestHelpers {
  readonly language: RuntimeLanguage;
  readonly addEvent: (
    nextSession: InteractionSession,
    kind: string,
    status: InteractionEvent["status"],
    detail: string,
  ) => InteractionSession;
  readonly markCompleted: (nextSession: InteractionSession) => InteractionSession;
}

async function handleDraftLifecycleRequest(params: {
  readonly session: InteractionSession;
  readonly request: InteractionRequest;
  readonly tools: InteractionRuntimeTools;
  readonly helpers: RuntimeRequestHelpers;
}): Promise<InteractionRuntimeResult | undefined> {
  const { session, request, tools, helpers } = params;
  const { language, addEvent, markCompleted } = helpers;

  switch (request.intent) {
    case "develop_book": {
      if (!tools.developBookDraft) {
        throw new Error(localize(language, {
          zh: "创作草案会话暂未实现。",
          en: "Book-draft ideation is not implemented yet.",
        }));
      }
      if (!request.instruction) {
        throw new Error(localize(language, {
          zh: "创作草案需要一条用户输入。",
          en: "Book-draft ideation requires user input.",
        }));
      }
      const toolResult = await tools.developBookDraft(request.instruction, session.creationDraft);
      const metadata = extractToolMetadata(toolResult);
      const draft = metadata.details?.creationDraft as InteractionSession["creationDraft"] | undefined;
      if (!draft) {
        throw new Error(localize(language, {
          zh: "创作草案工具没有返回草案数据。",
          en: "Book-draft tool did not return draft data.",
        }));
      }
      const newRound: DraftRound = {
        roundId: (session.draftRounds?.length ?? 0) + 1,
        userMessage: request.instruction ?? "",
        assistantRaw: metadata.details?.draftRaw as string ?? "",
        fieldsUpdated: (metadata.details?.fieldsUpdated as string[]) ?? [],
        summary: metadata.details?.draftSummary as string ?? "",
        timestamp: Date.now(),
      };
      const withDraft = updateCreationDraft(session, draft);
      const withRounds = {
        ...withDraft,
        draftRounds: [...(withDraft.draftRounds ?? []), newRound],
      };
      const nextSession = appendToolEvents(withRounds, metadata.events);
      const completed = {
        ...markCompleted(nextSession),
        currentExecution: metadata.currentExecution ?? markCompleted(nextSession).currentExecution,
      };
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          zh: "已更新创作草案。",
          en: "Updated the book draft.",
        })),
        responseText: metadata.responseText ?? localize(language, {
          zh: "已更新创作草案。",
          en: "Updated the book draft.",
        }),
        details: metadata.details,
      };
    }
    case "show_book_draft": {
      if (!session.creationDraft) {
        return {
          session: markCompleted(session),
          responseText: localize(language, {
            zh: "当前还没有创作草案。先告诉我你想写什么，再逐步把书收出来。",
            en: "There is no active book draft yet. Start by telling me what you want to write.",
          }),
        };
      }
      return {
        session: markCompleted(session),
        responseText: renderCreationDraft(session.creationDraft, language),
      };
    }
    case "create_book": {
      if (!tools.createBook) {
        throw new Error(localize(language, {
          zh: "交互运行时暂未实现创建作品。",
          en: "Book creation is not implemented in the interaction runtime yet.",
        }));
      }
      const effectiveDraft = session.creationDraft;
      const title = request.title ?? effectiveDraft?.title;
      if (!title) {
        throw new Error(localize(language, {
          zh: "创建作品需要标题。",
          en: "Book creation requires a title.",
        }));
      }
      const toolResult = await tools.createBook({
        title,
        genre: request.genre ?? effectiveDraft?.genre,
        platform: request.platform ?? effectiveDraft?.platform,
        language: request.language ?? effectiveDraft?.language,
        chapterWordCount: request.chapterWordCount ?? effectiveDraft?.chapterWordCount,
        targetChapters: request.targetChapters ?? effectiveDraft?.targetChapters,
        blurb: request.blurb ?? effectiveDraft?.blurb,
        worldPremise: request.worldPremise ?? effectiveDraft?.worldPremise,
        settingNotes: request.settingNotes ?? effectiveDraft?.settingNotes,
        protagonist: request.protagonist ?? effectiveDraft?.protagonist,
        supportingCast: request.supportingCast ?? effectiveDraft?.supportingCast,
        conflictCore: request.conflictCore ?? effectiveDraft?.conflictCore,
        volumeOutline: request.volumeOutline ?? effectiveDraft?.volumeOutline,
        constraints: request.constraints ?? effectiveDraft?.constraints,
        authorIntent: request.authorIntent ?? effectiveDraft?.authorIntent,
        currentFocus: request.currentFocus ?? effectiveDraft?.currentFocus,
      });
      const metadata = extractToolMetadata(toolResult);
      const createdBookId = typeof toolResult === "object" && toolResult !== null && "bookId" in toolResult
        && typeof (toolResult as { bookId?: unknown }).bookId === "string"
        ? (toolResult as { bookId: string }).bookId
        : undefined;
      if (!createdBookId) {
        throw new Error(localize(language, {
          zh: "创建作品工具没有返回作品 ID。",
          en: "Create-book tool did not return a book id.",
        }));
      }
      const nextSession = appendToolEvents(
        clearCreationDraft(bindActiveBook(session, createdBookId)),
        metadata.events,
      );
      const completed = {
        ...markCompleted(nextSession),
        currentExecution: metadata.currentExecution ?? markCompleted(nextSession).currentExecution,
      };
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          zh: `已创建作品 ${createdBookId}。`,
          en: `Created ${createdBookId}.`,
        })),
        responseText: metadata.responseText ?? localize(language, {
          zh: `已创建作品 ${createdBookId}。`,
          en: `Created ${createdBookId}.`,
        }),
        details: metadata.details,
      };
    }
    case "discard_book_draft": {
      const completed = markCompleted(clearCreationDraft(session));
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          zh: "已丢弃当前创作草案。",
          en: "Discarded the current book draft.",
        })),
        responseText: localize(language, {
          zh: "已丢弃当前创作草案。",
          en: "Discarded the current book draft.",
        }),
      };
    }
    default:
      return undefined;
  }
}

async function handleBookSelectionRequest(params: {
  readonly session: InteractionSession;
  readonly request: InteractionRequest;
  readonly tools: InteractionRuntimeTools;
  readonly helpers: RuntimeRequestHelpers;
}): Promise<InteractionRuntimeResult | undefined> {
  const { session, request, tools, helpers } = params;
  const { language, addEvent, markCompleted } = helpers;

  switch (request.intent) {
    case "list_books": {
      const books = await tools.listBooks();
      const completed = markCompleted(session);
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          zh: `已列出 ${books.length} 本作品。`,
          en: `Listed ${books.length} book(s).`,
        })),
        responseText: books.length > 0
          ? localize(language, {
              zh: `作品列表：${books.join("、")}`,
              en: `Books: ${books.join(", ")}`,
            })
          : localize(language, {
              zh: "当前项目下没有作品。",
              en: "No books found in this project.",
            }),
      };
    }
    case "select_book": {
      if (!request.bookId) {
        throw new Error(localize(language, {
          zh: "切换作品需要提供作品 ID。",
          en: "Book selection requires a book id.",
        }));
      }
      const books = await tools.listBooks();
      if (!books.includes(request.bookId)) {
        throw new Error(localize(language, {
          zh: `当前项目中找不到作品「${request.bookId}」。`,
          en: `Book "${request.bookId}" not found in this project.`,
        }));
      }
      const completed = markCompleted(bindActiveBook(session, request.bookId));
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          zh: `已切换当前作品到 ${request.bookId}。`,
          en: `Bound active book to ${request.bookId}.`,
        })),
        responseText: localize(language, {
          zh: `当前作品：${request.bookId}`,
          en: `Active book: ${request.bookId}`,
        }),
      };
    }
    default:
      return undefined;
  }
}

export async function runInteractionRequest(params: {
  readonly session: InteractionSession;
  readonly request: InteractionRequest;
  readonly tools: InteractionRuntimeTools;
}): Promise<InteractionRuntimeResult> {
  const request = routeInteractionRequest(params.request);
  const language = resolveRuntimeLanguage(request);
  let session = params.session;
  const addEvent = (
    nextSession: InteractionSession,
    kind: string,
    status: InteractionEvent["status"],
    detail: string,
  ): InteractionSession => appendInteractionEvent(nextSession, {
    kind,
    timestamp: Date.now(),
    status,
    bookId: nextSession.activeBookId,
    chapterNumber: nextSession.activeChapterNumber,
    detail,
  });

  if (request.mode) {
    session = updateAutomationMode(session, request.mode as AutomationMode);
  }

  session = clearPendingDecision({
    ...session,
    currentExecution: buildTaskStartedState(session, request, language),
  });
  session = addEvent(session, "task.started", session.currentExecution!.status, localize(language, {
    zh: `开始执行 ${request.intent}。`,
    en: `Started ${request.intent}.`,
  }));

  const markCompleted = (nextSession: InteractionSession): InteractionSession => ({
    ...nextSession,
    currentExecution: {
      status: "completed",
      bookId: nextSession.activeBookId,
      chapterNumber: nextSession.activeChapterNumber,
      stageLabel: localize(language, {
        zh: "已完成",
        en: "completed",
      }),
    },
  });

  const helperContext: RuntimeRequestHelpers = {
    language,
    addEvent,
    markCompleted,
  };

  const draftLifecycleResult = await handleDraftLifecycleRequest({
    session,
    request,
    tools: params.tools,
    helpers: helperContext,
  });
  if (draftLifecycleResult) {
    return draftLifecycleResult;
  }

  const bookSelectionResult = await handleBookSelectionRequest({
    session,
    request,
    tools: params.tools,
    helpers: helperContext,
  });
  if (bookSelectionResult) {
    return bookSelectionResult;
  }

  switch (request.intent) {
    case "write_next":
    case "continue_book": {
      const bookId = request.bookId ?? session.activeBookId;
      if (!bookId) {
        throw new Error(localize(language, {
          zh: "当前交互会话还没有绑定作品。",
          en: "No active book is bound to the interaction session.",
        }));
      }
      const toolResult = await params.tools.writeNextChapter(bookId);
      const metadata = extractToolMetadata(toolResult);
      session = bindActiveBook(session, bookId, metadata.activeChapterNumber);
      session = appendToolEvents(session, metadata.events);
      const pendingDecision = metadata.pendingDecision ?? buildPendingDecision(
        session,
        request,
        language,
        metadata.activeChapterNumber,
      );
      const completed = pendingDecision
        ? {
            ...session,
            pendingDecision,
            currentExecution: metadata.currentExecution ?? buildWaitingExecution(session, request, language, metadata.activeChapterNumber),
          }
        : {
            ...markCompleted(session),
            currentExecution: metadata.currentExecution ?? markCompleted(session).currentExecution,
          };
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          zh: `已为 ${bookId} 完成下一章写作。`,
          en: `Completed write_next for ${bookId}.`,
        })),
        responseText: metadata.responseText ?? (
          pendingDecision
            ? localize(language, {
                zh: `已为 ${bookId} 完成下一章写作，等待你的下一步决定。`,
                en: `Completed write_next for ${bookId}; waiting for your next decision.`,
              })
            : localize(language, {
                zh: `已为 ${bookId} 完成下一章写作。`,
                en: `Completed write_next for ${bookId}.`,
              })
        ),
      };
    }
    case "revise_chapter":
    case "rewrite_chapter": {
      const bookId = request.bookId ?? session.activeBookId;
      if (!bookId) {
        throw new Error(localize(language, {
          zh: "当前交互会话还没有绑定作品。",
          en: "No active book is bound to the interaction session.",
        }));
      }
      if (!request.chapterNumber) {
        throw new Error(localize(language, {
          zh: "修订章节需要章节号。",
          en: "Chapter number is required for chapter revision.",
        }));
      }
      const mode: ReviseMode = request.intent === "rewrite_chapter" ? "rewrite" : "local-fix";
      const toolResult = await params.tools.reviseDraft(bookId, request.chapterNumber, mode);
      const metadata = extractToolMetadata(toolResult);
      const chapterNumber = metadata.activeChapterNumber ?? request.chapterNumber;
      session = bindActiveBook(session, bookId, chapterNumber);
      session = appendToolEvents(session, metadata.events);
      const pendingDecision = metadata.pendingDecision ?? buildPendingDecision(
        session,
        request,
        language,
        chapterNumber,
      );
      const completed = pendingDecision
        ? {
            ...session,
            pendingDecision,
            currentExecution: metadata.currentExecution ?? buildWaitingExecution(session, request, language, chapterNumber),
          }
        : {
            ...markCompleted(session),
            currentExecution: metadata.currentExecution ?? markCompleted(session).currentExecution,
          };
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          zh: request.intent === "rewrite_chapter"
            ? `已为 ${bookId} 完成章节重写。`
            : `已为 ${bookId} 完成章节修订。`,
          en: `Completed ${request.intent} for ${bookId}.`,
        })),
        responseText: metadata.responseText ?? (
          pendingDecision
            ? localize(language, {
                zh: request.intent === "rewrite_chapter"
                  ? `已为 ${bookId} 完成章节重写，等待你的下一步决定。`
                  : `已为 ${bookId} 完成章节修订，等待你的下一步决定。`,
                en: `Completed ${request.intent} for ${bookId}; waiting for your next decision.`,
              })
            : localize(language, {
                zh: request.intent === "rewrite_chapter"
                  ? `已为 ${bookId} 完成章节重写。`
                  : `已为 ${bookId} 完成章节修订。`,
                en: `Completed ${request.intent} for ${bookId}.`,
              })
        ),
      };
    }
    case "patch_chapter_text": {
      const bookId = request.bookId ?? session.activeBookId;
      if (!bookId) {
        throw new Error(localize(language, {
          zh: "当前交互会话还没有绑定作品。",
          en: "No active book is bound to the interaction session.",
        }));
      }
      if (!request.chapterNumber || !request.targetText || !request.replacementText) {
        throw new Error(localize(language, {
          zh: "正文修补需要章节号、目标文本和替换文本。",
          en: "Chapter patch requires chapter number, target text, and replacement text.",
        }));
      }
      const toolResult = await params.tools.patchChapterText(
        bookId,
        request.chapterNumber,
        request.targetText,
        request.replacementText,
      );
      const metadata = extractToolMetadata(toolResult);
      const chapterNumber = metadata.activeChapterNumber ?? request.chapterNumber;
      session = bindActiveBook(session, bookId, chapterNumber);
      session = appendToolEvents(session, metadata.events);
      const pendingDecision = metadata.pendingDecision ?? buildPendingDecision(
        session,
        request,
        language,
        chapterNumber,
      );
      const completed = pendingDecision
        ? {
            ...session,
            pendingDecision,
            currentExecution: metadata.currentExecution ?? buildWaitingExecution(session, request, language, chapterNumber),
          }
        : {
            ...markCompleted(session),
            currentExecution: metadata.currentExecution ?? markCompleted(session).currentExecution,
          };
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          zh: `已修补 ${bookId} 的第 ${chapterNumber} 章。`,
          en: `Patched chapter ${chapterNumber} for ${bookId}.`,
        })),
        responseText: metadata.responseText ?? (
          pendingDecision
            ? localize(language, {
                zh: `已修补 ${bookId} 的第 ${chapterNumber} 章，等待你的下一步决定。`,
                en: `Patched chapter ${chapterNumber} for ${bookId}; waiting for your next decision.`,
              })
            : localize(language, {
                zh: `已修补 ${bookId} 的第 ${chapterNumber} 章。`,
                en: `Patched chapter ${chapterNumber} for ${bookId}.`,
              })
        ),
      };
    }
    case "rename_entity": {
      const bookId = request.bookId ?? session.activeBookId;
      if (!bookId) {
        throw new Error(localize(language, {
          zh: "当前交互会话还没有绑定作品。",
          en: "No active book is bound to the interaction session.",
        }));
      }
      if (!request.oldValue || !request.newValue) {
        throw new Error(localize(language, {
          zh: "实体改名需要旧值和新值。",
          en: "Entity rename requires old and new values.",
        }));
      }
      const toolResult = await params.tools.renameEntity(bookId, request.oldValue, request.newValue);
      const metadata = extractToolMetadata(toolResult);
      session = bindActiveBook(session, bookId, metadata.activeChapterNumber);
      session = appendToolEvents(session, metadata.events);
      const pendingDecision = metadata.pendingDecision ?? buildPendingDecision(
        session,
        request,
        language,
        metadata.activeChapterNumber,
      );
      const completed = pendingDecision
        ? {
            ...session,
            pendingDecision,
            currentExecution: metadata.currentExecution ?? buildWaitingExecution(session, request, language, metadata.activeChapterNumber),
          }
        : {
            ...markCompleted(session),
            currentExecution: metadata.currentExecution ?? markCompleted(session).currentExecution,
          };
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          zh: `已在 ${bookId} 中把 ${request.oldValue} 改成 ${request.newValue}。`,
          en: `Renamed ${request.oldValue} to ${request.newValue} in ${bookId}.`,
        })),
        responseText: metadata.responseText ?? (
          pendingDecision
            ? localize(language, {
                zh: `已在 ${bookId} 中把 ${request.oldValue} 改成 ${request.newValue}，等待你的下一步决定。`,
                en: `Renamed ${request.oldValue} to ${request.newValue} in ${bookId}; waiting for your next decision.`,
              })
            : localize(language, {
                zh: `已在 ${bookId} 中把 ${request.oldValue} 改成 ${request.newValue}。`,
                en: `Renamed ${request.oldValue} to ${request.newValue} in ${bookId}.`,
              })
        ),
      };
    }
    case "update_focus": {
      const bookId = request.bookId ?? session.activeBookId;
      if (!bookId) {
        throw new Error(localize(language, {
          zh: "当前交互会话还没有绑定作品。",
          en: "No active book is bound to the interaction session.",
        }));
      }
      if (!request.instruction) {
        throw new Error(localize(language, {
          zh: "更新焦点需要提供内容。",
          en: "Focus update requires instruction content.",
        }));
      }
      const toolResult = await params.tools.updateCurrentFocus(bookId, request.instruction);
      const metadata = extractToolMetadata(toolResult);
      session = bindActiveBook(session, bookId);
      session = appendToolEvents(session, metadata.events);
      const pendingDecision = metadata.pendingDecision ?? buildPendingDecision(session, request, language);
      const completed = pendingDecision
        ? {
            ...session,
            pendingDecision,
            currentExecution: metadata.currentExecution ?? buildWaitingExecution(session, request, language),
          }
        : {
            ...markCompleted(session),
            currentExecution: metadata.currentExecution ?? markCompleted(session).currentExecution,
          };
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          zh: `已更新 ${bookId} 的当前焦点。`,
          en: `Updated current focus for ${bookId}.`,
        })),
        responseText: metadata.responseText ?? (
          pendingDecision
            ? localize(language, {
                zh: `已更新 ${bookId} 的当前焦点，等待你的下一步决定。`,
                en: `Updated current focus for ${bookId}; waiting for your next decision.`,
              })
            : localize(language, {
                zh: `已更新 ${bookId} 的当前焦点。`,
                en: `Updated current focus for ${bookId}.`,
              })
        ),
      };
    }
    case "update_author_intent": {
      const bookId = request.bookId ?? session.activeBookId;
      if (!bookId) {
        throw new Error(localize(language, {
          zh: "当前交互会话还没有绑定作品。",
          en: "No active book is bound to the interaction session.",
        }));
      }
      if (!request.instruction) {
        throw new Error(localize(language, {
          zh: "更新作者意图需要提供内容。",
          en: "Author intent update requires instruction content.",
        }));
      }
      const toolResult = await params.tools.updateAuthorIntent(bookId, request.instruction);
      const metadata = extractToolMetadata(toolResult);
      session = bindActiveBook(session, bookId);
      session = appendToolEvents(session, metadata.events);
      const pendingDecision = metadata.pendingDecision ?? buildPendingDecision(session, request, language);
      const completed = pendingDecision
        ? {
            ...session,
            pendingDecision,
            currentExecution: metadata.currentExecution ?? buildWaitingExecution(session, request, language),
          }
        : {
            ...markCompleted(session),
            currentExecution: metadata.currentExecution ?? markCompleted(session).currentExecution,
          };
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          zh: `已更新 ${bookId} 的作者意图。`,
          en: `Updated author intent for ${bookId}.`,
        })),
        responseText: metadata.responseText ?? (
          pendingDecision
            ? localize(language, {
                zh: `已更新 ${bookId} 的作者意图，等待你的下一步决定。`,
                en: `Updated author intent for ${bookId}; waiting for your next decision.`,
              })
            : localize(language, {
                zh: `已更新 ${bookId} 的作者意图。`,
                en: `Updated author intent for ${bookId}.`,
              })
        ),
      };
    }
    case "edit_truth": {
      const bookId = request.bookId ?? session.activeBookId;
      if (!bookId) {
        throw new Error(localize(language, {
          zh: "当前交互会话还没有绑定作品。",
          en: "No active book is bound to the interaction session.",
        }));
      }
      if (!request.fileName || !request.instruction) {
        throw new Error(localize(language, {
          zh: "编辑真相文件需要文件名和内容。",
          en: "Truth-file edit requires a file name and content.",
        }));
      }
      const toolResult = await params.tools.writeTruthFile(bookId, request.fileName, request.instruction);
      const metadata = extractToolMetadata(toolResult);
      session = bindActiveBook(session, bookId);
      session = appendToolEvents(session, metadata.events);
      const pendingDecision = metadata.pendingDecision ?? buildPendingDecision(session, request, language);
      const completed = pendingDecision
        ? {
            ...session,
            pendingDecision,
            currentExecution: metadata.currentExecution ?? buildWaitingExecution(session, request, language),
          }
        : {
            ...markCompleted(session),
            currentExecution: metadata.currentExecution ?? markCompleted(session).currentExecution,
          };
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          zh: `已更新 ${bookId} 的 ${request.fileName}。`,
          en: `Updated ${request.fileName} for ${bookId}.`,
        })),
        responseText: metadata.responseText ?? (
          pendingDecision
            ? localize(language, {
                zh: `已更新 ${bookId} 的 ${request.fileName}，等待你的下一步决定。`,
                en: `Updated ${request.fileName} for ${bookId}; waiting for your next decision.`,
              })
            : localize(language, {
                zh: `已更新 ${bookId} 的 ${request.fileName}。`,
                en: `Updated ${request.fileName} for ${bookId}.`,
              })
        ),
      };
    }
    case "export_book": {
      const bookId = request.bookId ?? session.activeBookId;
      if (!params.tools.exportBook) {
        throw new Error(localize(language, {
          zh: "交互运行时暂未实现导出作品。",
          en: "Book export is not implemented in the interaction runtime yet.",
        }));
      }
      if (!bookId) {
        throw new Error(localize(language, {
          zh: "当前交互会话还没有绑定作品。",
          en: "No active book is bound to the interaction session.",
        }));
      }
      const toolResult = await params.tools.exportBook(bookId, {
        format: request.format,
        approvedOnly: request.approvedOnly,
        outputPath: request.outputPath,
      });
      const metadata = extractToolMetadata(toolResult);
      session = bindActiveBook(session, bookId, metadata.activeChapterNumber);
      session = appendToolEvents(session, metadata.events);
      const completed = {
        ...markCompleted(session),
        currentExecution: metadata.currentExecution ?? markCompleted(session).currentExecution,
      };
      return {
        session: addEvent(completed, "task.completed", "completed", localize(language, {
          zh: `已导出 ${bookId}。`,
          en: `Exported ${bookId}.`,
        })),
        responseText: metadata.responseText ?? localize(language, {
          zh: `已导出 ${bookId}。`,
          en: `Exported ${bookId}.`,
        }),
        details: metadata.details,
      };
    }
    case "switch_mode":
      session = markCompleted(session);
      return {
        session: addEvent(session, "task.completed", "completed", localize(language, {
          zh: `已切换到${localizeMode(session.automationMode, language)}模式。`,
          en: `Switched mode to ${session.automationMode}.`,
        })),
        responseText: localize(language, {
          zh: `已切换到${localizeMode(session.automationMode, language)}模式。`,
          en: `Switched mode to ${session.automationMode}.`,
        }),
      };
    case "pause_book": {
      const bookId = request.bookId ?? session.activeBookId;
      const paused = {
        ...session,
        currentExecution: {
          status: "blocked" as const,
          bookId,
          chapterNumber: session.activeChapterNumber,
          stageLabel: localize(language, {
            zh: "已由用户暂停",
            en: "paused by user",
          }),
        },
      };
      return {
        session: addEvent(paused, "task.completed", "blocked", localize(language, {
          zh: `已暂停${bookId ?? "当前作品"}。`,
          en: `Paused ${bookId ?? "current book"}.`,
        })),
        responseText: localize(language, {
          zh: `已暂停${bookId ?? "当前作品"}。`,
          en: `Paused ${bookId ?? "current book"}.`,
        }),
      };
    }
    case "resume_book": {
      const bookId = request.bookId ?? session.activeBookId;
      const resumed = {
        ...session,
        currentExecution: {
          status: "completed" as const,
          bookId,
          chapterNumber: session.activeChapterNumber,
          stageLabel: localize(language, {
            zh: "可继续执行",
            en: "ready to continue",
          }),
        },
      };
      return {
        session: addEvent(resumed, "task.completed", "completed", localize(language, {
          zh: `已恢复${bookId ?? "当前作品"}。`,
          en: `Resumed ${bookId ?? "current book"}.`,
        })),
        responseText: localize(language, {
          zh: `已恢复${bookId ?? "当前作品"}。`,
          en: `Resumed ${bookId ?? "current book"}.`,
        }),
      };
    }
    case "chat": {
      const bookId = request.bookId ?? session.activeBookId;
      const prompt = request.instruction?.trim().toLowerCase() ?? "";
      const toolResult = params.tools.chat
        ? await params.tools.chat(request.instruction ?? "", {
            bookId,
            automationMode: session.automationMode,
          })
        : undefined;
      const metadata = extractToolMetadata(toolResult);
      const responseText = metadata.responseText ?? (
        /^(hi|hello|hey|你好|嗨|哈喽)$/i.test(prompt)
          ? (bookId
              ? localize(language, {
                  zh: `你好。当前作品是 ${bookId}。你可以让我继续写、修订章节，或者解释当前卡住的原因。`,
                  en: `Hi. Active book is ${bookId}. Ask me to continue, revise a chapter, or explain what is blocked.`,
                })
              : localize(language, {
                  zh: "你好。当前还没有激活作品。你可以先打开作品、列出作品，或者直接告诉我你要写什么。",
                  en: "Hi. No active book yet. Open a book, list books, or tell me what you want to write.",
                }))
          : (bookId
              ? localize(language, {
                  zh: `我在。当前作品是 ${bookId}。你可以让我继续写、修订章节、重写、调整焦点，或者查看流水线为何停止。`,
                  en: `I’m here. Active book is ${bookId}. You can ask me to continue, revise a chapter, rewrite, change focus, or inspect why the pipeline stopped.`,
                })
              : localize(language, {
                  zh: "我在。当前还没有绑定作品。先打开作品、列出作品，或者直接描述你要写什么。",
                  en: "I’m here. No active book is bound yet. Open a book, list books, or describe what you want to write.",
                }))
      );
      const completed = markCompleted(session);
      return {
        session: addEvent(completed, "task.completed", "completed", responseText),
        responseText,
      };
    }
    case "explain_status":
    case "explain_failure": {
      const bookId = request.bookId ?? session.activeBookId;
      const baselineExecution = params.session.currentExecution;
      const stage = baselineExecution?.stageLabel ?? baselineExecution?.status ?? "idle";
      const summary = request.intent === "explain_failure"
        ? localize(language, {
            zh: `当前失败上下文：${bookId ?? "当前无激活作品"} 处于 ${stage}。`,
            en: `Current failure context: ${bookId ?? "no active book"} is at ${stage}.`,
          })
        : localize(language, {
            zh: `当前状态：${bookId ?? "当前无激活作品"} 处于 ${stage}。`,
            en: `Current status: ${bookId ?? "no active book"} is at ${stage}.`,
          });
      const completed = markCompleted(session);
      return {
        session: addEvent(completed, "task.completed", "completed", summary),
        responseText: summary,
      };
    }
    default:
      throw new Error(localize(language, {
        zh: `交互运行时暂未实现意图「${request.intent}」。`,
        en: `Intent "${request.intent}" is not implemented in the interaction runtime yet.`,
      }));
  }
}
