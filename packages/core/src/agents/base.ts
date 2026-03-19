import type { LLMClient, LLMMessage, LLMResponse, OnStreamProgress } from "../llm/provider.js";
import { chatCompletion } from "../llm/provider.js";
import { AgentError } from "./agent-error.js";
import { readFileSafe as readFileSafeUtil } from "../utils/read-file-safe.js";
import type { Logger } from "../utils/logger.js";

export interface AgentContext {
  readonly client: LLMClient;
  readonly model: string;
  readonly projectRoot: string;
  readonly bookId?: string;
  readonly logger?: Logger;
  readonly onStreamProgress?: OnStreamProgress;
}

export abstract class BaseAgent {
  protected readonly ctx: AgentContext;

  constructor(ctx: AgentContext) {
    this.ctx = ctx;
  }

  protected async chat(
    messages: ReadonlyArray<LLMMessage>,
    options?: { readonly temperature?: number; readonly maxTokens?: number },
  ): Promise<LLMResponse> {
    try {
      return await chatCompletion(this.ctx.client, this.ctx.model, messages, {
        ...options,
        onStreamProgress: this.ctx.onStreamProgress,
      });
    } catch (error) {
      // Ya es un AgentError — no envolver dos veces
      if (error instanceof AgentError) throw error;

      throw new AgentError({
        agent: this.name,
        message: `LLM call failed: ${String(error).slice(0, 200)}`,
        cause: error,
        bookId: this.ctx.bookId,
      });
    }
  }

  /**
   * Chat with provider-native web search enabled.
   * OpenAI Chat API: uses web_search_options.
   * OpenAI Responses API: uses web_search_preview hosted tool.
   * Anthropic: falls back to regular chat (no native search).
   */
  protected async chatWithSearch(
    messages: ReadonlyArray<LLMMessage>,
    options?: { readonly temperature?: number; readonly maxTokens?: number },
  ): Promise<LLMResponse> {
    try {
      return await chatCompletion(this.ctx.client, this.ctx.model, messages, {
        ...options,
        webSearch: true,
        onStreamProgress: this.ctx.onStreamProgress,
      });
    } catch (error) {
      if (error instanceof AgentError) throw error;

      throw new AgentError({
        agent: this.name,
        message: `LLM call (web search) failed: ${String(error).slice(0, 200)}`,
        cause: error,
        bookId: this.ctx.bookId,
      });
    }
  }

  /**
   * Lee un archivo con un valor por defecto si no existe.
   * Delega a la utilidad compartida readFileSafe.
   */
  protected readFileSafe(path: string, fallback = "(文件不存在)"): Promise<string> {
    return readFileSafeUtil(path, fallback);
  }

  abstract get name(): string;
}

