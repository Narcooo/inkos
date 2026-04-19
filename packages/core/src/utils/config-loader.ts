import { readFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ProjectConfigSchema, type ProjectConfig } from "../models/project.js";
import { getServiceApiKey } from "../llm/secrets.js";
import { resolveServicePreset, resolveServiceProviderFamily } from "../llm/service-presets.js";

export const GLOBAL_CONFIG_DIR = join(homedir(), ".inkos");
export const GLOBAL_ENV_PATH = join(GLOBAL_CONFIG_DIR, ".env");

interface ServiceConfigEntry {
  readonly service: string;
  readonly name?: string;
  readonly baseUrl?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly apiFormat?: "chat" | "responses";
  readonly stream?: boolean;
}

type LLMConfigSource = "env" | "studio";

export function isApiKeyOptionalForEndpoint(params: {
  readonly provider?: string | undefined;
  readonly baseUrl?: string | undefined;
}): boolean {
  if (params.provider === "anthropic") {
    return false;
  }
  if (!params.baseUrl) {
    return false;
  }

  try {
    const url = new URL(params.baseUrl);
    const hostname = url.hostname.toLowerCase();

    return (
      hostname === "localhost"
      || hostname === "127.0.0.1"
      || hostname === "::1"
      || hostname === "0.0.0.0"
      || hostname === "host.docker.internal"
      || hostname.endsWith(".local")
      || isPrivateIpv4(hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Load project config from inkos.json with .env overrides.
 * Shared by CLI and Studio — single source of truth for config loading.
 */
export async function loadProjectConfig(
  root: string,
  options?: { readonly requireApiKey?: boolean },
): Promise<ProjectConfig> {
  // Load global ~/.inkos/.env first, then project .env overrides
  const { config: loadEnv } = await import("dotenv");
  loadEnv({ path: GLOBAL_ENV_PATH });
  loadEnv({ path: join(root, ".env"), override: true });

  const configPath = join(root, "inkos.json");

  try {
    await access(configPath);
  } catch {
    throw new Error(
      `inkos.json not found in ${root}.\nMake sure you are inside an InkOS project directory (cd into the project created by 'inkos init').`,
    );
  }

  const raw = await readFile(configPath, "utf-8");

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(raw);
  } catch {
    throw new Error(`inkos.json in ${root} is not valid JSON. Check the file for syntax errors.`);
  }

  // llm.configSource controls whether INKOS_LLM_* env vars override project config
  const env = process.env;
  const llm = (config.llm ?? {}) as Record<string, unknown>;
  const configSource = resolveConfigSource(llm.configSource);
  llm.configSource = configSource;

  const normalizedServices = normalizeServiceEntries(llm.services);
  if (normalizedServices.length > 0) {
    llm.services = normalizedServices;

    const selectedEntry = selectServiceEntry(normalizedServices, llm.service);
    const selectedServiceId = selectedEntry ? serviceEntryKey(selectedEntry) : undefined;

    if (selectedEntry) {
      llm.service = selectedEntry.service;

      if (!(typeof llm.model === "string" && llm.model.length > 0) && typeof llm.defaultModel === "string" && llm.defaultModel.length > 0) {
        llm.model = llm.defaultModel;
      }

      if (!(typeof llm.baseUrl === "string" && llm.baseUrl.length > 0)) {
        llm.baseUrl = selectedEntry.baseUrl ?? resolveServicePreset(selectedEntry.service)?.baseUrl ?? "";
      }

      if (!(typeof llm.provider === "string" && llm.provider.length > 0)) {
        llm.provider = deriveProviderFromService(selectedEntry.service);
      }

      if (llm.temperature === undefined && selectedEntry.temperature !== undefined) {
        llm.temperature = selectedEntry.temperature;
      }

      if (llm.maxTokens === undefined && selectedEntry.maxTokens !== undefined) {
        llm.maxTokens = selectedEntry.maxTokens;
      }

      if (selectedEntry.apiFormat !== undefined) {
        llm.apiFormat = selectedEntry.apiFormat;
      }

      if (selectedEntry.stream !== undefined) {
        llm.stream = selectedEntry.stream;
      }

      if (selectedServiceId && (configSource !== "env" || !env.INKOS_LLM_API_KEY)) {
        const secretApiKey = await getServiceApiKey(root, selectedServiceId);
        if (secretApiKey) {
          llm.apiKey = secretApiKey;
        }
      }
    }
  }

  const shouldBootstrapStudioFallbackToEnv = configSource === "studio"
    && normalizedServices.length === 0
    && !(typeof llm.apiKey === "string" && llm.apiKey.length > 0)
    && !(typeof llm.model === "string" && llm.model.length > 0)
    && !(typeof llm.baseUrl === "string" && llm.baseUrl.length > 0);

  if (configSource === "env" || shouldBootstrapStudioFallbackToEnv) {
    if (env.INKOS_LLM_PROVIDER) llm.provider = env.INKOS_LLM_PROVIDER;
    if (env.INKOS_LLM_BASE_URL) llm.baseUrl = env.INKOS_LLM_BASE_URL;
    if (env.INKOS_LLM_MODEL) llm.model = env.INKOS_LLM_MODEL;
    if (env.INKOS_LLM_TEMPERATURE) llm.temperature = parseFloat(env.INKOS_LLM_TEMPERATURE);
    if (env.INKOS_LLM_MAX_TOKENS) llm.maxTokens = parseInt(env.INKOS_LLM_MAX_TOKENS, 10);
    if (env.INKOS_LLM_THINKING_BUDGET) llm.thinkingBudget = parseInt(env.INKOS_LLM_THINKING_BUDGET, 10);
  }
  // Extra params from env: INKOS_LLM_EXTRA_<key>=<value>
  const extraFromEnv: Record<string, unknown> = {};
  if (configSource === "env" || shouldBootstrapStudioFallbackToEnv) {
    for (const [key, value] of Object.entries(env)) {
      if (key.startsWith("INKOS_LLM_EXTRA_") && value) {
        const paramName = key.slice("INKOS_LLM_EXTRA_".length);
        // Auto-coerce: numbers, booleans, JSON objects
        if (/^\d+(\.\d+)?$/.test(value)) extraFromEnv[paramName] = parseFloat(value);
        else if (value === "true") extraFromEnv[paramName] = true;
        else if (value === "false") extraFromEnv[paramName] = false;
        else if (value.startsWith("{") || value.startsWith("[")) {
          try { extraFromEnv[paramName] = JSON.parse(value); } catch { extraFromEnv[paramName] = value; }
        }
        else extraFromEnv[paramName] = value;
      }
    }
  }
  if (Object.keys(extraFromEnv).length > 0) {
    llm.extra = { ...(llm.extra as Record<string, unknown> ?? {}), ...extraFromEnv };
  }
  if ((configSource === "env" || shouldBootstrapStudioFallbackToEnv) && env.INKOS_LLM_API_FORMAT) llm.apiFormat = env.INKOS_LLM_API_FORMAT;
  config.llm = llm;

  // Global language override
  if (env.INKOS_DEFAULT_LANGUAGE) config.language = env.INKOS_DEFAULT_LANGUAGE;

  // API key ONLY from env — never stored in inkos.json
  const apiKey = (configSource === "env" || shouldBootstrapStudioFallbackToEnv)
    ? env.INKOS_LLM_API_KEY || (typeof llm.apiKey === "string" ? llm.apiKey : "")
    : (typeof llm.apiKey === "string" ? llm.apiKey : "");
  const provider = typeof llm.provider === "string" ? llm.provider : undefined;
  const baseUrl = typeof llm.baseUrl === "string" ? llm.baseUrl : undefined;
  const apiKeyOptional = isApiKeyOptionalForEndpoint({ provider, baseUrl });

  if (!apiKey && options?.requireApiKey !== false && !apiKeyOptional) {
    throw new Error(
      "INKOS_LLM_API_KEY not set. Run 'inkos config set-global' or add it to project .env file.",
    );
  }
  if (options?.requireApiKey === false) {
    llm.provider = typeof llm.provider === "string" && llm.provider.length > 0
      ? llm.provider
      : "openai";
    llm.baseUrl = typeof llm.baseUrl === "string" && llm.baseUrl.length > 0
      ? llm.baseUrl
      : "https://example.invalid/v1";
    llm.model = typeof llm.model === "string" && llm.model.length > 0
      ? llm.model
      : "noop-model";
  }
  llm.apiKey = apiKey ?? "";

  return ProjectConfigSchema.parse(config);
}

function resolveConfigSource(value: unknown): LLMConfigSource {
  return value === "studio" ? "studio" : "env";
}

function normalizeServiceEntries(raw: unknown): ServiceConfigEntry[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({
        service: typeof entry.service === "string" && entry.service.length > 0 ? entry.service : "custom",
        ...(typeof entry.name === "string" && entry.name.length > 0 ? { name: entry.name } : {}),
        ...(typeof entry.baseUrl === "string" && entry.baseUrl.length > 0 ? { baseUrl: entry.baseUrl } : {}),
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
      ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
      ...(typeof value.maxTokens === "number" ? { maxTokens: value.maxTokens } : {}),
      ...(value.apiFormat === "chat" || value.apiFormat === "responses" ? { apiFormat: value.apiFormat } : {}),
      ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
    };
  }

  return {
    service: serviceId,
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
    return services.find((entry) => entry.service === configuredService || serviceEntryKey(entry) === configuredService) ?? services[0];
  }
  return services[0];
}

function serviceEntryKey(entry: ServiceConfigEntry): string {
  return entry.service === "custom" ? `custom:${entry.name ?? "Custom"}` : entry.service;
}

function deriveProviderFromService(service: string): "anthropic" | "openai" | "custom" {
  if (service === "custom") return "custom";
  return resolveServiceProviderFamily(service) ?? "openai";
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((segment) => Number.parseInt(segment, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  if (parts[0] === 10) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}
