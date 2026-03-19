// provider.ts — Routing layer + factory
//
// Delegates a todas las implementaciones por proveedor, re-exporta todos
// los tipos/utilidades para que los consumidores sigan importando desde aquí.

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { LLMConfig } from "../models/project.js";
import { withRetry } from "./retry.js";

// Re-export todos los tipos y utilidades compartidas
export type {
  StreamProgress, OnStreamProgress, LLMResponse, LLMMessage, LLMClient,
  ToolDefinition, ToolCall, AgentMessage, ChatWithToolsResult, ResolvedOptions,
} from "./llm-types.js";
export { createStreamMonitor, PartialResponseError } from "./llm-types.js";

// Importaciones internas (no re-exportadas)
import type { LLMClient, LLMMessage, AgentMessage, ToolDefinition, LLMResponse, ChatWithToolsResult, OnStreamProgress } from "./llm-types.js";
import { PartialResponseError, wrapLLMError, isLikelyStreamError } from "./llm-types.js";

import {
  chatCompletionOpenAIChat, chatCompletionOpenAIChatSync,
  chatCompletionOpenAIResponses, chatCompletionOpenAIResponsesSync,
  chatWithToolsOpenAIChat, chatWithToolsOpenAIResponses,
} from "./openai-backend.js";

import {
  chatCompletionAnthropic, chatCompletionAnthropicSync,
  chatWithToolsAnthropic,
} from "./anthropic-backend.js";

// === Factory ===

export function createLLMClient(config: LLMConfig): LLMClient {
  const defaults = {
    temperature: config.temperature ?? 0.7,
    maxTokens: config.maxTokens ?? 8192,
    thinkingBudget: config.thinkingBudget ?? 0,
  };

  const apiFormat = config.apiFormat ?? "chat";
  const stream = config.stream ?? true;

  if (config.provider === "anthropic") {
    // Anthropic SDK appends /v1/ internally — strip if user included it
    const baseURL = config.baseUrl.replace(/\/v1\/?$/, "");
    return {
      provider: "anthropic",
      apiFormat,
      stream,
      _anthropic: new Anthropic({ apiKey: config.apiKey, baseURL }),
      defaults,
    };
  }
  // openai or custom — both use OpenAI SDK
  return {
    provider: "openai",
    apiFormat,
    stream,
    _openai: new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl }),
    defaults,
  };
}

// === Simple Chat (used by all agents via BaseAgent.chat()) ===

export async function chatCompletion(
  client: LLMClient,
  model: string,
  messages: ReadonlyArray<LLMMessage>,
  options?: {
    readonly temperature?: number;
    readonly maxTokens?: number;
    readonly webSearch?: boolean;
    readonly onStreamProgress?: OnStreamProgress;
  },
): Promise<LLMResponse> {
  return withRetry(async () => {
    const resolved = {
      temperature: options?.temperature ?? client.defaults.temperature,
      maxTokens: options?.maxTokens ?? client.defaults.maxTokens,
    };
    const onStreamProgress = options?.onStreamProgress;
    const errorCtx = { baseUrl: client._openai?.baseURL ?? "(anthropic)", model };

    try {
      if (client.provider === "anthropic") {
        return client.stream
          ? await chatCompletionAnthropic(client._anthropic!, model, messages, resolved, client.defaults.thinkingBudget, onStreamProgress)
          : await chatCompletionAnthropicSync(client._anthropic!, model, messages, resolved, client.defaults.thinkingBudget);
      }
      if (client.apiFormat === "responses") {
        return client.stream
          ? await chatCompletionOpenAIResponses(client._openai!, model, messages, resolved, options?.webSearch, onStreamProgress)
          : await chatCompletionOpenAIResponsesSync(client._openai!, model, messages, resolved, options?.webSearch);
      }
      return client.stream
        ? await chatCompletionOpenAIChat(client._openai!, model, messages, resolved, options?.webSearch, onStreamProgress)
        : await chatCompletionOpenAIChatSync(client._openai!, model, messages, resolved, options?.webSearch);
    } catch (error) {
      // Stream interrupted but partial content is usable — return truncated response
      if (error instanceof PartialResponseError) {
        return {
          content: error.partialContent,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
      }

      // Auto-fallback: if streaming failed, retry with sync (many proxies don't support SSE)
      if (client.stream) {
        const isStreamRelated = isLikelyStreamError(error);
        if (isStreamRelated) {
          try {
            if (client.provider === "anthropic") {
              return await chatCompletionAnthropicSync(client._anthropic!, model, messages, resolved, client.defaults.thinkingBudget);
            }
            if (client.apiFormat === "responses") {
              return await chatCompletionOpenAIResponsesSync(client._openai!, model, messages, resolved, options?.webSearch);
            }
            return await chatCompletionOpenAIChatSync(client._openai!, model, messages, resolved, options?.webSearch);
          } catch (syncError) {
            throw wrapLLMError(syncError, errorCtx);
          }
        }
      }

      throw wrapLLMError(error, errorCtx);
    }
  });
}

// === Tool-calling Chat (used by agent loop) ===

export async function chatWithTools(
  client: LLMClient,
  model: string,
  messages: ReadonlyArray<AgentMessage>,
  tools: ReadonlyArray<ToolDefinition>,
  options?: {
    readonly temperature?: number;
    readonly maxTokens?: number;
  },
): Promise<ChatWithToolsResult> {
  return withRetry(async () => {
    try {
      const resolved = {
        temperature: options?.temperature ?? client.defaults.temperature,
        maxTokens: options?.maxTokens ?? client.defaults.maxTokens,
      };
      if (client.provider === "anthropic") {
        return await chatWithToolsAnthropic(client._anthropic!, model, messages, tools, resolved, client.defaults.thinkingBudget);
      }
      if (client.apiFormat === "responses") {
        return await chatWithToolsOpenAIResponses(client._openai!, model, messages, tools, resolved);
      }
      return await chatWithToolsOpenAIChat(client._openai!, model, messages, tools, resolved);
    } catch (error) {
      throw wrapLLMError(error);
    }
  });
}
