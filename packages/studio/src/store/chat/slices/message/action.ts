import type { StateCreator } from "zustand";
import type {
  AgentResponse,
  ChatStore,
  MessageActions,
  SessionResponse,
  SessionSummary,
} from "../../types";
import { fetchJson } from "../../../../hooks/use-api";
import { attachSessionStreamListeners } from "./stream-events";
import {
  bookKey,
  createSessionRuntime,
  deserializeMessages,
  extractErrorMessage,
  mergeSessionIds,
  updateSession,
  upsertSessionSummary,
} from "./runtime";

export const createMessageSlice: StateCreator<ChatStore, [], [], MessageActions> = (set, get) => ({
  activateSession: (sessionId) =>
    set({ activeSessionId: sessionId }),

  setInput: (text) => set({ input: text }),

  addUserMessage: (sessionId, content) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (session) => ({
        messages: [...session.messages, { role: "user", content, timestamp: Date.now() }],
        lastError: null,
      })),
    })),

  appendStreamChunk: (sessionId, text, streamTs) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (session) => {
        const last = session.messages[session.messages.length - 1];
        if (last?.timestamp === streamTs && last.role === "assistant") {
          return {
            messages: [...session.messages.slice(0, -1), { ...last, content: last.content + text }],
          };
        }
        return {
          messages: [...session.messages, { role: "assistant", content: text, timestamp: streamTs }],
        };
      }),
    })),

  finalizeStream: (sessionId, streamTs, content, toolCall) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (session) => ({
        messages: session.messages.map((message) => {
          if (message.timestamp !== streamTs || message.role !== "assistant") return message;
          const parts = [...(message.parts ?? [])];
          const lastPart = parts[parts.length - 1];
          if (lastPart?.type === "text") {
            parts[parts.length - 1] = { ...lastPart, content };
          } else if (content) {
            parts.push({ type: "text", content });
          }
          return { ...message, content, toolCall, parts };
        }),
      })),
    })),

  replaceStreamWithError: (sessionId, streamTs, errorMsg) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (session) => ({
        messages: [
          ...session.messages.filter(
            (message) => !(message.timestamp === streamTs && message.role === "assistant"),
          ),
          { role: "assistant", content: `\u2717 ${errorMsg}`, timestamp: Date.now() },
        ],
        isStreaming: false,
        lastError: errorMsg,
        stream: null,
      })),
    })),

  addErrorMessage: (sessionId, errorMsg) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (session) => ({
        messages: [...session.messages, { role: "assistant", content: `\u2717 ${errorMsg}`, timestamp: Date.now() }],
        lastError: errorMsg,
      })),
    })),

  loadSessionMessages: (sessionId, msgs) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (session) => {
        if (session.messages.length > 0) return {};
        return { messages: deserializeMessages(msgs) };
      }),
    })),

  setSelectedModel: (model, service) => set({ selectedModel: model, selectedService: service }),

  loadSessionList: async (bookId) => {
    const query = bookId === null ? "null" : encodeURIComponent(bookId);
    try {
      const data = await fetchJson<{ sessions: ReadonlyArray<SessionSummary> }>(`/sessions?bookId=${query}`);
      set((state) => {
        let sessions = state.sessions;
        for (const summary of data.sessions) {
          sessions = upsertSessionSummary(sessions, summary);
        }
        return {
          sessions,
          sessionIdsByBook: {
            ...state.sessionIdsByBook,
            [bookKey(bookId)]: data.sessions.map((session) => session.sessionId),
          },
        };
      });
    } catch {
      // ignore
    }
  },

  createSession: async (bookId) => {
    const data = await fetchJson<SessionResponse>("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId }),
    });
    const sessionId = data.session?.sessionId;
    if (!sessionId) {
      throw new Error("Failed to create session");
    }

    set((state) => {
      const runtime = createSessionRuntime({
        sessionId,
        bookId: data.session?.bookId ?? bookId ?? null,
        title: data.session?.title ?? null,
      });
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: runtime,
        },
        sessionIdsByBook: {
          ...state.sessionIdsByBook,
          [bookKey(runtime.bookId)]: mergeSessionIds(
            state.sessionIdsByBook[bookKey(runtime.bookId)],
            [sessionId],
          ),
        },
        activeSessionId: sessionId,
      };
    });

    return sessionId;
  },

  createDraftSession: (bookId) => {
    // 前端生成 sessionId（与后端 createBookSession 同格式），暂不持久化到磁盘，
    // 也暂不写入 sessionIdsByBook——侧边栏看不到这条 draft。
    // 发送第一条消息时 sendMessage 会调 POST /sessions { sessionId, bookId } 落盘
    // 并把 id 追加进 sessionIdsByBook，那一刻侧边栏才出现该会话（带着 title）。
    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((state) => {
      const runtime = createSessionRuntime({
        sessionId,
        bookId,
        title: null,
        isDraft: true,
      });
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: runtime,
        },
        activeSessionId: sessionId,
      };
    });
    return sessionId;
  },

  renameSession: async (sessionId, title) => {
    const previous = get().sessions[sessionId]?.title ?? null;
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, () => ({ title })),
    }));

    try {
      await fetchJson(`/sessions/${sessionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
    } catch {
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, () => ({ title: previous })),
      }));
    }
  },

  deleteSession: async (sessionId) => {
    const session = get().sessions[sessionId];
    session?.stream?.close();
    // 草稿会话还没写到磁盘，跳过 DELETE 请求避免后端返回 404
    if (session && !session.isDraft) {
      try {
        await fetchJson(`/sessions/${sessionId}`, { method: "DELETE" });
      } catch {
        // ignore
      }
    }

    set((state) => {
      const { [sessionId]: deleted, ...rest } = state.sessions;
      const sessionIdsByBook = Object.fromEntries(
        Object.entries(state.sessionIdsByBook).map(([key, ids]) => [
          key,
          ids.filter((id) => id !== sessionId),
        ]),
      );

      let activeSessionId = state.activeSessionId;
      if (activeSessionId === sessionId) {
        const fallbackKey = bookKey(session?.bookId ?? null);
        activeSessionId = sessionIdsByBook[fallbackKey]?.[0] ?? null;
      }

      return {
        sessions: rest,
        sessionIdsByBook,
        activeSessionId,
      };
    });
  },

  loadSessionDetail: async (sessionId) => {
    // 草稿会话：磁盘上还没有文件，直接跳过远端拉取。
    // 本地已有消息：不拉取远端，避免流式中或未持久化的消息被覆盖。
    const existing = get().sessions[sessionId];
    if (existing?.isDraft) return;
    if (existing && existing.messages.length > 0) return;

    try {
      const data = await fetchJson<SessionResponse>(`/sessions/${sessionId}`);
      const detail = data.session;
      if (!detail?.sessionId) return;
      const detailSessionId = detail.sessionId;
      const messages = detail.messages ? deserializeMessages(detail.messages) : [];

      set((state) => {
        const runtime = state.sessions[detailSessionId];
        // set 执行到这里可能已有本地消息写入（比如并发 sendMessage），再查一次。
        if (runtime && runtime.messages.length > 0) return {};
        const nextBookId = detail.bookId ?? runtime?.bookId ?? null;
        return {
          sessions: {
            ...state.sessions,
            [detailSessionId]: {
              ...(runtime ?? createSessionRuntime({
                sessionId: detailSessionId,
                bookId: nextBookId,
                title: detail.title ?? null,
              })),
              bookId: nextBookId,
              title: detail.title ?? runtime?.title ?? null,
              messages,
            },
          },
          sessionIdsByBook: {
            ...state.sessionIdsByBook,
            [bookKey(nextBookId)]: mergeSessionIds(
              state.sessionIdsByBook[bookKey(nextBookId)],
              [detailSessionId],
            ),
          },
        };
      });
    } catch {
      // ignore
    }
  },

  sendMessage: async (sessionId, text, activeBookId) => {
    const trimmed = text.trim();
    const session = get().sessions[sessionId];
    if (!trimmed || !session || session.isStreaming) return;

    if (!get().selectedModel) {
      get().addUserMessage(sessionId, trimmed);
      get().addErrorMessage(sessionId, "请先选择一个模型");
      return;
    }

    // 草稿会话：第一条消息发送时才真正把 session 文件写到磁盘。
    // 后端 POST /sessions 支持接受客户端传入的 sessionId，所以 id 保持一致，
    // 前端 store 里的 runtime 不用 remount，只需要把 isDraft 翻成 false。
    if (session.isDraft) {
      try {
        await fetchJson<SessionResponse>("/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, bookId: session.bookId }),
        });
        // 落盘成功：把 isDraft 翻成 false，同时把 sessionId 追加进 sessionIdsByBook
        // 让侧边栏现在才看到这条会话。
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
      } catch (err) {
        get().addErrorMessage(sessionId, err instanceof Error ? err.message : String(err));
        return;
      }
    }

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

      const finalContent = data.details?.draftRaw || data.response || "";
      const toolCall = data.details?.toolCall ?? undefined;
      const hasStream = Boolean(
        get().sessions[sessionId]?.messages.some((message) => message.timestamp === streamTs),
      );

      if (data.error) {
        const errorMessage = extractErrorMessage(data.error);
        if (hasStream) {
          get().replaceStreamWithError(sessionId, streamTs, errorMessage);
        } else {
          get().addErrorMessage(sessionId, errorMessage);
        }
      } else if (finalContent) {
        if (hasStream) {
          get().finalizeStream(sessionId, streamTs, finalContent, toolCall);
        } else {
          set((state) => ({
            sessions: updateSession(state.sessions, sessionId, (runtime) => ({
              messages: [
                ...runtime.messages,
                {
                  role: "assistant",
                  content: finalContent,
                  timestamp: Date.now(),
                  toolCall,
                },
              ],
            })),
          }));
        }
        if (toolCall?.name === "create_book") {
          set((state) => ({
            sessions: updateSession(state.sessions, sessionId, () => ({
              pendingBookArgs: { ...toolCall.arguments },
            })),
          }));
        }
      } else {
        const emptyMessage = "模型未返回文本内容。请检查协议类型（chat/responses）、流式开关或上游服务兼容性。";
        if (hasStream) {
          get().replaceStreamWithError(sessionId, streamTs, emptyMessage);
        } else {
          get().addErrorMessage(sessionId, emptyMessage);
        }
      }
    } catch (error) {
      streamEs.close();
      const errorMessage = error instanceof Error ? error.message : String(error);
      const hasStream = Boolean(
        get().sessions[sessionId]?.messages.some((message) => message.timestamp === streamTs),
      );
      if (hasStream) {
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
  },
});
