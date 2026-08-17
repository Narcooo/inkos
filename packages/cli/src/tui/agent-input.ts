import {
  ActionPayloadSchema,
  appendInteractionMessage,
  clearPendingDecision,
  createLLMClient,
  RequestedIntentSchema,
  runAgentSession,
  SessionKindSchema,
  type ActionPayload,
  type ActionSource,
  type InteractionSession,
  type PendingProposedAction,
  type PlayMode,
  type RequestedIntent,
  type SessionKind,
} from "@actalk/inkos-core";
import { persistProjectSession } from "./session-store.js";
import { buildPipelineConfig, loadConfig } from "../utils.js";

interface TuiAgentRoute {
  readonly userMessage: string;
  readonly sessionKind: SessionKind;
  readonly actionSource: Extract<ActionSource, "free-text" | "slash">;
  readonly requestedIntent?: RequestedIntent;
  readonly actionPayload?: ActionPayload;
  readonly requestedSkills?: ReadonlyArray<string>;
  readonly playMode?: PlayMode;
  readonly detachBook?: boolean;
  readonly clearPending?: boolean;
  readonly localResponse?: string;
}

export async function processTuiAgentInput(params: {
  readonly projectRoot: string;
  readonly input: string;
  readonly session: InteractionSession;
  readonly activeBookId?: string;
  readonly onTextDelta?: (text: string) => void;
}) {
  const config = await loadConfig({
    requireApiKey: false,
    projectRoot: params.projectRoot,
    ...(params.session.modelOverride ? { cli: { model: params.session.modelOverride } } : {}),
  });
  const client = createLLMClient(config.llm);
  const pipeline = new (await import("@actalk/inkos-core")).PipelineRunner(
    buildPipelineConfig(config, params.projectRoot, { quiet: true }),
  );
  const userTimestamp = Date.now();
  const currentBookId = params.activeBookId ?? params.session.activeBookId ?? null;
  const language = config.language === "en" ? "en" : "zh";
  const route = resolveTuiAgentRoute(params.input, params.session, currentBookId, language);
  const resolvedBookId = route.detachBook ? null : currentBookId;
  const initialMessages = params.session.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({ role: message.role, content: message.content }));

  let nextSession = appendInteractionMessage(clearPendingDecision({
    ...params.session,
    sessionKind: route.sessionKind,
    ...(route.playMode ? { playMode: route.playMode } : {}),
    ...(route.detachBook ? { activeBookId: undefined } : resolvedBookId ? { activeBookId: resolvedBookId } : {}),
    currentExecution: {
      status: "planning",
      ...(resolvedBookId ? { bookId: resolvedBookId } : {}),
      ...(params.session.activeChapterNumber ? { chapterNumber: params.session.activeChapterNumber } : {}),
      stageLabel: "agent",
    },
  }), {
    role: "user",
    content: params.input,
    timestamp: userTimestamp,
  });

  if (route.clearPending) {
    delete nextSession.pendingProposedAction;
  }

  if (route.localResponse) {
    nextSession = appendInteractionMessage({
      ...nextSession,
      currentExecution: {
        status: "completed",
        ...(resolvedBookId ? { bookId: resolvedBookId } : {}),
        stageLabel: "agent",
      },
    }, {
      role: "assistant",
      content: route.localResponse,
      timestamp: userTimestamp + 1,
    });
    await persistProjectSession(params.projectRoot, nextSession);
    return { responseText: route.localResponse, session: nextSession };
  }

  const result = await runAgentSession(
    {
      sessionId: params.session.sessionId,
      bookId: resolvedBookId,
      sessionKind: route.sessionKind,
      actionSource: route.actionSource,
      ...(route.requestedIntent ? { requestedIntent: route.requestedIntent } : {}),
      ...(route.actionPayload ? { actionPayload: route.actionPayload } : {}),
      ...(route.requestedSkills?.length ? { requestedSkills: route.requestedSkills } : {}),
      ...(route.playMode ? { playMode: route.playMode } : {}),
      language,
      pipeline,
      projectRoot: params.projectRoot,
      model: client._piModel
        ? client._piModel
        : { provider: config.llm.provider ?? "openai", modelId: config.llm.model },
      apiKey: client._apiKey,
      onEvent: (event: any) => {
        if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
          params.onTextDelta?.(event.assistantMessageEvent.delta);
        }
      },
    },
    route.userMessage,
    initialMessages,
  );
  const createdBookId = extractCreatedBookId(result.messages);
  const activeBookId = createdBookId ?? resolvedBookId;
  const proposedAction = extractProposedAction(result.messages);
  const responseText = proposedAction
    ? formatProposedAction(proposedAction, language)
    : result.responseText;

  const completedSession = {
    ...nextSession,
    sessionKind: route.sessionKind,
    ...(route.playMode ? { playMode: route.playMode } : {}),
    ...(activeBookId ? { activeBookId } : {}),
    ...(proposedAction ? { pendingProposedAction: proposedAction } : {}),
    currentExecution: {
      status: "completed" as const,
      ...(activeBookId ? { bookId: activeBookId } : {}),
      ...(params.session.activeChapterNumber ? { chapterNumber: params.session.activeChapterNumber } : {}),
      stageLabel: "agent",
    },
  };

  if (responseText?.trim()) {
    const lastAssistant = result.messages
      .filter((message: any) => message.role === "assistant")
      .at(-1) as { thinking?: string } | undefined;
    nextSession = appendInteractionMessage(completedSession, {
      role: "assistant",
      content: responseText,
      ...(lastAssistant?.thinking ? { thinking: lastAssistant.thinking } : {}),
      timestamp: userTimestamp + 1,
    });
  } else {
    nextSession = completedSession;
  }

  if (!proposedAction && (route.clearPending || route.requestedIntent)) {
    delete nextSession.pendingProposedAction;
  }

  await persistProjectSession(params.projectRoot, nextSession);
  return { responseText, session: nextSession };
}

export function resolveTuiAgentRoute(
  rawInput: string,
  session: InteractionSession,
  activeBookId: string | null,
  language: "zh" | "en" = "zh",
): TuiAgentRoute {
  const input = rawInput.trim();
  const currentKind = session.sessionKind ?? (activeBookId ? "book" : "chat");

  if (/^\/confirm$/i.test(input)) {
    const pending = session.pendingProposedAction;
    if (!pending) {
      return localConfirmationRoute(currentKind, input, language === "en" ? "There is no pending action." : "没有待确认的动作。");
    }
    const requestedIntent = RequestedIntentSchema.safeParse(pending.action);
    const actionPayload = pending.actionPayload === undefined
      ? { success: true as const, data: undefined }
      : ActionPayloadSchema.safeParse(pending.actionPayload);
    if (!requestedIntent.success || !actionPayload.success) {
      return localConfirmationRoute(
        currentKind,
        input,
        language === "en"
          ? "This pending action is no longer valid. Please propose it again."
          : "这条待确认动作已失效，请重新提出需求。",
      );
    }
    return {
      userMessage: pending.instruction,
      sessionKind: pending.targetSessionKind,
      actionSource: "slash",
      requestedIntent: requestedIntent.data,
      ...(actionPayload.data ? { actionPayload: actionPayload.data } : {}),
      ...(pending.requestedSkills?.length ? { requestedSkills: pending.requestedSkills } : {}),
      ...(pending.playMode ? { playMode: pending.playMode } : {}),
      ...(detachesFromBook(pending.targetSessionKind) ? { detachBook: true } : {}),
      clearPending: true,
    };
  }

  if (/^\/(?:cancel|reject)$/i.test(input)) {
    return localConfirmationRoute(
      currentKind,
      input,
      session.pendingProposedAction
        ? language === "en" ? "Pending action cancelled." : "已取消待确认动作。"
        : language === "en" ? "There is no pending action." : "没有待确认的动作。",
    );
  }

  const newMatch = input.match(/^\/new(?:\s+([\s\S]+))?$/i);
  if (newMatch) {
    return entryRoute("book-create", commandBody(newMatch[1], language === "en"
      ? "I want to create a new book. Confirm the direction with me first."
      : "我想创建一本新书，请先和我确认方向。"));
  }

  const shortMatch = input.match(/^\/short(?:\s+([\s\S]+))?$/i);
  if (shortMatch) {
    return entryRoute("short", commandBody(shortMatch[1], language === "en"
      ? "I want to create an InkOS Short. Confirm the direction with me first."
      : "我想做 InkOS Short，请先和我确认方向。"));
  }

  const coverMatch = input.match(/^\/cover(?:\s+([\s\S]+))?$/i);
  if (coverMatch) {
    return entryRoute("short", commandBody(coverMatch[1], language === "en"
      ? "I want to create or redo a cover. Confirm the target with me first."
      : "我想生成或重做封面，请先和我确认目标。"));
  }

  const playMatch = input.match(/^\/play(?:\s+(open|guided))?(?:\s+([\s\S]+))?$/i);
  if (playMatch) {
    const playMode = playMatch[1]?.toLowerCase() as PlayMode | undefined;
    return {
      ...entryRoute("play", commandBody(playMatch[2], language === "en"
        ? "I want to start an interactive world. Confirm the opening with me first."
        : "我想启动互动世界，请先和我确认开局。")),
      ...(playMode ? { playMode } : {}),
    };
  }

  if (/^\/write$/i.test(input)) {
    return {
      userMessage: language === "en" ? "Write the next chapter" : "写下一章",
      sessionKind: activeBookId ? "book" : currentKind,
      actionSource: "slash",
      requestedIntent: "write_next",
    };
  }

  return {
    userMessage: input,
    sessionKind: currentKind,
    actionSource: "free-text",
    ...(session.playMode ? { playMode: session.playMode } : {}),
  };
}

function entryRoute(sessionKind: SessionKind, userMessage: string): TuiAgentRoute {
  return { userMessage, sessionKind, actionSource: "slash", detachBook: true };
}

function localConfirmationRoute(sessionKind: SessionKind, userMessage: string, localResponse: string): TuiAgentRoute {
  return { userMessage, sessionKind, actionSource: "slash", clearPending: true, localResponse };
}

function detachesFromBook(sessionKind: SessionKind): boolean {
  return sessionKind === "book-create"
    || sessionKind === "short"
    || sessionKind === "play"
    || sessionKind === "script"
    || sessionKind === "storyboard"
    || sessionKind === "interactive-film";
}

function commandBody(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function extractCreatedBookId(messages: ReadonlyArray<unknown>): string | undefined {
  for (const message of [...messages].reverse()) {
    const details = (message as { details?: { kind?: string; bookId?: string } }).details;
    if (details?.kind === "book_created" && details.bookId) return details.bookId;
  }
  return undefined;
}

function extractProposedAction(messages: ReadonlyArray<unknown>): PendingProposedAction | undefined {
  for (const message of [...messages].reverse()) {
    const details = (message as { details?: Record<string, unknown> }).details;
    if (!details || details.kind !== "proposed_action") continue;
    const action = RequestedIntentSchema.safeParse(details.action);
    const targetSessionKind = SessionKindSchema.safeParse(details.targetSessionKind);
    const instruction = typeof details.instruction === "string" ? details.instruction.trim() : "";
    const actionPayload = details.actionPayload === undefined
      ? { success: true as const, data: undefined }
      : ActionPayloadSchema.safeParse(details.actionPayload);
    if (!action.success || !targetSessionKind.success || !instruction || !actionPayload.success) continue;

    const requestedSkills = Array.isArray(details.requestedSkills)
      ? [...new Set(details.requestedSkills.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim().toLowerCase()))]
      : undefined;
    const playMode = actionPayload.data?.playStart?.mode;
    return {
      action: action.data,
      targetSessionKind: targetSessionKind.data,
      instruction,
      ...(typeof details.title === "string" && details.title.trim() ? { title: details.title.trim() } : {}),
      ...(typeof details.summary === "string" && details.summary.trim() ? { summary: details.summary.trim() } : {}),
      ...(playMode ? { playMode } : {}),
      ...(requestedSkills?.length ? { requestedSkills } : {}),
      ...(actionPayload.data ? { actionPayload: actionPayload.data } : {}),
    };
  }
  return undefined;
}

function formatProposedAction(action: PendingProposedAction, language: "zh" | "en"): string {
  return language === "en"
    ? [action.title ?? "Confirm action", action.summary ?? "Confirm to continue.", "", action.instruction, "", "Type /confirm to continue, or /cancel to cancel."].join("\n")
    : [action.title ?? "确认执行", action.summary ?? "确认后继续执行。", "", action.instruction, "", "输入 /confirm 继续，或 /cancel 取消。"].join("\n");
}
