import type { StateCreator } from "zustand";
import type { ChatStore, MessageActions, AgentResponse, SessionMessage } from "../../types";
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
      m.timestamp === streamTs && m.role === "assistant" ? { ...m, content, toolCall } : m,
    ),
  })),

  replaceStreamWithError: (streamTs, errorMsg) => set((s) => ({
    messages: [
      ...s.messages.filter((m) => !(m.timestamp === streamTs && m.role === "assistant")),
      { role: "assistant" as const, content: `\u2717 ${errorMsg}`, timestamp: Date.now() },
    ],
  })),

  addErrorMessage: (errorMsg) => set((s) => ({
    messages: [...s.messages, { role: "assistant" as const, content: `\u2717 ${errorMsg}`, timestamp: Date.now() }],
  })),

  setLoading: (loading) => set({ loading }),

  setSelectedModel: (model, service) => set({ selectedModel: model, selectedService: service }),

  loadSessionMessages: (msgs) => set((s) => {
    if (s.messages.length > 0) return s;
    return {
      messages: msgs
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
          thinking: m.thinking,
          timestamp: m.timestamp,
        })),
    };
  }),

  loadSession: async (bookId) => {
    try {
      const data = await fetchJson<{ session: { sessionId: string; messages?: SessionMessage[] } }>("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId: bookId ?? null }),
      });
      const session = data.session;
      const prevSessionId = get().currentSessionId;

      // Same session + already have messages → skip reload
      if (prevSessionId === session.sessionId && get().messages.length > 0) {
        return;
      }

      // Different session → close stream, stop loading, switch
      get()._activeStream?.close();
      set({ currentSessionId: session.sessionId, messages: [], loading: false, _activeStream: null });
      if (session.messages && session.messages.length > 0) {
        get().loadSessionMessages(session.messages);
      }
    } catch {
      set({ currentSessionId: null, messages: [], loading: false });
    }
  },

  sendMessage: async (text, activeBookId) => {
    const trimmed = text.trim();
    if (!trimmed || get().loading) return;

    // Check if model is selected
    if (!get().selectedModel) {
      get().addUserMessage(trimmed);
      get().addErrorMessage("请先选择一个模型");
      return;
    }

    const hasBook = Boolean(activeBookId);
    const instruction = hasBook ? trimmed : `/new ${trimmed}`;
    const streamTs = Date.now() + 1;

    set({ input: "", loading: true });
    get().addUserMessage(trimmed);

    // Close any previous stream
    get()._activeStream?.close();
    const streamEs = new EventSource("/api/v1/events");
    set({ _activeStream: streamEs });

    streamEs.addEventListener("thinking:start", () => {
      // Create or update the streaming message with thinking state
      set((s) => {
        const last = s.messages[s.messages.length - 1];
        if (last?.timestamp === streamTs && last.role === "assistant") {
          return { messages: [...s.messages.slice(0, -1), { ...last, thinking: "", thinkingStreaming: true }] };
        }
        return { messages: [...s.messages, { role: "assistant" as const, content: "", thinking: "", thinkingStreaming: true, timestamp: streamTs }] };
      });
    });

    streamEs.addEventListener("thinking:delta", (e: MessageEvent) => {
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        if (!d?.text) return;
        set((s) => {
          const last = s.messages[s.messages.length - 1];
          if (last?.timestamp === streamTs && last.role === "assistant") {
            return { messages: [...s.messages.slice(0, -1), { ...last, thinking: (last.thinking ?? "") + d.text }] };
          }
          return s;
        });
      } catch { /* ignore */ }
    });

    streamEs.addEventListener("thinking:end", () => {
      set((s) => {
        const last = s.messages[s.messages.length - 1];
        if (last?.timestamp === streamTs && last.role === "assistant") {
          return { messages: [...s.messages.slice(0, -1), { ...last, thinkingStreaming: false }] };
        }
        return s;
      });
    });

    streamEs.addEventListener("draft:delta", (e: MessageEvent) => {
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        if (d?.text) get().appendStreamChunk(d.text, streamTs);
      } catch { /* ignore */ }
    });

    streamEs.addEventListener("tool:start", (e: MessageEvent) => {
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        if (d?.tool === "sub_agent") {
          const agent = (d.args as Record<string, unknown>)?.agent as string | undefined;
          const labels: Record<string, string> = { writer: "正在写作", auditor: "正在审计", reviser: "正在修订", exporter: "正在导出" };
          set({ activeOperation: labels[agent ?? ""] ?? `执行 ${agent}` });
        }
      } catch { /* ignore */ }
    });

    streamEs.addEventListener("tool:end", (e: MessageEvent) => {
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        if (d?.tool) {
          set({ activeOperation: null });
          // Bump bookDataVersion to refresh sidebar after tool completion
          get().bumpBookDataVersion();
        }
      } catch { /* ignore */ }
    });

    try {
      const data = await fetchJson<AgentResponse>("/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction,
          activeBookId,
          sessionId: get().currentSessionId,
          model: get().selectedModel ?? undefined,
          service: get().selectedService ?? undefined,
        }),
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
      set({ loading: false, _activeStream: null });
    }
  },
});
