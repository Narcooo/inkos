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

  const provider = config.provider === "anthropic" ? "anthropic" : "openai";
  return {
    provider,
    apiFormat,
    stream,
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
  const errorCtx = { baseUrl: client._piModel?.baseUrl ?? "(unknown)", model };

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
