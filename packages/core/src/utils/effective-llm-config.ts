import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ProjectConfigSchema, type LLMConfig, type ProjectConfig } from "../models/project.js";
import { loadSecrets } from "../llm/secrets.js";
import { getEndpoint } from "../llm/providers/index.js";
import { guessServiceFromBaseUrl, resolveServicePreset, resolveServiceProviderFamily } from "../llm/service-presets.js";
import { isApiKeyOptionalForEndpoint } from "./llm-endpoint-auth.js";
import { cliOverlayEnv, legacyEnv, studioIgnoredEnv, type LLMEnvLayers, type LLMEnvMap } from "./llm-env.js";

export type LLMConsumer = "studio" | "cli" | "daemon" | "deploy";
export type LLMConfigMode = "studio-project" | "cli-project" | "legacy-env";
export type LLMValueSource = "project" | "studio-secret" | "env" | "cli" | "default";

export interface LLMConfigCliOverrides {
  readonly service?: string;
  readonly model?: string;
  readonly apiKeyEnv?: string;
  readonly baseUrl?: string;
  readonly apiFormat?: "chat" | "responses";
  readonly stream?: boolean;
}

export interface ResolveEffectiveLLMConfigInput {
  readonly consumer: LLMConsumer;
  readonly projectRoot: string;
  readonly envLayers: LLMEnvLayers;
  readonly cli?: LLMConfigCliOverrides;
  readonly requireApiKey?: boolean;
}

export interface EffectiveLLMDiagnostics {
  readonly configMode: LLMConfigMode;
  readonly serviceSource: LLMValueSource;
  readonly modelSource: LLMValueSource;
  readonly apiKeySource: LLMValueSource;
  readonly warnings: readonly string[];
}

export interface EffectiveLLMConfigResult {
  readonly config: ProjectConfig;
  readonly llm: LLMConfig;
  readonly diagnostics: EffectiveLLMDiagnostics;
}

interface ServiceConfigEntry {
  readonly service: string;
  readonly name?: string;
  readonly baseUrl?: string;
  readonly models?: readonly string[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly apiFormat?: "chat" | "responses";
  readonly stream?: boolean;
}

interface MutableDiagnostics {
  configMode: LLMConfigMode;
  serviceSource: LLMValueSource;
  modelSource: LLMValueSource;
  apiKeySource: LLMValueSource;
  warnings: string[];
}

export async function resolveEffectiveLLMConfig(
  input: ResolveEffectiveLLMConfigInput,
): Promise<EffectiveLLMConfigResult> {
  const config = await readProjectConfig(input.projectRoot);
  const llm = { ...((config.llm ?? {}) as Record<string, unknown>) };
  const services = normalizeServiceEntries(llm.services);
  const configMode = resolveConfigMode(input.consumer, llm.configSource, services);
  const diagnostics: MutableDiagnostics = {
    configMode,
    serviceSource: "project",
    modelSource: "project",
    apiKeySource: "project",
    warnings: [],
  };

  if (services.length > 0) {
    llm.services = services;
  }

  if (configMode === "studio-project") {
    warnIfStudioIgnoresEnv(input.envLayers, diagnostics);
    warnIfStaleTopLevel(llm, services, diagnostics);
    await applyProjectServiceConfig(config, llm, services, input.projectRoot, diagnostics, {
      requireApiKey: input.requireApiKey,
      ignoreTopLevelModel: services.length > 0,
    });
  } else if (configMode === "cli-project") {
    await applyCliProjectConfig(config, llm, services, input, diagnostics);
  } else {
    await applyLegacyEnvConfig(config, llm, input, diagnostics);
  }

  if (input.requireApiKey === false) {
    fillNoopLLMDefaults(llm);
  }

  const provider = typeof llm.provider === "string" ? llm.provider : undefined;
  const baseUrl = typeof llm.baseUrl === "string" ? llm.baseUrl : undefined;
  const apiKey = typeof llm.apiKey === "string" ? llm.apiKey : "";
  if (!apiKey && input.requireApiKey !== false && !isApiKeyOptionalForEndpoint({ provider, baseUrl })) {
    throw new Error(
      configMode === "studio-project"
        ? "Studio LLM API key not set. Open Studio services and save an API key for the selected service."
        : "INKOS_LLM_API_KEY not set. Run 'inkos config set-global' or add it to project .env file.",
    );
  }

  llm.apiKey = apiKey;
  config.llm = llm;

  const parsed = ProjectConfigSchema.parse(config);
  return {
    config: parsed,
    llm: parsed.llm,
    diagnostics,
  };
}

async function readProjectConfig(root: string): Promise<Record<string, unknown>> {
  const configPath = join(root, "inkos.json");
  try {
    await access(configPath);
  } catch {
    throw new Error(
      `inkos.json not found in ${root}.\nMake sure you are inside an InkOS project directory (cd into the project created by 'inkos init').`,
    );
  }

  const raw = await readFile(configPath, "utf-8");
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`inkos.json in ${root} is not valid JSON. Check the file for syntax errors.`);
  }
}

function resolveConfigMode(
  consumer: LLMConsumer,
  source: unknown,
  services: readonly ServiceConfigEntry[],
): LLMConfigMode {
  if (consumer === "studio") return "studio-project";
  if (source === "env") return "legacy-env";
  if (source === "studio" || services.length > 0) return "cli-project";
  return "legacy-env";
}

async function applyProjectServiceConfig(
  config: Record<string, unknown>,
  llm: Record<string, unknown>,
  services: readonly ServiceConfigEntry[],
  projectRoot: string,
  diagnostics: MutableDiagnostics,
  options: {
    readonly requireApiKey?: boolean;
    readonly ignoreTopLevelModel: boolean;
    readonly requestedService?: string;
    readonly requestedModel?: string;
    readonly requestedModelSource?: LLMValueSource;
    readonly envApiKey?: string;
    readonly envBaseUrl?: string;
    readonly envProvider?: string;
    readonly cli?: LLMConfigCliOverrides;
    readonly env?: LLMEnvMap;
  },
): Promise<void> {
  llm.configSource = "studio";
  const selectedEntry = selectServiceEntry(services, options.requestedService ?? llm.service)
    ?? synthesizeServiceEntry(options.requestedService ?? llm.service);

  if (selectedEntry) {
    applyServiceEntry(llm, selectedEntry);
    diagnostics.serviceSource = options.requestedService ? diagnostics.serviceSource : "project";
  }

  const modelSource = options.requestedModel ? options.requestedModelSource ?? "env" : "project";
  const model = options.requestedModel
    ?? resolveServiceModel(
      selectedEntry,
      options.ignoreTopLevelModel ? undefined : stringValue(llm.model),
      stringValue(llm.defaultModel),
    );
  if (model) {
    assertModelBelongsToService(selectedEntry, model);
    llm.model = model;
    diagnostics.modelSource = modelSource;
  }

  if (options.envProvider) llm.provider = options.envProvider;
  if (options.envBaseUrl) llm.baseUrl = options.envBaseUrl;
  if (options.env) {
    applyCommonEnv(config, llm, options.env);
  }
  if (options.cli?.baseUrl) llm.baseUrl = options.cli.baseUrl;
  if (options.cli?.apiFormat) llm.apiFormat = options.cli.apiFormat;
  if (options.cli?.stream !== undefined) llm.stream = options.cli.stream;

  const serviceKey = selectedEntry ? serviceEntryKey(selectedEntry) : stringValue(llm.service);
  const secretApiKey = serviceKey ? await getStudioServiceApiKey(projectRoot, serviceKey) : "";
  const cliApiKey = options.cli?.apiKeyEnv ? options.env?.[options.cli.apiKeyEnv] ?? "" : "";
  const apiKey = cliApiKey || options.envApiKey || secretApiKey || "";
  llm.apiKey = apiKey;
  diagnostics.apiKeySource = cliApiKey
    ? "cli"
    : options.envApiKey
      ? "env"
      : secretApiKey
        ? "studio-secret"
        : "project";

}

async function applyCliProjectConfig(
  config: Record<string, unknown>,
  llm: Record<string, unknown>,
  services: readonly ServiceConfigEntry[],
  input: ResolveEffectiveLLMConfigInput,
  diagnostics: MutableDiagnostics,
): Promise<void> {
  const env = cliOverlayEnv(input.envLayers);
  const envBaseUrl = stringValue(env.INKOS_LLM_BASE_URL);
  const envService = stringValue(env.INKOS_LLM_SERVICE) ?? (envBaseUrl ? guessServiceFromBaseUrl(envBaseUrl) : undefined);
  const envModel = stringValue(env.INKOS_LLM_MODEL);
  const requestedService = input.cli?.service ?? envService;
  if (input.cli?.service) diagnostics.serviceSource = "cli";
  else if (envService) diagnostics.serviceSource = "env";

  const requestedModel = input.cli?.model ?? (input.cli?.service ? undefined : envModel);
  const requestedModelSource: LLMValueSource = input.cli?.model ? "cli" : !input.cli?.service && envModel ? "env" : "project";
  const allowEnvEndpointOverlay = !input.cli?.service;

  await applyProjectServiceConfig(config, llm, services, input.projectRoot, diagnostics, {
    requireApiKey: input.requireApiKey,
    ignoreTopLevelModel: true,
    requestedService,
    requestedModel,
    requestedModelSource,
    envApiKey: allowEnvEndpointOverlay ? stringValue(env.INKOS_LLM_API_KEY) : undefined,
    envBaseUrl: allowEnvEndpointOverlay ? envBaseUrl : undefined,
    envProvider: allowEnvEndpointOverlay ? stringValue(env.INKOS_LLM_PROVIDER) : undefined,
    cli: input.cli,
    env,
  });
}

async function applyLegacyEnvConfig(
  config: Record<string, unknown>,
  llm: Record<string, unknown>,
  input: ResolveEffectiveLLMConfigInput,
  diagnostics: MutableDiagnostics,
): Promise<void> {
  const env = legacyEnv(input.envLayers);
  llm.configSource = "env";

  if (env.INKOS_LLM_SERVICE) {
    llm.service = env.INKOS_LLM_SERVICE;
    diagnostics.serviceSource = "env";
  } else if (typeof llm.service !== "string" || llm.service.length === 0) {
    llm.service = "custom";
  }

  if (env.INKOS_LLM_PROVIDER) llm.provider = env.INKOS_LLM_PROVIDER;
  else if (typeof llm.provider !== "string" || llm.provider.length === 0) llm.provider = "custom";
  if (env.INKOS_LLM_BASE_URL) llm.baseUrl = env.INKOS_LLM_BASE_URL;
  if (env.INKOS_LLM_MODEL) {
    llm.model = env.INKOS_LLM_MODEL;
    diagnostics.modelSource = "env";
  }
  if (env.INKOS_LLM_API_KEY) {
    llm.apiKey = env.INKOS_LLM_API_KEY;
    diagnostics.apiKeySource = "env";
  } else if (typeof llm.apiKey !== "string") {
    llm.apiKey = "";
  }

  if (input.cli?.service) {
    const entry = synthesizeServiceEntry(input.cli.service);
    if (entry) {
      applyServiceEntry(llm, entry);
      if (!input.cli.model) {
        llm.model = resolveServiceModel(entry, undefined, stringValue(llm.defaultModel));
      }
    } else {
      llm.service = input.cli.service;
    }
    diagnostics.serviceSource = "cli";
  }
  if (input.cli?.model) {
    assertModelBelongsToService(synthesizeServiceEntry(stringValue(llm.service)), input.cli.model);
    llm.model = input.cli.model;
    diagnostics.modelSource = "cli";
  }
  if (input.cli?.baseUrl) llm.baseUrl = input.cli.baseUrl;
  if (input.cli?.apiFormat) llm.apiFormat = input.cli.apiFormat;
  if (input.cli?.stream !== undefined) llm.stream = input.cli.stream;
  if (input.cli?.apiKeyEnv) {
    llm.apiKey = env[input.cli.apiKeyEnv] ?? "";
    diagnostics.apiKeySource = "cli";
  }

  applyCommonEnv(config, llm, env);
  if (input.cli?.apiFormat) llm.apiFormat = input.cli.apiFormat;
  if (input.cli?.stream !== undefined) llm.stream = input.cli.stream;
}

function applyServiceEntry(llm: Record<string, unknown>, entry: ServiceConfigEntry): void {
  const endpoint = getEndpoint(entry.service);
  const transportDefaults = endpoint?.transportDefaults;
  llm.service = entry.service;
  llm.provider = deriveProviderFromService(entry.service);
  llm.baseUrl = entry.baseUrl ?? resolveServicePreset(entry.service)?.baseUrl ?? "";

  if (entry.temperature !== undefined) llm.temperature = entry.temperature;
  if (entry.apiFormat !== undefined) llm.apiFormat = entry.apiFormat;
  else if (transportDefaults?.apiFormat !== undefined) llm.apiFormat = transportDefaults.apiFormat;
  else llm.apiFormat = resolveServicePreset(entry.service)?.api.startsWith("openai-responses") ? "responses" : "chat";
  if (entry.stream !== undefined) llm.stream = entry.stream;
  else if (transportDefaults?.stream !== undefined) llm.stream = transportDefaults.stream;
}

function applyCommonEnv(
  config: Record<string, unknown>,
  llm: Record<string, unknown>,
  env: LLMEnvMap,
): void {
  if (env.INKOS_LLM_TEMPERATURE) llm.temperature = Number.parseFloat(env.INKOS_LLM_TEMPERATURE);
  if (env.INKOS_LLM_THINKING_BUDGET) llm.thinkingBudget = Number.parseInt(env.INKOS_LLM_THINKING_BUDGET, 10);
  if (env.INKOS_LLM_PROXY_URL) llm.proxyUrl = env.INKOS_LLM_PROXY_URL;
  if (env.INKOS_LLM_API_FORMAT) llm.apiFormat = env.INKOS_LLM_API_FORMAT;
  if (env.INKOS_LLM_STREAM) llm.stream = parseBoolean(env.INKOS_LLM_STREAM);
  if (env.INKOS_DEFAULT_LANGUAGE) config.language = env.INKOS_DEFAULT_LANGUAGE;

  const extraFromEnv: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("INKOS_LLM_EXTRA_") && value) {
      extraFromEnv[key.slice("INKOS_LLM_EXTRA_".length)] = parseEnvValue(value);
    }
  }
  if (Object.keys(extraFromEnv).length > 0) {
    llm.extra = { ...(objectValue(llm.extra)), ...extraFromEnv };
  }
}

async function getStudioServiceApiKey(projectRoot: string, serviceKey: string): Promise<string> {
  const secrets = await loadSecrets(projectRoot);
  return secrets.services[serviceKey]?.apiKey ?? "";
}

function normalizeServiceEntries(raw: unknown): ServiceConfigEntry[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({
        service: typeof entry.service === "string" && entry.service.length > 0 ? entry.service : "custom",
        ...(typeof entry.name === "string" && entry.name.length > 0 ? { name: entry.name } : {}),
        ...(typeof entry.baseUrl === "string" && entry.baseUrl.length > 0 ? { baseUrl: entry.baseUrl } : {}),
        ...(Array.isArray(entry.models) ? { models: normalizeModelIds(entry.models) } : {}),
        ...(typeof entry.temperature === "number" ? { temperature: entry.temperature } : {}),
        ...(typeof entry.maxTokens === "number" ? { maxTokens: entry.maxTokens } : {}),
        ...(entry.apiFormat === "chat" || entry.apiFormat === "responses" ? { apiFormat: entry.apiFormat } : {}),
        ...(typeof entry.stream === "boolean" ? { stream: entry.stream } : {}),
      }));
  }

  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, value]) => value && typeof value === "object")
      .map(([serviceId, value]) => normalizeServiceEntryFromPatch(serviceId, value as Record<string, unknown>));
  }

  return [];
}

function normalizeServiceEntryFromPatch(serviceId: string, value: Record<string, unknown>): ServiceConfigEntry {
  if (serviceId.startsWith("custom:")) {
    return {
      service: "custom",
      name: decodeURIComponent(serviceId.slice("custom:".length)),
      ...(typeof value.baseUrl === "string" && value.baseUrl.length > 0 ? { baseUrl: value.baseUrl } : {}),
      ...(Array.isArray(value.models) ? { models: normalizeModelIds(value.models) } : {}),
      ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
      ...(typeof value.maxTokens === "number" ? { maxTokens: value.maxTokens } : {}),
      ...(value.apiFormat === "chat" || value.apiFormat === "responses" ? { apiFormat: value.apiFormat } : {}),
      ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
    };
  }

  if (serviceId === "custom") {
    return {
      service: "custom",
      ...(typeof value.name === "string" && value.name.length > 0 ? { name: value.name } : {}),
      ...(typeof value.baseUrl === "string" && value.baseUrl.length > 0 ? { baseUrl: value.baseUrl } : {}),
      ...(Array.isArray(value.models) ? { models: normalizeModelIds(value.models) } : {}),
      ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
      ...(typeof value.maxTokens === "number" ? { maxTokens: value.maxTokens } : {}),
      ...(value.apiFormat === "chat" || value.apiFormat === "responses" ? { apiFormat: value.apiFormat } : {}),
      ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
    };
  }

  return {
    service: serviceId,
    ...(Array.isArray(value.models) ? { models: normalizeModelIds(value.models) } : {}),
    ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
    ...(typeof value.maxTokens === "number" ? { maxTokens: value.maxTokens } : {}),
    ...(value.apiFormat === "chat" || value.apiFormat === "responses" ? { apiFormat: value.apiFormat } : {}),
    ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
  };
}

function selectServiceEntry(
  services: readonly ServiceConfigEntry[],
  configuredService: unknown,
): ServiceConfigEntry | undefined {
  if (typeof configuredService === "string" && configuredService.length > 0) {
    return services.find((entry) => entry.service === configuredService || serviceEntryKey(entry) === configuredService)
      ?? synthesizeServiceEntry(configuredService);
  }
  return services[0];
}

function synthesizeServiceEntry(service: unknown): ServiceConfigEntry | undefined {
  if (typeof service !== "string" || service.length === 0) return undefined;
  if (service.startsWith("custom:")) {
    return { service: "custom", name: service.slice("custom:".length) || "Custom" };
  }
  if (service === "custom" || getEndpoint(service) || resolveServicePreset(service)) {
    return { service };
  }
  return undefined;
}

function resolveServiceModel(
  entry: ServiceConfigEntry | undefined,
  currentModel: string | undefined,
  defaultModel: string | undefined,
): string {
  if (!entry) return defaultModel || currentModel || "noop-model";
  if (entry.service === "custom") return defaultModel || currentModel || "noop-model";

  const endpoint = getEndpoint(entry.service);
  const candidate = [defaultModel, currentModel]
    .find((model): model is string => Boolean(model && modelBelongsToService(entry, model)));
  if (candidate) return candidate;

  return endpoint?.checkModel
    ?? endpoint?.models.find((model) => model.enabled !== false)?.id
    ?? defaultModel
    ?? currentModel
    ?? "noop-model";
}

function assertModelBelongsToService(entry: ServiceConfigEntry | undefined, model: string): void {
  if (!entry || entry.service === "custom") return;
  const endpoint = getEndpoint(entry.service);
  if (!endpoint) return;
  if (!modelBelongsToService(entry, model)) {
    throw new Error(`模型 ${model} 不属于 ${entry.service} 服务，请切换服务或选择该服务下的模型。`);
  }
}

function modelBelongsToService(entry: ServiceConfigEntry, model: string): boolean {
  if (entry.models?.some((knownModel) => knownModel.toLowerCase() === model.toLowerCase())) return true;
  if (serviceAllowsUnlistedModels(entry.service)) return true;
  const endpoint = getEndpoint(entry.service);
  if (!endpoint) return true;
  return endpoint.models.some((knownModel) => knownModel.id.toLowerCase() === model.toLowerCase());
}

function normalizeModelIds(value: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const models: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const model = item.trim();
    const key = model.toLowerCase();
    if (!model || seen.has(key)) continue;
    seen.add(key);
    models.push(model);
  }
  return models;
}

/**
 * 这些服务的可用模型清单是动态的，静态 bank 必然滞后，
 * 所以用户显式配置的模型 id 直接透传，不做 bank 白名单校验（issue #300）：
 * - ollama：本地装了什么模型就有什么模型
 * - lmstudio：本地装了什么模型就有什么模型
 * - openrouter：聚合 350+ 上游模型，上游随时增删，bank 只列常用子集
 * - newapi：自建中转网关，模型清单由部署方自定义，bank 为空
 * - kkaiapi：多家大模型的 OpenAI 兼容中转站，上游清单随时变化
 * - ppio：聚合平台，每周都有新模型 id，bank 只维护主流子集
 * - siliconcloud：聚合平台，新模型上架频繁，bank 只维护主流子集
 */
const SERVICES_WITH_DYNAMIC_MODELS: ReadonlySet<string> = new Set([
  "ollama",
  "lmstudio",
  "openrouter",
  "newapi",
  "kkaiapi",
  "ppio",
  "siliconcloud",
]);

function serviceAllowsUnlistedModels(service: string): boolean {
  return SERVICES_WITH_DYNAMIC_MODELS.has(service);
}

function serviceEntryKey(entry: ServiceConfigEntry): string {
  return entry.service === "custom" ? `custom:${entry.name ?? "Custom"}` : entry.service;
}

function deriveProviderFromService(service: string): "anthropic" | "openai" | "custom" {
  if (service === "custom") return "custom";
  return resolveServiceProviderFamily(service) ?? "openai";
}

function warnIfStudioIgnoresEnv(layers: LLMEnvLayers, diagnostics: MutableDiagnostics): void {
  const ignored = studioIgnoredEnv(layers);
  if (Object.keys(ignored).some((key) => key.startsWith("INKOS_LLM_"))) {
    diagnostics.warnings.push("Studio 运行时不会使用 env 中的 INKOS_LLM_* 配置；请在服务配置页保存 Studio 配置。");
  }
}

function warnIfStaleTopLevel(
  llm: Record<string, unknown>,
  services: readonly ServiceConfigEntry[],
  diagnostics: MutableDiagnostics,
): void {
  if (services.length === 0) return;
  if (["provider", "baseUrl", "model", "apiKey"].some((key) => typeof llm[key] === "string" && (llm[key] as string).length > 0)) {
    diagnostics.warnings.push("检测到旧顶层 LLM 配置；Studio 模式以选中的 service/defaultModel/secrets 为准。");
  }
}

function fillNoopLLMDefaults(llm: Record<string, unknown>): void {
  if (typeof llm.provider !== "string" || llm.provider.length === 0) llm.provider = "openai";
  if (typeof llm.baseUrl !== "string" || llm.baseUrl.length === 0) llm.baseUrl = "https://example.invalid/v1";
  if (typeof llm.model !== "string" || llm.model.length === 0) llm.model = "noop-model";
  if (typeof llm.apiKey !== "string") llm.apiKey = "";
}

function parseEnvValue(value: string): unknown {
  if (/^\d+(\.\d+)?$/.test(value)) return Number.parseFloat(value);
  if (value === "true") return true;
  if (value === "false") return false;
  if (value.startsWith("{") || value.startsWith("[")) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  return value;
}

function parseBoolean(value: string): boolean {
  return value === "true" || value === "1" || value === "yes";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
