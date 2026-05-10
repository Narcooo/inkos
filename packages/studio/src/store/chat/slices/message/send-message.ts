import type { StateCreator } from "zustand";
import { fetchJson } from "../../../../hooks/use-api";
import type {
  AgentResponse,
  ChatStore,
  MessageActions,
  SessionResponse,
  ToolCall,
} from "../../types";
import { attachSessionStreamListeners } from "./stream-events";
import {
  bookKey,
  extractErrorMessage,
  mergeSessionIds,
  updateSession,
} from "./runtime";

type SliceSet = Parameters<StateCreator<ChatStore, [], [], MessageActions>>[0];
type SliceGet = Parameters<StateCreator<ChatStore, [], [], MessageActions>>[1];

interface SendMessageInput {
  activeBookId?: string;
  get: SliceGet;
  sessionId: string;
  set: SliceSet;
  text: string;
}

async function persistDraftSession({
  get,
  sessionId,
  set,
}: Pick<SendMessageInput, "get" | "sessionId" | "set">): Promise<boolean> {
  const session = get().sessions[sessionId];
  if (!session?.isDraft) return true;

  try {
    await fetchJson<SessionResponse>("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, bookId: session.bookId }),
    });
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, () => ({ isDraft: false })),
      sessionIdsByBook: {
        ...state.sessionIdsByBook,
        [bookKey(session.bookId)]: mergeSessionIds(
          state.sessionIdsByBook[bookKey(session.bookId)],
          [sessionId],
        ),
      },
    }));
    return true;
  } catch (error) {
    get().addErrorMessage(sessionId, error instanceof Error ? error.message : String(error));
    return false;
  }
}

function hasStreamMessage(get: SliceGet, sessionId: string, streamTs: number): boolean {
  return Boolean(
    get().sessions[sessionId]?.messages.some((message) => message.timestamp === streamTs),
  );
}

function appendAssistantMessage(
  set: SliceSet,
  sessionId: string,
  content: string,
  toolCall: ToolCall | undefined,
): void {
  set((state) => ({
    sessions: updateSession(state.sessions, sessionId, (runtime) => ({
      messages: [
        ...runtime.messages,
        {
          role: "assistant",
          content,
          timestamp: Date.now(),
          toolCall,
        },
      ],
    })),
  }));
}

function handleAgentResponse({
  data,
  get,
  sessionId,
  set,
  streamTs,
}: Pick<SendMessageInput, "get" | "sessionId" | "set"> & {
  data: AgentResponse;
  streamTs: number;
}): void {
  const finalContent = data.details?.draftRaw || data.response || "";
  const toolCall = data.details?.toolCall ?? undefined;
  const hasStream = hasStreamMessage(get, sessionId, streamTs);

  if (data.error) {
    const errorMessage = extractErrorMessage(data.error);
    if (hasStream) get().replaceStreamWithError(sessionId, streamTs, errorMessage);
    else get().addErrorMessage(sessionId, errorMessage);
    return;
  }

  if (finalContent) {
    if (hasStream) {
      get().finalizeStream(sessionId, streamTs, finalContent, toolCall);
    } else {
      appendAssistantMessage(set, sessionId, finalContent, toolCall);
    }
    return;
  }

  const emptyMessage = "模型未返回文本内容。请检查协议类型（chat/responses）、流式开关或上游服务兼容性。";
  if (hasStream) get().replaceStreamWithError(sessionId, streamTs, emptyMessage);
  else get().addErrorMessage(sessionId, emptyMessage);
}

export async function sendChatMessage({
  activeBookId,
  get,
  sessionId,
  set,
  text,
}: SendMessageInput): Promise<void> {
  const trimmed = text.trim();
  const session = get().sessions[sessionId];
  if (!trimmed || !session || session.isStreaming) return;

  if (!get().selectedModel) {
    get().addUserMessage(sessionId, trimmed);
    get().addErrorMessage(sessionId, "请先选择一个模型");
    return;
  }

  const draftReady = await persistDraftSession({ get, sessionId, set });
  if (!draftReady) return;

  const instruction = activeBookId ? trimmed : `/new ${trimmed}`;
  const streamTs = Date.now() + 1;

  set((state) => ({
    input: "",
    activeSessionId: sessionId,
    sessions: updateSession(state.sessions, sessionId, () => ({
      isStreaming: true,
      lastError: null,
    })),
  }));

  get().addUserMessage(sessionId, trimmed);
  session.stream?.close();
  const streamEs = new EventSource("/api/v1/events");
  set((state) => ({
    sessions: updateSession(state.sessions, sessionId, () => ({ stream: streamEs })),
  }));
  attachSessionStreamListeners({ sessionId, streamTs, streamEs, set, get });

  try {
    const data = await fetchJson<AgentResponse>("/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instruction,
        activeBookId,
        sessionId,
        model: get().selectedModel ?? undefined,
        service: get().selectedService ?? undefined,
      }),
    });

    streamEs.close();
    handleAgentResponse({ data, get, sessionId, set, streamTs });
  } catch (error) {
    streamEs.close();
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (hasStreamMessage(get, sessionId, streamTs)) {
      get().replaceStreamWithError(sessionId, streamTs, errorMessage);
    } else {
      get().addErrorMessage(sessionId, errorMessage);
    }
  } finally {
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (runtime) => ({
        isStreaming: false,
        stream: runtime.stream === streamEs ? null : runtime.stream,
      })),
    }));
  }
}
