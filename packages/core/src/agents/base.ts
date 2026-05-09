import { createWriteStream, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";
import type { LLMClient, LLMMessage, LLMResponse, OnStreamProgress } from "../llm/provider.js";
import { chatCompletion } from "../llm/provider.js";
import { searchWeb, fetchUrl } from "../utils/web-search.js";
import type { Logger } from "../utils/logger.js";

export interface AgentContext {
  readonly client: LLMClient;
  readonly model: string;
  readonly projectRoot: string;
  readonly bookId?: string;
  readonly logger?: Logger;
  readonly onStreamProgress?: OnStreamProgress;
  readonly chatLogDir?: string;
}

export abstract class BaseAgent {
  protected readonly ctx: AgentContext;

  constructor(ctx: AgentContext) {
    this.ctx = ctx;
  }

  protected get log() {
    return this.ctx.logger;
  }

  protected _createChatLogWriteStream(): Writable | undefined {
    const logDir = this.ctx.chatLogDir;
    if (!logDir) return undefined;

    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const random = Math.random().toString(36).slice(2, 8);
    const filename = `chat-log-${this.name}-${timestamp}-${random}.log`;
    return createWriteStream(join(logDir, filename), { encoding: "utf-8" });
  }

  protected async chat(
    messages: ReadonlyArray<LLMMessage>,
    options?: { readonly temperature?: number; readonly maxTokens?: number },
  ): Promise<LLMResponse> {
    const chatLogWriteStream = this._createChatLogWriteStream();

    try {
      const client = this.ctx.client;
      const model = this.ctx.model;
      const temperature = options?.temperature ?? client.defaults.temperature;
      const maxTokens = options?.maxTokens ?? client.defaults.maxTokens;
      const headerLine = `[${this.name}] >>> BEGIN >>> model=${model} provider=${client.provider} service=${client.service} baseUrl=${client._piModel?.baseUrl ?? "(unknown)"} temperature=${temperature} maxTokens=${maxTokens} messageCount=${messages.length}`;

      if (chatLogWriteStream) {
        chatLogWriteStream.write(`${headerLine}\n`);
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];
          const hdr = `PROMPT [${msg.role}] (${msg.content.length} chars):`;
          chatLogWriteStream.write(`${hdr}\n${msg.content}\n`);
          if (i < messages.length - 1) chatLogWriteStream.write("---\n");
        }
      }

      const result = await chatCompletion(client, model, messages, {
        ...options,
        onStreamProgress: this.ctx.onStreamProgress,
      });

      const respLine = `[${this.name}] <<< RESPONSE <<< ${result.content.length} chars | tokens: prompt=${result.usage.promptTokens} completion=${result.usage.completionTokens} total=${result.usage.totalTokens}`;

      if (chatLogWriteStream) {
        chatLogWriteStream.write(`${respLine}\n${result.content}\n=== END ===\n\n`);
      }

      return result;
    } finally {
      chatLogWriteStream?.end();
    }
  }

  /**
   * Chat with web search enabled.
   * OpenAI: uses native web_search_options / web_search_preview.
   * Other providers: searches via Tavily API (TAVILY_API_KEY), injects results into prompt.
   */
  protected async chatWithSearch(
    messages: ReadonlyArray<LLMMessage>,
    options?: { readonly temperature?: number; readonly maxTokens?: number },
  ): Promise<LLMResponse> {
    // OpenAI has native search — use it directly
    if (this.ctx.client.provider === "openai") {
      return chatCompletion(this.ctx.client, this.ctx.model, messages, {
        ...options,
        webSearch: true,
        onStreamProgress: this.ctx.onStreamProgress,
      });
    }

    // Other providers: self-hosted search → inject results into prompt
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) {
      return this.chat(messages, options);
    }

    try {
      // Extract search query from user message (first 200 chars)
      const query = lastUserMsg.content.slice(0, 200);
      this.log?.info(`[search] Searching: ${query.slice(0, 60)}...`);

      const results = await searchWeb(query, 3);
      if (results.length === 0) {
        this.log?.warn("[search] No results found, falling back to regular chat");
        return this.chat(messages, options);
      }

      // Fetch top result for full content
      let fullContent = "";
      try {
        fullContent = await fetchUrl(results[0]!.url, 4000);
      } catch {
        // Fetch failed, use snippets only
      }

      const searchContext = [
        "## Web Search Results\n",
        ...results.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`),
        ...(fullContent ? [`\n## Full Content (Top Result)\n${fullContent}`] : []),
      ].join("\n");

      // Inject search results before the last user message
      const augmentedMessages: LLMMessage[] = messages.map((m) =>
        m === lastUserMsg
          ? { ...m, content: `${searchContext}\n\n---\n\n${m.content}` }
          : m,
      );

      return this.chat(augmentedMessages, options);
    } catch (e) {
      this.log?.warn(`[search] Search failed: ${e}, falling back to regular chat`);
      return this.chat(messages, options);
    }
  }

  abstract get name(): string;
}
