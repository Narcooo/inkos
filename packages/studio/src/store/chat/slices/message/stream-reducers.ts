import type { MessagePart, PipelineStage, SessionRuntime } from "../../types";
import {
  deriveFlat,
  extractToolError,
  findRunningToolPart,
  getOrCreateStream,
  replaceLast,
  resolveToolLabel,
  summarizeResult,
} from "./runtime";

type StreamPatch = Partial<SessionRuntime>;

function updateStreamParts(
  runtime: SessionRuntime,
  streamTs: number,
  update: (parts: MessagePart[]) => MessagePart[] | null,
): StreamPatch {
  const [messages, stream] = getOrCreateStream(runtime.messages, streamTs);
  const currentParts = [...(stream.parts ?? [])];
  const parts = update(currentParts);
  if (!parts) return {};

  const flat = deriveFlat(parts);
  return {
    messages: replaceLast(messages, { ...stream, ...flat, parts }),
  };
}

export function applyThinkingStart(runtime: SessionRuntime, streamTs: number): StreamPatch {
  return updateStreamParts(runtime, streamTs, (parts) => [
    ...parts,
    { type: "thinking", content: "", streaming: true },
  ]);
}

export function applyThinkingDelta(
  runtime: SessionRuntime,
  streamTs: number,
  text: string,
): StreamPatch {
  return updateStreamParts(runtime, streamTs, (parts) => {
    const last = parts[parts.length - 1];
    if (last?.type !== "thinking") return parts;
    parts[parts.length - 1] = { ...last, content: last.content + text };
    return parts;
  });
}

export function applyThinkingEnd(runtime: SessionRuntime, streamTs: number): StreamPatch {
  return updateStreamParts(runtime, streamTs, (parts) => {
    const last = parts[parts.length - 1];
    if (last?.type !== "thinking") return parts;
    parts[parts.length - 1] = { ...last, streaming: false };
    return parts;
  });
}

export function applyDraftDelta(
  runtime: SessionRuntime,
  streamTs: number,
  text: string,
): StreamPatch {
  return updateStreamParts(runtime, streamTs, (parts) => {
    const last = parts[parts.length - 1];
    if (last?.type === "text") {
      parts[parts.length - 1] = { ...last, content: last.content + text };
    } else {
      parts.push({ type: "text", content: text });
    }
    return parts;
  });
}

export function applyToolStart(
  runtime: SessionRuntime,
  streamTs: number,
  data: Record<string, unknown>,
  now = Date.now(),
): StreamPatch {
  return updateStreamParts(runtime, streamTs, (parts) => {
    const tool = String(data.tool);

    if (tool === "sub_agent") {
      const last = parts[parts.length - 1];
      if (last?.type === "text" && last.content) {
        parts.pop();
        const previous = parts[parts.length - 1];
        if (previous?.type === "thinking") {
          parts[parts.length - 1] = {
            ...previous,
            content: previous.content + (previous.content ? "\n\n" : "") + last.content,
          };
        } else {
          parts.push({ type: "thinking", content: last.content, streaming: false });
        }
      }
    }

    const args = data.args && typeof data.args === "object"
      ? data.args as Record<string, unknown>
      : undefined;
    const agent = tool === "sub_agent" ? args?.agent as string | undefined : undefined;
    const stages: PipelineStage[] | undefined = Array.isArray(data.stages) && data.stages.length > 0
      ? (data.stages as string[]).map((label) => ({ label, status: "pending" }))
      : undefined;

    parts.push({
      type: "tool",
      execution: {
        id: String(data.id),
        tool,
        agent,
        label: resolveToolLabel(tool, agent),
        status: "running",
        args,
        stages,
        startedAt: now,
      },
    });
    return parts;
  });
}

export function applyToolEnd(
  runtime: SessionRuntime,
  streamTs: number,
  data: Record<string, unknown>,
  now = Date.now(),
): StreamPatch {
  return updateStreamParts(runtime, streamTs, (parts) => parts.map((part) => {
    if (part.type !== "tool" || part.execution.id !== data.id) return part;

    const execution = { ...part.execution };
    execution.status = data.isError ? "error" : "completed";
    execution.completedAt = now;
    execution.stages = execution.stages?.map((stage) =>
      stage.status !== "completed"
        ? { ...stage, status: "completed", progress: undefined }
        : stage
    );
    if (data.isError) execution.error = extractToolError(data.result);
    else execution.result = summarizeResult(data.result);

    return { type: "tool", execution };
  }));
}

export function applyToolLog(
  runtime: SessionRuntime,
  streamTs: number,
  message: string,
): StreamPatch {
  return updateStreamParts(runtime, streamTs, (parts) => {
    const runningTool = findRunningToolPart(parts);
    if (!runningTool) return null;

    return parts.map((part) => {
      if (part.type !== "tool" || part.execution.id !== runningTool.execution.id) return part;
      return {
        type: "tool",
        execution: {
          ...part.execution,
          logs: [...(part.execution.logs ?? []), message],
        },
      };
    });
  });
}

export function applyLlmProgress(
  runtime: SessionRuntime,
  streamTs: number,
  data: Record<string, unknown>,
): StreamPatch {
  return updateStreamParts(runtime, streamTs, (parts) => {
    const runningTool = findRunningToolPart(parts);
    if (!runningTool?.execution.stages) return null;

    return parts.map((part) => {
      if (part.type !== "tool" || part.execution.id !== runningTool.execution.id) return part;
      return {
        type: "tool",
        execution: {
          ...part.execution,
          stages: part.execution.stages?.map((stage) =>
            stage.status === "active"
              ? {
                  ...stage,
                  progress: {
                    status: data.status as string | undefined,
                    elapsedMs: Number(data.elapsedMs ?? 0),
                    totalChars: Number(data.totalChars ?? 0),
                    chineseChars: Number(data.chineseChars ?? 0),
                  },
                }
              : stage
          ),
        },
      };
    });
  });
}
