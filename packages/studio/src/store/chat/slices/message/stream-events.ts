import type { StateCreator } from "zustand";
import type { ChatStore, Message, MessageActions, MessagePart, PipelineStage, ToolExecution } from "../../types";
import { shouldRefreshSidebarForTool } from "../../message-policy";
import { tr } from "../../../../lib/app-language";
import {
  deriveFlat,
  extractToolDetails,
  extractToolError,
  findRunningToolPart,
  getOrCreateStream,
  hasAnyInFlightExecution,
  hasInFlightExecution,
  mergeTaskExecution,
  replaceLast,
  resolveToolLabel,
  sessionMatchesEvent,
  summarizeResult,
  updateSession,
  updateToolPartById,
} from "./runtime";

type SliceSet = Parameters<StateCreator<ChatStore, [], [], MessageActions>>[0];
type SliceGet = Parameters<StateCreator<ChatStore, [], [], MessageActions>>[1];

type ContextCompressionCategory = "session_context" | "story_context";
type ContextCompressionPhase = "start" | "end" | "error";

interface ContextCompressionEventPayload {
  readonly sessionId?: string;
  readonly executionId?: string;
  readonly category?: ContextCompressionCategory;
  readonly phase?: ContextCompressionPhase;
  readonly message?: string;
  readonly protectedTokens?: number;
  readonly compressibleTokens?: number;
  readonly budgetTokens?: number;
  readonly sources?: readonly string[];
}

interface AttachSessionStreamListenersInput {
  sessionId: string;
  streamTs: number;
  sourceRequestId?: string;
  streamEs: EventSource;
  set: SliceSet;
  get: SliceGet;
}

export const STREAM_TEXT_FLUSH_MS = 48;
export const TOOL_PROGRESS_FLUSH_MS = 750;
export const MAX_TOOL_LOGS = 80;

export type StreamTextDelta =
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string };

interface StreamProgressEventData {
  readonly status?: string;
  readonly elapsedMs: number;
  readonly totalChars: number;
  readonly chineseChars: number;
}

interface ProgressThrottle {
  enqueue(event: StreamProgressEventData): void;
  flush(): void;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** 服务端给后台生产任务的进度事件附加的 execution id；聊天轮事件不带。 */
function eventExecutionId(data: unknown): string | undefined {
  const executionId = (data as { executionId?: unknown } | null)?.executionId;
  return typeof executionId === "string" && executionId ? executionId : undefined;
}

export function applyStreamTextDeltas(
  parts: ReadonlyArray<MessagePart>,
  deltas: ReadonlyArray<StreamTextDelta>,
): MessagePart[] {
  const next = [...parts];

  for (const delta of deltas) {
    if (!delta.text) continue;

    if (delta.kind === "thinking") {
      const last = next[next.length - 1];
      if (last?.type === "thinking") {
        next[next.length - 1] = { ...last, content: last.content + delta.text };
      }
      continue;
    }

    const last = next[next.length - 1];
    if (last?.type === "text") {
      next[next.length - 1] = { ...last, content: last.content + delta.text };
    } else {
      next.push({ type: "text", content: delta.text });
    }
  }

  return next;
}

export function appendBoundedToolLogs(
  existing: ReadonlyArray<string> | undefined,
  incoming: ReadonlyArray<string>,
): string[] {
  return [...(existing ?? []), ...incoming].slice(-MAX_TOOL_LOGS);
}

/**
 * 倒序找最近一个运行中的聊天轮工具卡；跳过带 background 标记的后台任务卡。
 * 无 id 的回退事件只属于聊天轮，落到任务卡上会把聊天日志串排进任务里。
 */
function findRunningChatToolPart(
  parts: ReadonlyArray<MessagePart>,
): (MessagePart & { type: "tool" }) | undefined {
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i]!;
    if (part.type === "tool" && part.execution.status === "running" && !part.execution.background) {
      return part;
    }
  }
  return undefined;
}

/**
 * 倒序扫描消息，找到最近一个仍在运行的聊天轮工具卡并更新它。
 * 任务与聊天并行时，后台任务卡（execution.background）被跳过——无 id 的
 * 回退事件不属于任务；跳过后没有可挂的卡时返回 null，事件整体丢弃
 *（任务快照重放会带回任务自己的累积日志，不丢信息）。
 * update 返回 null 表示这张卡不需要更新（整体视为 no-op）。
 */
export function updateLatestRunningToolMessage(
  messages: ReadonlyArray<Message>,
  update: (execution: ToolExecution) => ToolExecution | null,
): ReadonlyArray<Message> | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    const running = findRunningChatToolPart(message.parts ?? []);
    if (!running) continue;
    const updated = update(running.execution);
    if (!updated) return null;
    const parts = (message.parts ?? []).map((part) => (
      part.type === "tool" && part.execution.id === running.execution.id
        ? { type: "tool" as const, execution: updated }
        : part
    ));
    return [
      ...messages.slice(0, i),
      { ...message, ...deriveFlat(parts), parts },
      ...messages.slice(i + 1),
    ];
  }
  return null;
}

export function createStreamTextDeltaBatcher(
  flushDeltas: (deltas: StreamTextDelta[]) => void,
  delayMs = STREAM_TEXT_FLUSH_MS,
): { enqueue: (delta: StreamTextDelta) => void; flush: () => void } {
  let pending: StreamTextDelta[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const flush = () => {
    clearTimer();
    if (pending.length === 0) return;
    const deltas = pending;
    pending = [];
    flushDeltas(deltas);
  };

  const schedule = () => {
    if (timer !== null) return;
    timer = setTimeout(flush, delayMs);
  };

  return {
    enqueue(delta) {
      pending.push(delta);
      schedule();
    },
    flush,
  };
}

export function createLatestEventThrottle<T>(
  publishLatest: (event: T) => void,
  intervalMs = TOOL_PROGRESS_FLUSH_MS,
): { enqueue: (event: T) => void; flush: () => void } {
  let latest: T | undefined;
  let hasLatest = false;
  let lastPublishedAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const publishNow = (event: T) => {
    lastPublishedAt = Date.now();
    publishLatest(event);
  };

  const flush = () => {
    clearTimer();
    if (!hasLatest) return;
    const event = latest as T;
    latest = undefined;
    hasLatest = false;
    publishNow(event);
  };

  const schedule = () => {
    if (timer !== null) return;
    const elapsed = lastPublishedAt === null ? intervalMs : Date.now() - lastPublishedAt;
    const delay = Math.max(0, intervalMs - elapsed);
    timer = setTimeout(flush, delay);
  };

  return {
    enqueue(event) {
      if (lastPublishedAt === null) {
        publishNow(event);
        return;
      }

      latest = event;
      hasLatest = true;

      if (Date.now() - lastPublishedAt >= intervalMs) {
        flush();
      } else {
        schedule();
      }
    },
    flush,
  };
}

export function attachSessionStreamListeners({
  sessionId,
  streamTs,
  sourceRequestId,
  streamEs,
  set,
  get,
}: AttachSessionStreamListenersInput): void {
  const textDeltaBatcher = createStreamTextDeltaBatcher((deltas) => {
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (runtime) => {
        const [messages, stream] = getOrCreateStream(runtime.messages, streamTs);
        const parts = applyStreamTextDeltas(stream.parts ?? [], deltas);
        const flat = deriveFlat(parts);
        return { messages: replaceLast(messages, { ...stream, ...flat, parts }) };
      }),
    }));
  });

  const flushTextDeltas = () => textDeltaBatcher.flush();

  const applyStageProgress = (execution: ToolExecution, data: StreamProgressEventData): ToolExecution => ({
    ...execution,
    stages: execution.stages?.map((stage) =>
      stage.status === "active"
        ? {
            ...stage,
            progress: {
              status: data.status,
              elapsedMs: data.elapsedMs,
              totalChars: data.totalChars,
              chineseChars: data.chineseChars,
            },
          }
        : stage,
    ),
  });

  // llm:progress 按事件里的 executionId 路由：带 id 的事件（后台生产任务）按 id
  // 精确定位工具卡；不带 id 的维持"最近一张运行中的卡"回退（聊天轮工具与旧版
  // 事件）。每个 id 一个独立节流器：任务与聊天并行时，双方进度不会在同一个
  // "只保留最新事件"的节流器里互相覆盖。
  const progressThrottles = new Map<string, ProgressThrottle>();
  const progressThrottleFor = (executionId: string | undefined): ProgressThrottle => {
    const key = executionId ?? "";
    const existing = progressThrottles.get(key);
    if (existing) return existing;
    const throttle = createLatestEventThrottle<StreamProgressEventData>((data) => {
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          const messages = executionId
            ? updateToolPartById(runtime.messages, executionId, (execution) => (
                execution.stages ? applyStageProgress(execution, data) : execution
              ))
            : updateLatestRunningToolMessage(runtime.messages, (execution) => (
                execution.stages ? applyStageProgress(execution, data) : null
              ));
          return messages ? { messages } : {};
        }),
      }));
    });
    progressThrottles.set(key, throttle);
    return throttle;
  };
  const flushProgressThrottles = () => {
    for (const throttle of progressThrottles.values()) throttle.flush();
  };

  streamEs.addEventListener("draft:complete", flushTextDeltas);
  streamEs.addEventListener("draft:error", flushTextDeltas);

  // agent:complete / agent:error / agent:aborted 都是"某一轮请求结束"的信号，
  // 但事件本身分不清结束的是聊天轮还是后台任务轮（两者共享 sessionId）：
  // - 聊天轮还在进行（isChatStreaming=true）时不能关连接——事件既可能属于
  //   聊天轮自己（随后 sendMessage 的 finally 会收尾），也可能属于后台任务
  //   （聊天要继续）；
  // - 聊天轮已结束时，只要消息里还有 in-flight 的任务卡，连接也要保持，
  //   等任务自己的终态事件（tool:end → agent:complete）到来再关闭。
  const finishSessionStream = (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data)) return;
      flushTextDeltas();
      flushProgressThrottles();
      const runtime = get().sessions[sessionId];
      if (!runtime || runtime.isChatStreaming) return;
      if (hasAnyInFlightExecution(runtime.messages)) return;
      streamEs.close();
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, () => ({
          isStreaming: false,
          stream: null,
        })),
      }));
    } catch {
      // ignore
    }
  };
  streamEs.addEventListener("agent:complete", finishSessionStream);
  streamEs.addEventListener("agent:error", finishSessionStream);

  streamEs.addEventListener("task:snapshot", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.execution) return;
      const execution = data.execution as ToolExecution;
      const running = execution.status === "running" || execution.status === "processing";
      // EventSource may connect after the production task has already started, so its
      // real-time tool:start broadcast is missed and only this snapshot is replayed.
      // A task started during this request needs the same task-round reclassification;
      // an older task is parallel background work and must not interrupt the new chat.
      const startedByCurrentRequest = running
        && typeof sourceRequestId === "string"
        && data.sourceRequestId === sourceRequestId;
      // 服务端在每次 SSE 连接建立时都会重放该会话的任务快照。终态快照只用于
      // 收尾一个当前确实还在运行中的任务卡（刷新恢复场景）；如果本会话没有在
      // 跟踪这个任务，说明它是上一轮已结束任务的残留快照，直接忽略——否则
      // 会把本轮新建立的流关掉，导致后续实时事件全部丢失。
      if (!running && !hasInFlightExecution(get().sessions[sessionId]?.messages ?? [], execution.id)) {
        return;
      }
      // 聊天轮正在流式时收到终态快照（任务刚结束、新连接建立时服务端重放）：
      // 只收尾任务卡，连接与流式状态保持不动，由聊天轮自己收尾——否则会把
      // 正在跑的聊天流关掉，本轮增量全部丢失。
      const chatStreaming = Boolean(get().sessions[sessionId]?.isChatStreaming);
      const keepStream = running || chatStreaming;
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => ({
          messages: mergeTaskExecution(runtime.messages, execution),
          isStreaming: keepStream,
          ...(startedByCurrentRequest && runtime.isChatStreaming ? { isChatStreaming: false } : {}),
          stream: keepStream ? runtime.stream : null,
        })),
      }));
      if (!keepStream) streamEs.close();
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("agent:aborted", finishSessionStream);

  streamEs.addEventListener("thinking:start", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data)) return;
      flushTextDeltas();
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          const [messages, stream] = getOrCreateStream(runtime.messages, streamTs);
          const parts = [...(stream.parts ?? []), { type: "thinking" as const, content: "", streaming: true }];
          const flat = deriveFlat(parts);
          return { messages: replaceLast(messages, { ...stream, ...flat, parts }) };
        }),
      }));
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("thinking:delta", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.text) return;
      textDeltaBatcher.enqueue({ kind: "thinking", text: data.text as string });
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("thinking:end", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data)) return;
      flushTextDeltas();
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          const [messages, stream] = getOrCreateStream(runtime.messages, streamTs);
          const parts = [...(stream.parts ?? [])];
          const last = parts[parts.length - 1];
          if (last?.type === "thinking") {
            parts[parts.length - 1] = { ...last, streaming: false };
          }
          const flat = deriveFlat(parts);
          return { messages: replaceLast(messages, { ...stream, ...flat, parts }) };
        }),
      }));
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("draft:delta", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.text) return;
      textDeltaBatcher.enqueue({ kind: "text", text: data.text as string });
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("tool:start", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.tool) return;
      // 服务端在确认式生产任务的 tool:start 上带 background: true。free-text
      // 命中服务端写章启发式时，前端发送时把这轮当成了聊天轮
      //（isChatStreaming=true）；收到该标记说明这轮实际按后台任务执行，
      // 需要重分类：isChatStreaming 归 false（停止按钮据此走 scope=all 才能
      // 拿到任务控制器，用户也可以继续聊天），isStreaming 维持 true（任务在跑）。
      // 挂起的 fetch 返回后由 sendMessage 的 finally 按"是否还有任务在跑"收尾。
      const background = data.background === true;
      const belongsToCurrentRequest = typeof sourceRequestId === "string"
        && data.sourceRequestId === sourceRequestId;
      flushTextDeltas();
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          const [messages, stream] = getOrCreateStream(runtime.messages, streamTs);
          const parts = [...(stream.parts ?? [])];

          if (data.tool === "sub_agent") {
            const last = parts[parts.length - 1];
            if (last?.type === "text" && last.content) {
              parts.pop();
              const prev = parts[parts.length - 1];
              if (prev?.type === "thinking") {
                parts[parts.length - 1] = {
                  ...prev,
                  content: prev.content + (prev.content ? "\n\n" : "") + last.content,
                };
              } else {
                parts.push({ type: "thinking", content: last.content, streaming: false });
              }
            }
          }

          const agent = data.tool === "sub_agent" ? (data.args?.agent as string | undefined) : undefined;
          const stages: PipelineStage[] | undefined = Array.isArray(data.stages) && data.stages.length > 0
            ? (data.stages as string[]).map((label) => ({ label, status: "pending" as const }))
            : undefined;

          parts.push({
            type: "tool",
            execution: {
              id: data.id as string,
              tool: data.tool as string,
              agent,
              label: resolveToolLabel(data.tool as string, agent),
              status: "running",
              args: data.args as Record<string, unknown> | undefined,
              stages,
              startedAt: Date.now(),
              ...(background ? { background: true } : {}),
            },
          });

          const flat = deriveFlat(parts);
          return {
            messages: replaceLast(messages, { ...stream, ...flat, parts }),
            ...(background && belongsToCurrentRequest && runtime.isChatStreaming
              ? { isChatStreaming: false }
              : {}),
          };
        }),
      }));
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("tool:end", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.tool) return;
      flushTextDeltas();
      flushProgressThrottles();
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          // 按 execution id 全量定位：并行聊天时任务卡在更早的消息里
          const messages = updateToolPartById(runtime.messages, data.id as string, (previous) => {
            const execution = { ...previous };
            execution.status = data.isError ? "error" : "completed";
            execution.completedAt = Date.now();
            execution.stages = execution.stages?.map((stage) =>
              stage.status !== "completed"
                ? { ...stage, status: "completed" as const, progress: undefined }
                : stage,
            );
            if (data.isError) execution.error = extractToolError(data.result);
            else execution.result = summarizeResult(data.result);
            const details = data.details ?? extractToolDetails(data.result);
            if (details !== undefined) execution.details = details;
            return execution;
          });
          return messages ? { messages } : {};
        }),
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
      const executionId = eventExecutionId(data);
      flushTextDeltas();
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          const appendLog = (execution: ToolExecution): ToolExecution => ({
            ...execution,
            logs: appendBoundedToolLogs(execution.logs, [message]),
          });
          // 带 executionId 的日志（后台生产任务）按 id 精确定位工具卡；卡还没
          // 出现时直接丢弃这条（任务快照重放会带回累积的 logs），不能回退到
          // "最近一张运行中的卡"——那会把任务日志串排进并行聊天轮的工具卡。
          const messages = executionId
            ? updateToolPartById(runtime.messages, executionId, appendLog)
            : updateLatestRunningToolMessage(runtime.messages, appendLog);
          return messages ? { messages } : {};
        }),
      }));
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("llm:progress", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data)) return;
      flushTextDeltas();
      progressThrottleFor(eventExecutionId(data)).enqueue({
        status: typeof data.status === "string" ? data.status : undefined,
        elapsedMs: numberOrZero(data.elapsedMs),
        totalChars: numberOrZero(data.totalChars),
        chineseChars: numberOrZero(data.chineseChars),
      });
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("context:compression", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) as ContextCompressionEventPayload : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.category || !data.phase) return;
      const category = data.category;
      const phase = data.phase;
      const executionId = eventExecutionId(data);
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          // 带 executionId 的压缩事件（后台生产任务的 pipeline）：作为阶段挂到
          // 对应的任务卡上；卡不存在时丢弃这条（任务快照重放会带回状态），
          // 绝不写进聊天流消息——并行时会把任务状态串排进聊天轮。
          if (executionId) {
            const messages = updateToolPartById(runtime.messages, executionId, (execution) =>
              applyContextCompressionToExecution(execution, category, phase, data),
            );
            return messages ? { messages } : {};
          }
          const [messages, stream] = getOrCreateStream(runtime.messages, streamTs);
          const parts = [...(stream.parts ?? [])];
          applyContextCompressionToParts(parts, category, phase, data);
          const flat = deriveFlat(parts);
          return { messages: replaceLast(messages, { ...stream, ...flat, parts }) };
        }),
      }));
    } catch {
      // ignore
    }
  });
}

function compressionLabel(category: ContextCompressionCategory): string {
  return category === "session_context"
    ? tr("整理会话记忆", "Organize session memory")
    : tr("压缩故事上下文", "Compress story context");
}

function compressionSourceSummary(sources: readonly string[] | undefined): string {
  if (!sources || sources.length === 0) return "";
  const preview = sources.slice(0, 3).join(", ");
  const suffix = sources.length > 3 ? ` +${sources.length - 3}` : "";
  return `${tr("来源", "sources")} ${sources.length}: ${preview}${suffix}`;
}

function compressionProgress(data: ContextCompressionEventPayload): PipelineStage["progress"] | undefined {
  if (data.phase !== "start") return undefined;
  const parts = [
    data.protectedTokens !== undefined ? `${tr("保护", "protected")} ${data.protectedTokens}` : "",
    data.compressibleTokens !== undefined ? `${tr("可压缩", "compressible")} ${data.compressibleTokens}` : "",
    data.budgetTokens !== undefined ? `${tr("预算", "budget")} ${data.budgetTokens}` : "",
    compressionSourceSummary(data.sources),
  ].filter(Boolean);
  return {
    status: parts.length > 0 ? parts.join(" · ") : "compressing",
    elapsedMs: 0,
    totalChars: 0,
    chineseChars: 0,
  };
}

function upsertCompressionStage(
  stages: PipelineStage[] | undefined,
  category: ContextCompressionCategory,
  phase: ContextCompressionPhase,
  data: ContextCompressionEventPayload,
): PipelineStage[] {
  const label = compressionLabel(category);
  const found = stages?.some((stage) => stage.label === label) ?? false;
  const base = found ? [...(stages ?? [])] : [...(stages ?? []), { label, status: "pending" as const }];
  const status: PipelineStage["status"] = phase === "start" ? "active" : "completed";
  return base.map((stage) =>
    stage.label === label
      ? { ...stage, status, progress: phase === "start" ? compressionProgress(data) : undefined }
      : stage
  );
}

function findRunningExecution(parts: MessagePart[]): ToolExecution | undefined {
  const running = findRunningToolPart(parts);
  return running?.execution;
}

/** 按 id 定位到的任务卡：把压缩事件作为阶段挂上去（不可变更新）。 */
function applyContextCompressionToExecution(
  execution: ToolExecution,
  category: ContextCompressionCategory,
  phase: ContextCompressionPhase,
  data: ContextCompressionEventPayload,
): ToolExecution {
  const stages = upsertCompressionStage(execution.stages, category, phase, data);
  if (phase === "error") {
    return {
      ...execution,
      stages,
      status: "error",
      error: data.message ?? `${compressionLabel(category)}${tr("失败", " failed")}`,
    };
  }
  return { ...execution, stages };
}

function applyContextCompressionToParts(
  parts: MessagePart[],
  category: ContextCompressionCategory,
  phase: ContextCompressionPhase,
  data: ContextCompressionEventPayload,
): void {
  const running = category === "session_context" ? undefined : findRunningExecution(parts);
  if (running) {
    running.stages = upsertCompressionStage(running.stages, category, phase, data);
    if (phase === "error") {
      running.status = "error";
      running.error = data.message ?? `${compressionLabel(category)}${tr("失败", " failed")}`;
    }
    return;
  }

  const id = `context-${category}`;
  const existing = parts.find((part): part is { type: "tool"; execution: ToolExecution } =>
    part.type === "tool" && part.execution.id === id
  );
  const status: ToolExecution["status"] = phase === "start" ? "running" : phase === "error" ? "error" : "completed";
  const execution = existing?.execution ?? {
    id,
    tool: "context_compression",
    label: compressionLabel(category),
    status,
    stages: [],
    startedAt: Date.now(),
  };
  execution.status = status;
  execution.label = compressionLabel(category);
  execution.stages = upsertCompressionStage(execution.stages, category, phase, data);
  if (phase !== "start") execution.completedAt = Date.now();
  if (phase === "error") execution.error = data.message ?? `${compressionLabel(category)}${tr("失败", " failed")}`;
  if (!existing) parts.push({ type: "tool", execution });
}
