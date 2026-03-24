import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { LLMConfig } from "../models/project.js";

// === Streaming Monitor Types ===

export interface StreamProgress {
  readonly elapsedMs: number;
  readonly totalChars: number;
  readonly chineseChars: number;
  readonly status: "streaming" | "done";
}

export type OnStreamProgress = (progress: StreamProgress) => void;

export function createStreamMonitor(
  onProgress?: OnStreamProgress,
  intervalMs: number = 30000,
): { readonly onChunk: (text: string) => void; readonly stop: () => void } {
  let totalChars = 0;
  let chineseChars = 0;
  const startTime = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;

  if (onProgress) {
    timer = setInterval(() => {
      onProgress({
        elapsedMs: Date.now() - startTime,
        totalChars,
        chineseChars,
        status: "streaming",
      });
    }, intervalMs);
  }

  return {
    onChunk(text: string): void {
      totalChars += text.length;
      chineseChars += (text.match(/[\u4e00-\u9fff]/g) || []).length;
    },
    stop(): void {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      onProgress?.({
        elapsedMs: Date.now() - startTime,
        totalChars,
        chineseChars,
        status: "done",
      });
    },
  };
}

// === Shared Types ===

export interface LLMResponse {
  readonly content: string;
  readonly usage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

export interface LLMMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface LLMClient {
  readonly provider: "openai" | "anthropic";
  readonly apiFormat: "chat" | "responses";
  readonly stream: boolean;
  readonly _openai?: OpenAI;
  readonly _anthropic?: Anthropic;
  readonly defaults: {
    readonly temperature: number;
    readonly maxTokens: number;
    readonly maxTokensCap: number | null; // non-null only when user explicitly configured
    readonly thinkingBudget: number;
    readonly extra: Record<string, unknown>;
  };
}

// === Tool-calling Types ===

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

export type AgentMessage =
  | { readonly role: "system"; readonly content: string }
  | { readonly role: "user"; readonly content: string }
  | { readonly role: "assistant"; readonly content: string | null; readonly toolCalls?: ReadonlyArray<ToolCall> }
  | { readonly role: "tool"; readonly toolCallId: string; readonly content: string };

export interface ChatWithToolsResult {
  readonly content: string;
  readonly toolCalls: ReadonlyArray<ToolCall>;
}

// === Factory ===

export function createLLMClient(config: LLMConfig): LLMClient {
  const defaults = {
    temperature: config.temperature ?? 0.7,
    maxTokens: config.maxTokens ?? 8192,
    maxTokensCap: config.maxTokens ?? null, // only cap when user explicitly set maxTokens
    thinkingBudget: config.thinkingBudget ?? 0,
    extra: config.extra ?? {},
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

// === Partial Response (stream interrupted but usable content received) ===

export class PartialResponseError extends Error {
  readonly partialContent: string;
  constructor(partialContent: string, cause: unknown) {
    super(`Stream interrupted after ${partialContent.length} chars: ${String(cause)}`);
    this.name = "PartialResponseError";
    this.partialContent = partialContent;
  }
}

/** Minimum chars to consider a partial response salvageable (Chinese ~2 chars/word → 500 chars ≈ 250 words) */
const MIN_SALVAGEABLE_CHARS = 500;

/** Keys managed by the provider layer — prevent extra from overriding them. */
const RESERVED_KEYS = new Set(["max_tokens", "temperature", "model", "messages", "stream"]);

function stripReservedKeys(extra: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (!RESERVED_KEYS.has(key)) result[key] = value;
  }
  return result;
}

// === Error Wrapping ===

function wrapLLMError(error: unknown, context?: { readonly baseUrl?: string; readonly model?: string }): Error {
  const msg = String(error);
  const ctxLine = context
    ? `\n  (baseUrl: ${context.baseUrl}, model: ${context.model})`
    : "";

  if (msg.includes("400")) {
    return new Error(
      `API 返回 400 (请求参数错误)。可能原因：\n` +
      `  1. 模型名称不正确（检查 INKOS_LLM_MODEL）\n` +
      `  2. 提供方不支持某些参数（如 max_tokens、stream）\n` +
      `  3. 消息格式不兼容（部分提供方不支持 system role）\n` +
      `  建议：在 inkos.json 中设置 "stream": false 试试，或检查提供方文档${ctxLine}`,
    );
  }
  if (msg.includes("403")) {
    return new Error(
      `API 返回 403 (请求被拒绝)。可能原因：\n` +
      `  1. API Key 无效或过期\n` +
      `  2. API 提供方的内容审查拦截了请求（公益/免费 API 常见）\n` +
      `  3. 账户余额不足\n` +
      `  建议：用 inkos doctor 测试 API 连通性，或换一个不限制内容的 API 提供方${ctxLine}`,
    );
  }
  if (msg.includes("401")) {
    return new Error(
      `API 返回 401 (未授权)。请检查 .env 中的 INKOS_LLM_API_KEY 是否正确。${ctxLine}`,
    );
  }
  if (msg.includes("429")) {
    return new Error(
      `API 返回 429 (请求过多)。请稍后重试，或检查 API 配额。${ctxLine}`,
    );
  }
  if (msg.includes("Connection error") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("fetch failed")) {
    return new Error(
      `无法连接到 API 服务。可能原因：\n` +
      `  1. baseUrl 地址不正确（当前：${context?.baseUrl ?? "未知"}）\n` +
      `  2. 网络不通或被防火墙拦截\n` +
      `  3. API 服务暂时不可用\n` +
      `  建议：检查 INKOS_LLM_BASE_URL 是否包含完整路径（如 /v1）`,
    );
  }
  return error instanceof Error ? error : new Error(msg);
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
  const perCallMax = options?.maxTokens ?? client.defaults.maxTokens;
  const cap = client.defaults.maxTokensCap;
  const resolved = {
    temperature: options?.temperature ?? client.defaults.temperature,
    maxTokens: cap !== null ? Math.min(perCallMax, cap) : perCallMax,
    extra: client.defaults.extra,
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
}

function isLikelyStreamError(error: unknown): boolean {
  const msg = String(error).toLowerCase();
  // Common indicators that streaming specifically is the problem:
  // - SSE parse errors, chunked transfer issues, content-type mismatches
  // - Some proxies return 400/415 when stream=true
  // - "stream" mentioned in error, or generic network errors during streaming
  return (
    msg.includes("stream") ||
    msg.includes("text/event-stream") ||
    msg.includes("chunked") ||
    msg.includes("unexpected end") ||
    msg.includes("premature close") ||
    msg.includes("terminated") ||
    msg.includes("econnreset") ||
    (msg.includes("400") && !msg.includes("content"))
  );
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
  try {
    const resolved = {
      temperature: options?.temperature ?? client.defaults.temperature,
      maxTokens: options?.maxTokens ?? client.defaults.maxTokens,
    };
    // Tool-calling always uses streaming (only used by agent loop, not by writer/auditor)
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
}

// === OpenAI Chat Completions API Implementation (default) ===

async function chatCompletionOpenAIChat(
  client: OpenAI,
  model: string,
  messages: ReadonlyArray<LLMMessage>,
  options: { readonly temperature: number; readonly maxTokens: number; readonly extra: Record<string, unknown> },
  webSearch?: boolean,
  onStreamProgress?: OnStreamProgress,
): Promise<LLMResponse> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createParams: any = {
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: options.temperature,
    max_tokens: options.maxTokens,
    stream: true,
    ...(webSearch ? { web_search_options: { search_context_size: "medium" as const } } : {}),
    ...stripReservedKeys(options.extra),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = await client.chat.completions.create(createParams) as any;

  const chunks: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  const monitor = createStreamMonitor(onStreamProgress);

  try {
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        chunks.push(delta);
        monitor.onChunk(delta);
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? 0;
        outputTokens = chunk.usage.completion_tokens ?? 0;
      }
    }
  } catch (streamError) {
    monitor.stop();
    const partial = chunks.join("");
    if (partial.length >= MIN_SALVAGEABLE_CHARS) {
      throw new PartialResponseError(partial, streamError);
    }
    throw streamError;
  } finally {
    monitor.stop();
  }

  const content = chunks.join("");
  if (!content) throw new Error("LLM returned empty response from stream");

  return {
    content,
    usage: {
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
  };
}

async function chatCompletionOpenAIChatSync(
  client: OpenAI,
  model: string,
  messages: ReadonlyArray<LLMMessage>,
  options: { readonly temperature: number; readonly maxTokens: number; readonly extra: Record<string, unknown> },
  _webSearch?: boolean,
): Promise<LLMResponse> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const syncParams: any = {
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: options.temperature,
    max_tokens: options.maxTokens,
    stream: false,
    ...stripReservedKeys(options.extra),
  };
  const response = await client.chat.completions.create(syncParams);

  const content = response.choices[0]?.message?.content ?? "";
  if (!content) throw new Error("LLM returned empty response");

  return {
    content,
    usage: {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    },
  };
}

async function chatWithToolsOpenAIChat(
  client: OpenAI,
  model: string,
  messages: ReadonlyArray<AgentMessage>,
  tools: ReadonlyArray<ToolDefinition>,
  options: { readonly temperature: number; readonly maxTokens: number },
): Promise<ChatWithToolsResult> {
  const openaiMessages = agentMessagesToOpenAIChat(messages);
  const openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const stream = await client.chat.completions.create({
    model,
    messages: openaiMessages,
    tools: openaiTools,
    temperature: options.temperature,
    max_tokens: options.maxTokens,
    stream: true,
  });

  let content = "";
  const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>();

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.content) content += delta.content;
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const existing = toolCallMap.get(tc.index);
        if (existing) {
          existing.arguments += tc.function?.arguments ?? "";
        } else {
          toolCallMap.set(tc.index, {
            id: tc.id ?? "",
            name: tc.function?.name ?? "",
            arguments: tc.function?.arguments ?? "",
          });
        }
      }
    }
  }

  const toolCalls: ToolCall[] = [...toolCallMap.values()];
  return { content, toolCalls };
}

function agentMessagesToOpenAIChat(
  messages: ReadonlyArray<AgentMessage>,
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      result.push({ role: "system", content: msg.content });
      continue;
    }
    if (msg.role === "user") {
      result.push({ role: "user", content: msg.content });
      continue;
    }
    if (msg.role === "assistant") {
      const assistantMsg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
        role: "assistant",
        content: msg.content ?? null,
      };
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        assistantMsg.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }
      result.push(assistantMsg);
      continue;
    }
    if (msg.role === "tool") {
      result.push({
        role: "tool",
        tool_call_id: msg.toolCallId,
        content: msg.content,
      });
    }
  }

  return result;
}

// === OpenAI Responses API Implementation (optional) ===

async function chatCompletionOpenAIResponses(
  client: OpenAI,
  model: string,
  messages: ReadonlyArray<LLMMessage>,
  options: { readonly temperature: number; readonly maxTokens: number },
  webSearch?: boolean,
  onStreamProgress?: OnStreamProgress,
): Promise<LLMResponse> {
  const input: OpenAI.Responses.ResponseInputItem[] = messages.map((m) => ({
    role: m.role as "system" | "user" | "assistant",
    content: m.content,
  }));

  const tools: OpenAI.Responses.Tool[] | undefined = webSearch
    ? [{ type: "web_search_preview" as const }]
    : undefined;

  const stream = await client.responses.create({
    model,
    input,
    temperature: options.temperature,
    max_output_tokens: options.maxTokens,
    stream: true,
    ...(tools ? { tools } : {}),
  });

  const chunks: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  const monitor = createStreamMonitor(onStreamProgress);

  try {
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        chunks.push(event.delta);
        monitor.onChunk(event.delta);
      }
      if (event.type === "response.completed") {
        inputTokens = event.response.usage?.input_tokens ?? 0;
        outputTokens = event.response.usage?.output_tokens ?? 0;
      }
    }
  } catch (streamError) {
    monitor.stop();
    const partial = chunks.join("");
    if (partial.length >= MIN_SALVAGEABLE_CHARS) {
      throw new PartialResponseError(partial, streamError);
    }
    throw streamError;
  } finally {
    monitor.stop();
  }

  const content = chunks.join("");
  if (!content) throw new Error("LLM returned empty response from stream");

  return {
    content,
    usage: {
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
  };
}

async function chatCompletionOpenAIResponsesSync(
  client: OpenAI,
  model: string,
  messages: ReadonlyArray<LLMMessage>,
  options: { readonly temperature: number; readonly maxTokens: number },
  _webSearch?: boolean,
): Promise<LLMResponse> {
  const input: OpenAI.Responses.ResponseInputItem[] = messages.map((m) => ({
    role: m.role as "system" | "user" | "assistant",
    content: m.content,
  }));

  const response = await client.responses.create({
    model,
    input,
    temperature: options.temperature,
    max_output_tokens: options.maxTokens,
    stream: false,
  });

  const content = response.output
    .filter((item): item is OpenAI.Responses.ResponseOutputMessage => item.type === "message")
    .flatMap((item) => item.content)
    .filter((block): block is OpenAI.Responses.ResponseOutputText => block.type === "output_text")
    .map((block) => block.text)
    .join("");

  if (!content) throw new Error("LLM returned empty response");

  return {
    content,
    usage: {
      promptTokens: response.usage?.input_tokens ?? 0,
      completionTokens: response.usage?.output_tokens ?? 0,
      totalTokens: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
    },
  };
}

async function chatWithToolsOpenAIResponses(
  client: OpenAI,
  model: string,
  messages: ReadonlyArray<AgentMessage>,
  tools: ReadonlyArray<ToolDefinition>,
  options: { readonly temperature: number; readonly maxTokens: number },
): Promise<ChatWithToolsResult> {
  const input = agentMessagesToResponsesInput(messages);
  const responsesTools: OpenAI.Responses.Tool[] = tools.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    parameters: t.parameters as OpenAI.Responses.FunctionTool["parameters"],
    strict: false,
  }));

  const stream = await client.responses.create({
    model,
    input,
    tools: responsesTools,
    temperature: options.temperature,
    max_output_tokens: options.maxTokens,
    stream: true,
  });

  let content = "";
  const toolCalls: ToolCall[] = [];

  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      content += event.delta;
    }
    if (event.type === "response.output_item.done" && event.item.type === "function_call") {
      toolCalls.push({
        id: event.item.call_id,
        name: event.item.name,
        arguments: event.item.arguments,
      });
    }
  }

  return { content, toolCalls };
}

function agentMessagesToResponsesInput(
  messages: ReadonlyArray<AgentMessage>,
): OpenAI.Responses.ResponseInputItem[] {
  const result: OpenAI.Responses.ResponseInputItem[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      result.push({ role: "system", content: msg.content });
      continue;
    }
    if (msg.role === "user") {
      result.push({ role: "user", content: msg.content });
      continue;
    }
    if (msg.role === "assistant") {
      if (msg.content) {
        result.push({ role: "assistant", content: msg.content });
      }
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          result.push({
            type: "function_call" as const,
            call_id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          });
        }
      }
      continue;
    }
    if (msg.role === "tool") {
      result.push({
        type: "function_call_output" as const,
        call_id: msg.toolCallId,
        output: msg.content,
      });
    }
  }

  return result;
}

// === Anthropic Implementation ===

async function chatCompletionAnthropic(
  client: Anthropic,
  model: string,
  messages: ReadonlyArray<LLMMessage>,
  options: { readonly temperature: number; readonly maxTokens: number },
  thinkingBudget: number = 0,
  onStreamProgress?: OnStreamProgress,
): Promise<LLMResponse> {
  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const nonSystem = messages.filter((m) => m.role !== "system");

  const stream = await client.messages.create({
    model,
    ...(systemText ? { system: systemText } : {}),
    messages: nonSystem.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    ...(thinkingBudget > 0
      ? { thinking: { type: "enabled" as const, budget_tokens: thinkingBudget } }
      : { temperature: options.temperature }),
    max_tokens: options.maxTokens,
    stream: true,
  });

  const chunks: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  const monitor = createStreamMonitor(onStreamProgress);

  try {
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        chunks.push(event.delta.text);
        monitor.onChunk(event.delta.text);
      }
      if (event.type === "message_start") {
        inputTokens = event.message.usage?.input_tokens ?? 0;
      }
      if (event.type === "message_delta") {
        outputTokens = ((event as unknown as { usage?: { output_tokens?: number } }).usage?.output_tokens) ?? 0;
      }
    }
  } catch (streamError) {
    monitor.stop();
    const partial = chunks.join("");
    if (partial.length >= MIN_SALVAGEABLE_CHARS) {
      throw new PartialResponseError(partial, streamError);
    }
    throw streamError;
  } finally {
    monitor.stop();
  }

  const content = chunks.join("");
  if (!content) throw new Error("LLM returned empty response from stream");

  return {
    content,
    usage: {
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
  };
}

async function chatCompletionAnthropicSync(
  client: Anthropic,
  model: string,
  messages: ReadonlyArray<LLMMessage>,
  options: { readonly temperature: number; readonly maxTokens: number },
  thinkingBudget: number = 0,
): Promise<LLMResponse> {
  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const nonSystem = messages.filter((m) => m.role !== "system");

  const response = await client.messages.create({
    model,
    ...(systemText ? { system: systemText } : {}),
    messages: nonSystem.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    ...(thinkingBudget > 0
      ? { thinking: { type: "enabled" as const, budget_tokens: thinkingBudget } }
      : { temperature: options.temperature }),
    max_tokens: options.maxTokens,
  });

  const content = response.content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  if (!content) throw new Error("LLM returned empty response");

  return {
    content,
    usage: {
      promptTokens: response.usage?.input_tokens ?? 0,
      completionTokens: response.usage?.output_tokens ?? 0,
      totalTokens: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
    },
  };
}

async function chatWithToolsAnthropic(
  client: Anthropic,
  model: string,
  messages: ReadonlyArray<AgentMessage>,
  tools: ReadonlyArray<ToolDefinition>,
  options: { readonly temperature: number; readonly maxTokens: number },
  thinkingBudget: number = 0,
): Promise<ChatWithToolsResult> {
  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => (m as { content: string }).content)
    .join("\n\n");
  const nonSystem = messages.filter((m) => m.role !== "system");

  const anthropicMessages = agentMessagesToAnthropic(nonSystem);
  const anthropicTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Messages.Tool.InputSchema,
  }));

  const stream = await client.messages.create({
    model,
    ...(systemText ? { system: systemText } : {}),
    messages: anthropicMessages,
    tools: anthropicTools,
    ...(thinkingBudget > 0
      ? { thinking: { type: "enabled" as const, budget_tokens: thinkingBudget } }
      : { temperature: options.temperature }),
    max_tokens: options.maxTokens,
    stream: true,
  });

  let content = "";
  const toolCalls: ToolCall[] = [];
  let currentBlock: { id: string; name: string; input: string } | null = null;

  for await (const event of stream) {
    if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
      currentBlock = {
        id: event.content_block.id,
        name: event.content_block.name,
        input: "",
      };
    }
    if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") {
        content += event.delta.text;
      }
      if (event.delta.type === "input_json_delta" && currentBlock) {
        currentBlock.input += event.delta.partial_json;
      }
    }
    if (event.type === "content_block_stop" && currentBlock) {
      toolCalls.push({
        id: currentBlock.id,
        name: currentBlock.name,
        arguments: currentBlock.input,
      });
      currentBlock = null;
    }
  }

  return { content, toolCalls };
}

function agentMessagesToAnthropic(
  messages: ReadonlyArray<AgentMessage>,
): Anthropic.Messages.MessageParam[] {
  const result: Anthropic.Messages.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") continue;

    if (msg.role === "user") {
      result.push({ role: "user", content: msg.content });
      continue;
    }

    if (msg.role === "assistant") {
      const blocks: Anthropic.Messages.ContentBlockParam[] = [];
      if (msg.content) {
        blocks.push({ type: "text", text: msg.content });
      }
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: JSON.parse(tc.arguments),
          });
        }
      }
      if (blocks.length === 0) {
        blocks.push({ type: "text", text: "" });
      }
      result.push({ role: "assistant", content: blocks });
      continue;
    }

    if (msg.role === "tool") {
      const toolResult: Anthropic.Messages.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: msg.toolCallId,
        content: msg.content,
      };
      // Merge consecutive tool results into one user message (Anthropic requires alternating roles)
      const prev = result[result.length - 1];
      if (prev && prev.role === "user" && Array.isArray(prev.content)) {
        (prev.content as Anthropic.Messages.ToolResultBlockParam[]).push(toolResult);
      } else {
        result.push({ role: "user", content: [toolResult] });
      }
    }
  }

  return result;
}
