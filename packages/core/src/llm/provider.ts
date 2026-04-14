import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { LLMConfig } from "../models/project.js";
import {
  streamSimple as piStreamSimple,
  stream as piStream,
} from "@mariozechner/pi-ai";
import type {
  Api as PiApi,
  Model as PiModel,
  Context as PiContext,
  AssistantMessageEvent,
  Tool as PiTool,
  TextContent as PiTextContent,
  ToolCall as PiToolCall,
} from "@mariozechner/pi-ai";
import { resolveServicePreset } from "./service-presets.js";

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
  readonly _piModel?: PiModel<PiApi>;
  readonly _apiKey?: string;
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

  // --- Build pi-ai Model object ---
  const serviceName = config.service ?? "custom";
  const preset = resolveServicePreset(serviceName);
  const piApi = (preset?.api ?? "openai-completions") as PiApi;
  const baseUrl = config.baseUrl || preset?.baseUrl || "";
  const extraHeaders = config.headers ?? parseEnvHeaders();

  const piModel: PiModel<PiApi> = {
    id: config.model,
    name: config.model,
    api: piApi,
    provider: serviceName,
    baseUrl,
    reasoning: (config.thinkingBudget ?? 0) > 0,
    input: ["text"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: config.maxTokens ?? 8192,
    ...(extraHeaders ? { headers: extraHeaders } : {}),
  };

  // Still build old SDK clients (kept for backward compat until Task 5 cleanup)
  if (config.provider === "anthropic") {
    // Anthropic SDK appends /v1/ internally — strip if user included it
    const baseURL = config.baseUrl.replace(/\/v1\/?$/, "");
    return {
      provider: "anthropic",
      apiFormat,
      stream,
      _anthropic: new Anthropic({ apiKey: config.apiKey, baseURL }),
      _piModel: piModel,
      _apiKey: config.apiKey,
      defaults,
    };
  }
  // openai or custom — both use OpenAI SDK
  return {
    provider: "openai",
    apiFormat,
    stream,
    _openai: new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      ...(extraHeaders ? { defaultHeaders: extraHeaders } : {}),
    }),
    _piModel: piModel,
    _apiKey: config.apiKey,
    defaults,
  };
}

function parseEnvHeaders(): Record<string, string> | undefined {
  const raw = process.env.INKOS_LLM_HEADERS;
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // not JSON — treat as single "Key: Value" pair
    const idx = raw.indexOf(":");
    if (idx > 0) {
      return { [raw.slice(0, idx).trim()]: raw.slice(idx + 1).trim() };
    }
  }
  return undefined;
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

// === Fixed-Temperature Model Clamp ===
//
// 部分 thinking 模型（如 Moonshot kimi-k2.5、kimi-thinking-preview）强制要求
// temperature === 1，其他值会被 API 直接 400 拒绝。为让这类模型能和 inkos
// 已有的 per-call 温度调参（0.1 validator → 0.8 architect brainstorm）共存，
// 在 provider 层统一夹制：命中名单就把传入的 temperature 强制改成 1，并对
// 每个模型名打一次 warning 提示用户。

function requiresFixedTemperature(model: string): boolean {
  const lower = model.toLowerCase();
  // kimi-k2.5 及其子变体（k2.5-preview 等），以及任何名字里带 "thinking" 的模型
  return lower.startsWith("kimi-k2.5") || lower.includes("thinking");
}

const warnedFixedTemperatureModels = new Set<string>();

function clampTemperatureForModel(model: string, requested: number): number {
  if (!requiresFixedTemperature(model)) return requested;
  if (requested === 1) return 1;
  if (!warnedFixedTemperatureModels.has(model)) {
    warnedFixedTemperatureModels.add(model);
    console.warn(
      `[inkos] 模型 "${model}" 是 thinking 模型，强制 temperature=1（原请求值 ${requested}）`,
    );
  }
  return 1;
}

// 仅测试用：清空 warning 去重集合。
export function __resetFixedTemperatureWarnings(): void {
  warnedFixedTemperatureModels.clear();
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
      `  建议：检查提供方文档，确认该接口要求流式开启、流式关闭，还是根本不支持 stream${ctxLine}`,
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

function wrapStreamRequiredError(
  streamError: unknown,
  syncError: unknown,
  context?: { readonly baseUrl?: string; readonly model?: string },
): Error {
  const ctxLine = context
    ? `\n  (baseUrl: ${context.baseUrl}, model: ${context.model})`
    : "";
  return new Error(
    `API 提供方要求使用流式请求（stream:true），不能回退到同步模式。` +
    `\n  这次失败不是模型名错误，而是前一次流式请求先失败了，随后同步回退又被提供方拒绝。` +
    `\n  建议：保持 stream:true，并检查该提供方/代理的 SSE 流是否稳定。` +
    `\n  原始流式错误：${String(streamError)}` +
    `\n  同步回退错误：${String(syncError)}${ctxLine}`,
  );
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
    readonly onTextDelta?: (text: string) => void;
  },
): Promise<LLMResponse> {
  const perCallMax = options?.maxTokens ?? client.defaults.maxTokens;
  const cap = client.defaults.maxTokensCap;
  const resolved = {
    temperature: clampTemperatureForModel(
      model,
      options?.temperature ?? client.defaults.temperature,
    ),
    maxTokens: cap !== null ? Math.min(perCallMax, cap) : perCallMax,
    extra: client.defaults.extra,
  };
  const onStreamProgress = options?.onStreamProgress;
  const onTextDelta = options?.onTextDelta;
  const errorCtx = { baseUrl: client._piModel?.baseUrl ?? client._openai?.baseURL ?? "(anthropic)", model };

  try {
    return await chatCompletionViaPiAi(client, model, messages, resolved, onStreamProgress, onTextDelta);
  } catch (error) {
    // Stream interrupted but partial content is usable — return truncated response
    if (error instanceof PartialResponseError) {
      return {
        content: error.partialContent,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
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

function isStreamRequiredError(error: unknown): boolean {
  const msg = String(error).toLowerCase();
  return (
    msg.includes("stream must be set to true") ||
    (msg.includes("stream") && msg.includes("must be set to true")) ||
    (msg.includes("stream") && msg.includes("required"))
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
      temperature: clampTemperatureForModel(
        model,
        options?.temperature ?? client.defaults.temperature,
      ),
      maxTokens: options?.maxTokens ?? client.defaults.maxTokens,
    };
    return await chatWithToolsViaPiAi(client, model, messages, tools, resolved);
  } catch (error) {
    throw wrapLLMError(error);
  }
}

// === pi-ai Unified Implementation ===

/**
 * Build a pi-ai Model<Api> for a specific per-call model name.
 * The base template comes from client._piModel (created in createLLMClient);
 * we override .id / .name when the caller passes a different model string
 * (e.g. agent overrides).
 */
function resolvePiModel(client: LLMClient, model: string): PiModel<PiApi> {
  const base = client._piModel!;
  if (base.id === model) return base;
  return { ...base, id: model, name: model };
}

/** Convert inkos LLMMessage[] to pi-ai Context. */
function toPiContext(messages: ReadonlyArray<LLMMessage>): PiContext {
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  const systemPrompt = systemParts.length > 0 ? systemParts.join("\n\n") : undefined;
  const piMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "user") {
        return { role: "user" as const, content: m.content, timestamp: Date.now() };
      }
      // assistant
      return {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: m.content }],
        api: "openai-completions" as PiApi,
        provider: "openai",
        model: "",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop" as const,
        timestamp: Date.now(),
      };
    });
  return { systemPrompt, messages: piMessages };
}

/** Convert inkos AgentMessage[] to pi-ai Context (with tool calls/results). */
function agentMessagesToPiContext(messages: ReadonlyArray<AgentMessage>): PiContext {
  const systemParts = messages.filter((m) => m.role === "system").map((m) => (m as { content: string }).content);
  const systemPrompt = systemParts.length > 0 ? systemParts.join("\n\n") : undefined;
  const piMessages: PiContext["messages"] = [];
  for (const msg of messages) {
    if (msg.role === "system") continue;
    if (msg.role === "user") {
      piMessages.push({ role: "user", content: msg.content, timestamp: Date.now() });
      continue;
    }
    if (msg.role === "assistant") {
      const content: (PiTextContent | PiToolCall)[] = [];
      if (msg.content) content.push({ type: "text", text: msg.content });
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          content.push({
            type: "toolCall",
            id: tc.id,
            name: tc.name,
            arguments: JSON.parse(tc.arguments),
          });
        }
      }
      if (content.length === 0) content.push({ type: "text", text: "" });
      piMessages.push({
        role: "assistant",
        content,
        api: "openai-completions" as PiApi,
        provider: "openai",
        model: "",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      });
      continue;
    }
    if (msg.role === "tool") {
      piMessages.push({
        role: "toolResult",
        toolCallId: msg.toolCallId,
        toolName: "",
        content: [{ type: "text", text: msg.content }],
        isError: false,
        timestamp: Date.now(),
      });
    }
  }
  return { systemPrompt, messages: piMessages };
}

/** Convert inkos ToolDefinition[] to pi-ai Tool[]. */
function toPiTools(tools: ReadonlyArray<ToolDefinition>): PiTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters as PiTool["parameters"],
  }));
}

async function chatCompletionViaPiAi(
  client: LLMClient,
  model: string,
  messages: ReadonlyArray<LLMMessage>,
  resolved: { readonly temperature: number; readonly maxTokens: number; readonly extra: Record<string, unknown> },
  onStreamProgress?: OnStreamProgress,
  onTextDelta?: (text: string) => void,
): Promise<LLMResponse> {
  const piModel = resolvePiModel(client, model);
  const context = toPiContext(messages);
  const streamOpts = {
    temperature: resolved.temperature,
    maxTokens: resolved.maxTokens,
    apiKey: client._apiKey,
    headers: piModel.headers,
  };

  const eventStream = piStreamSimple(piModel, context, streamOpts);
  const chunks: string[] = [];
  const monitor = createStreamMonitor(onStreamProgress);
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    for await (const event of eventStream) {
      if (event.type === "text_delta") {
        chunks.push(event.delta);
        monitor.onChunk(event.delta);
        onTextDelta?.(event.delta);
      }
      if (event.type === "done" || event.type === "error") {
        const msg = event.type === "done" ? event.message : event.error;
        inputTokens = msg.usage.input;
        outputTokens = msg.usage.output;
        if (event.type === "error" && msg.errorMessage) {
          // Check if we have partial content worth salvaging
          const partial = chunks.join("");
          if (partial.length >= MIN_SALVAGEABLE_CHARS) {
            throw new PartialResponseError(partial, new Error(msg.errorMessage));
          }
          throw new Error(msg.errorMessage);
        }
      }
    }
  } catch (streamError) {
    monitor.stop();
    if (streamError instanceof PartialResponseError) throw streamError;
    const partial = chunks.join("");
    if (partial.length >= MIN_SALVAGEABLE_CHARS) {
      throw new PartialResponseError(partial, streamError);
    }
    throw streamError;
  } finally {
    monitor.stop();
  }

  const content = chunks.join("");
  if (!content) {
    const diag = `usage=${inputTokens}+${outputTokens}`;
    console.warn(`[inkos] LLM 流式响应无文本内容 (${diag})`);
    throw new Error(`LLM returned empty response from stream (${diag})`);
  }

  return {
    content,
    usage: {
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
  };
}

async function chatWithToolsViaPiAi(
  client: LLMClient,
  model: string,
  messages: ReadonlyArray<AgentMessage>,
  tools: ReadonlyArray<ToolDefinition>,
  resolved: { readonly temperature: number; readonly maxTokens: number },
): Promise<ChatWithToolsResult> {
  const piModel = resolvePiModel(client, model);
  const context = agentMessagesToPiContext(messages);
  context.tools = toPiTools(tools);
  const streamOpts = {
    temperature: resolved.temperature,
    maxTokens: resolved.maxTokens,
    apiKey: client._apiKey,
    headers: piModel.headers,
  };

  const eventStream = piStream(piModel, context, streamOpts);
  let content = "";
  const toolCalls: ToolCall[] = [];

  for await (const event of eventStream) {
    if (event.type === "text_delta") {
      content += event.delta;
    }
    if (event.type === "toolcall_end") {
      toolCalls.push({
        id: event.toolCall.id,
        name: event.toolCall.name,
        arguments: JSON.stringify(event.toolCall.arguments),
      });
    }
    if (event.type === "error" && event.error.errorMessage) {
      throw new Error(event.error.errorMessage);
    }
  }

  return { content, toolCalls };
}

// === Legacy Implementations (kept for backward compat, no longer called from main path) ===

// === OpenAI Chat Completions API Implementation (default) ===

async function chatCompletionOpenAIChat(
  client: OpenAI,
  model: string,
  messages: ReadonlyArray<LLMMessage>,
  options: { readonly temperature: number; readonly maxTokens: number; readonly extra: Record<string, unknown> },
  webSearch?: boolean,
  onStreamProgress?: OnStreamProgress,
  onTextDelta?: (text: string) => void,
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
  let reasoningChars = 0;
  let lastFinishReason: string | null = null;
  const monitor = createStreamMonitor(onStreamProgress);

  try {
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      const delta = choice?.delta?.content;
      if (delta) {
        chunks.push(delta);
        monitor.onChunk(delta);
        onTextDelta?.(delta);
      }
      // Track reasoning_content from thinking models (e.g. kimi-k2.5)
      const reasoning = choice?.delta?.reasoning_content;
      if (reasoning) {
        reasoningChars += reasoning.length;
      }
      if (choice?.finish_reason) {
        lastFinishReason = choice.finish_reason;
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
  if (!content) {
    const diag = [
      `finish_reason=${lastFinishReason ?? "unknown"}`,
      `usage=${inputTokens}+${outputTokens}`,
      ...(reasoningChars > 0 ? [`reasoning_content=${reasoningChars}chars`] : []),
    ].join(", ");
    console.warn(`[inkos] LLM 流式响应无文本内容 (${diag})`);
    throw new Error(`LLM returned empty response from stream (${diag})`);
  }

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
  onTextDelta?: (text: string) => void,
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
  if (!content) {
    const finishReason = response.choices[0]?.finish_reason ?? "unknown";
    const usage = response.usage;
    const diag = [
      `finish_reason=${finishReason}`,
      `usage=${usage?.prompt_tokens ?? 0}+${usage?.completion_tokens ?? 0}`,
    ].join(", ");
    console.warn(`[inkos] LLM 同步响应无文本内容 (${diag})`);
    throw new Error(`LLM returned empty response (${diag})`);
  }
  onTextDelta?.(content);

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
  onTextDelta?: (text: string) => void,
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
        onTextDelta?.(event.delta);
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
  onTextDelta?: (text: string) => void,
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
  onTextDelta?.(content);

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
  onTextDelta?: (text: string) => void,
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
  let hasThinkingBlocks = false;
  let stopReason: string | null = null;
  const monitor = createStreamMonitor(onStreamProgress);

  try {
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        chunks.push(event.delta.text);
        monitor.onChunk(event.delta.text);
        onTextDelta?.(event.delta.text);
      }
      if (event.type === "content_block_delta" && event.delta.type === "thinking_delta") {
        hasThinkingBlocks = true;
      }
      if (event.type === "message_start") {
        inputTokens = event.message.usage?.input_tokens ?? 0;
      }
      if (event.type === "message_delta") {
        outputTokens = ((event as unknown as { usage?: { output_tokens?: number } }).usage?.output_tokens) ?? 0;
        stopReason = ((event as unknown as { delta?: { stop_reason?: string } }).delta?.stop_reason) ?? null;
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
  if (!content) {
    const diag = [
      `stop_reason=${stopReason ?? "unknown"}`,
      `usage=${inputTokens}+${outputTokens}`,
      ...(hasThinkingBlocks ? ["has_thinking_blocks=true"] : []),
    ].join(", ");
    console.warn(`[inkos] Anthropic 流式响应无文本内容 (${diag})`);
    throw new Error(`LLM returned empty response from stream (${diag})`);
  }

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
  onTextDelta?: (text: string) => void,
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

  if (!content) {
    const hasThinking = response.content.some((block) => block.type === "thinking");
    const diag = [
      `stop_reason=${response.stop_reason ?? "unknown"}`,
      `usage=${response.usage?.input_tokens ?? 0}+${response.usage?.output_tokens ?? 0}`,
      ...(hasThinking ? ["has_thinking_blocks=true"] : []),
    ].join(", ");
    console.warn(`[inkos] Anthropic 同步响应无文本内容 (${diag})`);
    throw new Error(`LLM returned empty response (${diag})`);
  }
  onTextDelta?.(content);

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
