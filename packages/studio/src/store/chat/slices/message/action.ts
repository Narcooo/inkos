import type { StateCreator } from "zustand";
import type { ChatStore, MessageActions, AgentResponse, SessionMessage, Message } from "../../types";
import { fetchJson } from "../../../../hooks/use-api";

function extractErrorMessage(error: string | { code?: string; message?: string }): string {
  if (typeof error === "string") return error;
  return error.message ?? "Unknown error";
}

// -- Tool execution helpers --

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

/** Mark all "processing" tool executions as "completed" on the streaming message. */
function markProcessingCompleted(messages: ReadonlyArray<Message>, streamTs: number): ReadonlyArray<Message> {
  const last = messages[messages.length - 1];
  if (!last || last.timestamp !== streamTs || last.role !== "assistant") return messages;
  const hasProcessing = last.toolExecutions?.some(t => t.status === "processing");
  if (!hasProcessing) return messages;
  return [...messages.slice(0, -1), {
    ...last,
    toolExecutions: last.toolExecutions!.map(t =>
      t.status === "processing" ? { ...t, status: "completed" as const } : t
    ),
  }];
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
    messages: markProcessingCompleted(s.messages, streamTs).map((m) => {
      if (m.timestamp !== streamTs || m.role !== "assistant") return m;
      return { ...m, content, toolCall };
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
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
          thinking: m.thinking,
          toolExecutions: (m as any).toolExecutions,
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

    // Close any previous stream
    get()._activeStream?.close();
    const streamEs = new EventSource("/api/v1/events");
    set({ _activeStream: streamEs });

    // -- thinking events (append mode, not overwrite) --

    streamEs.addEventListener("thinking:start", () => {
      set((s) => {
        const msgs = markProcessingCompleted(s.messages, streamTs);
        const last = msgs[msgs.length - 1];
        if (last?.timestamp === streamTs && last.role === "assistant") {
          const prev = last.thinking ?? "";
          const sep = prev ? "\n\n---\n\n" : "";
          return { messages: [...msgs.slice(0, -1), { ...last, thinking: prev + sep, thinkingStreaming: true }] };
        }
        return { messages: [...msgs, { role: "assistant" as const, content: "", thinking: "", thinkingStreaming: true, timestamp: streamTs }] };
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

    // -- draft text events --

    streamEs.addEventListener("draft:delta", (e: MessageEvent) => {
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        if (!d?.text) return;
        set((s) => ({ messages: markProcessingCompleted(s.messages, streamTs) }));
        get().appendStreamChunk(d.text, streamTs);
      } catch { /* ignore */ }
    });

    // -- tool execution events --

    streamEs.addEventListener("tool:start", (e: MessageEvent) => {
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        if (!d?.tool) return;

        set((s) => {
          let msgs = markProcessingCompleted(s.messages, streamTs);
          let current = msgs[msgs.length - 1];

          if (!current || current.timestamp !== streamTs || current.role !== "assistant") {
            current = { role: "assistant" as const, content: "", timestamp: streamTs };
            msgs = [...msgs, current];
          }

          // Move pre-tool content to thinking
          const prevThinking = current.thinking ?? "";
          const movedContent = current.content
            ? (prevThinking ? prevThinking + "\n\n" : "") + current.content
            : prevThinking;

          // Create ToolExecution
          const agent = d.tool === "sub_agent" ? (d.args?.agent as string | undefined) : undefined;
          const stages = (d.stages as string[] | undefined)?.map((label: string) => ({
            label,
            status: "pending" as const,
          }));

          const newExec = {
            id: d.id as string,
            tool: d.tool as string,
            agent,
            label: resolveToolLabel(d.tool, agent),
            status: "running" as const,
            args: d.args as Record<string, unknown> | undefined,
            stages: stages && stages.length > 0 ? stages : undefined,
            startedAt: Date.now(),
          };

          return {
            messages: [...msgs.slice(0, -1), {
              ...current,
              thinking: movedContent,
              content: "",
              toolExecutions: [...(current.toolExecutions ?? []), newExec],
            }],
          };
        });
      } catch { /* ignore */ }
    });

    streamEs.addEventListener("tool:end", (e: MessageEvent) => {
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        if (!d?.tool) return;

        set((s) => {
          const last = s.messages[s.messages.length - 1];
          if (!last || last.timestamp !== streamTs || last.role !== "assistant") return s;

          const toolExecutions = (last.toolExecutions ?? []).map((t) => {
            if (t.id !== d.id) return t;
            const stages = t.stages?.map((stage) =>
              stage.status !== "completed"
                ? { ...stage, status: "completed" as const, progress: undefined }
                : stage
            );
            return {
              ...t,
              status: (d.isError ? "error" : "processing") as "error" | "processing",
              stages,
              result: d.isError ? undefined : summarizeResult(d.result),
              error: d.isError ? extractToolError(d.result) : undefined,
              completedAt: Date.now(),
            };
          });

          return {
            messages: [...s.messages.slice(0, -1), { ...last, toolExecutions }],
          };
        });

        get().bumpBookDataVersion();
      } catch { /* ignore */ }
    });

    // -- pipeline stage events (from PipelineRunner.logStage) --

    streamEs.addEventListener("log", (e: MessageEvent) => {
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        const msg = d?.message as string | undefined;
        if (!msg) return;

        const stageMatch = msg.match(/^(?:阶段：|Stage: )(.+)$/);
        if (!stageMatch) return;
        const stageName = stageMatch[1];

        set((s) => {
          const last = s.messages[s.messages.length - 1];
          if (!last || last.timestamp !== streamTs || last.role !== "assistant") return s;

          const execIdx = last.toolExecutions?.findIndex(t => t.status === "running" && t.stages) ?? -1;
          if (execIdx === -1) return s;

          const exec = last.toolExecutions![execIdx];
          let found = false;
          const stages = exec.stages!.map((stage) => {
            if (stage.label === stageName) {
              found = true;
              return { ...stage, status: "active" as const };
            }
            if (!found && stage.status === "active") {
              return { ...stage, status: "completed" as const, progress: undefined };
            }
            return stage;
          });

          if (!found) return s;

          const updatedExecs = [...last.toolExecutions!];
          updatedExecs[execIdx] = { ...exec, stages };

          return {
            messages: [...s.messages.slice(0, -1), { ...last, toolExecutions: updatedExecs }],
          };
        });
      } catch { /* ignore */ }
    });

    // -- LLM streaming progress (all statuses: thinking, streaming, etc.) --

    streamEs.addEventListener("llm:progress", (e: MessageEvent) => {
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        if (!d) return;

        set((s) => {
          const last = s.messages[s.messages.length - 1];
          if (!last || last.timestamp !== streamTs || last.role !== "assistant") return s;

          const execIdx = last.toolExecutions?.findIndex(t => t.status === "running" && t.stages) ?? -1;
          if (execIdx === -1) return s;

          const exec = last.toolExecutions![execIdx];
          const stages = exec.stages!.map((stage) =>
            stage.status === "active"
              ? { ...stage, progress: { status: d.status, elapsedMs: d.elapsedMs, totalChars: d.totalChars, chineseChars: d.chineseChars } }
              : stage
          );

          const updatedExecs = [...last.toolExecutions!];
          updatedExecs[execIdx] = { ...exec, stages };

          return {
            messages: [...s.messages.slice(0, -1), { ...last, toolExecutions: updatedExecs }],
          };
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
