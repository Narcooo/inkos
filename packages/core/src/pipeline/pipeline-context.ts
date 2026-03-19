/**
 * Pipeline Context — Infraestructura compartida entre PipelineRunner e ImportPipeline.
 *
 * Elimina la duplicación de resolveOverride / agentCtxFor / agentClients
 * que existía en ambos archivos.
 */

import type { LLMClient, OnStreamProgress } from "../llm/provider.js";
import { createLLMClient } from "../llm/provider.js";
import type { Logger } from "../utils/logger.js";
import type { LLMConfig, AgentLLMOverride } from "../models/project.js";
import type { AgentContext } from "../agents/base.js";

export interface PipelineContextConfig {
  readonly client: LLMClient;
  readonly model: string;
  readonly projectRoot: string;
  readonly defaultLLMConfig?: LLMConfig;
  readonly modelOverrides?: Record<string, string | AgentLLMOverride>;
  readonly logger?: Logger;
  readonly onStreamProgress?: OnStreamProgress;
}

/**
 * Contexto compartido que resuelve overrides de agente y construye AgentContext.
 * Usado por PipelineRunner e ImportPipeline para evitar duplicación.
 */
export class PipelineContext {
  private readonly config: PipelineContextConfig;
  private readonly agentClients = new Map<string, LLMClient>();

  constructor(config: PipelineContextConfig) {
    this.config = config;
  }

  /** Resuelve el modelo y cliente para un agente específico, considerando overrides. */
  resolveOverride(agentName: string): { model: string; client: LLMClient } {
    const override = this.config.modelOverrides?.[agentName];
    if (!override) {
      return { model: this.config.model, client: this.config.client };
    }
    if (typeof override === "string") {
      return { model: override, client: this.config.client };
    }
    if (!override.baseUrl) {
      return { model: override.model, client: this.config.client };
    }
    const cacheKey = `${override.baseUrl}:${override.provider ?? "custom"}`;
    let client = this.agentClients.get(cacheKey);
    if (!client) {
      const base = this.config.defaultLLMConfig;
      const apiKey = override.apiKeyEnv
        ? process.env[override.apiKeyEnv] ?? ""
        : base?.apiKey ?? "";
      client = createLLMClient({
        provider: override.provider ?? base?.provider ?? "custom",
        baseUrl: override.baseUrl,
        apiKey,
        model: override.model,
        temperature: base?.temperature ?? 0.7,
        maxTokens: base?.maxTokens ?? 8192,
        thinkingBudget: base?.thinkingBudget ?? 0,
        apiFormat: base?.apiFormat ?? "chat",
        stream: override.stream ?? base?.stream ?? true,
      });
      this.agentClients.set(cacheKey, client);
    }
    return { model: override.model, client };
  }

  /** Construye un AgentContext para un agente específico. */
  agentCtxFor(agent: string, bookId?: string): AgentContext {
    const { model, client } = this.resolveOverride(agent);
    return {
      client,
      model,
      projectRoot: this.config.projectRoot,
      bookId,
      logger: this.config.logger?.child(agent),
      onStreamProgress: this.config.onStreamProgress,
    };
  }

  /** Construye un AgentContext básico sin override. */
  agentCtx(bookId?: string): AgentContext {
    return {
      client: this.config.client,
      model: this.config.model,
      projectRoot: this.config.projectRoot,
      bookId,
      logger: this.config.logger,
      onStreamProgress: this.config.onStreamProgress,
    };
  }
}
