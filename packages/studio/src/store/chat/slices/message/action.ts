import type { StateCreator } from "zustand";
import type { ChatStore, MessageActions, AgentResponse, SessionResponse } from "../../types";
import { fetchJson } from "../../../../hooks/use-api";

function extractErrorMessage(error: string | { code?: string; message?: string }): string {
  if (typeof error === "string") return error;
  return error.message ?? "Unknown error";
}

export const createMessageSlice: StateCreator<ChatStore, [], [], MessageActions> = (set, get) => ({
  setInput: (text) => set({ input: text }),

  addUserMessage: (content) => set((s) => ({
    messages: [...s.messages, { role: "user" as const, content, timestamp: Date.now() }],
  })),

  appendStreamChunk: (text, streamTs) => set((s) => {
    const last = s.messages[s.messages.length - 1];
    if (last?.timestamp === streamTs && last.role === "assistant") {
      return { messages: [...s.messages.slice(0, -1), { ...last, content: last.content + text }] };
    }
    return { messages: [...s.messages, { role: "assistant" as const, content: text, timestamp: streamTs }] };
  }),

  finalizeStream: (streamTs, content, toolCall) => set((s) => ({
    messages: s.messages.map((m) =>
      m.timestamp === streamTs ? { ...m, content, toolCall } : m,
    ),
  })),

  replaceStreamWithError: (streamTs, errorMsg) => set((s) => ({
    messages: [
      ...s.messages.filter((m) => m.timestamp !== streamTs),
      { role: "assistant" as const, content: `\u2717 ${errorMsg}`, timestamp: Date.now() },
    ],
  })),

  addErrorMessage: (errorMsg) => set((s) => ({
    messages: [...s.messages, { role: "assistant" as const, content: `\u2717 ${errorMsg}`, timestamp: Date.now() }],
  })),

  setLoading: (loading) => set({ loading }),

  loadSessionMessages: (msgs) => set((s) => {
    if (s.messages.length > 0) return s;
    return {
      messages: msgs
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content, timestamp: m.timestamp })),
    };
  }),

  loadSession: async () => {
    try {
      const data = await fetchJson<SessionResponse>("/interaction/session");
      const sessionMessages = data.session?.messages;
      if (sessionMessages && sessionMessages.length > 0) {
        get().loadSessionMessages(sessionMessages);
      }
    } catch {
      // Session load failed — start with empty state
    }
  },

  sendMessage: async (text, activeBookId) => {
    const trimmed = text.trim();
    if (!trimmed || get().loading) return;

    const hasBook = Boolean(activeBookId);
    const instruction = hasBook ? trimmed : `/new ${trimmed}`;
    const streamTs = Date.now() + 1;

    set({ input: "", loading: true });
    get().addUserMessage(trimmed);

    const streamEs = new EventSource("/api/events");
    streamEs.addEventListener("draft:delta", (e: MessageEvent) => {
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        if (d?.text) get().appendStreamChunk(d.text, streamTs);
      } catch { /* ignore */ }
    });

    try {
      const data = await fetchJson<AgentResponse>("/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction, activeBookId }),
      });

      streamEs.close();

      const finalContent = data.details?.draftRaw || data.response || "Acknowledged.";
      const toolCall = data.details?.toolCall ?? undefined;
      const hasStream = get().messages.some((m) => m.timestamp === streamTs);

      if (data.error) {
        if (hasStream) {
          get().replaceStreamWithError(streamTs, extractErrorMessage(data.error));
        } else {
          get().addErrorMessage(extractErrorMessage(data.error));
        }
      } else {
        if (hasStream) {
          get().finalizeStream(streamTs, finalContent, toolCall);
        } else {
          set((s) => ({
            messages: [...s.messages, {
              role: "assistant" as const, content: finalContent, timestamp: Date.now(), toolCall,
            }],
          }));
        }
        if (toolCall?.name === "create_book") {
          get().setPendingBookArgs({ ...toolCall.arguments });
        }
      }
    } catch (e) {
      streamEs.close();
      const errorMsg = e instanceof Error ? e.message : String(e);
      const hasStream = get().messages.some((m) => m.timestamp === streamTs);
      if (hasStream) {
        get().replaceStreamWithError(streamTs, errorMsg);
      } else {
        get().addErrorMessage(errorMsg);
      }
    } finally {
      set({ loading: false });
    }
  },
});
