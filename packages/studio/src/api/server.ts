import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import {
  StateManager,
  PipelineRunner,
  createLLMClient,
  createLogger,
  createInteractionToolsFromDeps,
  computeAnalytics,
  loadProjectConfig,
  loadProjectSession,
  processProjectInteractionRequest,
  resolveSessionActiveBook,
  listBookSessions,
  loadBookSession,
  appendManualSessionMessages,
  createAndPersistBookSession,
  renameBookSession,
  deleteBookSession,
  migrateBookSession,
  SessionAlreadyMigratedError,
  runAgentSession,
  buildAgentSystemPrompt,
  resolveServicePreset,
  resolveServiceProviderFamily,
  resolveServiceModelsBaseUrl,
  resolveServiceModel,
  loadSecrets,
  saveSecrets,
  listModelsForService,
  isApiKeyOptionalForEndpoint,
  getAllEndpoints,
  probeModelsFromUpstream,
  fetchWithProxy,
  chatCompletion,
  buildExportArtifact,
  GLOBAL_ENV_PATH,
  type ResolvedModel,
  type PipelineConfig,
  type ProjectConfig,
  type LogSink,
  type LogEntry,
} from "@actalk/inkos-core";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { isSafeBookId } from "./safety.js";
import { ApiError } from "./errors.js";
import { buildStudioBookConfig } from "./book-create.js";

// -- Pipeline stage definitions per agent type --

const PIPELINE_STAGES: Record<string, string[]> = {
  writer: [
    "准备章节输入", "撰写章节草稿", "落盘最终章节",
    "生成最终真相文件", "校验真相文件变更", "同步记忆索引",
    "更新章节索引与快照",
  ],
  architect: [
    "生成基础设定", "保存书籍配置", "写入基础设定文件",
    "初始化控制文档", "创建初始快照",
  ],
  reviser: [
    "加载修订上下文", "修订章节", "落盘修订结果",
    "更新索引与快照",
  ],
  auditor: ["审计章节"],
};

const AGENT_LABELS: Record<string, string> = {
  architect: "建书", writer: "写作", auditor: "审计",
  reviser: "修订", exporter: "导出",
};
const TOOL_LABELS: Record<string, string> = {
  read: "读取文件", edit: "编辑文件", grep: "搜索", ls: "列目录",
};

function resolveToolLabel(tool: string, agent?: string): string {
  if (tool === "sub_agent" && agent) return AGENT_LABELS[agent] ?? agent;
  return TOOL_LABELS[tool] ?? tool;
}

function summarizeResult(result: unknown): string {
  if (typeof result === "string") return result.slice(0, 200);
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.content === "string") return r.content.slice(0, 200);
    if (typeof r.text === "string") return r.text.slice(0, 200);
  }
  return String(result).slice(0, 200);
}

const NON_TEXT_MODEL_ID_PARTS = [
  "image",
  "embedding",
  "embed",
  "rerank",
  "tts",
  "speech",
  "audio",
  "moderation",
] as const;

function isTextChatModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) return false;
  return !NON_TEXT_MODEL_ID_PARTS.some((part) => normalized.includes(part));
}

function filterTextChatModels<T extends { readonly id: string }>(models: ReadonlyArray<T>): T[] {
  return models.filter((model) => isTextChatModelId(model.id));
}

function normalizeApiBookId(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_BOOK_ID", `${fieldName} must be a string`);
  }
  const bookId = value.trim();
  if (!bookId) {
    throw new ApiError(400, "INVALID_BOOK_ID", `${fieldName} cannot be blank`);
  }
  if (!isSafeBookId(bookId)) {
    throw new ApiError(400, "INVALID_BOOK_ID", `Invalid ${fieldName}: "${bookId}"`);
  }
  return bookId;
}

function nonTextModelMessage(modelId: string): string {
  return `模型 ${modelId} 不适合文本聊天/写作。请在模型选择器中改用文本模型，例如 gemini-2.5-flash、gemini-2.5-pro 或对应服务的 chat 模型。`;
}

function extractToolError(result: unknown): string {
  if (typeof result === "string") return result.slice(0, 500);
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.content === "string") return r.content.slice(0, 500);
    if (r.content && Array.isArray(r.content)) {
      const textPart = r.content.find((c: any) => c.type === "text");
      if (textPart) return (textPart as any).text?.slice(0, 500) ?? "";
    }
  }
  return String(result).slice(0, 500);
}

function isLikelyFailedToolResult(exec: CollectedToolExec): boolean {
  if (exec.status === "error") return true;
  const text = `${exec.error ?? ""}\n${exec.result ?? ""}`.toLowerCase();
  return /\bfailed\b|\berror\b|失败|异常|出错/.test(text);
}

function hasSuccessfulSubAgentExec(
  execs: ReadonlyArray<CollectedToolExec>,
  agent: string,
): boolean {
  return execs.some((exec) =>
    exec.tool === "sub_agent"
    && exec.agent === agent
    && exec.status === "completed"
    && !isLikelyFailedToolResult(exec)
  );
}

function isWriteNextInstruction(instruction: string): boolean {
  const trimmed = instruction.trim();
  return /^(continue|继续|继续写|写下一章|write next|下一章|再来一章)$/i.test(trimmed)
    || /(继续写|写下一章|下一章|再来一章|write\s+next)/i.test(trimmed);
}

function looksLikeBookCreatedClaim(responseText: string): boolean {
  return /(?:已|已经|成功).{0,12}(?:创建|建书|初始化|保存).{0,12}(?:作品|书|书籍|文件夹)?/.test(responseText)
    || /\b(?:created|initiali[sz]ed|saved)\b.{0,40}\b(?:book|project|novel)\b/i.test(responseText);
}

function validateAgentActionExecution(args: {
  readonly instruction: string;
  readonly agentBookId: string | null | undefined;
  readonly responseText: string;
  readonly collectedToolExecs: ReadonlyArray<CollectedToolExec>;
}): string | undefined {
  const failedExec = args.collectedToolExecs.find(isLikelyFailedToolResult);
  if (failedExec) {
    return `${failedExec.label} 执行失败：${failedExec.error ?? failedExec.result ?? "未知错误"}`;
  }

  if (
    args.agentBookId
    && isWriteNextInstruction(args.instruction)
    && !hasSuccessfulSubAgentExec(args.collectedToolExecs, "writer")
  ) {
    return "模型声称已完成下一章，但没有实际调用写作工具。请重试；如果仍失败，请检查模型是否支持工具调用。";
  }

  if (
    !args.agentBookId
    && looksLikeBookCreatedClaim(args.responseText)
    && !resolveCreatedBookIdFromToolExecs(args.collectedToolExecs)
  ) {
    return "模型声称已创建作品，但没有实际调用建书工具，也没有生成作品文件。请补充书名/题材后重试，或换用支持工具调用的模型。";
  }

  return undefined;
}

interface CollectedToolExec {
  id: string;
  tool: string;
  agent?: string;
  label: string;
  status: "running" | "completed" | "error";
  args?: Record<string, unknown>;
  result?: string;
  details?: unknown;
  error?: string;
  stages?: Array<{ label: string; status: "pending" | "completed" }>;
  startedAt: number;
  completedAt?: number;
}

interface StudioBookListSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly chaptersWritten: number;
  readonly [key: string]: unknown;
}

// --- Event bus for SSE ---

type EventHandler = (event: string, data: unknown) => void;
const subscribers = new Set<EventHandler>();
const bookCreateStatus = new Map<string, { status: "creating" | "error"; error?: string }>();

// 内存缓存：service -> 模型列表 + 更新时间戳；避免每次 sidebar 挂载时都打真实 LLM /models
const modelListCache = new Map<string, { models: Array<{ id: string; name: string }>; at: number }>();
const SERVICE_CONNECTION_PROBE_MAX_TOKENS = 4;

interface ServiceConfigEntry {
  service: string;
  name?: string;
  baseUrl?: string;
  temperature?: number;
  apiFormat?: "chat" | "responses";
  stream?: boolean;
}

type LLMConfigSource = "env" | "studio";

interface EnvConfigSummary {
  detected: boolean;
  provider: string | null;
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
}

interface EnvConfigStatus {
  project: EnvConfigSummary;
  global: EnvConfigSummary;
  effectiveSource: "project" | "global" | null;
  runtimeUsesEnv: false;
}

interface ServiceProbeResult {
  ok: boolean;
  models: Array<{ id: string; name: string }>;
  selectedModel?: string;
  apiFormat?: "chat" | "responses";
  stream?: boolean;
  baseUrl?: string;
  modelsSource?: "api" | "fallback";
  error?: string;
}

function broadcast(event: string, data: unknown): void {
  for (const handler of subscribers) {
    handler(event, data);
  }
}

function deriveBookIdFromTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\uac00-\ud7af]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

function resolveArchitectBookIdFromArgs(args?: Record<string, unknown>): string | null {
  if (!args || args.agent !== "architect" || args.revise === true) return null;
  if (typeof args.bookId === "string" && args.bookId.trim()) return args.bookId.trim();
  if (typeof args.title === "string" && args.title.trim()) {
    return deriveBookIdFromTitle(args.title) || null;
  }
  return null;
}

function resolveCreatedBookIdFromToolExecs(execs: ReadonlyArray<CollectedToolExec>): string | null {
  for (let i = execs.length - 1; i >= 0; i -= 1) {
    const exec = execs[i];
    if (exec.tool !== "sub_agent" || exec.agent !== "architect" || exec.status !== "completed") continue;

    const details = exec.details as { kind?: unknown; bookId?: unknown } | undefined;
    if (details?.kind === "book_created" && typeof details.bookId === "string" && details.bookId.trim()) {
      return details.bookId.trim();
    }

    const fromArgs = resolveArchitectBookIdFromArgs(exec.args);
    if (fromArgs) return fromArgs;
  }
  return null;
}

async function loadStudioBookListSummary(
  state: StateManager,
  bookId: string,
): Promise<StudioBookListSummary> {
  const book = await state.loadBookConfig(bookId);
  const nextChapter = await state.getNextChapterNumber(bookId);
  return { ...book, chaptersWritten: nextChapter - 1 };
}

function isCustomServiceId(serviceId: string): boolean {
  return serviceId === "custom" || serviceId.startsWith("custom:");
}

function serviceConfigKey(entry: ServiceConfigEntry): string {
  return entry.service === "custom" ? `custom:${entry.name ?? "Custom"}` : entry.service;
}

function normalizeServiceEntry(serviceId: string, value: Record<string, unknown>): ServiceConfigEntry {
  if (serviceId.startsWith("custom:")) {
    return {
      service: "custom",
      name: decodeURIComponent(serviceId.slice("custom:".length)),
      ...(typeof value.baseUrl === "string" && value.baseUrl.length > 0 ? { baseUrl: value.baseUrl } : {}),
      ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
      ...(value.apiFormat === "chat" || value.apiFormat === "responses" ? { apiFormat: value.apiFormat } : {}),
      ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
    };
  }

  if (serviceId === "custom") {
    return {
      service: "custom",
      ...(typeof value.name === "string" && value.name.length > 0 ? { name: value.name } : {}),
      ...(typeof value.baseUrl === "string" && value.baseUrl.length > 0 ? { baseUrl: value.baseUrl } : {}),
      ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
      ...(value.apiFormat === "chat" || value.apiFormat === "responses" ? { apiFormat: value.apiFormat } : {}),
      ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
    };
  }

  return {
    service: serviceId,
    ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
    ...(value.apiFormat === "chat" || value.apiFormat === "responses" ? { apiFormat: value.apiFormat } : {}),
    ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
  };
}

function normalizeConfigSource(value: unknown): LLMConfigSource {
  return value === "studio" ? "studio" : "env";
}

function normalizeServiceConfig(raw: unknown): ServiceConfigEntry[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({
        service: typeof entry.service === "string" && entry.service.length > 0 ? entry.service : "custom",
        ...(typeof entry.name === "string" && entry.name.length > 0 ? { name: entry.name } : {}),
        ...(typeof entry.baseUrl === "string" && entry.baseUrl.length > 0 ? { baseUrl: entry.baseUrl } : {}),
        ...(typeof entry.temperature === "number" ? { temperature: entry.temperature } : {}),
        ...(entry.apiFormat === "chat" || entry.apiFormat === "responses" ? { apiFormat: entry.apiFormat } : {}),
        ...(typeof entry.stream === "boolean" ? { stream: entry.stream } : {}),
      }));
  }

  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, value]) => value && typeof value === "object")
      .map(([serviceId, value]) => normalizeServiceEntry(serviceId, value as Record<string, unknown>));
  }

  return [];
}

function mergeServiceConfig(existing: ServiceConfigEntry[], updates: ServiceConfigEntry[]): ServiceConfigEntry[] {
  const merged = new Map(existing.map((entry) => [serviceConfigKey(entry), entry]));
  for (const update of updates) {
    merged.set(serviceConfigKey(update), update);
  }
  return [...merged.values()];
}

async function loadRawConfig(root: string): Promise<Record<string, unknown>> {
  const configPath = join(root, "inkos.json");
  const raw = await readFile(configPath, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

async function saveRawConfig(root: string, config: Record<string, unknown>): Promise<void> {
  await writeFile(join(root, "inkos.json"), JSON.stringify(config, null, 2), "utf-8");
}

async function readEnvConfigSummary(path: string): Promise<EnvConfigSummary> {
  try {
    const raw = await readFile(path, "utf-8");
    const values = new Map<string, string>();

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, value] = match;
      values.set(key, value.trim());
    }

    const provider = values.get("INKOS_LLM_PROVIDER") ?? null;
    const baseUrl = values.get("INKOS_LLM_BASE_URL") ?? null;
    const model = values.get("INKOS_LLM_MODEL") ?? null;
    const apiKey = values.get("INKOS_LLM_API_KEY") ?? "";
    const detected = Boolean(provider || baseUrl || model || apiKey);

    return {
      detected,
      provider,
      baseUrl,
      model,
      hasApiKey: apiKey.length > 0,
    };
  } catch {
    return {
      detected: false,
      provider: null,
      baseUrl: null,
      model: null,
      hasApiKey: false,
    };
  }
}

async function readEnvConfigStatus(root: string): Promise<EnvConfigStatus> {
  const project = await readEnvConfigSummary(join(root, ".env"));
  const global = await readEnvConfigSummary(GLOBAL_ENV_PATH);
  return {
    project,
    global,
    effectiveSource: project.detected ? "project" : global.detected ? "global" : null,
    runtimeUsesEnv: false,
  };
}

async function resolveConfiguredServiceBaseUrl(root: string, serviceId: string, inlineBaseUrl?: string): Promise<string | undefined> {
  if (inlineBaseUrl?.trim()) return inlineBaseUrl.trim();

  if (!isCustomServiceId(serviceId)) {
    return resolveServicePreset(serviceId)?.baseUrl;
  }

  try {
    const config = await loadRawConfig(root);
    const services = normalizeServiceConfig((config.llm as Record<string, unknown> | undefined)?.services);
    const matched = services.find((entry) => serviceConfigKey(entry) === serviceId);
    return matched?.baseUrl;
  } catch {
    return undefined;
  }
}

async function resolveConfiguredServiceEntry(root: string, serviceId: string): Promise<ServiceConfigEntry | undefined> {
  try {
    const config = await loadRawConfig(root);
    const services = normalizeServiceConfig((config.llm as Record<string, unknown> | undefined)?.services);
    return services.find((entry) => serviceConfigKey(entry) === serviceId);
  } catch {
    return undefined;
  }
}

function buildProbePlans(
  preferredApiFormat: "chat" | "responses" | undefined,
  preferredStream: boolean | undefined,
): Array<{ apiFormat: "chat" | "responses"; stream: boolean }> {
  const candidates: Array<{ apiFormat: "chat" | "responses"; stream: boolean }> = [];
  const seen = new Set<string>();
  const push = (apiFormat: "chat" | "responses", stream: boolean) => {
    const key = `${apiFormat}:${stream ? "1" : "0"}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ apiFormat, stream });
  };

  if (preferredApiFormat) {
    push(preferredApiFormat, preferredStream ?? false);
    push(preferredApiFormat, !(preferredStream ?? false));
  }
  const alternate = preferredApiFormat === "responses" ? "chat" : "responses";
  push(alternate, false);
  push(alternate, true);
  push("chat", false);
  push("chat", true);
  push("responses", false);
  push("responses", true);
  return candidates;
}

function buildModelCandidates(args: {
  preferredModel?: string;
  configModel?: string;
  envModel?: string | null;
  discoveredModels: Array<{ id: string; name: string }>;
  includeGenericFallbacks?: boolean;
  onlyPreferredModel?: boolean;
}): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  const push = (value: string | null | undefined) => {
    if (!value || value.trim().length === 0) return;
    const id = value.trim();
    if (seen.has(id)) return;
    seen.add(id);
    candidates.push(id);
  };

  push(args.preferredModel);
  if (args.onlyPreferredModel) return candidates;
  push(args.configModel);
  push(args.envModel ?? undefined);
  for (const model of args.discoveredModels) push(model.id);
  if (args.includeGenericFallbacks === false) return candidates;
  push("gpt-5.4");
  push("gpt-4o");
  push("claude-sonnet-4-6");
  push("MiniMax-M2.7");
  push("kimi-k2.5");
  return candidates;
}

function formatServiceProbeError(args: {
  readonly service: string;
  readonly label?: string;
  readonly baseUrl: string;
  readonly model?: string;
  readonly apiFormat?: "chat" | "responses";
  readonly stream?: boolean;
  readonly error: string;
}): string {
  const rawDetail = args.error
    .replace(/\n\s*\(baseUrl:[\s\S]*?\)$/m, "")
    .trim();
  const upstreamDetail = rawDetail.includes("上游详情：")
    ? rawDetail
    : "";
  const context = [
    `服务商：${args.label ?? args.service}`,
    `测试模型：${args.model ?? "未确定"}`,
    `协议：${args.apiFormat === "responses" ? "Responses" : "Chat / Completions"}${typeof args.stream === "boolean" ? `，${args.stream ? "流式" : "非流式"}` : ""}`,
    `Base URL：${args.baseUrl}`,
  ].join("\n");

  if (args.service === "google") {
    return [
      "Google Gemini 测试连接失败。",
      context,
      "",
      "请优先检查：",
      "1. API Key 是否来自 Google AI Studio 的 Gemini API key，而不是 OAuth、Vertex AI 或其它 Google 服务凭据。",
      "2. 该 key 所属项目是否已启用 Gemini API，并且没有被限制到其它 API、来源或服务。",
      "3. 当前地区/账号是否允许访问 Gemini API。",
      "4. 如果 key 曾经泄露，请在 AI Studio 重新生成后再保存。",
      upstreamDetail ? `\n上游返回：${upstreamDetail}` : "",
    ].filter(Boolean).join("\n");
  }

  if (args.service === "moonshot" || args.service === "kimiCodingPlan" || args.service === "kimicode") {
    return [
      `${args.label ?? args.service} 测试连接失败。`,
      context,
      "",
      "请优先检查模型是否可用，以及 kimi-k2.x 这类模型是否需要 temperature=1。",
      rawDetail ? `\n上游返回：${rawDetail}` : "",
    ].filter(Boolean).join("\n");
  }

  return [
    `${args.label ?? args.service} 测试连接失败。`,
    context,
    "",
    "请检查 API Key、模型可用性、账号额度，以及协议类型是否匹配该服务商。",
    rawDetail ? `\n上游返回：${rawDetail}` : "",
  ].filter(Boolean).join("\n");
}

async function fetchModelsFromServiceBaseUrl(
  serviceId: string,
  baseUrl: string,
  apiKey: string,
  proxyUrl?: string,
): Promise<{ models: Array<{ id: string; name: string }>; error?: string; authFailed?: boolean }> {
  const endpoint = isCustomServiceId(serviceId)
    ? undefined
    : getAllEndpoints().find((ep) => ep.id === serviceId);
  const modelsBaseUrl = isCustomServiceId(serviceId)
    ? baseUrl
    : endpoint?.modelsBaseUrl ?? (endpoint ? baseUrl : resolveServiceModelsBaseUrl(serviceId) ?? baseUrl);
  const modelsUrl = modelsBaseUrl.replace(/\/$/, "") + "/models";
  try {
    const res = await fetchWithProxy(modelsUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    }, proxyUrl);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        models: [],
        error: `服务商返回 ${res.status}: ${body.slice(0, 200)}`,
        authFailed: res.status === 401 || res.status === 403,
      };
    }
    const json = await res.json() as { data?: Array<{ id: string }> };
    return {
      models: (json.data ?? []).map((m) => ({ id: m.id, name: m.id })),
    };
  } catch (error) {
    return {
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeServiceCapabilities(args: {
  root: string;
  service: string;
  apiKey: string;
  baseUrl: string;
  preferredApiFormat?: "chat" | "responses";
  preferredStream?: boolean;
  preferredModel?: string;
  onlyPreferredModel?: boolean;
  proxyUrl?: string;
}): Promise<ServiceProbeResult> {
  const rawConfig = await loadRawConfig(args.root).catch(() => ({} as Record<string, unknown>));
  const llm = (rawConfig.llm as Record<string, unknown> | undefined) ?? {};
  const envConfig = await readEnvConfigStatus(args.root);
  const envModel = envConfig.effectiveSource === "project"
    ? envConfig.project.model
    : envConfig.effectiveSource === "global"
      ? envConfig.global.model
      : null;

  const baseService = isCustomServiceId(args.service) ? "custom" : args.service;
  const modelsResponse = await fetchModelsFromServiceBaseUrl(baseService, args.baseUrl, args.apiKey, args.proxyUrl);
  if (modelsResponse.authFailed) {
    return {
      ok: false,
      models: [],
      error: modelsResponse.error ?? "API Key 无效或无权访问模型列表。",
    };
  }
  const discoveredModels = modelsResponse.models;
  const endpoint = getAllEndpoints().find((ep) => ep.id === baseService);
  const preset = resolveServicePreset(baseService);
  const discoveredFirstModel =
    discoveredModels.find((model) => isTextChatModelId(model.id))?.id
    ?? discoveredModels[0]?.id;
  // Prefer live /models results; if unavailable, probe with the service's own check model before global defaults.
  const serviceFirstModel =
    discoveredFirstModel
    ?? endpoint?.checkModel
    ?? preset?.knownModels?.[0]
    ?? endpoint?.models.find((model) => model.enabled !== false)?.id;
  const useDynamicLocalModels = baseService === "ollama";
  const useEndpointCheckModel = !useDynamicLocalModels
    && !isCustomServiceId(args.service)
    && discoveredModels.length === 0
    && Boolean(endpoint?.checkModel);
  const configService = typeof llm.service === "string" ? llm.service : undefined;
  const configModel = !useEndpointCheckModel && configService === args.service
    ? typeof llm.defaultModel === "string"
      ? llm.defaultModel
      : typeof llm.model === "string"
        ? llm.model
        : undefined
    : undefined;
  const useCustomFallbacks = isCustomServiceId(args.service);
  const modelCandidates = buildModelCandidates({
    preferredModel: args.preferredModel ?? serviceFirstModel,
    configModel,
    envModel: useCustomFallbacks ? envModel : undefined,
    discoveredModels: useEndpointCheckModel ? [] : discoveredModels,
    includeGenericFallbacks: useCustomFallbacks,
    onlyPreferredModel: args.onlyPreferredModel,
  });

  if (modelCandidates.length === 0) {
    return {
      ok: false,
      models: [],
      error: "无法自动确定模型，请先填写可用模型或提供支持 /models 的服务端点。",
    };
  }

  let lastError = modelsResponse.error ?? "自动探测失败";

  for (const model of modelCandidates) {
    for (const plan of buildProbePlans(args.preferredApiFormat, args.preferredStream)) {
      const client = createLLMClient({
        provider: resolveServiceProviderFamily(baseService) ?? "openai",
        service: baseService,
        configSource: "studio",
        baseUrl: args.baseUrl,
        apiKey: args.apiKey.trim(),
        model,
        temperature: 0.7,
        maxTokens: SERVICE_CONNECTION_PROBE_MAX_TOKENS,
        thinkingBudget: 0,
        proxyUrl: args.proxyUrl,
        apiFormat: plan.apiFormat,
        stream: plan.stream,
      } as ProjectConfig["llm"]);

      try {
        await chatCompletion(client, model, [{ role: "user", content: "ping" }], {
          maxTokens: SERVICE_CONNECTION_PROBE_MAX_TOKENS,
        });
        const models = discoveredModels.length > 0
          ? discoveredModels
          : endpoint?.models
            .filter((m) => m.enabled !== false)
            .filter((m) => isTextChatModelId(m.id))
            .map((m) => ({ id: m.id, name: m.id }))
            ?? preset?.knownModels?.map((id) => ({ id, name: id }))
            ?? [{ id: model, name: model }];
        return {
          ok: true,
          models,
          selectedModel: model,
          apiFormat: plan.apiFormat,
          stream: plan.stream,
          baseUrl: args.baseUrl,
          modelsSource: discoveredModels.length > 0 ? "api" : "fallback",
        };
      } catch (error) {
        lastError = formatServiceProbeError({
          service: baseService,
          label: endpoint?.label ?? preset?.label,
          baseUrl: args.baseUrl,
          model,
          apiFormat: plan.apiFormat,
          stream: plan.stream,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    ok: false,
    models: discoveredModels,
    error: lastError,
  };
}

// --- Server factory ---

export function createStudioServer(initialConfig: ProjectConfig, root: string) {
  const app = new Hono();
  const state = new StateManager(root);
  let cachedConfig = initialConfig;

  app.use("/*", cors());

  // Structured error handler — ApiError returns typed JSON, others return 500
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status as 400);
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("LLM API key not set") || message.includes("INKOS_LLM_API_KEY not set")) {
      return c.json({ error: { code: "LLM_CONFIG_ERROR", message } }, 400);
    }
    console.error("[studio] Unexpected server error", error);
    return c.json(
      { error: { code: "INTERNAL_ERROR", message: "Unexpected server error." } },
      500,
    );
  });

  // BookId validation middleware — blocks path traversal on all book routes
  app.use("/api/v1/books/:id/*", async (c, next) => {
    const bookId = c.req.param("id");
    if (!isSafeBookId(bookId)) {
      throw new ApiError(400, "INVALID_BOOK_ID", `Invalid book ID: "${bookId}"`);
    }
    await next();
  });
  app.use("/api/v1/books/:id", async (c, next) => {
    const bookId = c.req.param("id");
    if (!isSafeBookId(bookId)) {
      throw new ApiError(400, "INVALID_BOOK_ID", `Invalid book ID: "${bookId}"`);
    }
    await next();
  });

  // Logger sink that broadcasts to SSE
  const sseSink: LogSink = {
    write(entry: LogEntry): void {
      broadcast("log", { level: entry.level, tag: entry.tag, message: entry.message });
    },
  };

  // Logger sink that prints to server terminal
  const consoleSink: LogSink = {
    write(entry: LogEntry): void {
      const prefix = `[${entry.tag}]`;
      if (entry.level === "warn") console.warn(prefix, entry.message);
      else if (entry.level === "error") console.error(prefix, entry.message);
      else console.log(prefix, entry.message);
    },
  };

  async function loadCurrentProjectConfig(
    options?: { readonly requireApiKey?: boolean },
  ): Promise<ProjectConfig> {
    const freshConfig = await loadProjectConfig(root, { ...options, consumer: "studio" });
    cachedConfig = freshConfig;
    return freshConfig;
  }

  async function buildPipelineConfig(
    overrides?: Partial<Pick<PipelineConfig, "externalContext" | "client" | "model">> & {
      readonly currentConfig?: ProjectConfig;
      readonly sessionIdForSSE?: string;
    },
  ): Promise<PipelineConfig> {
    const currentConfig = overrides?.currentConfig ?? await loadCurrentProjectConfig();
    const scopedSseSink: LogSink = overrides?.sessionIdForSSE
      ? {
          write(entry) {
            broadcast("log", {
              sessionId: overrides.sessionIdForSSE,
              level: entry.level,
              tag: entry.tag,
              message: entry.message,
            });
          },
        }
      : sseSink;
    const logger = createLogger({ tag: "studio", sinks: [scopedSseSink, consoleSink] });
    return {
      client: overrides?.client ?? createLLMClient(currentConfig.llm),
      model: overrides?.model ?? currentConfig.llm.model,
      projectRoot: root,
      defaultLLMConfig: currentConfig.llm,
      foundationReviewRetries: currentConfig.foundation?.reviewRetries ?? 2,
      modelOverrides: currentConfig.modelOverrides,
      notifyChannels: currentConfig.notify,
      logger,
      onStreamProgress: (progress) => {
        broadcast("llm:progress", {
          ...(overrides?.sessionIdForSSE ? { sessionId: overrides.sessionIdForSSE } : {}),
          status: progress.status,
          elapsedMs: progress.elapsedMs,
          totalChars: progress.totalChars,
          chineseChars: progress.chineseChars,
        });
      },
      externalContext: overrides?.externalContext,
    };
  }

  // --- Books ---

  app.get("/api/v1/books", async (c) => {
    const bookIds = await state.listBooks();
    const books = await Promise.all(bookIds.map((id) => loadStudioBookListSummary(state, id)));
    return c.json({ books });
  });

  app.get("/api/v1/books/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const book = await state.loadBookConfig(id);
      const chapters = await state.loadChapterIndex(id);
      const nextChapter = await state.getNextChapterNumber(id);
      return c.json({ book, chapters, nextChapter });
    } catch {
      return c.json({ error: `Book "${id}" not found` }, 404);
    }
  });

  // --- Genres ---

  app.get("/api/v1/genres", async (c) => {
    const { listAvailableGenres, readGenreProfile } = await import("@actalk/inkos-core");
    const rawGenres = await listAvailableGenres(root);
    const genres = await Promise.all(
      rawGenres.map(async (g) => {
        try {
          const { profile } = await readGenreProfile(root, g.id);
          return { ...g, language: profile.language ?? "zh" };
        } catch {
          return { ...g, language: "zh" };
        }
      }),
    );
    return c.json({ genres });
  });

  // --- Book Create ---

  app.post("/api/v1/books/create", async (c) => {
    const body = await c.req.json<{
      title: string;
      genre: string;
      language?: string;
      platform?: string;
      chapterWordCount?: number;
      targetChapters?: number;
      blurb?: string;
      styleGuide?: string;
    }>();

    const now = new Date().toISOString();
    const bookConfig = buildStudioBookConfig(body, now);
    const bookId = bookConfig.id;
    const bookDir = state.bookDir(bookId);

    try {
      await access(join(bookDir, "book.json"));
      await access(join(bookDir, "story", "story_bible.md"));
      return c.json({ error: `Book "${bookId}" already exists` }, 409);
    } catch {
      // The target book is not fully initialized yet, so creation can continue.
    }

    broadcast("book:creating", { bookId, title: body.title });
    bookCreateStatus.set(bookId, { status: "creating" });

    const pipeline = new PipelineRunner(await buildPipelineConfig());
    const tools = createInteractionToolsFromDeps(pipeline, state);
    processProjectInteractionRequest({
      projectRoot: root,
      request: {
        intent: "create_book",
        title: body.title,
        genre: body.genre,
        language: body.language === "ko" ? "ko" : body.language === "en" ? "en" : body.language === "zh" ? "zh" : undefined,
        platform: body.platform,
        chapterWordCount: body.chapterWordCount,
        targetChapters: body.targetChapters,
        blurb: body.blurb,
        styleGuide: body.styleGuide,
      },
      tools,
    }).then(
      async (result: {
        readonly session: { readonly activeBookId?: string };
        readonly details?: Readonly<Record<string, unknown>>;
      }) => {
        const createdBookId = (result.details?.bookId as string | undefined) ?? result.session.activeBookId ?? bookId;
        const book = await loadStudioBookListSummary(state, createdBookId).catch(() => undefined);
        bookCreateStatus.delete(bookId);
        bookCreateStatus.delete(createdBookId);
        broadcast("book:created", { bookId: createdBookId, ...(book ? { book } : {}) });
      },
      (e: unknown) => {
        const error = e instanceof Error ? e.message : String(e);
        bookCreateStatus.set(bookId, { status: "error", error });
        broadcast("book:error", { bookId, error });
      },
    );

    return c.json({ status: "creating", bookId });
  });

  app.get("/api/v1/books/:id/create-status", async (c) => {
    const id = c.req.param("id");
    const status = bookCreateStatus.get(id);
    if (!status) {
      try {
        if (await state.isCompleteBookDirectory(state.bookDir(id))) {
          return c.json({ status: "ready" });
        }
      } catch {
        // Fall through to the missing status response.
      }
      return c.json({ status: "missing" }, 404);
    }
    return c.json(status);
  });

  // --- Chapters ---

  app.get("/api/v1/books/:id/chapters/:num", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    const bookDir = state.bookDir(id);
    const chaptersDir = join(bookDir, "chapters");

    try {
      const files = await readdir(chaptersDir);
      const paddedNum = String(num).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);
      const content = await readFile(join(chaptersDir, match), "utf-8");
      return c.json({ chapterNumber: num, filename: match, content });
    } catch {
      return c.json({ error: "Chapter not found" }, 404);
    }
  });

  // --- Chapter Save ---

  app.put("/api/v1/books/:id/chapters/:num", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    const bookDir = state.bookDir(id);
    const chaptersDir = join(bookDir, "chapters");
    const { content } = await c.req.json<{ content: string }>();

    try {
      const files = await readdir(chaptersDir);
      const paddedNum = String(num).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const { writeFile: writeFileFs } = await import("node:fs/promises");
      await writeFileFs(join(chaptersDir, match), content, "utf-8");
      return c.json({ ok: true, chapterNumber: num });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Truth files ---

  // Flat-file whitelist — the pre-Phase-5 story root files plus dev's legacy
  // editor targets (author_intent / current_focus / volume_outline).
  //
  // Phase 5 cleanup #3 moved the authoritative YAML frontmatter + outline prose
  // into story/outline/ and character sheets into story/roles/. `story_bible.md`
  // and `book_rules.md` now exist only as compat pointer shims — we still allow
  // reading them so legacy books keep rendering, but the server-side writer
  // (write_truth_file) no longer accepts them as edit targets.
  const TRUTH_FLAT_FILES = [
    "author_intent.md", "current_focus.md",
    "story_bible.md", "book_rules.md", "volume_outline.md", "current_state.md",
    "particle_ledger.md", "pending_hooks.md", "chapter_summaries.md",
    "subplot_board.md", "emotional_arcs.md", "character_matrix.md",
    "style_guide.md", "parent_canon.md", "fanfic_canon.md",
  ];

  // Authoritative Phase 5 paths — prose outline + role sheets live under
  // dedicated subdirectories of story/. The full path (relative to story/) is
  // matched literally here. `节奏原则.md` / `rhythm_principles.md` is optional
  // after Phase 5 consolidation (rhythm lives in volume_map's closing paragraph);
  // the entries stay whitelisted for legacy books and manual overrides.
  const TRUTH_OUTLINE_FILES = [
    "outline/story_frame.md",
    "outline/volume_map.md",
    "outline/节奏原则.md",
    "outline/rhythm_principles.md",
  ];

  // Pointer shims that the runtime no longer treats as authoritative. The
  // GET handler tags them with `legacy: true` so the UI can surface that the
  // edits won't land where the user expects.
  const LEGACY_SHIM_FILES = new Set(["story_bible.md", "book_rules.md"]);

  /**
   * Validate a requested truth-file path:
   *   1. Must be one of the declared flat files, an outline/* allow-listed
   *      entry, or a roles/**\/*.md file under 主要角色/ | 次要角色/.
   *   2. Must resolve to a path inside bookDir/story/ (no `..`, no absolute
   *      paths, no traversal via the tier-name segment).
   */
  function resolveTruthFilePath(bookDir: string, file: string): string | null {
    // Reject absolute paths, traversal, null bytes outright.
    if (!file || file.includes("\0") || isAbsolute(file) || file.includes("..")) {
      return null;
    }

    // Phase hotfix 3: accept both Chinese and English locale role dirs so
    // English-layout books (roles/major, roles/minor) are reachable through
    // Studio. The runtime reader (utils/outline-paths.ts:75) already scans
    // both — Studio used to drop English books to read-only.
    const allowed =
      TRUTH_FLAT_FILES.includes(file)
      || TRUTH_OUTLINE_FILES.includes(file)
      || /^roles\/(主要角色|次要角色|major|minor|주요인물|보조인물)\/[^/]+\.md$/.test(file);

    if (!allowed) return null;

    const storyDir = resolve(bookDir, "story");
    const resolved = resolve(storyDir, file);
    const relativePath = relative(storyDir, resolved);
    if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      return null;
    }
    return resolved;
  }

  async function fileExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  // Use `:file{.+}` wildcard so nested paths (outline/..., roles/.../...) match.
  app.get("/api/v1/books/:id/truth/:file{.+}", async (c) => {
    const file = c.req.param("file");
    const id = c.req.param("id");

    const bookDir = state.bookDir(id);
    const resolved = resolveTruthFilePath(bookDir, file);
    if (!resolved) {
      return c.json({ error: "Invalid truth file" }, 400);
    }

    // Phase 5: new-layout books keep the authoritative prose under outline/.
    // A legacy book may only have story_bible.md / book_rules.md on disk —
    // we still serve those for read-only display, but flag them so the UI
    // can warn users their edits won't reach the runtime.
    // Hotfix: only tag as legacy when the book actually HAS the new layout.
    // Pre-Phase-5 books use story_bible/book_rules as the authoritative source.
    const { isNewLayoutBook } = await import("@actalk/inkos-core");
    const legacy = LEGACY_SHIM_FILES.has(file) && await isNewLayoutBook(bookDir);

    try {
      const content = await readFile(resolved, "utf-8");
      return c.json({ file, content, ...(legacy ? { legacy: true } : {}) });
    } catch {
      return c.json({ file, content: null, ...(legacy ? { legacy: true } : {}) });
    }
  });

  // --- Analytics ---

  app.get("/api/v1/books/:id/analytics", async (c) => {
    const id = c.req.param("id");
    try {
      const chapters = await state.loadChapterIndex(id);
      return c.json(computeAnalytics(id, chapters));
    } catch {
      return c.json({ error: `Book "${id}" not found` }, 404);
    }
  });

  // --- Actions ---

  app.post("/api/v1/books/:id/write-next", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ wordCount?: number }>().catch(() => ({ wordCount: undefined }));

    broadcast("write:start", { bookId: id });

    // Fire and forget — progress/completion/errors pushed via SSE
    const pipeline = new PipelineRunner(await buildPipelineConfig());
    pipeline.writeNextChapter(id, body.wordCount).then(
      (result) => {
        broadcast("write:complete", { bookId: id, chapterNumber: result.chapterNumber, status: result.status, title: result.title, wordCount: result.wordCount });
      },
      (e) => {
        broadcast("write:error", { bookId: id, error: e instanceof Error ? e.message : String(e) });
      },
    );

    return c.json({ status: "writing", bookId: id });
  });

  app.post("/api/v1/books/:id/draft", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ wordCount?: number; context?: string }>().catch(() => ({ wordCount: undefined, context: undefined }));

    broadcast("draft:start", { bookId: id });

    const pipeline = new PipelineRunner(await buildPipelineConfig());
    pipeline.writeDraft(id, body.context, body.wordCount).then(
      (result) => {
        broadcast("draft:complete", { bookId: id, chapterNumber: result.chapterNumber, title: result.title, wordCount: result.wordCount });
      },
      (e) => {
        broadcast("draft:error", { bookId: id, error: e instanceof Error ? e.message : String(e) });
      },
    );

    return c.json({ status: "drafting", bookId: id });
  });

  app.post("/api/v1/books/:id/chapters/:num/approve", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);

    try {
      const index = await state.loadChapterIndex(id);
      const updated = index.map((ch) =>
        ch.number === num ? { ...ch, status: "approved" as const } : ch,
      );
      await state.saveChapterIndex(id, updated);
      return c.json({ ok: true, chapterNumber: num, status: "approved" });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/chapters/:num/reject", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);

    try {
      const index = await state.loadChapterIndex(id);
      const target = index.find((ch) => ch.number === num);
      if (!target) {
        return c.json({ error: `Chapter ${num} not found` }, 404);
      }

      const rollbackTarget = num - 1;
      const discarded = await state.rollbackToChapter(id, rollbackTarget);
      return c.json({
        ok: true,
        chapterNumber: num,
        status: "rejected",
        rolledBackTo: rollbackTarget,
        discarded,
      });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- SSE ---

  app.get("/api/v1/events", (c) => {
    return streamSSE(c, async (stream) => {
      const handler: EventHandler = (event, data) => {
        stream.writeSSE({ event, data: JSON.stringify(data) });
      };
      subscribers.add(handler);
      await stream.writeSSE({ event: "ping", data: "" });

      // Keep alive
      const keepAlive = setInterval(() => {
        stream.writeSSE({ event: "ping", data: "" });
      }, 30000);

      stream.onAbort(() => {
        subscribers.delete(handler);
        clearInterval(keepAlive);
      });

      // Block until aborted
      await new Promise(() => {});
    });
  });

  // --- Model discovery ---

  app.get("/api/v1/services", async (c) => {
    const secrets = await loadSecrets(root);
    const endpoints = getAllEndpoints().filter((ep) => ep.id !== "custom");

    // Fast: only check connection status from secrets, no external API calls.
    const services = endpoints.map((ep) => ({
      service: ep.id,
      label: ep.label,
      group: ep.group,
      connected: Boolean(secrets.services[ep.id]?.apiKey),
    }));

    // Add custom services from inkos.json
    try {
      const config = await loadRawConfig(root);
      for (const svc of normalizeServiceConfig((config.llm as Record<string, unknown> | undefined)?.services)) {
        if (svc.service === "custom") {
          const secretKey = `custom:${svc.name}`;
          services.push({
            service: secretKey,
            label: svc.name ?? "Custom",
            group: undefined,
            connected: Boolean(secrets.services[secretKey]?.apiKey),
          });
        }
      }
    } catch { /* no config file */ }

    return c.json({ services });
  });

  app.get("/api/v1/services/config", async (c) => {
    const config = await loadRawConfig(root);
    const llm = (config.llm as Record<string, unknown> | undefined) ?? {};
    const services = normalizeServiceConfig(llm.services);
    const envConfig = await readEnvConfigStatus(root);
    return c.json({
      services,
      service: typeof llm.service === "string" ? llm.service : null,
      defaultModel: llm.defaultModel ?? null,
      configSource: "studio" satisfies LLMConfigSource,
      storedConfigSource: normalizeConfigSource(llm.configSource),
      envConfig,
    });
  });

  app.put("/api/v1/services/config", async (c) => {
    const body = await c.req.json<{ services?: unknown; defaultModel?: string; configSource?: LLMConfigSource; service?: string }>();
    const config = await loadRawConfig(root);
    config.llm = config.llm ?? {};
    const llm = config.llm as Record<string, unknown>;
    if (body.services !== undefined) {
      const existingServices = normalizeServiceConfig(llm.services);
      const incomingServices = normalizeServiceConfig(body.services);
      llm.services = mergeServiceConfig(existingServices, incomingServices);
    }
    if (body.defaultModel !== undefined) {
      llm.defaultModel = body.defaultModel;
    }
    if (body.configSource === "env") {
      return c.json({
        error: "Studio 运行时不支持切换到 env；env 只在 CLI/daemon/部署运行时作为覆盖层使用。",
      }, 400);
    }
    if (body.configSource !== undefined) {
      llm.configSource = normalizeConfigSource(body.configSource);
    }
    if (body.service !== undefined) {
      llm.service = body.service;
    }
    await saveRawConfig(root, config);
    return c.json({ ok: true });
  });

  app.post("/api/v1/services/:service/test", async (c) => {
    const service = c.req.param("service");
    const { apiKey, baseUrl, apiFormat, stream, model } = await c.req.json<{
      apiKey: string;
      baseUrl?: string;
      apiFormat?: "chat" | "responses";
      stream?: boolean;
      model?: string;
    }>();

    const resolvedBaseUrl = await resolveConfiguredServiceBaseUrl(root, service, baseUrl);
    if (!resolvedBaseUrl) {
      return c.json({ ok: false, error: `未知服务商: ${service}` }, 400);
    }

    const baseService = isCustomServiceId(service) ? "custom" : service;
    const apiKeyOptional = isApiKeyOptionalForEndpoint({
      provider: resolveServiceProviderFamily(baseService) ?? "openai",
      baseUrl: resolvedBaseUrl,
    });
    if (!apiKey?.trim() && !apiKeyOptional) {
      return c.json({ ok: false, error: "API Key 不能为空" }, 400);
    }

    const rawConfig = await loadRawConfig(root).catch(() => ({} as Record<string, unknown>));
    const llm = (rawConfig.llm as Record<string, unknown> | undefined) ?? {};
    const probe = await probeServiceCapabilities({
      root,
      service,
      apiKey: apiKey?.trim() ?? "",
      baseUrl: resolvedBaseUrl,
      preferredApiFormat: apiFormat,
      preferredStream: stream,
      preferredModel: typeof model === "string" ? model.trim() : undefined,
      onlyPreferredModel: typeof model === "string" && model.trim().length > 0,
      proxyUrl: typeof llm.proxyUrl === "string" ? llm.proxyUrl : undefined,
    });

    // B12: 升级响应 shape 为 { probe, chat, ... }，同时保留老字段供 UI 过渡期兼容
    const probeStatus = {
      ok: probe.ok,
      models: probe.models?.length ?? 0,
      ...(probe.ok ? {} : { error: probe.error ?? "连接失败" }),
    };

    if (!probe.ok) {
      return c.json({
        ok: false,
        error: probe.error ?? "连接失败",
        probe: probeStatus,
        chat: null,
      }, 400);
    }

    return c.json({
      ok: true,
      modelCount: probe.models.length,
      models: probe.models,
      selectedModel: probe.selectedModel,
      detected: {
        apiFormat: probe.apiFormat,
        stream: probe.stream,
        baseUrl: probe.baseUrl,
        modelsSource: probe.modelsSource,
      },
      // B12 新字段：两步验证状态
      probe: probeStatus,
      chat: null,  // probeServiceCapabilities 本身只做 probe，chat hello 在 Studio 的 follow-up 调用里单独触发
    });
  });

  app.put("/api/v1/services/:service/secret", async (c) => {
    const service = c.req.param("service");
    const { apiKey } = await c.req.json<{ apiKey: string }>();
    const secrets = await loadSecrets(root);
    if (apiKey?.trim()) {
      secrets.services[service] = { apiKey: apiKey.trim() };
    } else {
      delete secrets.services[service];
    }
    await saveSecrets(root, secrets);
    return c.json({ ok: true });
  });

  app.get("/api/v1/services/:service/secret", async (c) => {
    const service = c.req.param("service");
    const secrets = await loadSecrets(root);
    return c.json({
      apiKey: secrets.services[service]?.apiKey ?? "",
    });
  });

  app.get("/api/v1/services/models", async (c) => {
    const secrets = await loadSecrets(root);
    const endpoints = getAllEndpoints()
      .filter((ep) => ep.id !== "custom" && Boolean(secrets.services[ep.id]?.apiKey));

    const groups = endpoints.map((ep) => ({
      service: ep.id,
      label: ep.label,
      models: ep.models
        .filter((m) => m.enabled !== false)
        .filter((m) => isTextChatModelId(m.id))
        .map((m) => ({
          id: m.id,
          name: m.id,
          ...(typeof m.maxOutput === "number" ? { maxOutput: m.maxOutput } : {}),
          ...(m.contextWindowTokens > 0 ? { contextWindow: m.contextWindowTokens } : {}),
        })),
    }));

    return c.json({ groups });
  });

  app.get("/api/v1/services/models/custom", async (c) => {
    const secrets = await loadSecrets(root);
    let config: Record<string, unknown> = {};
    try {
      config = await loadRawConfig(root);
    } catch {
      // no config file
    }

    const customs = normalizeServiceConfig((config.llm as Record<string, unknown> | undefined)?.services)
      .filter((s) => s.service === "custom")
      .map((s) => ({
        id: `custom:${s.name ?? "Custom"}`,
        baseUrl: s.baseUrl ?? "",
        label: s.name ?? "Custom",
      }))
      .filter((s) => s.baseUrl && Boolean(secrets.services[s.id]?.apiKey));

    const groups = await Promise.all(customs.map(async (s) => ({
      service: s.id,
      label: s.label,
      models: filterTextChatModels(
        await probeModelsFromUpstream(s.baseUrl, secrets.services[s.id].apiKey, 10_000),
      ),
    })));

    return c.json({ groups });
  });

  app.get("/api/v1/services/:service/models", async (c) => {
    const service = c.req.param("service");
    const refresh = c.req.query("refresh") === "1";
    const secrets = await loadSecrets(root);
    const apiKey = c.req.query("apiKey") || secrets.services[service]?.apiKey || "";

    const inlineBaseUrl = c.req.query("baseUrl");
    const resolvedBaseUrl = await resolveConfiguredServiceBaseUrl(root, service, inlineBaseUrl);
    const baseService = isCustomServiceId(service) ? "custom" : service;
    const apiKeyOptional = isApiKeyOptionalForEndpoint({
      provider: resolveServiceProviderFamily(baseService) ?? "openai",
      baseUrl: resolvedBaseUrl,
    });

    // No key = no models, except local/self-hosted endpoints such as Ollama.
    if (!apiKey && !apiKeyOptional) return c.json({ models: [] });

    // Cache by service + resolved baseUrl + apiKey fingerprint; valid for 10 min unless ?refresh=1
    const cacheKey = `${service}::${resolvedBaseUrl ?? ""}::${apiKey.slice(-8)}`;
    if (!refresh) {
      const cached = modelListCache.get(cacheKey);
      if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
        return c.json({ models: cached.models });
      }
    }

    // B13: 走 listModelsForService 走 live probe + bank 交叉，返回带元数据的 models
    const enriched = await listModelsForService(
      isCustomServiceId(service) ? "custom" : service,
      apiKey,
      isCustomServiceId(service) ? resolvedBaseUrl ?? undefined : undefined,
    );
    const models = filterTextChatModels(enriched).map((m) => ({
      id: m.id,
      name: m.name,
      ...(m.maxOutput !== undefined ? { maxOutput: m.maxOutput } : {}),
      ...(m.contextWindow > 0 ? { contextWindow: m.contextWindow } : {}),
    }));
    modelListCache.set(cacheKey, { models, at: Date.now() });
    return c.json({ models });
  });

  // --- Project info ---

  app.get("/api/v1/project", async (c) => {
    const currentConfig = await loadCurrentProjectConfig({ requireApiKey: false });
    // Check if language was explicitly set in inkos.json (not just the schema default)
    const raw = JSON.parse(await readFile(join(root, "inkos.json"), "utf-8"));
    const languageExplicit = "language" in raw && raw.language !== "";

    return c.json({
      name: currentConfig.name,
      language: currentConfig.language,
      languageExplicit,
      model: currentConfig.llm.model,
      provider: currentConfig.llm.provider,
      baseUrl: currentConfig.llm.baseUrl,
      stream: currentConfig.llm.stream,
      temperature: currentConfig.llm.temperature,
    });
  });

  // --- Config editing ---

  app.put("/api/v1/project", async (c) => {
    const updates = await c.req.json<Record<string, unknown>>();
    const configPath = join(root, "inkos.json");
    try {
      const raw = await readFile(configPath, "utf-8");
      const existing = JSON.parse(raw);
      // Merge LLM settings
      if (updates.temperature !== undefined) {
        existing.llm.temperature = updates.temperature;
      }
      if (updates.stream !== undefined) {
        existing.llm.stream = updates.stream;
      }
      if (updates.language === "zh" || updates.language === "en" || updates.language === "ko") {
        existing.language = updates.language;
      }
      const { writeFile: writeFileFs } = await import("node:fs/promises");
      await writeFileFs(configPath, JSON.stringify(existing, null, 2), "utf-8");
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Truth files browser ---

  app.get("/api/v1/books/:id/truth", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);
    const storyDir = join(bookDir, "story");

    async function listDir(subdir: string): Promise<string[]> {
      try {
        const entries = await readdir(join(storyDir, subdir));
        return entries.filter((f) => f.endsWith(".md") || f.endsWith(".json"));
      } catch {
        return [];
      }
    }

    // Hotfix: only tag shim files as legacy when the book has the new layout.
    const { isNewLayoutBook } = await import("@actalk/inkos-core");
    const newLayout = await isNewLayoutBook(bookDir);

    async function describe(relPath: string): Promise<{ readonly name: string; readonly size: number; readonly preview: string; readonly legacy?: true } | null> {
      try {
        const content = await readFile(join(storyDir, relPath), "utf-8");
        const isShim = LEGACY_SHIM_FILES.has(relPath) && newLayout;
        const entry: { readonly name: string; readonly size: number; readonly preview: string; readonly legacy?: true } =
          isShim
            ? { name: relPath, size: content.length, preview: content.slice(0, 200), legacy: true }
            : { name: relPath, size: content.length, preview: content.slice(0, 200) };
        return entry;
      } catch {
        return null;
      }
    }

    try {
      // Flat story/ files (legacy + runtime logs)
      const flatFiles = (await listDir(".")).filter((f) => !f.startsWith("outline") && !f.startsWith("roles"));
      // Phase 5 outline/ files
      const outlineFiles = (await listDir("outline")).map((f) => `outline/${f}`);
      // Phase 5 roles/主要角色 + roles/次要角色, plus Phase hotfix 3
      // English-locale equivalents so en-language books are visible.
      const majorRolesZh = (await listDir("roles/主要角色")).map((f) => `roles/主要角色/${f}`);
      const minorRolesZh = (await listDir("roles/次要角色")).map((f) => `roles/次要角色/${f}`);
      const majorRolesEn = (await listDir("roles/major")).map((f) => `roles/major/${f}`);
      const minorRolesEn = (await listDir("roles/minor")).map((f) => `roles/minor/${f}`);
      const majorRolesKo = (await listDir("roles/주요인물")).map((f) => `roles/주요인물/${f}`);
      const minorRolesKo = (await listDir("roles/보조인물")).map((f) => `roles/보조인물/${f}`);

      const all = [
        ...flatFiles,
        ...outlineFiles,
        ...majorRolesZh,
        ...minorRolesZh,
        ...majorRolesEn,
        ...minorRolesEn,
        ...majorRolesKo,
        ...minorRolesKo,
      ];
      const described = await Promise.all(all.map(describe));
      const result = described.filter((x): x is NonNullable<typeof x> => x !== null);
      return c.json({ files: result });
    } catch {
      return c.json({ files: [] });
    }
  });

  // --- Daemon control ---

  let schedulerInstance: import("@actalk/inkos-core").Scheduler | null = null;

  app.get("/api/v1/daemon", (c) => {
    return c.json({
      running: schedulerInstance?.isRunning ?? false,
    });
  });

  app.post("/api/v1/daemon/start", async (c) => {
    if (schedulerInstance?.isRunning) {
      return c.json({ error: "Daemon already running" }, 400);
    }
    try {
      const { Scheduler } = await import("@actalk/inkos-core");
      const currentConfig = await loadCurrentProjectConfig();
      const scheduler = new Scheduler({
        ...(await buildPipelineConfig()),
        radarCron: currentConfig.daemon.schedule.radarCron,
        writeCron: currentConfig.daemon.schedule.writeCron,
        maxConcurrentBooks: currentConfig.daemon.maxConcurrentBooks,
        chaptersPerCycle: currentConfig.daemon.chaptersPerCycle,
        retryDelayMs: currentConfig.daemon.retryDelayMs,
        cooldownAfterChapterMs: currentConfig.daemon.cooldownAfterChapterMs,
        maxChaptersPerDay: currentConfig.daemon.maxChaptersPerDay,
        onChapterComplete: (bookId, chapter, status) => {
          broadcast("daemon:chapter", { bookId, chapter, status });
        },
        onError: (bookId, error) => {
          broadcast("daemon:error", { bookId, error: error.message });
        },
      });
      schedulerInstance = scheduler;
      broadcast("daemon:started", {});
      void scheduler.start().catch((e) => {
        const error = e instanceof Error ? e : new Error(String(e));
        if (schedulerInstance === scheduler) {
          scheduler.stop();
          schedulerInstance = null;
          broadcast("daemon:stopped", {});
        }
        broadcast("daemon:error", { bookId: "scheduler", error: error.message });
      });
      return c.json({ ok: true, running: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/daemon/stop", (c) => {
    if (!schedulerInstance?.isRunning) {
      return c.json({ error: "Daemon not running" }, 400);
    }
    schedulerInstance.stop();
    schedulerInstance = null;
    broadcast("daemon:stopped", {});
    return c.json({ ok: true, running: false });
  });

  // --- Logs ---

  app.get("/api/v1/logs", async (c) => {
    const logPath = join(root, "inkos.log");
    try {
      const content = await readFile(logPath, "utf-8");
      const lines = content.trim().split("\n").slice(-100);
      const entries = lines.map((line) => {
        try { return JSON.parse(line); } catch { return { message: line }; }
      });
      return c.json({ entries });
    } catch {
      return c.json({ entries: [] });
    }
  });

  // --- Agent chat ---

  app.get("/api/v1/interaction/session", async (c) => {
    const session = await loadProjectSession(root);
    const activeBookId = await resolveSessionActiveBook(root, session);
    return c.json({
      session: activeBookId && session.activeBookId !== activeBookId
        ? { ...session, activeBookId }
        : session,
      activeBookId,
    });
  });

  // -- Per-book session endpoints --

  app.get("/api/v1/sessions", async (c) => {
    const bookId = c.req.query("bookId");
    const sessions = await listBookSessions(root, bookId === undefined ? null : bookId === "null" ? null : bookId);
    return c.json({ sessions });
  });

  app.get("/api/v1/sessions/:sessionId", async (c) => {
    const session = await loadBookSession(root, c.req.param("sessionId"));
    if (!session) return c.json({ error: "Session not found" }, 404);
    return c.json({ session });
  });

  app.post("/api/v1/sessions", async (c) => {
    const body = await c.req.json<{ bookId?: string | null; sessionId?: string }>().catch(() => ({}));
    const bookId = normalizeApiBookId((body as { bookId?: unknown }).bookId, "bookId");
    const sessionId = (body as { sessionId?: string }).sessionId;
    // sessionId 只允许 timestamp-random 格式；防止注入任意文件名
    const safeSessionId = sessionId && /^[0-9]+-[a-z0-9]+$/.test(sessionId) ? sessionId : undefined;
    const session = await createAndPersistBookSession(root, bookId, safeSessionId);
    return c.json({ session });
  });

  app.put("/api/v1/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json<{ title?: string }>().catch(() => ({}) as { title?: string });
    const title = body.title?.trim();
    if (!title) {
      throw new ApiError(400, "INVALID_SESSION_TITLE", "Session title is required");
    }

    const session = await renameBookSession(root, sessionId, title);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }
    return c.json({ session });
  });

  app.delete("/api/v1/sessions/:sessionId", async (c) => {
    await deleteBookSession(root, c.req.param("sessionId"));
    return c.json({ ok: true });
  });

  app.post("/api/v1/agent", async (c) => {
    const { instruction, activeBookId, sessionId: reqSessionId, model: reqModelRaw, service: reqServiceRaw } = await c.req.json<{
      instruction: string;
      activeBookId?: string;
      sessionId?: string;
      model?: string;
      service?: string;
    }>();
    const sessionId = reqSessionId;
    if (!instruction?.trim()) {
      return c.json({ error: "No instruction provided" }, 400);
    }
    if (!sessionId?.trim()) {
      throw new ApiError(400, "SESSION_ID_REQUIRED", "sessionId is required");
    }
    if (reqModelRaw && !isTextChatModelId(reqModelRaw)) {
      const message = nonTextModelMessage(reqModelRaw);
      return c.json({ error: message, response: message }, 400);
    }

    broadcast("agent:start", { instruction, activeBookId, sessionId });

    try {
      // Load config + create LLM client (pipeline created after model resolution)
      const config = await loadCurrentProjectConfig({ requireApiKey: false });
      const client = createLLMClient(config.llm);
      const rawLlmConfig = config.llm as unknown as Record<string, unknown>;
      const configuredDefaultModel = typeof rawLlmConfig.defaultModel === "string" ? rawLlmConfig.defaultModel : undefined;
      const configuredServices = normalizeServiceConfig(rawLlmConfig.services);
      const configuredDefaultServiceEntry = configuredServices[0];
      const configuredDefaultService = configuredDefaultServiceEntry ? serviceConfigKey(configuredDefaultServiceEntry) : undefined;
      const reqModel = configuredDefaultModel ?? reqModelRaw;
      const reqService = configuredDefaultModel
        ? (configuredDefaultService ?? reqServiceRaw)
        : reqServiceRaw;

      const loadedBookSession = await loadBookSession(root, sessionId);
      if (!loadedBookSession) {
        throw new ApiError(404, "SESSION_NOT_FOUND", `Session not found: ${sessionId}`);
      }
      let bookSession = loadedBookSession;
      const requestedActiveBookId = normalizeApiBookId(activeBookId, "activeBookId");
      const persistedBookId = normalizeApiBookId(bookSession.bookId, "session.bookId");
      if (
        requestedActiveBookId
        && persistedBookId
        && persistedBookId !== requestedActiveBookId
      ) {
        throw new ApiError(
          409,
          "SESSION_BOOK_MISMATCH",
          `Session ${bookSession.sessionId} is bound to ${persistedBookId}, not ${requestedActiveBookId}`,
        );
      }
      const agentBookId = requestedActiveBookId ?? persistedBookId;
      if (agentBookId) {
        try {
          await state.loadBookConfig(agentBookId);
        } catch {
          throw new ApiError(404, "BOOK_NOT_FOUND", `Book not found: ${agentBookId}`);
        }
      }
      const streamSessionId = loadedBookSession.sessionId;
      const titleBeforeRun = bookSession.title;
      let sessionTitleBroadcasted = false;
      const refreshBookSessionFromTranscript = async (): Promise<void> => {
        const refreshed = await loadBookSession(root, bookSession.sessionId);
        if (refreshed) {
          bookSession = refreshed;
        }
        if (!sessionTitleBroadcasted && titleBeforeRun === null && bookSession.title) {
          broadcast("session:title", { sessionId: bookSession.sessionId, title: bookSession.title });
          sessionTitleBroadcasted = true;
        }
      };

      // Resolve model — multi-service resolution
      let resolvedModel: ResolvedModel["model"] | undefined;
      let resolvedApiKey: string | undefined;

      if (reqService && reqModel) {
        // 1. Frontend explicitly selected a service+model — fail loudly if no key
        try {
          const configuredEntry = await resolveConfiguredServiceEntry(root, reqService);
          const resolved = await resolveServiceModel(
            reqService,
            reqModel,
            root,
            await resolveConfiguredServiceBaseUrl(root, reqService),
            configuredEntry?.apiFormat,
          );
          resolvedModel = resolved.model;
          resolvedApiKey = resolved.apiKey;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          if (/API key/i.test(msg)) {
            return c.json({
              error: `请先为 ${reqService} 配置 API Key`,
              response: `请先在模型配置中为 ${reqService} 填写 API Key，然后再试。`,
            }, 400);
          }
          throw e;
        }
      }

      if (!resolvedModel) {
        // 2. Try defaultModel from new config format
        const rawConfig = config.llm as unknown as Record<string, unknown>;
        const defaultModel = rawConfig.defaultModel as string | undefined;
        const servicesArr = normalizeServiceConfig(rawConfig.services);
        const firstService = servicesArr[0];
        if (firstService?.service && defaultModel && isTextChatModelId(defaultModel)) {
          try {
            const resolved = await resolveServiceModel(
              serviceConfigKey(firstService),
              defaultModel,
              root,
              firstService.baseUrl,
              firstService.apiFormat,
            );
            resolvedModel = resolved.model;
            resolvedApiKey = resolved.apiKey;
          } catch { /* fall through */ }
        }
      }

      if (!resolvedModel) {
        // 3. Try first connected service from secrets
        const secrets = await loadSecrets(root);
        for (const [svcName, svcData] of Object.entries(secrets.services)) {
          if (svcData?.apiKey) {
            try {
              const models = await listModelsForService(svcName, svcData.apiKey);
              const textModels = filterTextChatModels(models);
              if (textModels.length > 0) {
                const configuredEntry = await resolveConfiguredServiceEntry(root, svcName);
                const resolved = await resolveServiceModel(
                  svcName,
                  textModels[0].id,
                  root,
                  await resolveConfiguredServiceBaseUrl(root, svcName),
                  configuredEntry?.apiFormat,
                );
                resolvedModel = resolved.model;
                resolvedApiKey = resolved.apiKey;
                break;
              }
            } catch { /* try next */ }
          }
        }
      }

      if (!resolvedModel) {
        // 4. Legacy fallback: use createLLMClient
        resolvedModel = client._piModel
          ? client._piModel
          : { provider: config.llm.provider ?? "anthropic", modelId: config.llm.model } as any;
        resolvedApiKey = client._apiKey;
      }

      const model = resolvedModel!;
      const agentApiKey = resolvedApiKey;
      const configuredEntry = reqService ? await resolveConfiguredServiceEntry(root, reqService) : undefined;

      // Create pipeline with resolved model (so sub_agent tools use the frontend-selected model)
      // Don't spread config.llm — its baseUrl/provider belong to the old service.
      // Let createLLMClient resolve baseUrl from the service preset.
      const pipelineClient = (reqService && reqModel && resolvedModel)
        ? createLLMClient({
            ...config.llm,
            service: configuredEntry?.service ?? reqService,
            model: reqModel,
            apiKey: resolvedApiKey ?? "",
            ...(configuredEntry?.apiFormat ? { apiFormat: configuredEntry.apiFormat } : {}),
            ...(configuredEntry?.stream !== undefined ? { stream: configuredEntry.stream } : {}),
            baseUrl: configuredEntry?.baseUrl ?? "",
          } as any)
        : client;
      const pipeline = new PipelineRunner(await buildPipelineConfig({
        client: pipelineClient,
        model: reqModel ?? config.llm.model,
        currentConfig: config,
        sessionIdForSSE: bookSession.sessionId,
      }));

      if (agentBookId && isWriteNextInstruction(instruction)) {
        const toolCallId = `direct-writer-${Date.now().toString(36)}`;
        const toolArgs = { agent: "writer", bookId: agentBookId };
        broadcast("tool:start", {
          sessionId: streamSessionId,
          id: toolCallId,
          tool: "sub_agent",
          args: toolArgs,
          stages: PIPELINE_STAGES.writer,
        });

        try {
          const writeResult = await pipeline.writeNextChapter(agentBookId);
          const responseText = [
            `已为 ${agentBookId} 完成第 ${writeResult.chapterNumber} 章`,
            writeResult.title ? `《${writeResult.title}》` : "",
            `，字数 ${writeResult.wordCount}，状态 ${writeResult.status}。`,
          ].join("");
          const toolResult = {
            content: [{ type: "text", text: responseText }],
            details: {
              kind: "chapter_written",
              bookId: agentBookId,
              chapterNumber: writeResult.chapterNumber,
              title: writeResult.title,
              wordCount: writeResult.wordCount,
              status: writeResult.status,
            },
          };
          broadcast("tool:end", {
            sessionId: streamSessionId,
            id: toolCallId,
            tool: "sub_agent",
            result: toolResult,
            isError: false,
          });
          await appendManualSessionMessages(root, bookSession.sessionId, [{
            role: "assistant",
            content: [{ type: "text", text: responseText }],
            api: "anthropic-messages",
            provider: configuredEntry?.service ?? reqService ?? config.llm.provider,
            model: reqModel ?? config.llm.model,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "toolUse",
            timestamp: Date.now(),
          }], instruction);
          await refreshBookSessionFromTranscript();
          broadcast("agent:complete", { instruction, activeBookId: agentBookId, sessionId: bookSession.sessionId });
          return c.json({
            response: responseText,
            session: {
              sessionId: bookSession.sessionId,
              activeBookId: agentBookId,
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const toolResult = { content: [{ type: "text", text: message }] };
          broadcast("tool:end", {
            sessionId: streamSessionId,
            id: toolCallId,
            tool: "sub_agent",
            result: toolResult,
            isError: true,
          });
          broadcast("agent:error", { instruction, activeBookId: agentBookId, sessionId: bookSession.sessionId, error: message });
          return c.json({
            error: { code: "AGENT_ACTION_FAILED", message },
            response: message,
          }, 502);
        }
      }

      // Run pi-agent session
      const collectedToolExecs: CollectedToolExec[] = [];
      const result = await runAgentSession(
        {
          model,
          apiKey: agentApiKey,
          pipeline,
          projectRoot: root,
          bookId: agentBookId,
          sessionId: bookSession.sessionId,
          language: config.language ?? "zh",
          onEvent: (event) => {
            if (event.type === "message_update") {
              const ame = event.assistantMessageEvent;
              if (ame.type === "text_delta") {
                broadcast("draft:delta", { sessionId: streamSessionId, text: ame.delta });
              } else if (ame.type === "thinking_delta") {
                broadcast("thinking:delta", { sessionId: streamSessionId, text: (ame as any).delta });
              } else if (ame.type === "thinking_start") {
                broadcast("thinking:start", { sessionId: streamSessionId });
              } else if (ame.type === "thinking_end") {
                broadcast("thinking:end", { sessionId: streamSessionId });
              }
            }
            if (event.type === "tool_execution_start") {
              const args = event.args as Record<string, unknown> | undefined;
              const agent = event.toolName === "sub_agent" ? (args?.agent as string | undefined) : undefined;
              const stages = agent ? (PIPELINE_STAGES[agent] ?? []) : [];

              collectedToolExecs.push({
                id: event.toolCallId,
                tool: event.toolName,
                agent,
                label: resolveToolLabel(event.toolName, agent),
                status: "running",
                args,
                stages: stages.length > 0
                  ? stages.map(l => ({ label: l, status: "pending" as const }))
                  : undefined,
                startedAt: Date.now(),
              });

              if (!agentBookId && event.toolName === "sub_agent" && agent === "architect") {
                const bookId = resolveArchitectBookIdFromArgs(args);
                if (bookId) {
                  const title = typeof args?.title === "string" && args.title.trim()
                    ? args.title.trim()
                    : bookId;
                  bookCreateStatus.set(bookId, { status: "creating" });
                  broadcast("book:creating", { bookId, title, sessionId: streamSessionId });
                }
              }

              broadcast("tool:start", {
                sessionId: streamSessionId,
                id: event.toolCallId,
                tool: event.toolName,
                args,
                stages,
              });
            }
            if (event.type === "tool_execution_update") {
              broadcast("tool:update", {
                sessionId: streamSessionId,
                tool: event.toolName,
                partialResult: event.partialResult,
              });
            }
            if (event.type === "tool_execution_end") {
              const exec = collectedToolExecs.find(t => t.id === event.toolCallId);
              if (exec) {
                exec.status = event.isError ? "error" : "completed";
                exec.completedAt = Date.now();
                exec.stages = exec.stages?.map(s => ({ ...s, status: "completed" as const }));
                if (event.isError) exec.error = extractToolError(event.result);
                else exec.result = summarizeResult(event.result);
                exec.details = (event.result as { details?: unknown } | undefined)?.details;
                if (
                  event.isError &&
                  !agentBookId &&
                  exec.tool === "sub_agent" &&
                  exec.agent === "architect"
                ) {
                  const bookId = resolveArchitectBookIdFromArgs(exec.args);
                  if (bookId) {
                    const error = exec.error ?? "Book creation failed";
                    bookCreateStatus.set(bookId, { status: "error", error });
                    broadcast("book:error", { bookId, sessionId: streamSessionId, error });
                  }
                }
              }
              broadcast("tool:end", {
                sessionId: streamSessionId,
                id: event.toolCallId,
                tool: event.toolName,
                result: event.result,
                isError: event.isError,
              });
            }
          },
        },
        instruction,
      );

      if (result.responseText) {
        const actionExecutionError = validateAgentActionExecution({
          instruction,
          agentBookId,
          responseText: result.responseText,
          collectedToolExecs,
        });
        if (actionExecutionError) {
          return c.json({
            error: { code: "AGENT_ACTION_NOT_EXECUTED", message: actionExecutionError },
            response: actionExecutionError,
          }, 502);
        }
      }

      let broadcastedCreatedBookId: string | null = null;
      const finalizeCreatedBook = async (): Promise<string | null> => {
        if (agentBookId) return null;
        const createdBookId = resolveCreatedBookIdFromToolExecs(collectedToolExecs);
        if (!createdBookId) return null;
        if (broadcastedCreatedBookId === createdBookId) return createdBookId;

        try {
          const migratedSession = await migrateBookSession(root, bookSession.sessionId, createdBookId);
          if (migratedSession) {
            bookSession = migratedSession;
          }
        } catch (e) {
          if (!(e instanceof SessionAlreadyMigratedError)) {
            throw e;
          }
        }

        const book = await loadStudioBookListSummary(state, createdBookId).catch(() => undefined);
        bookCreateStatus.delete(createdBookId);
        broadcast("book:created", {
          bookId: createdBookId,
          sessionId: bookSession.sessionId,
          ...(book ? { book } : {}),
        });
        broadcastedCreatedBookId = createdBookId;
        return createdBookId;
      };

      if (!result.responseText) {
        if (result.errorMessage) {
          if (resolveCreatedBookIdFromToolExecs(collectedToolExecs)) {
            await finalizeCreatedBook();
          }
          return c.json({
            error: { code: "AGENT_LLM_ERROR", message: result.errorMessage },
            response: result.errorMessage,
          }, 502);
        }

        try {
          const fallbackClient = createLLMClient({
            ...config.llm,
            service: configuredEntry?.service ?? reqService ?? config.llm.service,
            model: reqModel ?? config.llm.model,
            apiKey: agentApiKey ?? config.llm.apiKey,
            baseUrl: configuredEntry?.baseUrl ?? "",
            ...(configuredEntry?.apiFormat ? { apiFormat: configuredEntry.apiFormat } : {}),
            ...(configuredEntry?.stream !== undefined ? { stream: configuredEntry.stream } : {}),
          } as ProjectConfig["llm"]);
          const fallback = await chatCompletion(
            fallbackClient,
            reqModel ?? config.llm.model,
            [
              { role: "system", content: buildAgentSystemPrompt(agentBookId, config.language ?? "zh") },
              { role: "user", content: instruction },
            ],
            { maxTokens: 256 },
          );
          if (fallback.content?.trim()) {
            const actionExecutionError = validateAgentActionExecution({
              instruction,
              agentBookId,
              responseText: fallback.content,
              collectedToolExecs,
            });
            if (actionExecutionError) {
              return c.json({
                error: { code: "AGENT_ACTION_NOT_EXECUTED", message: actionExecutionError },
                response: actionExecutionError,
              }, 502);
            }
            await appendManualSessionMessages(root, bookSession.sessionId, [{
              role: "assistant",
              content: [{ type: "text", text: fallback.content }],
              api: "anthropic-messages",
              provider: configuredEntry?.service ?? reqService ?? config.llm.provider,
              model: reqModel ?? config.llm.model,
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
            }], instruction);
            await refreshBookSessionFromTranscript();
            const createdBookId = await finalizeCreatedBook();
            return c.json({
              response: fallback.content,
              session: {
                sessionId: bookSession.sessionId,
                ...(createdBookId ? { activeBookId: createdBookId } : {}),
              },
            });
          }
        } catch {
          // fall through to probe-based diagnosis below
        }

        try {
          const probeClient = createLLMClient({
            ...config.llm,
            service: configuredEntry?.service ?? reqService ?? config.llm.service,
            model: reqModel ?? config.llm.model,
            apiKey: agentApiKey ?? config.llm.apiKey,
            baseUrl: configuredEntry?.baseUrl ?? "",
            ...(configuredEntry?.apiFormat ? { apiFormat: configuredEntry.apiFormat } : {}),
            ...(configuredEntry?.stream !== undefined ? { stream: configuredEntry.stream } : {}),
          } as ProjectConfig["llm"]);
          await chatCompletion(
            probeClient,
            reqModel ?? config.llm.model,
            [{ role: "user", content: "ping" }],
            { maxTokens: 5 },
          );
        } catch (probeError) {
          const probeMessage = probeError instanceof Error ? probeError.message : String(probeError);
          if (resolveCreatedBookIdFromToolExecs(collectedToolExecs)) {
            await finalizeCreatedBook();
          }
          return c.json({
            error: { code: "AGENT_EMPTY_RESPONSE", message: probeMessage },
            response: probeMessage,
          }, 502);
        }

        const emptyMessage = "模型未返回文本内容。请检查协议类型（chat/responses）、流式开关或上游服务兼容性。";
        if (resolveCreatedBookIdFromToolExecs(collectedToolExecs)) {
          await finalizeCreatedBook();
        }
        return c.json({
          error: { code: "AGENT_EMPTY_RESPONSE", message: emptyMessage },
          response: emptyMessage,
        }, 502);
      }
      await refreshBookSessionFromTranscript();
      await finalizeCreatedBook();

      broadcast("agent:complete", { instruction, activeBookId, sessionId: bookSession.sessionId });

      return c.json({
        response: result.responseText,
        session: {
          sessionId: bookSession.sessionId,
          ...(bookSession.bookId ? { activeBookId: bookSession.bookId } : {}),
        },
      });
    } catch (e) {
      if (e instanceof ApiError) {
        throw e;
      }
      if (e instanceof SessionAlreadyMigratedError) {
        const migratedMessage = e instanceof Error ? e.message : String(e);
        throw new ApiError(409, "SESSION_ALREADY_MIGRATED", migratedMessage);
      }
      const msg = e instanceof Error ? e.message : String(e);
      broadcast("agent:error", { instruction, activeBookId, sessionId, error: msg });

      // Agent busy — return 429 with user-friendly message
      if (/already processing|prompt.*queue/i.test(msg)) {
        return c.json({
          error: { code: "AGENT_BUSY", message: "正在处理中，请等待当前操作完成" },
          response: "正在处理中，请等待当前操作完成后再发送。",
        }, 429);
      }

      return c.json(
        { error: { code: "AGENT_ERROR", message: msg } },
        500,
      );
    }
  });

  // --- Language setup ---

  app.post("/api/v1/project/language", async (c) => {
    const { language } = await c.req.json<{ language: "zh" | "en" | "ko" }>();
    const configPath = join(root, "inkos.json");
    try {
      const raw = await readFile(configPath, "utf-8");
      const existing = JSON.parse(raw);
      existing.language = language;
      const { writeFile: writeFileFs } = await import("node:fs/promises");
      await writeFileFs(configPath, JSON.stringify(existing, null, 2), "utf-8");
      return c.json({ ok: true, language });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Audit ---

  app.post("/api/v1/books/:id/audit/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const bookDir = state.bookDir(id);

    broadcast("audit:start", { bookId: id, chapter: chapterNum });
    try {
      const book = await state.loadBookConfig(id);
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNum).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const content = await readFile(join(chaptersDir, match), "utf-8");
      const currentConfig = await loadCurrentProjectConfig();
      const { ContinuityAuditor } = await import("@actalk/inkos-core");
      const auditor = new ContinuityAuditor({
        client: createLLMClient(currentConfig.llm),
        model: currentConfig.llm.model,
        projectRoot: root,
        bookId: id,
      });
      const result = await auditor.auditChapter(bookDir, content, chapterNum, book.genre);
      broadcast("audit:complete", { bookId: id, chapter: chapterNum, passed: result.passed });
      return c.json(result);
    } catch (e) {
      broadcast("audit:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Revise ---

  app.post("/api/v1/books/:id/revise/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const bookDir = state.bookDir(id);
    const body = await c.req
      .json<{ mode?: string; brief?: string }>()
      .catch(() => ({ mode: "spot-fix", brief: undefined }));

    broadcast("revise:start", { bookId: id, chapter: chapterNum });
    try {
      const book = await state.loadBookConfig(id);
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNum).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const pipeline = new PipelineRunner(await buildPipelineConfig({
        externalContext: body.brief,
      }));
      const normalizedMode = body.mode ?? "spot-fix";
      const result = await pipeline.reviseDraft(
        id,
        chapterNum,
        normalizedMode as "polish" | "rewrite" | "rework" | "spot-fix" | "anti-detect",
      );
      broadcast("revise:complete", { bookId: id, chapter: chapterNum });
      return c.json(result);
    } catch (e) {
      broadcast("revise:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Export ---

  app.get("/api/v1/books/:id/export", async (c) => {
    const id = c.req.param("id");
    const format = (c.req.query("format") ?? "txt") as string;
    const approvedOnly = c.req.query("approvedOnly") === "true";

    try {
      const artifact = await buildExportArtifact(state, id, {
        format: format as "txt" | "md" | "epub",
        approvedOnly,
      });
      const responseBody = typeof artifact.payload === "string"
        ? artifact.payload
        : new Uint8Array(artifact.payload);
      return new Response(responseBody, {
        headers: {
          "Content-Type": artifact.contentType,
          "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
        },
      });
    } catch {
      return c.json({ error: "Export failed" }, 500);
    }
  });

  // --- Export to file (save to project dir) ---

  app.post("/api/v1/books/:id/export-save", async (c) => {
    const id = c.req.param("id");
    const { format, approvedOnly } = await c.req.json<{ format?: string; approvedOnly?: boolean }>().catch(() => ({ format: "txt", approvedOnly: false }));
    const fmt = format ?? "txt";

    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      const tools = createInteractionToolsFromDeps(pipeline, state);
      const bookDir = state.bookDir(id);
      const outputPath = join(bookDir, `${id}.${fmt === "epub" ? "epub" : fmt}`);
      const result = await processProjectInteractionRequest({
        projectRoot: root,
        request: {
          intent: "export_book",
          bookId: id,
          format: fmt as "txt" | "md" | "epub",
          approvedOnly,
          outputPath,
        },
        tools,
        activeBookId: id,
      });
      return c.json({
        ok: true,
        path: (result.details?.outputPath as string | undefined) ?? outputPath,
        format: fmt,
        chapters: (result.details?.chaptersExported as number | undefined) ?? 0,
      });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Genre detail + copy ---

  app.get("/api/v1/genres/:id", async (c) => {
    const genreId = c.req.param("id");
    try {
      const { readGenreProfile } = await import("@actalk/inkos-core");
      const { profile, body } = await readGenreProfile(root, genreId);
      return c.json({ profile, body });
    } catch (e) {
      return c.json({ error: String(e) }, 404);
    }
  });

  app.post("/api/v1/genres/:id/copy", async (c) => {
    const genreId = c.req.param("id");
    if (/[/\\\0]/.test(genreId) || genreId.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${genreId}"`);
    }
    try {
      const { getBuiltinGenresDir } = await import("@actalk/inkos-core");
      const { mkdir: mkdirFs, copyFile } = await import("node:fs/promises");
      const builtinDir = getBuiltinGenresDir();
      const projectGenresDir = join(root, "genres");
      await mkdirFs(projectGenresDir, { recursive: true });
      await copyFile(join(builtinDir, `${genreId}.md`), join(projectGenresDir, `${genreId}.md`));
      return c.json({ ok: true, path: `genres/${genreId}.md` });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Model overrides ---

  app.get("/api/v1/project/model-overrides", async (c) => {
    const raw = JSON.parse(await readFile(join(root, "inkos.json"), "utf-8"));
    return c.json({ overrides: raw.modelOverrides ?? {} });
  });

  app.put("/api/v1/project/model-overrides", async (c) => {
    const { overrides } = await c.req.json<{ overrides: Record<string, unknown> }>();
    const configPath = join(root, "inkos.json");
    const raw = JSON.parse(await readFile(configPath, "utf-8"));
    raw.modelOverrides = overrides;
    const { writeFile: writeFileFs } = await import("node:fs/promises");
    await writeFileFs(configPath, JSON.stringify(raw, null, 2), "utf-8");
    return c.json({ ok: true });
  });

  // --- Notify channels ---

  app.get("/api/v1/project/notify", async (c) => {
    const raw = JSON.parse(await readFile(join(root, "inkos.json"), "utf-8"));
    return c.json({ channels: raw.notify ?? [] });
  });

  app.put("/api/v1/project/notify", async (c) => {
    const { channels } = await c.req.json<{ channels: unknown[] }>();
    const configPath = join(root, "inkos.json");
    const raw = JSON.parse(await readFile(configPath, "utf-8"));
    raw.notify = channels;
    const { writeFile: writeFileFs } = await import("node:fs/promises");
    await writeFileFs(configPath, JSON.stringify(raw, null, 2), "utf-8");
    return c.json({ ok: true });
  });

  // --- AIGC Detection ---

  app.post("/api/v1/books/:id/detect/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const bookDir = state.bookDir(id);

    try {
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNum).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const content = await readFile(join(chaptersDir, match), "utf-8");
      const { analyzeAITells } = await import("@actalk/inkos-core");
      const result = analyzeAITells(content);
      return c.json({ chapterNumber: chapterNum, ...result });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Truth file edit ---

  app.put("/api/v1/books/:id/truth/:file{.+}", async (c) => {
    const id = c.req.param("id");
    const file = c.req.param("file");
    const bookDir = state.bookDir(id);
    const resolved = resolveTruthFilePath(bookDir, file);
    if (!resolved) {
      return c.json({ error: "Invalid truth file" }, 400);
    }
    // Legacy pointer shims are read-only in new-layout books: writing
    // story_bible.md or book_rules.md does nothing at runtime (the pipeline
    // reads outline/ instead). For pre-Phase-5 books these ARE authoritative.
    if (LEGACY_SHIM_FILES.has(file)) {
      const { isNewLayoutBook } = await import("@actalk/inkos-core");
      if (await isNewLayoutBook(bookDir)) {
        return c.json(
          { error: "Legacy compat shim; edit outline/story_frame.md instead" },
          400,
        );
      }
    }
    const { content } = await c.req.json<{ content: string }>();
    const { writeFile: writeFileFs, mkdir: mkdirFs } = await import("node:fs/promises");
    const { dirname: dirnameFs } = await import("node:path");
    await mkdirFs(dirnameFs(resolved), { recursive: true });
    await writeFileFs(resolved, content, "utf-8");
    return c.json({ ok: true });
  });

  // =============================================
  // NEW ENDPOINTS — CLI parity
  // =============================================

  // --- Book Delete ---

  app.delete("/api/v1/books/:id", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);
    try {
      const { rm } = await import("node:fs/promises");
      await rm(bookDir, { recursive: true, force: true });
      broadcast("book:deleted", { bookId: id });
      return c.json({ ok: true, bookId: id });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Book Update ---

  app.put("/api/v1/books/:id", async (c) => {
    const id = c.req.param("id");
    const updates = await c.req.json<{
      chapterWordCount?: number;
      targetChapters?: number;
      status?: string;
      language?: string;
    }>();
    try {
      const book = await state.loadBookConfig(id);
      const updated = {
        ...book,
        ...(updates.chapterWordCount !== undefined ? { chapterWordCount: Number(updates.chapterWordCount) } : {}),
        ...(updates.targetChapters !== undefined ? { targetChapters: Number(updates.targetChapters) } : {}),
        ...(updates.status !== undefined ? { status: updates.status as typeof book.status } : {}),
        ...(updates.language !== undefined ? { language: updates.language as "zh" | "en" | "ko" } : {}),
        updatedAt: new Date().toISOString(),
      };
      await state.saveBookConfig(id, updated);
      return c.json({ ok: true, book: updated });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Write Rewrite (specific chapter) ---

  app.post("/api/v1/books/:id/rewrite/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const body: { brief?: string } = await c.req
      .json<{ brief?: string }>()
      .catch(() => ({}));

    broadcast("rewrite:start", { bookId: id, chapter: chapterNum });
    try {
      const rollbackTarget = chapterNum - 1;
      const discarded = await state.rollbackToChapter(id, rollbackTarget);
      const pipeline = new PipelineRunner(await buildPipelineConfig({
        externalContext: body.brief,
      }));
      pipeline.writeNextChapter(id).then(
        (result) => broadcast("rewrite:complete", { bookId: id, chapterNumber: result.chapterNumber, title: result.title, wordCount: result.wordCount }),
        (e) => broadcast("rewrite:error", { bookId: id, error: e instanceof Error ? e.message : String(e) }),
      );
      return c.json({ status: "rewriting", bookId: id, chapter: chapterNum, rolledBackTo: rollbackTarget, discarded });
    } catch (e) {
      broadcast("rewrite:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/resync/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const body: { brief?: string } = await c.req
      .json<{ brief?: string }>()
      .catch(() => ({}));

    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig({
        externalContext: body.brief,
      }));
      const result = await pipeline.resyncChapterArtifacts(id, chapterNum);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Detect All chapters ---

  app.post("/api/v1/books/:id/detect-all", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);

    try {
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const mdFiles = files.filter((f) => f.endsWith(".md") && /^\d{4}/.test(f)).sort();
      const { analyzeAITells } = await import("@actalk/inkos-core");

      const results = await Promise.all(
        mdFiles.map(async (f) => {
          const num = parseInt(f.slice(0, 4), 10);
          const content = await readFile(join(chaptersDir, f), "utf-8");
          const result = analyzeAITells(content);
          return { chapterNumber: num, filename: f, ...result };
        }),
      );
      return c.json({ bookId: id, results });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Detect Stats ---

  app.get("/api/v1/books/:id/detect/stats", async (c) => {
    const id = c.req.param("id");
    try {
      const { loadDetectionHistory, analyzeDetectionInsights } = await import("@actalk/inkos-core");
      const bookDir = state.bookDir(id);
      const history = await loadDetectionHistory(bookDir);
      const insights = analyzeDetectionInsights(history);
      return c.json(insights);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Genre Create ---

  app.post("/api/v1/genres/create", async (c) => {
    const body = await c.req.json<{
      id: string; name: string; language?: string;
      chapterTypes?: string[]; fatigueWords?: string[];
      numericalSystem?: boolean; powerScaling?: boolean; eraResearch?: boolean;
      pacingRule?: string; satisfactionTypes?: string[]; auditDimensions?: number[];
      body?: string;
    }>();

    if (!body.id || !body.name) {
      return c.json({ error: "id and name are required" }, 400);
    }
    if (/[/\\\0]/.test(body.id) || body.id.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${body.id}"`);
    }

    const { writeFile: writeFileFs, mkdir: mkdirFs } = await import("node:fs/promises");
    const genresDir = join(root, "genres");
    await mkdirFs(genresDir, { recursive: true });

    const frontmatter = [
      "---",
      `name: ${body.name}`,
      `id: ${body.id}`,
      `language: ${body.language ?? "zh"}`,
      `chapterTypes: ${JSON.stringify(body.chapterTypes ?? [])}`,
      `fatigueWords: ${JSON.stringify(body.fatigueWords ?? [])}`,
      `numericalSystem: ${body.numericalSystem ?? false}`,
      `powerScaling: ${body.powerScaling ?? false}`,
      `eraResearch: ${body.eraResearch ?? false}`,
      `pacingRule: "${body.pacingRule ?? ""}"`,
      `satisfactionTypes: ${JSON.stringify(body.satisfactionTypes ?? [])}`,
      `auditDimensions: ${JSON.stringify(body.auditDimensions ?? [])}`,
      "---",
      "",
      body.body ?? "",
    ].join("\n");

    await writeFileFs(join(genresDir, `${body.id}.md`), frontmatter, "utf-8");
    return c.json({ ok: true, id: body.id });
  });

  // --- Genre Edit ---

  app.put("/api/v1/genres/:id", async (c) => {
    const genreId = c.req.param("id");
    if (/[/\\\0]/.test(genreId) || genreId.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${genreId}"`);
    }

    const body = await c.req.json<{ profile: Record<string, unknown>; body: string }>();
    const { writeFile: writeFileFs, mkdir: mkdirFs } = await import("node:fs/promises");
    const genresDir = join(root, "genres");
    await mkdirFs(genresDir, { recursive: true });

    const p = body.profile;
    const frontmatter = [
      "---",
      `name: ${p.name ?? genreId}`,
      `id: ${p.id ?? genreId}`,
      `language: ${p.language ?? "zh"}`,
      `chapterTypes: ${JSON.stringify(p.chapterTypes ?? [])}`,
      `fatigueWords: ${JSON.stringify(p.fatigueWords ?? [])}`,
      `numericalSystem: ${p.numericalSystem ?? false}`,
      `powerScaling: ${p.powerScaling ?? false}`,
      `eraResearch: ${p.eraResearch ?? false}`,
      `pacingRule: "${p.pacingRule ?? ""}"`,
      `satisfactionTypes: ${JSON.stringify(p.satisfactionTypes ?? [])}`,
      `auditDimensions: ${JSON.stringify(p.auditDimensions ?? [])}`,
      "---",
      "",
      body.body ?? "",
    ].join("\n");

    await writeFileFs(join(genresDir, `${genreId}.md`), frontmatter, "utf-8");
    return c.json({ ok: true, id: genreId });
  });

  // --- Genre Delete (project-level only) ---

  app.delete("/api/v1/genres/:id", async (c) => {
    const genreId = c.req.param("id");
    if (/[/\\\0]/.test(genreId) || genreId.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${genreId}"`);
    }

    const filePath = join(root, "genres", `${genreId}.md`);
    try {
      const { rm } = await import("node:fs/promises");
      await rm(filePath);
      return c.json({ ok: true, id: genreId });
    } catch (e) {
      return c.json({ error: `Genre "${genreId}" not found in project` }, 404);
    }
  });

  // --- Style Analyze ---

  app.post("/api/v1/style/analyze", async (c) => {
    const { text, sourceName } = await c.req.json<{ text: string; sourceName: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    try {
      const { analyzeStyle } = await import("@actalk/inkos-core");
      const profile = analyzeStyle(text, sourceName ?? "unknown");
      return c.json(profile);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Style Import to Book ---

  app.post("/api/v1/books/:id/style/import", async (c) => {
    const id = c.req.param("id");
    const { text, sourceName } = await c.req.json<{ text: string; sourceName: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    broadcast("style:start", { bookId: id });
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      const result = await pipeline.generateStyleGuide(id, text, sourceName ?? "unknown");
      broadcast("style:complete", { bookId: id });
      return c.json({ ok: true, result });
    } catch (e) {
      broadcast("style:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Import Chapters ---

  app.post("/api/v1/books/:id/import/chapters", async (c) => {
    const id = c.req.param("id");
    const { text, splitRegex } = await c.req.json<{ text: string; splitRegex?: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    broadcast("import:start", { bookId: id, type: "chapters" });
    try {
      const { splitChapters } = await import("@actalk/inkos-core");
      const chapters = [...splitChapters(text, splitRegex)];

      const pipeline = new PipelineRunner(await buildPipelineConfig());
      const result = await pipeline.importChapters({ bookId: id, chapters });
      broadcast("import:complete", { bookId: id, type: "chapters", count: result.importedCount });
      return c.json(result);
    } catch (e) {
      broadcast("import:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Import Canon ---

  app.post("/api/v1/books/:id/import/canon", async (c) => {
    const id = c.req.param("id");
    const { fromBookId } = await c.req.json<{ fromBookId: string }>();
    if (!fromBookId) return c.json({ error: "fromBookId is required" }, 400);

    broadcast("import:start", { bookId: id, type: "canon" });
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      await pipeline.importCanon(id, fromBookId);
      broadcast("import:complete", { bookId: id, type: "canon" });
      return c.json({ ok: true });
    } catch (e) {
      broadcast("import:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Fanfic Init ---

  app.post("/api/v1/fanfic/init", async (c) => {
    const body = await c.req.json<{
      title: string; sourceText: string; sourceName?: string;
      mode?: string; genre?: string; platform?: string;
      targetChapters?: number; chapterWordCount?: number; language?: string;
    }>();
    if (!body.title || !body.sourceText) {
      return c.json({ error: "title and sourceText are required" }, 400);
    }

    const now = new Date().toISOString();
    const bookId = deriveBookIdFromTitle(body.title) || `book-${Date.now().toString(36)}`;

    const bookConfig = {
      id: bookId,
      title: body.title,
      platform: (body.platform ?? "other") as "other",
      genre: (body.genre ?? "other") as "xuanhuan",
      status: "outlining" as const,
      targetChapters: body.targetChapters ?? 100,
      chapterWordCount: body.chapterWordCount ?? 3000,
      fanficMode: (body.mode ?? "canon") as "canon",
      ...(body.language ? { language: body.language as "zh" | "en" | "ko" } : {}),
      createdAt: now,
      updatedAt: now,
    };

    broadcast("fanfic:start", { bookId, title: body.title });
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      await pipeline.initFanficBook(bookConfig, body.sourceText, body.sourceName ?? "source", (body.mode ?? "canon") as "canon");
      broadcast("fanfic:complete", { bookId });
      return c.json({ ok: true, bookId });
    } catch (e) {
      broadcast("fanfic:error", { bookId, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Fanfic Show (read canon) ---

  app.get("/api/v1/books/:id/fanfic", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);
    try {
      const content = await readFile(join(bookDir, "story", "fanfic_canon.md"), "utf-8");
      return c.json({ bookId: id, content });
    } catch {
      return c.json({ bookId: id, content: null });
    }
  });

  // --- Fanfic Refresh ---

  app.post("/api/v1/books/:id/fanfic/refresh", async (c) => {
    const id = c.req.param("id");
    const { sourceText, sourceName } = await c.req.json<{ sourceText: string; sourceName?: string }>();
    if (!sourceText?.trim()) return c.json({ error: "sourceText is required" }, 400);

    broadcast("fanfic:refresh:start", { bookId: id });
    try {
      const book = await state.loadBookConfig(id);
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      await pipeline.importFanficCanon(id, sourceText, sourceName ?? "source", (book.fanficMode ?? "canon") as "canon");
      broadcast("fanfic:refresh:complete", { bookId: id });
      return c.json({ ok: true });
    } catch (e) {
      broadcast("fanfic:refresh:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Radar Scan ---

  app.post("/api/v1/radar/scan", async (c) => {
    broadcast("radar:start", {});
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      const result = await pipeline.runRadar();
      broadcast("radar:complete", { result });
      return c.json(result);
    } catch (e) {
      broadcast("radar:error", { error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Doctor (environment health check) ---

  app.get("/api/v1/doctor", async (c) => {
    const { existsSync } = await import("node:fs");
    const { GLOBAL_ENV_PATH } = await import("@actalk/inkos-core");
    const booksDirPath = join(root, "books");
    const rawConfig = await loadRawConfig(root).catch(() => ({} as Record<string, unknown>));
    const llmConfig = (rawConfig.llm as Record<string, unknown> | undefined) ?? {};
    const hasStudioModelConfig = typeof llmConfig.service === "string" && typeof llmConfig.defaultModel === "string";

    const checks = {
      inkosJson: existsSync(join(root, "inkos.json")),
      projectEnv: existsSync(join(root, ".env")) || hasStudioModelConfig,
      globalEnv: existsSync(GLOBAL_ENV_PATH) || hasStudioModelConfig,
      booksDir: existsSync(booksDirPath),
      llmConnected: hasStudioModelConfig,
      bookCount: 0,
    };

    if (!checks.booksDir) {
      try {
        await mkdir(booksDirPath, { recursive: true });
        checks.booksDir = true;
      } catch {
        // Leave failed if the directory cannot be created.
      }
    }

    try {
      const books = await state.listBooks();
      checks.bookCount = books.length;
    } catch { /* ignore */ }

    return c.json(checks);
  });

  return app;
}

// --- Standalone runner ---

export async function startStudioServer(
  root: string,
  port = 4567,
  options?: { readonly staticDir?: string },
): Promise<void> {
  const config = await loadProjectConfig(root, { consumer: "studio", requireApiKey: false });

  const app = createStudioServer(config, root);

  // Serve frontend static files — single process for API + frontend
  if (options?.staticDir) {
    const { readFile: readFileFs } = await import("node:fs/promises");
    const { join: joinPath } = await import("node:path");
    const { existsSync } = await import("node:fs");

    // Serve static assets (js, css, etc.)
    app.get("/assets/*", async (c) => {
      const filePath = joinPath(options.staticDir!, c.req.path);
      try {
        const content = await readFileFs(filePath);
        const ext = filePath.split(".").pop() ?? "";
        const contentTypes: Record<string, string> = {
          js: "application/javascript",
          css: "text/css",
          svg: "image/svg+xml",
          png: "image/png",
          ico: "image/x-icon",
          json: "application/json",
        };
        return new Response(content, {
          headers: { "Content-Type": contentTypes[ext] ?? "application/octet-stream" },
        });
      } catch {
        return c.notFound();
      }
    });

    // SPA fallback — serve index.html for all non-API routes
    const indexPath = joinPath(options.staticDir!, "index.html");
    if (existsSync(indexPath)) {
      const indexHtml = await readFileFs(indexPath, "utf-8");
      app.get("*", (c) => {
        if (c.req.path.startsWith("/api/v1/")) return c.notFound();
        return c.html(indexHtml);
      });
    }
  }

  console.log(`InkOS Studio running on http://localhost:${port}`);
  serve({ fetch: app.fetch, port });
}
