import {
  appendManualSessionMessages,
  buildAgentSystemPrompt,
  chatCompletion,
  createLLMClient,
  type ProjectConfig,
} from "@actalk/inkos-core";
import type { ServiceConfigEntry } from "../services/service-config.js";
import type { CollectedToolExec } from "./execution.js";
import {
  resolveCreatedBookIdFromToolExecs,
  validateAgentActionExecution,
} from "./execution.js";
import type { AgentRouteResult } from "./route-types.js";
import type { AgentSessionContext } from "./session-context.js";

export async function recoverEmptyAgentResponse(args: {
  readonly agentApiKey?: string;
  readonly agentBookId: string | null;
  readonly collectedToolExecs: CollectedToolExec[];
  readonly config: ProjectConfig;
  readonly configuredEntry?: ServiceConfigEntry;
  readonly finalizeCreatedBook: () => Promise<string | null>;
  readonly instruction: string;
  readonly requestedModel?: string;
  readonly requestedService?: string;
  readonly result: { responseText?: string; errorMessage?: string };
  readonly root: string;
  readonly sessionContext: AgentSessionContext;
}): Promise<AgentRouteResult> {
  if (args.result.errorMessage) {
    if (resolveCreatedBookIdFromToolExecs(args.collectedToolExecs)) {
      await args.finalizeCreatedBook();
    }
    return {
      body: {
        error: { code: "AGENT_LLM_ERROR", message: args.result.errorMessage },
        response: args.result.errorMessage,
      },
      status: 502,
    };
  }

  try {
    const fallbackClient = createLLMClient({
      ...args.config.llm,
      service: args.configuredEntry?.service ?? args.requestedService ?? args.config.llm.service,
      model: args.requestedModel ?? args.config.llm.model,
      apiKey: args.agentApiKey ?? args.config.llm.apiKey,
      baseUrl: args.configuredEntry?.baseUrl ?? "",
      ...(args.configuredEntry?.apiFormat ? { apiFormat: args.configuredEntry.apiFormat } : {}),
      ...(args.configuredEntry?.stream !== undefined ? { stream: args.configuredEntry.stream } : {}),
    } as ProjectConfig["llm"]);
    const fallback = await chatCompletion(
      fallbackClient,
      args.requestedModel ?? args.config.llm.model,
      [
        { role: "system", content: buildAgentSystemPrompt(args.agentBookId, args.config.language ?? "zh") },
        { role: "user", content: args.instruction },
      ],
      { maxTokens: 256 },
    );
    if (fallback.content?.trim()) {
      const actionExecutionError = validateAgentActionExecution({
        instruction: args.instruction,
        agentBookId: args.agentBookId,
        responseText: fallback.content,
        collectedToolExecs: args.collectedToolExecs,
      });
      if (actionExecutionError) {
        return {
          body: {
            error: { code: "AGENT_ACTION_NOT_EXECUTED", message: actionExecutionError },
            response: actionExecutionError,
          },
          status: 502,
        };
      }
      await appendManualSessionMessages(args.root, args.sessionContext.bookSession.sessionId, [{
        role: "assistant",
        content: [{ type: "text", text: fallback.content }],
        api: "anthropic-messages",
        provider: args.configuredEntry?.service ?? args.requestedService ?? args.config.llm.provider,
        model: args.requestedModel ?? args.config.llm.model,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      }], args.instruction);
      await args.sessionContext.refreshBookSessionFromTranscript();
      const createdBookId = await args.finalizeCreatedBook();
      return {
        body: {
          response: fallback.content,
          session: {
            sessionId: args.sessionContext.bookSession.sessionId,
            ...(createdBookId ? { activeBookId: createdBookId } : {}),
          },
        },
      };
    }
  } catch {
    // Fall through to probe-based diagnosis below.
  }

  try {
    const probeClient = createLLMClient({
      ...args.config.llm,
      service: args.configuredEntry?.service ?? args.requestedService ?? args.config.llm.service,
      model: args.requestedModel ?? args.config.llm.model,
      apiKey: args.agentApiKey ?? args.config.llm.apiKey,
      baseUrl: args.configuredEntry?.baseUrl ?? "",
      ...(args.configuredEntry?.apiFormat ? { apiFormat: args.configuredEntry.apiFormat } : {}),
      ...(args.configuredEntry?.stream !== undefined ? { stream: args.configuredEntry.stream } : {}),
    } as ProjectConfig["llm"]);
    await chatCompletion(
      probeClient,
      args.requestedModel ?? args.config.llm.model,
      [{ role: "user", content: "ping" }],
      { maxTokens: 5 },
    );
  } catch (probeError) {
    const probeMessage = probeError instanceof Error ? probeError.message : String(probeError);
    if (resolveCreatedBookIdFromToolExecs(args.collectedToolExecs)) {
      await args.finalizeCreatedBook();
    }
    return {
      body: {
        error: { code: "AGENT_EMPTY_RESPONSE", message: probeMessage },
        response: probeMessage,
      },
      status: 502,
    };
  }

  const emptyMessage = "模型未返回文本内容。请检查协议类型（chat/responses）、流式开关或上游服务兼容性。";
  if (resolveCreatedBookIdFromToolExecs(args.collectedToolExecs)) {
    await args.finalizeCreatedBook();
  }
  return {
    body: {
      error: { code: "AGENT_EMPTY_RESPONSE", message: emptyMessage },
      response: emptyMessage,
    },
    status: 502,
  };
}
