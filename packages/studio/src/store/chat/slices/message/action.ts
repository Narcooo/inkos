import type { StateCreator } from "zustand";
import type {
  ChatStore,
  MessageActions,
} from "../../types";
import { sendChatMessage } from "./send-message";
import {
  deserializeMessages,
  updateSession,
} from "./runtime";
import {
  createDraftSessionAction,
  createSessionAction,
  deleteSessionAction,
  loadSessionDetailAction,
  loadSessionListAction,
  renameSessionAction,
} from "./session-actions";

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

  loadSessionList: (bookId) => loadSessionListAction(set, bookId),

  createSession: (bookId) => createSessionAction(set, bookId),

  createDraftSession: (bookId) => createDraftSessionAction(set, bookId),

  renameSession: (sessionId, title) => renameSessionAction(set, get, sessionId, title),

  deleteSession: (sessionId) => deleteSessionAction(set, get, sessionId),

  loadSessionDetail: (sessionId) => loadSessionDetailAction(set, get, sessionId),

  sendMessage: (sessionId, text, activeBookId) =>
    sendChatMessage({ activeBookId, get, sessionId, set, text }),
});
