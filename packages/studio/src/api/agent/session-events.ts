import type { CollectedToolExec } from "./execution.js";
import {
  extractToolError,
  PIPELINE_STAGES,
  resolveArchitectBookIdFromArgs,
  resolveToolLabel,
  summarizeResult,
} from "./execution.js";

interface CreateAgentSessionEventHandlerOptions {
  readonly collectedToolExecs: CollectedToolExec[];
  readonly agentBookId: string | null;
  readonly streamSessionId: string;
  readonly bookCreateStatus: Map<string, { status: "creating" | "error"; error?: string }>;
  readonly broadcast: (event: string, data: unknown) => void;
}

export function createAgentSessionEventHandler({
  collectedToolExecs,
  agentBookId,
  streamSessionId,
  bookCreateStatus,
  broadcast,
}: CreateAgentSessionEventHandlerOptions) {
  return (event: { type: string; [key: string]: any }) => {
    if (event.type === "message_update") {
      const ame = event.assistantMessageEvent;
      if (ame.type === "text_delta") {
        broadcast("draft:delta", { sessionId: streamSessionId, text: ame.delta });
      } else if (ame.type === "thinking_delta") {
        broadcast("thinking:delta", { sessionId: streamSessionId, text: ame.delta });
      } else if (ame.type === "thinking_start") {
        broadcast("thinking:start", { sessionId: streamSessionId });
      } else if (ame.type === "thinking_end") {
        broadcast("thinking:end", { sessionId: streamSessionId });
      }
    }
    if (event.type === "tool_execution_start") {
      const args = event.args as Record<string, unknown> | undefined;
      const agent = event.toolName === "sub_agent" ? (args?.agent as string | undefined) : undefined;
      const stages = agent ? (PIPELINE_STAGES[agent] ?? []) : [];

      collectedToolExecs.push({
        id: event.toolCallId,
        tool: event.toolName,
        agent,
        label: resolveToolLabel(event.toolName, agent),
        status: "running",
        args,
        stages: stages.length > 0
          ? stages.map(l => ({ label: l, status: "pending" as const }))
          : undefined,
        startedAt: Date.now(),
      });

      if (!agentBookId && event.toolName === "sub_agent" && agent === "architect") {
        const bookId = resolveArchitectBookIdFromArgs(args);
        if (bookId) {
          const title = typeof args?.title === "string" && args.title.trim()
            ? args.title.trim()
            : bookId;
          bookCreateStatus.set(bookId, { status: "creating" });
          broadcast("book:creating", { bookId, title, sessionId: streamSessionId });
        }
      }

      broadcast("tool:start", {
        sessionId: streamSessionId,
        id: event.toolCallId,
        tool: event.toolName,
        args,
        stages,
      });
    }
    if (event.type === "tool_execution_update") {
      broadcast("tool:update", {
        sessionId: streamSessionId,
        tool: event.toolName,
        partialResult: event.partialResult,
      });
    }
    if (event.type === "tool_execution_end") {
      const exec = collectedToolExecs.find(t => t.id === event.toolCallId);
      if (exec) {
        exec.status = event.isError ? "error" : "completed";
        exec.completedAt = Date.now();
        exec.stages = exec.stages?.map(s => ({ ...s, status: "completed" as const }));
        if (event.isError) exec.error = extractToolError(event.result);
        else exec.result = summarizeResult(event.result);
        exec.details = (event.result as { details?: unknown } | undefined)?.details;
        if (
          event.isError &&
          !agentBookId &&
          exec.tool === "sub_agent" &&
          exec.agent === "architect"
        ) {
          const bookId = resolveArchitectBookIdFromArgs(exec.args);
          if (bookId) {
            const error = exec.error ?? "Book creation failed";
            bookCreateStatus.set(bookId, { status: "error", error });
            broadcast("book:error", { bookId, sessionId: streamSessionId, error });
          }
        }
      }
      broadcast("tool:end", {
        sessionId: streamSessionId,
        id: event.toolCallId,
        tool: event.toolName,
        result: event.result,
        isError: event.isError,
      });
    }
  };
}
