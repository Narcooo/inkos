import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";

export type AgentTrajectoryRole = "main" | "subagent" | "workflow";

export interface AgentTrajectoryScopeInput {
  readonly conversationId: string;
  readonly runId: string;
  readonly agentRole: AgentTrajectoryRole;
  readonly parentToolCallId?: string;
}

export interface AgentModelCallTrace {
  readonly conversationId: string;
  readonly runId: string;
  readonly modelCallId: string;
  readonly agentRole: AgentTrajectoryRole;
  readonly piTurnIndex: number;
  readonly parentToolCallId?: string;
}

export interface ThinkingTrace {
  readonly effort: string;
  readonly budgetTokens?: number;
}

interface AgentTrajectoryScope extends AgentTrajectoryScopeInput {
  readonly counter: { piTurn: number };
}

const trajectoryStorage = new AsyncLocalStorage<AgentTrajectoryScope>();

export function opaqueConversationId(sessionId: string): string {
  return `inkos-${createHash("sha256").update(sessionId).digest("hex").slice(0, 32)}`;
}

export function runWithAgentTrajectory<T>(
  input: AgentTrajectoryScopeInput,
  task: () => T,
): T {
  return trajectoryStorage.run({ ...input, counter: { piTurn: 0 } }, task);
}

export function runWithAgentTrajectoryRole<T>(
  agentRole: AgentTrajectoryRole,
  task: () => T,
  parentToolCallId?: string,
): T {
  const current = trajectoryStorage.getStore();
  if (!current) return task();
  return trajectoryStorage.run({
    ...current,
    agentRole,
    ...(parentToolCallId ? { parentToolCallId } : {}),
  }, task);
}

export function runAsWorkflowTrajectory<T>(task: () => T): T {
  const current = trajectoryStorage.getStore();
  if (!current || current.agentRole !== "main") return task();
  return runWithAgentTrajectoryRole("workflow", task);
}

export function beginAgentModelCall(): AgentModelCallTrace | undefined {
  const current = trajectoryStorage.getStore();
  if (!current) return undefined;
  if (current.agentRole === "main") {
    current.counter.piTurn += 1;
  }
  return {
    conversationId: current.conversationId,
    runId: current.runId,
    modelCallId: randomUUID(),
    agentRole: current.agentRole,
    piTurnIndex: Math.max(current.counter.piTurn, 1),
    ...(current.parentToolCallId ? { parentToolCallId: current.parentToolCallId } : {}),
  };
}

export function isKkaiapiEndpoint(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname === "kkaiapi.com" || hostname.endsWith(".kkaiapi.com");
  } catch {
    return false;
  }
}

export function agentTrajectoryHeaders(
  baseUrl: string | undefined,
  trace: AgentModelCallTrace | undefined,
  clientAttempt: number,
  thinking: ThinkingTrace,
): Record<string, string> {
  if (!trace || !isKkaiapiEndpoint(baseUrl)) return {};
  return {
    "X-InkOS-Trace-Version": "1",
    "X-InkOS-Scaffold": "pi-inkos",
    "X-InkOS-Conversation-ID": trace.conversationId,
    "X-InkOS-Run-ID": trace.runId,
    "X-InkOS-Model-Call-ID": trace.modelCallId,
    "X-InkOS-Agent-Role": trace.agentRole,
    "X-InkOS-Pi-Turn-Index": String(trace.piTurnIndex),
    "X-InkOS-Client-Attempt": String(clientAttempt),
    "X-InkOS-Thinking-Effort": thinking.effort,
    ...(thinking.budgetTokens !== undefined
      ? { "X-InkOS-Thinking-Budget-Tokens": String(thinking.budgetTokens) }
      : {}),
    ...(trace.parentToolCallId
      ? { "X-InkOS-Parent-Tool-Call-ID": trace.parentToolCallId }
      : {}),
  };
}
