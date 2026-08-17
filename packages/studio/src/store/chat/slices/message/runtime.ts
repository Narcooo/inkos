import type {
  Message,
  MessagePart,
  PipelineStage,
  SessionMessage,
  SessionRuntime,
  SessionSummary,
  ToolExecution,
} from "../../types";
import { localizeKnownRuntimeMessage } from "../../../../lib/error-copy";
import { tr } from "../../../../lib/app-language";

const NULL_BOOK_KEY = "__null__";

// [zh, en] tuples resolved through tr() at call time so labels follow the
// current app language instead of the language active at module load.
const AGENT_LABELS: Record<string, readonly [string, string]> = {
  architect: ["建书", "Create book"],
  writer: ["写作", "Write"],
  auditor: ["审计", "Audit"],
  reviser: ["修订", "Revise"],
  exporter: ["导出", "Export"],
};

const TOOL_LABELS: Record<string, readonly [string, string]> = {
  read: ["读取文件", "Read file"],
  edit: ["编辑文件", "Edit file"],
  grep: ["搜索", "Search"],
  ls: ["列目录", "List directory"],
  context_compression: ["整理上下文", "Organize context"],
  propose_action: ["确认动作", "Confirm action"],
  short_fiction_run: ["短篇生产", "Short fiction run"],
  generate_cover: ["生成封面", "Generate cover"],
  script_create: ["剧本创作", "Create script"],
  storyboard_create: ["分镜创作", "Create storyboard"],
  interactive_film_create: ["互动影游", "Interactive film"],
  play_edit: ["编辑互动世界", "Edit interactive world"],
  play_start: ["启动互动世界", "Start interactive world"],
  play_revise: ["重做互动回合", "Redo play turn"],
  play_step: ["推进互动世界", "Advance interactive world"],
};

export function bookKey(bookId: string | null | undefined): string {
  return bookId ?? NULL_BOOK_KEY;
}

export function extractErrorMessage(error: string | { code?: string; message?: string }): string {
  if (typeof error === "string") return localizeKnownRuntimeMessage(error);
  return localizeKnownRuntimeMessage(error.message ?? "Unknown error");
}

export function resolveToolLabel(tool: string, agent?: string): string {
  if (tool === "sub_agent" && agent) {
    const label = AGENT_LABELS[agent];
    return label ? tr(label[0], label[1]) : agent;
  }
  const label = TOOL_LABELS[tool];
  return label ? tr(label[0], label[1]) : tool;
}

export function summarizeResult(result: unknown): string {
  if (typeof result === "string") return result.slice(0, 2000);
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (typeof record.content === "string") return record.content.slice(0, 2000);
    if (Array.isArray(record.content)) {
      const text = record.content
        .map((part) => {
          const item = part as { type?: unknown; text?: unknown };
          return item.type === "text" && typeof item.text === "string" ? item.text : "";
        })
        .filter(Boolean)
        .join("\n");
      if (text.trim()) return text.slice(0, 2000);
    }
  }
  return String(result).slice(0, 2000);
}

export function extractToolDetails(result: unknown): unknown {
  if (!result || typeof result !== "object") return undefined;
  return (result as Record<string, unknown>).details;
}

export function extractToolError(result: unknown): string {
  if (typeof result === "string") return localizeKnownRuntimeMessage(result).slice(0, 500);
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (typeof record.content === "string") return localizeKnownRuntimeMessage(record.content).slice(0, 500);
    if (record.content && Array.isArray(record.content)) {
      const textPart = record.content.find((content: any) => content.type === "text");
      if (textPart) return localizeKnownRuntimeMessage((textPart as any).text ?? "").slice(0, 500);
    }
  }
  return localizeKnownRuntimeMessage(String(result)).slice(0, 500);
}

export function getOrCreateStream(
  messages: ReadonlyArray<Message>,
  streamTs: number,
): [ReadonlyArray<Message>, Message] {
  const last = messages[messages.length - 1];
  if (last?.timestamp === streamTs && last.role === "assistant") {
    return [messages, last];
  }
  const message: Message = { role: "assistant", content: "", timestamp: streamTs, parts: [] };
  return [[...messages, message], message];
}

export function replaceLast(
  messages: ReadonlyArray<Message>,
  updated: Message,
): ReadonlyArray<Message> {
  return [...messages.slice(0, -1), updated];
}

export function findRunningToolPart(
  parts: MessagePart[],
): (MessagePart & { type: "tool" }) | undefined {
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i];
    if (part.type === "tool" && part.execution.status === "running") {
      return part as MessagePart & { type: "tool" };
    }
  }
  return undefined;
}

export function deriveFlat(
  parts: MessagePart[],
): { content: string; thinking?: string; thinkingStreaming?: boolean; toolExecutions?: ToolExecution[] } {
  let content = "";
  let thinking = "";
  let thinkingStreaming = false;
  const toolExecutions: ToolExecution[] = [];

  for (const part of parts) {
    if (part.type === "thinking") {
      if (thinking) thinking += "\n\n---\n\n";
      thinking += part.content;
      if (part.streaming) thinkingStreaming = true;
      continue;
    }

    if (part.type === "text") {
      content += part.content;
      continue;
    }

    toolExecutions.push(part.execution);
  }

  return {
    content,
    ...(thinking ? { thinking } : {}),
    ...(thinkingStreaming ? { thinkingStreaming: true } : {}),
    ...(toolExecutions.length > 0 ? { toolExecutions } : {}),
  };
}

export function withToolExecutions(
  message: Message,
  executions: ReadonlyArray<ToolExecution>,
): Message {
  if (executions.length === 0) return message;
  const existingIds = new Set((message.toolExecutions ?? []).map((execution) => execution.id));
  const missing = executions.filter((execution) => !existingIds.has(execution.id));
  if (missing.length === 0) return message;

  const currentParts = message.parts ?? (message.content ? [{ type: "text" as const, content: message.content }] : []);
  const nonTextParts = currentParts.filter((part) => part.type !== "text");
  const textParts = currentParts.filter((part) => part.type === "text");
  const parts: MessagePart[] = [
    ...nonTextParts,
    ...missing.map((execution) => ({ type: "tool" as const, execution })),
    ...textParts,
  ];
  return {
    ...message,
    ...deriveFlat(parts),
    parts,
  };
}

export function createSessionRuntime(input: {
  sessionId: string;
  bookId: string | null;
  sessionKind?: SessionRuntime["sessionKind"];
  playMode?: SessionRuntime["playMode"];
  title: string | null;
  messages?: ReadonlyArray<Message>;
  isDraft?: boolean;
}): SessionRuntime {
  return {
    sessionId: input.sessionId,
    bookId: input.bookId,
    sessionKind: input.sessionKind,
    playMode: input.playMode,
    title: input.title,
    messages: input.messages ?? [],
    stream: null,
    isStreaming: false,
    isChatStreaming: false,
    lastError: null,
    isDraft: input.isDraft ?? false,
  };
}

export function deserializeMessages(
  msgs: ReadonlyArray<SessionMessage>,
): ReadonlyArray<Message> {
  return msgs
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => {
      const toolExecutions = extractSessionToolExecutions(message);
      const parts: MessagePart[] = [];
      if (message.thinking) parts.push({ type: "thinking", content: message.thinking, streaming: false });
      if (toolExecutions) {
        for (const execution of toolExecutions) {
          parts.push({ type: "tool", execution });
        }
      }
      if (message.content) parts.push({ type: "text", content: message.content });
      return {
        role: message.role as "user" | "assistant",
        content: message.content,
        thinking: message.thinking,
        toolExecutions,
        timestamp: message.timestamp,
        parts: parts.length > 0 ? parts : undefined,
      };
    });
}

export function mergeToolExecution(
  messages: ReadonlyArray<Message>,
  execution: ToolExecution,
): ReadonlyArray<Message> {
  let found = false;
  const next = messages.map((message) => {
    const hasDirectExecution = message.toolExecutions?.some((item) => item.id === execution.id) ?? false;
    const hasPartExecution = message.parts?.some(
      (part) => part.type === "tool" && part.execution.id === execution.id,
    ) ?? false;
    if (!hasDirectExecution && !hasPartExecution) return message;

    found = true;
    const toolExecutions = hasDirectExecution
      ? message.toolExecutions?.map((item) => item.id === execution.id ? execution : item)
      : [...(message.toolExecutions ?? []), execution];
    const parts = hasPartExecution
      ? message.parts?.map((part) => (
          part.type === "tool" && part.execution.id === execution.id
            ? { type: "tool" as const, execution }
            : part
        ))
      : [...(message.parts ?? []), { type: "tool" as const, execution }];
    return { ...message, toolExecutions, parts };
  });

  if (found) return next;
  return [
    ...next,
    {
      role: "assistant",
      content: "",
      timestamp: execution.startedAt,
      toolExecutions: [execution],
      parts: [{ type: "tool", execution }],
    },
  ];
}

export function mergeTaskExecution(
  messages: ReadonlyArray<Message>,
  taskExecution: ToolExecution,
): ReadonlyArray<Message> {
  // 任务快照必然来自后台生产任务：恢复出的卡带 background 标记，供无 id
  // 事件的回退路由跳过它。终态快照替换整个 execution，标记也要跟着补回来。
  const execution: ToolExecution = taskExecution.background
    ? taskExecution
    : { ...taskExecution, background: true };
  return mergeToolExecution(messages, execution);
}

export function hasInFlightExecution(
  messages: ReadonlyArray<Message>,
  executionId: string,
): boolean {
  const inFlight = (execution: ToolExecution): boolean =>
    execution.id === executionId
    && (execution.status === "running" || execution.status === "processing");

  return messages.some((message) =>
    (message.toolExecutions?.some(inFlight) ?? false)
    || (message.parts?.some((part) => part.type === "tool" && inFlight(part.execution)) ?? false),
  );
}

/**
 * 消息里是否还有任何 running/processing 的工具执行。
 * 聊天轮结束时用它判断"后台生产任务是否还在跑"：只有全部执行都到终态，
 * 才允许关闭 SSE 连接并把 isStreaming 置回 false。
 */
export function hasAnyInFlightExecution(messages: ReadonlyArray<Message>): boolean {
  const inFlight = (execution: ToolExecution): boolean =>
    execution.status === "running" || execution.status === "processing";

  return messages.some((message) =>
    (message.toolExecutions?.some(inFlight) ?? false)
    || (message.parts?.some((part) => part.type === "tool" && inFlight(part.execution)) ?? false),
  );
}

/**
 * 按 execution id 在全部消息里定位工具卡并更新（并行聊天时任务卡挂在更早的
 * 任务轮消息上，不能只在当前 streamTs 的消息里找）。找不到时返回 null。
 */
export function updateToolPartById(
  messages: ReadonlyArray<Message>,
  executionId: string,
  update: (execution: ToolExecution) => ToolExecution,
): ReadonlyArray<Message> | null {
  let found = false;
  const next = messages.map((message) => {
    const hasPart = message.parts?.some(
      (part) => part.type === "tool" && part.execution.id === executionId,
    ) ?? false;
    if (!hasPart) return message;
    found = true;
    const parts = (message.parts ?? []).map((part) => (
      part.type === "tool" && part.execution.id === executionId
        ? { type: "tool" as const, execution: update(part.execution) }
        : part
    ));
    return { ...message, ...deriveFlat(parts), parts };
  });
  return found ? next : null;
}

export function markRunningToolsFailed(
  messages: ReadonlyArray<Message>,
  error: string,
  completedAt = Date.now(),
  shouldFail: (execution: ToolExecution) => boolean = () => true,
): ReadonlyArray<Message> {
  const failExecution = (execution: ToolExecution): ToolExecution => (
    (execution.status === "running" || execution.status === "processing") && shouldFail(execution)
      ? { ...execution, status: "error", error, completedAt }
      : execution
  );

  return messages.map((message) => ({
    ...message,
    ...(message.toolExecutions
      ? { toolExecutions: message.toolExecutions.map(failExecution) }
      : {}),
    ...(message.parts
      ? {
          parts: message.parts.map((part) => (
            part.type === "tool"
              ? { ...part, execution: failExecution(part.execution) }
              : part
          )),
        }
      : {}),
  }));
}

function extractSessionToolExecutions(message: SessionMessage): ToolExecution[] | undefined {
  const direct = (message as any).toolExecutions;
  if (Array.isArray(direct)) return direct as ToolExecution[];
  const legacy = (message as any).legacyDisplay?.toolExecutions;
  return Array.isArray(legacy) ? legacy as ToolExecution[] : undefined;
}

type ProposalResolution = "confirmed" | "rejected";

function proposedActionFrom(exec: ToolExecution): string | null {
  if (exec.tool !== "propose_action" || exec.status !== "completed") return null;
  if (!exec.details || typeof exec.details !== "object") return null;
  const record = exec.details as Record<string, unknown>;
  if (record.kind !== "proposed_action") return null;
  return typeof record.action === "string" && record.action.trim() ? record.action : null;
}

function completesProposedAction(exec: ToolExecution, action: string): boolean {
  if (exec.status !== "completed") return false;
  if (action === "create_book") return exec.tool === "sub_agent" && exec.agent === "architect";
  if (action === "short_run") return exec.tool === "short_fiction_run";
  if (action === "play_start") return exec.tool === "play_start";
  if (action === "generate_cover") return exec.tool === "generate_cover";
  if (action === "script_create") return exec.tool === "script_create";
  if (action === "storyboard_create") return exec.tool === "storyboard_create";
  if (action === "interactive_film_create") return exec.tool === "interactive_film_create";
  return false;
}

export function deriveResolvedProposals(
  messages: ReadonlyArray<Message>,
): Record<string, ProposalResolution> {
  const pending = new Map<string, string>();
  const resolved: Record<string, ProposalResolution> = {};

  for (const message of messages) {
    for (const exec of message.toolExecutions ?? []) {
      const proposedAction = proposedActionFrom(exec);
      if (proposedAction) {
        pending.set(exec.id, proposedAction);
        continue;
      }

      const pendingEntries = Array.from(pending.entries());
      for (let i = pendingEntries.length - 1; i >= 0; i -= 1) {
        const [proposalId, action] = pendingEntries[i]!;
        if (!completesProposedAction(exec, action)) continue;
        resolved[proposalId] = "confirmed";
        pending.delete(proposalId);
        break;
      }
    }
  }

  return resolved;
}

export function updateSession(
  sessions: Record<string, SessionRuntime>,
  sessionId: string,
  updater: (session: SessionRuntime) => Partial<SessionRuntime>,
): Record<string, SessionRuntime> {
  const existing = sessions[sessionId];
  if (!existing) return sessions;
  return {
    ...sessions,
    [sessionId]: {
      ...existing,
      ...updater(existing),
    },
  };
}

export function upsertSessionSummary(
  sessions: Record<string, SessionRuntime>,
  summary: Pick<SessionSummary, "sessionId" | "bookId" | "sessionKind" | "playMode" | "title">,
): Record<string, SessionRuntime> {
  const existing = sessions[summary.sessionId];
  return {
    ...sessions,
    [summary.sessionId]: existing
      ? {
          ...existing,
          bookId: summary.bookId,
          sessionKind: summary.sessionKind ?? existing.sessionKind,
          playMode: summary.playMode ?? existing.playMode,
          title: summary.title,
        }
      : createSessionRuntime(summary),
  };
}

export function mergeSessionIds(
  existing: ReadonlyArray<string> | undefined,
  incoming: ReadonlyArray<string>,
): ReadonlyArray<string> {
  if (!existing?.length) return [...incoming];
  const seen = new Set(existing);
  const appended = incoming.filter((id) => !seen.has(id));
  if (appended.length === 0) return existing as string[];
  return [...existing, ...appended];
}

export function sessionMatchesEvent(sessionId: string, data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  return (data as { sessionId?: unknown }).sessionId === sessionId;
}
