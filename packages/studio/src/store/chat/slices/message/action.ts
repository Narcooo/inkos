import type { StateCreator } from "zustand";
import type { ChatStore, MessageActions, AgentResponse, SessionMessage, Message, MessagePart, ToolExecution, PipelineStage } from "../../types";
import { fetchJson } from "../../../../hooks/use-api";

function extractErrorMessage(error: string | { code?: string; message?: string }): string {
  if (typeof error === "string") return error;
  return error.message ?? "Unknown error";
}

// -- Tool label helpers --

const AGENT_LABELS: Record<string, string> = {
  architect: "建书", writer: "写作", auditor: "审计",
  reviser: "修订", exporter: "导出",
};
const TOOL_LABELS: Record<string, string> = {
  read: "读取文件", edit: "编辑文件", grep: "搜索", ls: "列目录",
};

function resolveToolLabel(tool: string, agent?: string): string {
  if (tool === "sub_agent" && agent) return AGENT_LABELS[agent] ?? agent;
  return TOOL_LABELS[tool] ?? tool;
}

function summarizeResult(result: unknown): string {
  if (typeof result === "string") return result.slice(0, 200);
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.content === "string") return r.content.slice(0, 200);
  }
  return String(result).slice(0, 200);
}

function extractToolError(result: unknown): string {
  if (typeof result === "string") return result.slice(0, 500);
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.content === "string") return r.content.slice(0, 500);
    if (r.content && Array.isArray(r.content)) {
      const textPart = r.content.find((c: any) => c.type === "text");
      if (textPart) return (textPart as any).text?.slice(0, 500) ?? "";
    }
  }
  return String(result).slice(0, 500);
}

// -- Parts helpers --

/** Get or create the streaming assistant message, returning [updatedMessages, streamMsg]. */
function getOrCreateStream(messages: ReadonlyArray<Message>, streamTs: number): [ReadonlyArray<Message>, Message] {
  const last = messages[messages.length - 1];
  if (last?.timestamp === streamTs && last.role === "assistant") {
    return [messages, last];
  }
  const newMsg: Message = { role: "assistant", content: "", timestamp: streamTs, parts: [] };
  return [[...messages, newMsg], newMsg];
}

/** Replace the last message with an updated version. */
function replaceLast(messages: ReadonlyArray<Message>, updated: Message): ReadonlyArray<Message> {
  return [...messages.slice(0, -1), updated];
}

/** Find the last tool part that is "running" in a parts array. */
function findRunningToolPart(parts: MessagePart[]): (MessagePart & { type: "tool" }) | undefined {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.type === "tool" && p.execution.status === "running") return p as MessagePart & { type: "tool" };
  }
  return undefined;
}

/** Derive flat fields (content, thinking, toolExecutions) from parts for persistence compatibility. */
function deriveFlat(parts: MessagePart[]): { content: string; thinking?: string; thinkingStreaming?: boolean; toolExecutions?: ToolExecution[] } {
  let content = "";
  let thinking = "";
  let thinkingStreaming = false;
  const toolExecutions: ToolExecution[] = [];

  for (const p of parts) {
    if (p.type === "thinking") {
      if (thinking) thinking += "\n\n---\n\n";
      thinking += p.content;
      if (p.streaming) thinkingStreaming = true;
    } else if (p.type === "text") {
      content += p.content;
    } else if (p.type === "tool") {
      toolExecutions.push(p.execution);
    }
  }

  return {
    content,
    ...(thinking ? { thinking } : {}),
    ...(thinkingStreaming ? { thinkingStreaming: true } : {}),
    ...(toolExecutions.length > 0 ? { toolExecutions } : {}),
  };
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
    messages: s.messages.map((m) => {
      if (m.timestamp !== streamTs || m.role !== "assistant") return m;
      // Update the last text part in parts, or add one
      const parts = [...(m.parts ?? [])];
      const lastPart = parts[parts.length - 1];
      if (lastPart?.type === "text") {
        parts[parts.length - 1] = { ...lastPart, content };
      } else if (content) {
        parts.push({ type: "text", content });
      }
      return { ...m, content, toolCall, parts };
    }),
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
        .map((m) => {
          const toolExecs = (m as any).toolExecutions as ToolExecution[] | undefined;
          // Rebuild parts from flat fields for historical messages
          const parts: MessagePart[] = [];
          if (m.thinking) parts.push({ type: "thinking", content: m.thinking, streaming: false });
          if (toolExecs) {
            for (const exec of toolExecs) parts.push({ type: "tool", execution: exec });
          }
          if (m.content) parts.push({ type: "text", content: m.content });
          return {
            role: m.role as "user" | "assistant",
            content: m.content,
            thinking: m.thinking,
            toolExecutions: toolExecs,
            timestamp: m.timestamp,
            parts: parts.length > 0 ? parts : undefined,
          };
        }),
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

      if (prevSessionId === session.sessionId && get().messages.length > 0) {
        return;
      }

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

    get()._activeStream?.close();
    const streamEs = new EventSource("/api/v1/events");
    set({ _activeStream: streamEs });

    // ---------------------------------------------------------------
    // SSE listeners — each event updates `parts` as source of truth,
    // then derives flat fields (content/thinking/toolExecutions) for
    // persistence compatibility.
    // ---------------------------------------------------------------

    streamEs.addEventListener("thinking:start", () => {
      set((s) => {
        const [msgs, stream] = getOrCreateStream(s.messages, streamTs);
        const parts = [...(stream.parts ?? [])];
        parts.push({ type: "thinking", content: "", streaming: true });
        const flat = deriveFlat(parts);
        return { messages: replaceLast(msgs, { ...stream, ...flat, parts }) };
      });
    });

    streamEs.addEventListener("thinking:delta", (e: MessageEvent) => {
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        if (!d?.text) return;
        set((s) => {
          const [msgs, stream] = getOrCreateStream(s.messages, streamTs);
          const parts = [...(stream.parts ?? [])];
          const last = parts[parts.length - 1];
          if (last?.type === "thinking") {
            parts[parts.length - 1] = { ...last, content: last.content + d.text };
          }
          const flat = deriveFlat(parts);
          return { messages: replaceLast(msgs, { ...stream, ...flat, parts }) };
        });
      } catch { /* ignore */ }
    });

    streamEs.addEventListener("thinking:end", () => {
      set((s) => {
        const [msgs, stream] = getOrCreateStream(s.messages, streamTs);
        const parts = [...(stream.parts ?? [])];
        const last = parts[parts.length - 1];
        if (last?.type === "thinking") {
          parts[parts.length - 1] = { ...last, streaming: false };
        }
        const flat = deriveFlat(parts);
        return { messages: replaceLast(msgs, { ...stream, ...flat, parts }) };
      });
    });

    streamEs.addEventListener("draft:delta", (e: MessageEvent) => {
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        if (!d?.text) return;
        set((s) => {
          const [msgs, stream] = getOrCreateStream(s.messages, streamTs);
          const parts = [...(stream.parts ?? [])];
          const last = parts[parts.length - 1];
          if (last?.type === "text") {
            parts[parts.length - 1] = { ...last, content: last.content + d.text };
          } else {
            parts.push({ type: "text", content: d.text });
          }
          const flat = deriveFlat(parts);
          return { messages: replaceLast(msgs, { ...stream, ...flat, parts }) };
        });
      } catch { /* ignore */ }
    });

    streamEs.addEventListener("tool:start", (e: MessageEvent) => {
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        if (!d?.tool) return;

        set((s) => {
          const [msgs, stream] = getOrCreateStream(s.messages, streamTs);
          const parts = [...(stream.parts ?? [])];

          // For pipeline ops (sub_agent), move trailing text to thinking
          if (d.tool === "sub_agent") {
            const last = parts[parts.length - 1];
            if (last?.type === "text" && last.content) {
              parts.pop();
              const prev = parts[parts.length - 1];
              if (prev?.type === "thinking") {
                parts[parts.length - 1] = { ...prev, content: prev.content + (prev.content ? "\n\n" : "") + last.content };
              } else {
                parts.push({ type: "thinking", content: last.content, streaming: false });
              }
            }
          }

          const agent = d.tool === "sub_agent" ? (d.args?.agent as string | undefined) : undefined;
          const stages: PipelineStage[] | undefined = (d.stages as string[] | undefined)?.length
            ? (d.stages as string[]).map((label) => ({ label, status: "pending" as const }))
            : undefined;

          const exec: ToolExecution = {
            id: d.id as string,
            tool: d.tool as string,
            agent,
            label: resolveToolLabel(d.tool, agent),
            status: "running",
            args: d.args as Record<string, unknown> | undefined,
            stages,
            startedAt: Date.now(),
          };

          parts.push({ type: "tool", execution: exec });
          const flat = deriveFlat(parts);
          return { messages: replaceLast(msgs, { ...stream, ...flat, parts }) };
        });
      } catch { /* ignore */ }
    });

    streamEs.addEventListener("tool:end", (e: MessageEvent) => {
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        if (!d?.tool) return;

        set((s) => {
          const [msgs, stream] = getOrCreateStream(s.messages, streamTs);
          const parts = (stream.parts ?? []).map((p) => {
            if (p.type !== "tool" || p.execution.id !== d.id) return p;
            const exec = { ...p.execution };
            exec.status = d.isError ? "error" : "completed";
            exec.completedAt = Date.now();
            if (d.isError) exec.error = extractToolError(d.result);
            else exec.result = summarizeResult(d.result);
            exec.stages = exec.stages?.map((s) =>
              s.status !== "completed" ? { ...s, status: "completed" as const, progress: undefined } : s
            );
            return { type: "tool" as const, execution: exec };
          });
          const flat = deriveFlat(parts);
          return { messages: replaceLast(msgs, { ...stream, ...flat, parts }) };
        });

        get().bumpBookDataVersion();
      } catch { /* ignore */ }
    });

    streamEs.addEventListener("log", (e: MessageEvent) => {
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        const msg = d?.message as string | undefined;
        if (!msg) return;

        set((s) => {
          const [msgs, stream] = getOrCreateStream(s.messages, streamTs);
          const runningTool = findRunningToolPart([...(stream.parts ?? [])]);
          if (!runningTool) return s;

          const parts = (stream.parts ?? []).map((p) => {
            if (p.type !== "tool" || p.execution.id !== runningTool.execution.id) return p;
            return { type: "tool" as const, execution: { ...p.execution, logs: [...(p.execution.logs ?? []), msg] } };
          });
          const flat = deriveFlat(parts);
          return { messages: replaceLast(msgs, { ...stream, ...flat, parts }) };
        });
      } catch { /* ignore */ }
    });

    streamEs.addEventListener("llm:progress", (e: MessageEvent) => {
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        if (!d) return;

        set((s) => {
          const [msgs, stream] = getOrCreateStream(s.messages, streamTs);
          const runningTool = findRunningToolPart([...(stream.parts ?? [])]);
          if (!runningTool?.execution.stages) return s;

          const parts = (stream.parts ?? []).map((p) => {
            if (p.type !== "tool" || p.execution.id !== runningTool.execution.id) return p;
            const stages = p.execution.stages!.map((stage) =>
              stage.status === "active"
                ? { ...stage, progress: { status: d.status, elapsedMs: d.elapsedMs, totalChars: d.totalChars, chineseChars: d.chineseChars } }
                : stage
            );
            return { type: "tool" as const, execution: { ...p.execution, stages } };
          });
          const flat = deriveFlat(parts);
          return { messages: replaceLast(msgs, { ...stream, ...flat, parts }) };
        });
      } catch { /* ignore */ }
    });

    // -- API call + finalize --

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
