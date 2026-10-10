import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import {
  type ActionResult,
  type WorkProfile,
} from "./contracts.js";
import {
  CapabilityRegistry,
  type CapabilityAction,
} from "./capability-registry.js";
import { runWithAgentTrajectoryRole } from "../llm/agent-trajectory.js";
import { actionObservation, actionFailureFacts } from "./action-observation.js";

export interface CreateCapabilityPiToolsOptions {
  readonly registry: CapabilityRegistry;
  readonly profile: WorkProfile;
  readonly executeAction: (
    capabilityId: string,
    actionId: string,
    parameters: unknown,
    signal?: AbortSignal,
    onUpdate?: (partialResult: unknown) => void,
  ) => Promise<ActionResult>;
  readonly includeAction?: (capabilityId: string, action: CapabilityAction) => boolean;
  readonly onResult?: (
    capabilityId: string,
    actionId: string,
    result: ActionResult,
  ) => void | Promise<void>;
}

export function createCapabilityPiTools(
  options: CreateCapabilityPiToolsOptions,
): ReadonlyArray<AgentTool<TSchema, unknown>> {
  const failedReads = new Map<string, string[]>();
  return options.registry.forProfile(options.profile).flatMap((capability) => (
    capability.actions
      .filter((action) => options.includeAction?.(capability.id, action) ?? true)
      .map((action): AgentTool<TSchema, unknown> => ({
      name: capabilityToolName(capability.id, action.id),
      label: action.title,
      description: action.description,
      parameters: action.parameters,
      async execute(toolCallId, params, signal, onUpdate): Promise<AgentToolResult<unknown>> {
        if (signal?.aborted) throw signal.reason;
        const retryKey = JSON.stringify([capability.id, action.id, params]);
        let result: ActionResult;
        try { result = await runWithAgentTrajectoryRole("subagent", () => options.executeAction(
          capability.id,
          action.id,
          params,
          signal,
          onUpdate ? (partialResult) => onUpdate(partialResult as AgentToolResult<ActionResult>) : undefined,
        ), toolCallId);
        } catch (error) {
          if (action.risk === "read") failedReads.set(retryKey, [...(failedReads.get(retryKey) ?? []), toolCallId]);
          if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
          const failure = actionFailureFacts(error);
          const { message: _message, ...metadata } = failure;
          if (failure?.code) throw Object.assign(new Error(JSON.stringify({
            status: "error", ...failure,
          }), { cause: error }), metadata);
          throw error;
        }
        const recoveredToolCallIds = failedReads.get(retryKey) ?? [];
        failedReads.delete(retryKey);
        await options.onResult?.(capability.id, action.id, result);
        return {
          content: [{ type: "text", text: renderActionResultForAgent(result) }],
          // Studio renders domain-owned result cards (proposed_action, play
          // scene, chapter revision, etc.). The harness ActionResult remains
          // authoritative in the Episode ledger; Pi events expose its domain
          // payload when one exists.
          details: { ...((result.data && typeof result.data === "object") ? result.data : result),
            ...(result.operationReceipts?.length?{operationReceipts:result.operationReceipts}:{}),
            displayText: result.content ?? result.summary, recoveredToolCallIds,
            hostExecution: { risk: action.risk, status: result.status, artifacts: result.artifacts } },
        };
      },
      }))
  ));
}

export function capabilityToolName(capabilityId: string, actionId: string): string {
  return `${capabilityId}__${actionId}`;
}

export function capabilityActionId(toolName: string): string {
  const separator = toolName.indexOf("__");
  return separator >= 0 ? toolName.slice(separator + 2) : toolName;
}

export function renderActionResultForAgent(result: ActionResult): string {
  return JSON.stringify(actionObservation(result));
}
