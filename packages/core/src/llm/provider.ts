import type { LLMConfig } from "../models/project.js";
import {
  streamSimple as piStreamSimple,
  stream as piStream,
  completeSimple as piCompleteSimple,
  complete as piComplete,
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
import { getEndpoint } from "./providers/index.js";
import { lookupModel } from "./providers/lookup.js";
import { fetchWithProxy } from "../utils/proxy-fetch.js";
import { isApiKeyOptionalForEndpoint } from "../utils/llm-endpoint-auth.js";
import { buildCodexOAuthHeaders, isCodexOAuthService } from "./codex-oauth.js";


// === Streaming Monitor Types ===

export interface StreamProgress {
  readonly elapsedMs: number;
  readonly totalChars: number;
  readonly chineseChars: number;
  readonly status: "streaming" | "done";
}

export type OnStreamProgress = (progress: StreamProgress) => void;

const INKOS_USER_AGENT = "InkOS/1.3.5";
const UNKNOWN_MODEL_FALLBACK_MAX_TOKENS = 8192 * 3;
const TRANSIENT_LLM_RETRIES = 2;

function isByteString(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 255) return false;
  }
  return true;
}

function isValidHeaderName(value: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value);
}

function sanitizeHttpHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers) return undefined;
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!isValidHeaderName(key)) continue;
    if (!isByteString(value)) continue;
    sanitized[key] = value;
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function mergeUserAgent(headers?: Record<string, string>): Record<string, string> {
  return { "User-Agent": INKOS_USER_AGENT, ...(sanitizeHttpHeaders(headers) ?? {}) };
}

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
  readonly service?: string;
  readonly configSource?: LLMConfig["configSource"];
  readonly apiFormat: "chat" | "responses";
  readonly stream: boolean;
  readonly proxyUrl?: string;
  readonly _piModel?: PiModel<PiApi>;
  readonly _apiKey?: string;
  readonly defaults: {
    readonly temperature: number;
    /**
     * Per-call fallback: 当 agent 调 chat() 不传 options.maxTokens 时用这个值。
     * 命中模型卡时来自 providers bank 的 modelCard.maxOutput；未知模型走写作兜底预算。
     */
    readonly maxTokens: number;
    /**
     * Legacy mock compatibility only. v2 provider resolution no longer caps
     * per-call maxTokens from project config; model max output comes from the
     * provider bank.
     */
    readonly maxTokensCap?: number | null;
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
  // C1 (v2.0.0)：config.maxTokens / maxTokensCap 已删除；defaults.maxTokens 完全从 modelCard 推导。
  const _earlyCard = lookupModel(config.service ?? "custom", config.model);
  const defaults = {
    temperature: config.temperature ?? 0.7,
    maxTokens: _earlyCard?.maxOutput ?? UNKNOWN_MODEL_FALLBACK_MAX_TOKENS,
    thinkingBudget: config.thinkingBudget ?? 0,
    extra: config.extra ?? {},
  };

  const apiFormat = config.apiFormat ?? "chat";
  const stream = config.stream ?? true;

  // --- Build pi-ai Model object ---
  const serviceName = config.service ?? "custom";
  const preset = resolveServicePreset(serviceName);
  const inkosProvider = getEndpoint(serviceName);
  const modelCard = lookupModel(serviceName, config.model);

  const piApi = resolvePiApi(serviceName, config.apiFormat, (inkosProvider?.api ?? preset?.api) as PiApi) as PiApi;
  const baseUrl = config.baseUrl || inkosProvider?.baseUrl || preset?.baseUrl || "";
  const extraHeaders = sanitizeHttpHeaders(config.headers ?? parseEnvHeaders());
  const compat = piApi === "openai-completions"
    ? resolveProviderCompat(inkosProvider, baseUrl)
    : undefined;

  const provider = config.provider === "anthropic" ? "anthropic" : "openai";
  // pi-ai provider 字段：大多数情况 pi-ai 会按 baseUrl 自动嗅探（openrouter.ai / api.z.ai /
  // api.x.ai / deepseek.com / anthropic.com 等）。这里只列 pi-ai 嗅探不到、需要显式指定的少数情况。
  let piProvider: string;
  if (inkosProvider?.id === "google") piProvider = "google";
  else if (inkosProvider?.id === "zhipu") piProvider = "zai";
  else if (inkosProvider?.id === "openrouter") piProvider = "openrouter";
  else if (inkosProvider?.id === "githubCopilot") piProvider = "githubCopilot";
  else if (isCodexOAuthService(inkosProvider?.id ?? serviceName)) piProvider = "openai-codex";
  else if (inkosProvider?.id === "ollama") piProvider = "ollama";
  else if (inkosProvider?.api === "anthropic-messages") piProvider = "anthropic";
  else piProvider = provider;

  const piModel: PiModel<PiApi> = {
    id: modelCard?.deploymentName ?? config.model,
    name: config.model,
    api: piApi,
    provider: piProvider,
    baseUrl,
    // 注意：piModel.reasoning 是"激活 reasoning 模式"标志（会让 pi-ai 把 system 改成 developer role 等），
    // 不是"模型能力"标签。只有用户显式配了 thinkingBudget > 0 才启用 reasoning mode。
    // 千万不要从 lobe abilities.reasoning 自动推导，否则 Moonshot 这类不支持 developer role 的服务
    // 会把 content 吃掉，只返回 reasoning_content（见 R4 bug 1 诊断）。
    reasoning: (config.thinkingBudget ?? 0) > 0,
    input: ["text"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: modelCard?.contextWindowTokens ?? 128_000,
    maxTokens: modelCard?.maxOutput ?? UNKNOWN_MODEL_FALLBACK_MAX_TOKENS,
    ...(extraHeaders ? { headers: extraHeaders } : {}),
    ...(compat ? { compat } : {}),
  };

  return {
    provider,
    service: serviceName,
    configSource: config.configSource,
    apiFormat,
    stream,
    proxyUrl: config.proxyUrl,
    _piModel: piModel,
    _apiKey: config.apiKey,
    defaults,
  };
}

function resolvePiApi(
  serviceName: string,
  apiFormat: LLMConfig["apiFormat"] | undefined,
  presetApi: PiApi | undefined,
): PiApi {
  if (serviceName === "custom") {
    return apiFormat === "responses" ? "openai-responses" : "openai-completions";
  }
  return (presetApi ?? "openai-completions") as PiApi;
}

function resolveProviderCompat(
  provider: ReturnType<typeof getEndpoint>,
  baseUrl: string,
): Record<string, unknown> | undefined {
  const compat = {
    ...(provider?.compat ?? {}),
    ...(baseUrl.includes("generativelanguage.googleapis.com") ? { supportsStore: false } : {}),
  };
  return Object.keys(compat).length > 0 ? compat : undefined;
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
// 部分 thinking 模型（如 Moonshot kimi-k2.5/k2.6、kimi-k2-thinking）的 API
// 硬要求 temperature === 1，其他值会被直接 400 拒绝（Moonshot 返回
// `invalid temperature: only 1 is allowed for this model`）。
//
// inkos 让 writer/validator/architect 各自带 per-call 温度（0.1~1.5），
// 所以 provider 层统一夹制：如果 bank 里模型卡标了 temperature 字段，
// 就把 per-call 温度 clamp 到那个值，并对每个模型名打一次 warning。
//
// 这个字段只表达"服务端硬约束"，普通模型不要标，避免误伤 per-call 调参。

const warnedFixedTemperatureModels = new Set<string>();

function clampTemperatureForModel(
  service: string | undefined,
  model: string,
  requested: number,
): number {
  const card = service ? lookupModel(service, model) : undefined;
  if (card?.temperature === undefined) return requested;
  const locked = card.temperature;
  if (requested === locked) return locked;
  if (!warnedFixedTemperatureModels.has(model)) {
    warnedFixedTemperatureModels.add(model);
    console.warn(
      `[inkos] 模型 "${model}" API 要求 temperature=${locked}，已 clamp（原值 ${requested}）`,
    );
  }
  return locked;
}

// 仅测试用：清空 warning 去重集合。
export function __resetFixedTemperatureWarnings(): void {
  warnedFixedTemperatureModels.clear();
}

// === Error Wrapping ===

function wrapLLMError(error: unknown, context?: { readonly baseUrl?: string; readonly model?: string; readonly service?: string }): Error {
  const msg = String(error);
  const ctxLine = context
    ? `\n  (baseUrl: ${context.baseUrl}, model: ${context.model})`
    : "";

  if (msg.includes("400")) {
    // 抽上游 error body 的 message / reason / code（和下方 5xx 一致），让真实错因浮到用户面前
    let detail = "";
    if (error && typeof error === "object") {
      const err = error as { error?: unknown; body?: unknown; message?: string };
      const bodyLike = err.error ?? err.body;
      if (bodyLike && typeof bodyLike === "object") {
        const b = bodyLike as { reason?: string; message?: string; code?: number | string; type?: string };
        if (b.message) detail = b.type ? `${b.type}: ${b.message}` : b.message;
        else if (b.reason) detail = b.reason;
      }
    }
    return new Error(
      `API 返回 400（请求参数错误）。${detail ? `上游详情：${detail}。\n` : ""}` +
      `常见原因：\n` +
      `  1. temperature / max_tokens 超出模型约束（如 Moonshot kimi-k2.X 强制 temperature=1）\n` +
      `  2. 模型名称不正确或未上架\n` +
      `  3. 消息格式不兼容（部分服务不支持 system role 或 developer role）${ctxLine}`,
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
  if (
    msg.includes("Connection error")
    || msg.includes("ECONNREFUSED")
    || msg.includes("ENOTFOUND")
    || msg.includes("fetch failed")
    || msg.includes("terminated")
    || msg.includes("UND_ERR_SOCKET")
    || msg.includes("ECONNRESET")
    || msg.includes("ETIMEDOUT")
    || msg.includes("EPIPE")
  ) {
    return new Error(
      `无法连接到 API 服务。可能原因：\n` +
      `  1. baseUrl 地址不正确（当前：${context?.baseUrl ?? "未知"}）\n` +
      `  2. 网络不通或被防火墙拦截\n` +
      `  3. API 服务暂时不可用\n` +
      `  建议：检查 INKOS_LLM_BASE_URL 是否包含完整路径（如 /v1）`,
    );
  }
  // R4 Bug 2: 5xx "status code (no body)" — 尝试从 OpenAI SDK APIError 里抽 body 给用户看具体原因
  // （如 PPIO 的 {"code":500,"reason":"MODEL_NOT_AVAILABLE","message":"model not available"}）
  if (msg.includes("status code") && msg.includes("no body")) {
    let detail = "";
    if (error && typeof error === "object") {
      const err = error as { error?: unknown; body?: unknown; message?: string };
      const bodyLike = err.error ?? err.body;
      if (bodyLike && typeof bodyLike === "object") {
        const b = bodyLike as { reason?: string; message?: string; code?: number | string };
        if (b.reason) detail = `${b.reason}${b.message ? `: ${b.message}` : ""}`;
        else if (b.message) detail = b.message;
      }
    }
    return new Error(
      `API 返回 5xx（上游服务异常）。${detail ? `上游详情：${detail}。` : ""}\n` +
      `可能原因：\n` +
      `  1. 模型在 /models 列表但 inference 未上架（如 PPIO 返回 MODEL_NOT_AVAILABLE）\n` +
      `  2. 服务端临时故障，稍后重试\n` +
      `  3. 当前 apikey 无权限调用该模型${ctxLine}`,
    );
  }
  return error instanceof Error ? error : new Error(msg);
}

function collectErrorText(error: unknown, depth = 0): string {
  if (depth > 4 || error === null || error === undefined) return "";
  const parts = [String(error)];
  if (error instanceof Error) {
    parts.push(error.name, error.message);
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause) parts.push(collectErrorText(cause, depth + 1));
  } else if (typeof error === "object") {
    const err = error as { code?: unknown; cause?: unknown; message?: unknown; name?: unknown };
    if (err.name) parts.push(String(err.name));
    if (err.message) parts.push(String(err.message));
    if (err.code) parts.push(String(err.code));
    if (err.cause) parts.push(collectErrorText(err.cause, depth + 1));
  }
  return parts.join("\n");
}

function isTransientLLMTransportError(error: unknown): boolean {
  const text = collectErrorText(error);
  return [
    "terminated",
    "UND_ERR_SOCKET",
    "ECONNRESET",
    "ETIMEDOUT",
    "EPIPE",
    "socket hang up",
    "other side closed",
    "network socket disconnected",
  ].some((needle) => text.includes(needle));
}

async function withTransientLLMRetry<T>(
  run: () => Promise<T>,
  options?: { readonly enabled?: boolean },
): Promise<T> {
  const enabled = options?.enabled ?? true;
  let lastError: unknown;
  for (let attempt = 0; attempt <= TRANSIENT_LLM_RETRIES; attempt++) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (
        !enabled
        || attempt >= TRANSIENT_LLM_RETRIES
        || error instanceof PartialResponseError
        || !isTransientLLMTransportError(error)
      ) {
        throw error;
      }
    }
  }
  throw lastError;
}

function shouldUseNativeCustomTransport(client: LLMClient): boolean {
  if (client.service === "kkaiapi" && client.provider === "openai") {
    return true;
  }
  if (client.service === "custom") {
    if (
      client.configSource === "studio"
      && (client.provider === "openai" || client.provider === "anthropic")
    ) {
      return true;
    }
    return client.provider === "openai" && shouldUseNativeLocalOpenAICompatibleTransport(client);
  }
  return client.service === "ollama"
    && client.provider === "openai"
    && shouldUseNativeLocalOpenAICompatibleTransport(client);
}

async function withCodexOAuthRuntimeAuth(client: LLMClient): Promise<LLMClient> {
  if (!isCodexOAuthService(client.service)) return client;
  const headers = await buildCodexOAuthHeaders();
  const authorization = headers.Authorization ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  const runtimeHeaders = { ...headers };
  delete runtimeHeaders.Authorization;
  return {
    ...client,
    _apiKey: token,
    _piModel: client._piModel
      ? {
          ...client._piModel,
          headers: {
            ...(client._piModel.headers ?? {}),
            ...runtimeHeaders,
          },
        }
      : client._piModel,
  };
}

function shouldUseNativeLocalOpenAICompatibleTransport(client: LLMClient): boolean {
  return !client._apiKey
    && isApiKeyOptionalForEndpoint({
      provider: client.provider,
      baseUrl: client._piModel?.baseUrl,
    });
}

function buildCustomHeaders(client: LLMClient): Record<string, string> {
  const apiKey = sanitizeHeaderApiKey(client._apiKey);
  return sanitizeHttpHeaders({
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...(client._piModel?.headers ?? {}),
  }) ?? { "Content-Type": "application/json" };
}

function sanitizeHeaderApiKey(apiKey: string | undefined): string {
  const trimmed = apiKey?.trim() ?? "";
  if (!trimmed) return "";
  if (!/^[\x20-\x7e]+$/.test(trimmed)) {
    throw new Error("API Key contains non-ASCII characters; please remove any pasted Chinese notes or whitespace.");
  }
  return trimmed;
}

function joinSystemPrompt(messages: ReadonlyArray<LLMMessage>): string | undefined {
  const systemParts = messages
    .filter((message) => message.role === "system" && message.content.trim().length > 0)
    .map((message) => message.content.trim());
  return systemParts.length > 0 ? systemParts.join("\n\n") : undefined;
}

function buildChatMessages(messages: ReadonlyArray<LLMMessage>): Array<{ role: string; content: string }> {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function buildAnthropicMessages(messages: ReadonlyArray<LLMMessage>): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter((message): message is Readonly<LLMMessage> & { role: "user" | "assistant" } => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function buildResponsesInput(messages: ReadonlyArray<LLMMessage>): Array<{ role: string; content: Array<{ type: "input_text"; text: string }> }> {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      content: [{ type: "input_text", text: message.content }],
    }));
}

function hasSystemMessages(messages: ReadonlyArray<LLMMessage>): boolean {
  return messages.some((message) => message.role === "system" && message.content.trim().length > 0);
}

function foldSystemMessagesIntoFirstUser(messages: ReadonlyArray<LLMMessage>): LLMMessage[] {
  const system = joinSystemPrompt(messages);
  const nonSystemMessages = messages.filter((message) => message.role !== "system");
  if (!system) return [...nonSystemMessages];

  const firstUserIndex = nonSystemMessages.findIndex((message) => message.role === "user");
  const prefix = `System instructions:\n${system}\n\nUser request:\n`;
  if (firstUserIndex < 0) {
    return [{ role: "user", content: `System instructions:\n${system}` }, ...nonSystemMessages];
  }

  return nonSystemMessages.map((message, index) => index === firstUserIndex
    ? { ...message, content: `${prefix}${message.content}` }
    : message);
}

function isSystemRoleUnsupportedErrorText(text: string): boolean {
  const normalized = text.toLowerCase();
  const mentionsSystemRole = normalized.includes("system") && normalized.includes("role");
  if (!mentionsSystemRole) return false;
  return normalized.includes("unsupported")
    || normalized.includes("not support")
    || normalized.includes("does not support")
    || normalized.includes("invalid")
    || normalized.includes("不支持")
    || normalized.includes("不允许");
}

async function readErrorResponse(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string; detail?: string };
    if (typeof json.error === "string" && json.error) return `${res.status} ${json.error}`;
    if (json.error && typeof json.error === "object" && typeof json.error.message === "string") {
      return `${res.status} ${json.error.message}`;
    }
    if (typeof json.detail === "string" && json.detail) return `${res.status} ${json.detail}`;
  } catch {
    // fall through
  }
  return `${res.status} ${text || res.statusText}`.trim();
}

type ParsedSseEvent = {
  readonly event?: string;
  readonly data?: string;
};

function parseSseEvents(buffer: string): { readonly events: ParsedSseEvent[]; readonly rest: string } {
  const chunks = buffer.split(/\n\n/);
  const rest = chunks.pop() ?? "";
  const events: ParsedSseEvent[] = [];

  for (const chunk of chunks) {
    const lines = chunk.split(/\r?\n/);
    let eventName: string | undefined;
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }
    if (eventName || dataLines.length > 0) {
      events.push({
        ...(eventName ? { event: eventName } : {}),
        ...(dataLines.length > 0 ? { data: dataLines.join("\n") } : {}),
      });
    }
  }

  return { events, rest };
}

function extractOpenAITextPart(value: any): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => typeof item?.text === "string" ? item.text : typeof item?.content === "string" ? item.content : "")
      .join("");
  }
  return "";
}

function extractChatContent(json: any): string {
  const message = json?.choices?.[0]?.message;
  return extractOpenAITextPart(message?.content) || extractOpenAITextPart(message?.reasoning_content);
}

function extractChatDeltaContent(json: any): string {
  return extractOpenAITextPart(json?.choices?.[0]?.delta?.content);
}

function extractChatDeltaReasoningContent(json: any): string {
  return extractOpenAITextPart(json?.choices?.[0]?.delta?.reasoning_content);
}

function extractResponsesContent(json: any): string {
  const output = Array.isArray(json?.output) ? json.output : [];
  return output
    .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .map((part: any) => {
      if (typeof part?.text === "string") return part.text;
      if (typeof part?.content === "string") return part.content;
      if (typeof part?.output_text === "string") return part.output_text;
      return "";
    })
    .join("");
}

function extractAnthropicContent(json: any): string {
  const content = Array.isArray(json?.content) ? json.content : [];
  return content
    .map((part: any) => typeof part?.text === "string" ? part.text : "")
    .join("");
}

async function chatCompletionViaCustomAnthropicCompatible(
  client: LLMClient,
  model: string,
  messages: ReadonlyArray<LLMMessage>,
  resolved: { readonly temperature: number; readonly maxTokens: number; readonly extra: Record<string, unknown> },
  onStreamProgress?: OnStreamProgress,
  onTextDelta?: (text: string) => void,
): Promise<LLMResponse> {
  const baseUrl = client._piModel?.baseUrl ?? "";
  const errorCtx = { baseUrl, model, service: client.service };
  const extra = stripReservedKeys(resolved.extra);
  const payload: Record<string, unknown> = {
    model,
    messages: buildAnthropicMessages(messages),
    stream: client.stream,
    max_tokens: resolved.maxTokens,
    temperature: resolved.temperature,
    ...extra,
  };
  const system = joinSystemPrompt(messages);
  if (system) payload.system = system;

  const apiKey = sanitizeHeaderApiKey(client._apiKey);
  const response = await fetchWithProxy(`${baseUrl.replace(/\/$/, "")}/messages`, {
    method: "POST",
    headers: sanitizeHttpHeaders({
      "User-Agent": INKOS_USER_AGENT,
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(client._piModel?.headers ?? {}),
    }) ?? { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, client.proxyUrl);

  if (!response.ok) {
    throw wrapLLMError(new Error(await readErrorResponse(response)), errorCtx);
  }

  if (!client.stream) {
    const json = await response.json() as any;
    const content = extractAnthropicContent(json);
    if (!content) {
      throw wrapLLMError(new Error("LLM returned empty response"), errorCtx);
    }
    return {
      content,
      usage: {
        promptTokens: json?.usage?.input_tokens ?? 0,
        completionTokens: json?.usage?.output_tokens ?? 0,
        totalTokens: (json?.usage?.input_tokens ?? 0) + (json?.usage?.output_tokens ?? 0),
      },
    };
  }

  const reader = response.body?.getReader();
  if (!reader) throw wrapLLMError(new Error("Streaming body unavailable"), errorCtx);
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const monitor = createStreamMonitor(onStreamProgress);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseEvents(buffer);
      buffer = parsed.rest;
      for (const event of parsed.events) {
        if (!event.data) continue;
        const json = JSON.parse(event.data);
        if (json.type === "message_start" && json.message?.usage) {
          usage.promptTokens = json.message.usage.input_tokens ?? usage.promptTokens;
        }
        if (json.type === "content_block_delta" && json.delta?.type === "text_delta" && typeof json.delta.text === "string") {
          content += json.delta.text;
          monitor.onChunk(json.delta.text);
          onTextDelta?.(json.delta.text);
        }
        if (json.type === "message_delta" && json.usage) {
          usage.completionTokens = json.usage.output_tokens ?? usage.completionTokens;
        }
        if (json.type === "message_stop") {
          usage.totalTokens = usage.promptTokens + usage.completionTokens;
        }
      }
    }
  } finally {
    monitor.stop();
  }

  if (!content) {
    throw wrapLLMError(new Error("LLM returned empty response from stream"), errorCtx);
  }
  if (!usage.totalTokens) {
    usage.totalTokens = usage.promptTokens + usage.completionTokens;
  }
  return { content, usage };
}

async function chatCompletionViaCustomOpenAICompatible(
  client: LLMClient,
  model: string,
  messages: ReadonlyArray<LLMMessage>,
  resolved: { readonly temperature: number; readonly maxTokens: number; readonly extra: Record<string, unknown> },
  onStreamProgress?: OnStreamProgress,
  onTextDelta?: (text: string) => void,
  allowSystemRoleFallback = true,
): Promise<LLMResponse> {
  if (client.provider === "anthropic") {
    return chatCompletionViaCustomAnthropicCompatible(client, model, messages, resolved, onStreamProgress, onTextDelta);
  }
  const baseUrl = client._piModel?.baseUrl ?? "";
  const headers = buildCustomHeaders(client);
  const errorCtx = { baseUrl, model, service: client.service };
  const extra = stripReservedKeys(resolved.extra);

  if (client.apiFormat === "responses") {
    const payload: Record<string, unknown> = {
      model,
      input: buildResponsesInput(messages),
      stream: client.stream,
      store: false,
      max_output_tokens: resolved.maxTokens,
      temperature: resolved.temperature,
      ...extra,
    };
    const instructions = joinSystemPrompt(messages);
    if (instructions) payload.instructions = instructions;

    const response = await fetchWithProxy(`${baseUrl.replace(/\/$/, "")}/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    }, client.proxyUrl);
    if (!response.ok) {
      throw wrapLLMError(new Error(await readErrorResponse(response)), errorCtx);
    }

    if (!client.stream) {
      const json = await response.json() as any;
      const content = extractResponsesContent(json);
      if (!content) {
        throw wrapLLMError(new Error("LLM returned empty response"), errorCtx);
      }
      return {
        content,
        usage: {
          promptTokens: json?.usage?.input_tokens ?? 0,
          completionTokens: json?.usage?.output_tokens ?? 0,
          totalTokens: json?.usage?.total_tokens ?? 0,
        },
      };
    }

    const reader = response.body?.getReader();
    if (!reader) throw wrapLLMError(new Error("Streaming body unavailable"), errorCtx);
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const monitor = createStreamMonitor(onStreamProgress);

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseEvents(buffer);
        buffer = parsed.rest;
        for (const event of parsed.events) {
          if (!event.data) continue;
          const json = JSON.parse(event.data);
          if (json.type === "response.output_text.delta" && typeof json.delta === "string") {
            content += json.delta;
            monitor.onChunk(json.delta);
            onTextDelta?.(json.delta);
          }
          if (json.type === "response.completed") {
            usage = {
              promptTokens: json.response?.usage?.input_tokens ?? 0,
              completionTokens: json.response?.usage?.output_tokens ?? 0,
              totalTokens: json.response?.usage?.total_tokens ?? 0,
            };
            if (!content) {
              content = extractResponsesContent(json.response);
            }
          }
        }
      }
    } finally {
      monitor.stop();
    }

    if (!content) {
      throw wrapLLMError(new Error("LLM returned empty response from stream"), errorCtx);
    }
    return { content, usage };
  }

  const payload: Record<string, unknown> = {
    model,
    messages: [
      ...messages
        .filter((message) => message.role === "system")
        .map((message) => ({ role: "system", content: message.content })),
      ...buildChatMessages(messages),
    ],
    stream: client.stream,
    temperature: resolved.temperature,
    max_tokens: resolved.maxTokens,
    ...extra,
  };
  if (client.stream) {
    payload.stream_options = { include_usage: true };
  }

  const response = await fetchWithProxy(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  }, client.proxyUrl);
  if (!response.ok) {
    const detail = await readErrorResponse(response);
    if (allowSystemRoleFallback && hasSystemMessages(messages) && isSystemRoleUnsupportedErrorText(detail)) {
      return chatCompletionViaCustomOpenAICompatible(
        client,
        model,
        foldSystemMessagesIntoFirstUser(messages),
        resolved,
        onStreamProgress,
        onTextDelta,
        false,
      );
    }
    throw wrapLLMError(new Error(detail), errorCtx);
  }

  if (!client.stream) {
    const json = await response.json() as any;
    const content = extractChatContent(json);
    if (!content) {
      throw wrapLLMError(new Error("LLM returned empty response"), errorCtx);
    }
    return {
      content,
      usage: {
        promptTokens: json?.usage?.prompt_tokens ?? 0,
        completionTokens: json?.usage?.completion_tokens ?? 0,
        totalTokens: json?.usage?.total_tokens ?? 0,
      },
    };
  }

  const reader = response.body?.getReader();
  if (!reader) throw wrapLLMError(new Error("Streaming body unavailable"), errorCtx);
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoningContent = "";
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const monitor = createStreamMonitor(onStreamProgress);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseEvents(buffer);
      buffer = parsed.rest;
      for (const event of parsed.events) {
        if (!event.data || event.data === "[DONE]") continue;
        const json = JSON.parse(event.data);
        const delta = extractChatDeltaContent(json);
        if (delta) {
          content += delta;
          monitor.onChunk(delta);
          onTextDelta?.(delta);
        } else {
          const reasoningDelta = extractChatDeltaReasoningContent(json);
          if (reasoningDelta) {
            reasoningContent += reasoningDelta;
            monitor.onChunk(reasoningDelta);
          }
        }
        if (json?.usage) {
          usage = {
            promptTokens: json.usage.prompt_tokens ?? usage.promptTokens,
            completionTokens: json.usage.completion_tokens ?? usage.completionTokens,
            totalTokens: json.usage.total_tokens ?? usage.totalTokens,
          };
        }
      }
    }
  } finally {
    monitor.stop();
  }

  const finalContent = content || reasoningContent;
  if (!finalContent) {
    throw wrapLLMError(new Error("LLM returned empty response from stream"), errorCtx);
  }
  return { content: finalContent, usage };
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
  // C1 (v2.0.0)：删除 maxTokensCap 机制。per-call 显式传的 maxTokens 永远不被裁剪。
  const resolved = {
    temperature: clampTemperatureForModel(
      client.service,
      model,
      options?.temperature ?? client.defaults.temperature,
    ),
    maxTokens: options?.maxTokens ?? client.defaults.maxTokens,
    extra: client.defaults.extra,
  };
  const onStreamProgress = options?.onStreamProgress;
  const onTextDelta = options?.onTextDelta;
  const errorCtx = { baseUrl: client._piModel?.baseUrl ?? "(unknown)", model, service: client.service };

  try {
    return await withTransientLLMRetry(
      async () => {
        const runtimeClient = await withCodexOAuthRuntimeAuth(client);
        if (shouldUseNativeCustomTransport(runtimeClient)) {
          return chatCompletionViaCustomOpenAICompatible(runtimeClient, model, messages, resolved, onStreamProgress, onTextDelta);
        }
        return chatCompletionViaPiAi(runtimeClient, model, messages, resolved, onStreamProgress, onTextDelta);
      },
      // Retrying after UI text deltas have been emitted can duplicate visible text.
      { enabled: !onTextDelta },
    );
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
  const errorCtx = { baseUrl: client._piModel?.baseUrl ?? "(unknown)", model, service: client.service };
  try {
    const resolved = {
      temperature: clampTemperatureForModel(
        client.service,
        model,
        options?.temperature ?? client.defaults.temperature,
      ),
      maxTokens: options?.maxTokens ?? client.defaults.maxTokens,
    };
    const runtimeClient = await withCodexOAuthRuntimeAuth(client);
    return await chatWithToolsViaPiAi(runtimeClient, model, messages, tools, resolved);
  } catch (error) {
    throw wrapLLMError(error, errorCtx);
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

function ensureCodexInstructions(piModel: PiModel<PiApi>, context: PiContext): PiContext {
  if (piModel.api !== "openai-codex-responses" || context.systemPrompt?.trim()) {
    return context;
  }
  return { ...context, systemPrompt: "You are a helpful assistant." };
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
  const context = ensureCodexInstructions(piModel, toPiContext(messages));
  const streamOpts = buildPiStreamOptions(piModel, client, {
    temperature: resolved.temperature,
    maxTokens: resolved.maxTokens,
  });

  if (!client.stream) {
    const response = await piCompleteSimple(piModel, context, streamOpts);
    if (response.stopReason === "error" && response.errorMessage) {
      throw new Error(response.errorMessage);
    }
    const content = response.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("");
    if (!content) {
      const diag = `usage=${response.usage.input}+${response.usage.output}`;
      console.warn(`[inkos] LLM 非流式响应无文本内容 (${diag})`);
      throw new Error(`LLM returned empty response (${diag})`);
    }
    return {
      content,
      usage: {
        promptTokens: response.usage.input,
        completionTokens: response.usage.output,
        totalTokens: response.usage.totalTokens,
      },
    };
  }

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
  const context = ensureCodexInstructions(piModel, agentMessagesToPiContext(messages));
  context.tools = toPiTools(tools);
  const streamOpts = buildPiStreamOptions(piModel, client, {
    temperature: resolved.temperature,
    maxTokens: resolved.maxTokens,
  });

  if (!client.stream) {
    const response = await piComplete(piModel, context, streamOpts);
    if (response.stopReason === "error" && response.errorMessage) {
      throw new Error(response.errorMessage);
    }
    const content = response.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("");
    const toolCalls = response.content
      .filter((block): block is PiToolCall => block.type === "toolCall")
      .map((block) => ({
        id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.arguments),
      }));
    return { content, toolCalls };
  }

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

function buildPiStreamOptions(
  piModel: PiModel<PiApi>,
  client: LLMClient,
  resolved: { readonly temperature: number; readonly maxTokens: number },
): {
  readonly temperature?: number;
  readonly maxTokens: number;
  readonly apiKey?: string;
  readonly headers: Record<string, string>;
} {
  const supportsTemperature = piModel.api !== "openai-codex-responses";
  return {
    ...(supportsTemperature ? { temperature: resolved.temperature } : {}),
    maxTokens: resolved.maxTokens,
    apiKey: client._apiKey,
    headers: mergeUserAgent(piModel.headers),
  };
}
