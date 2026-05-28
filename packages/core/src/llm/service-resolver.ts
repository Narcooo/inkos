import { getModel } from "@mariozechner/pi-ai";
import type { Model, Api } from "@mariozechner/pi-ai";
import { resolveServicePiProvider, resolveServicePreset } from "./service-presets.js";
import { getServiceApiKey } from "./secrets.js";
import { getEndpoint } from "./providers/index.js";
import type { InkosEndpoint } from "./providers/types.js";
import { isApiKeyOptionalForEndpoint } from "../utils/llm-endpoint-auth.js";
import { isCodexOAuthService } from "./codex-oauth.js";

export interface ResolvedModel {
  model: Model<Api>;
  apiKey: string;
  writingTemperature?: number;
  temperatureRange?: readonly [number, number];
  temperatureHint?: string;
}

function resolveProviderCompat(
  provider: InkosEndpoint | undefined,
  baseUrl: string,
): Record<string, unknown> | undefined {
  const compat = {
    ...(provider?.compat ?? {}),
    ...(baseUrl.includes("generativelanguage.googleapis.com") ? { supportsStore: false } : {}),
  };
  return Object.keys(compat).length > 0 ? compat : undefined;
}

export async function resolveServiceModel(
  service: string,
  modelId: string,
  projectRoot: string,
  customBaseUrl?: string,
  customApiFormat?: "chat" | "responses",
): Promise<ResolvedModel> {
  // Determine pi-ai provider
  const baseService = service.startsWith("custom:") ? "custom" : service;
  const preset = resolveServicePreset(baseService);
  const endpoint = getEndpoint(baseService);
  const piProvider = baseService === "ollama" ? "ollama" : resolveServicePiProvider(baseService) ?? "openai";
  const apiType = service.startsWith("custom:")
    ? (customApiFormat === "responses" ? "openai-responses" : "openai-completions")
    : (preset?.api ?? "openai-completions");
  const configuredBaseUrl = customBaseUrl ?? preset?.baseUrl ?? "";
  const endpointModel = baseService === "minimax"
    ? endpoint?.models.find((model) => model.id === modelId || model.deploymentName === modelId)
    : undefined;

  // Get pi-ai Model — may return undefined for model IDs not in the built-in registry
  const piModel = getModel(piProvider as any, modelId as any) as Model<Api> | undefined;
  const effectiveBaseUrl = configuredBaseUrl || piModel?.baseUrl || "";
  const compat = apiType === "openai-completions"
    ? resolveProviderCompat(endpoint, effectiveBaseUrl)
    : undefined;

  if (!effectiveBaseUrl) {
    throw new Error(
      `Cannot resolve model "${modelId}" for service "${service}": no baseUrl available.`,
    );
  }

  // Resolve API key after baseUrl/provider are known so local/self-hosted endpoints
  // such as Ollama can be used without forcing a fake secret.
  const apiKey = await getServiceApiKey(projectRoot, service);
  if (!apiKey && !isCodexOAuthService(baseService) && !isApiKeyOptionalForEndpoint({ provider: preset?.providerFamily, baseUrl: effectiveBaseUrl })) {
    throw new Error(
      `API key not found for service "${service}". Add it in .inkos/secrets.json or set the environment variable.`,
    );
  }

  const model: Model<Api> = {
    id: modelId,
    name: piModel?.name ?? modelId,
    api: apiType as Api,
    provider: piProvider,
    baseUrl: effectiveBaseUrl,
    reasoning: piModel?.reasoning ?? false,
    input: piModel?.input ?? ["text"] as ("text" | "image")[],
    cost: piModel?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: endpointModel?.contextWindowTokens ?? piModel?.contextWindow ?? 0,
    maxTokens: endpointModel?.maxOutput ?? piModel?.maxTokens ?? 16384,
    ...(compat ? { compat: compat as Model<Api>["compat"] } : {}),
  };

  return {
    model,
    apiKey: apiKey ?? "",
    writingTemperature: preset?.writingTemperature,
    temperatureRange: preset?.temperatureRange,
    temperatureHint: preset?.temperatureHint,
  };
}
