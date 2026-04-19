import type { ChatState } from "./types";

const EMPTY_MESSAGES: readonly [] = [];

export const chatSelectors = {
  hasPendingTool: (s: ChatState) =>
    Boolean(s.activeSessionId && s.sessions[s.activeSessionId]?.pendingBookArgs),
  isCreating: (s: ChatState) => s.bookCreating,
  activeSession: (s: ChatState) => (s.activeSessionId ? s.sessions[s.activeSessionId] ?? null : null),
  activeMessages: (s: ChatState) =>
    (s.activeSessionId ? s.sessions[s.activeSessionId]?.messages : undefined) ?? EMPTY_MESSAGES,
  isActiveSessionStreaming: (s: ChatState) => Boolean(s.activeSessionId && s.sessions[s.activeSessionId]?.isStreaming),
  isEmpty: (s: ChatState) =>
    ((s.activeSessionId ? s.sessions[s.activeSessionId]?.messages.length : 0) ?? 0) === 0
    && !Boolean(s.activeSessionId && s.sessions[s.activeSessionId]?.isStreaming),
};
