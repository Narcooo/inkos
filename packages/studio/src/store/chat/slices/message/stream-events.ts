import type { StateCreator } from "zustand";
import type { ChatStore, MessageActions } from "../../types";
import { shouldRefreshSidebarForTool } from "../../message-policy";
import {
  sessionMatchesEvent,
  updateSession,
} from "./runtime";
import {
  applyDraftDelta,
  applyLlmProgress,
  applyThinkingDelta,
  applyThinkingEnd,
  applyThinkingStart,
  applyToolEnd,
  applyToolLog,
  applyToolStart,
} from "./stream-reducers";

type SliceSet = Parameters<StateCreator<ChatStore, [], [], MessageActions>>[0];
type SliceGet = Parameters<StateCreator<ChatStore, [], [], MessageActions>>[1];

interface AttachSessionStreamListenersInput {
  sessionId: string;
  streamTs: number;
  streamEs: EventSource;
  set: SliceSet;
  get: SliceGet;
}

export function attachSessionStreamListeners({
  sessionId,
  streamTs,
  streamEs,
  set,
  get,
}: AttachSessionStreamListenersInput): void {
  streamEs.addEventListener("thinking:start", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data)) return;
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) =>
          applyThinkingStart(runtime, streamTs)
        ),
      }));
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("thinking:delta", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.text) return;
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) =>
          applyThinkingDelta(runtime, streamTs, data.text as string)
        ),
      }));
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("thinking:end", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data)) return;
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) =>
          applyThinkingEnd(runtime, streamTs)
        ),
      }));
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("draft:delta", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.text) return;
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) =>
          applyDraftDelta(runtime, streamTs, data.text as string)
        ),
      }));
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("tool:start", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.tool) return;
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) =>
          applyToolStart(runtime, streamTs, data as Record<string, unknown>)
        ),
      }));
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("tool:end", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.tool) return;
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) =>
          applyToolEnd(runtime, streamTs, data as Record<string, unknown>)
        ),
      }));

      if (shouldRefreshSidebarForTool(data.tool as string)) {
        get().bumpBookDataVersion();
      }
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("log", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data)) return;
      const message = data?.message as string | undefined;
      if (!message) return;
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) =>
          applyToolLog(runtime, streamTs, message)
        ),
      }));
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("llm:progress", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data)) return;
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) =>
          applyLlmProgress(runtime, streamTs, data as Record<string, unknown>)
        ),
      }));
    } catch {
      // ignore
    }
  });
}
