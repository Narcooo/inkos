import { getModel } from "@mariozechner/pi-ai";
import type { Model, Api } from "@mariozechner/pi-ai";
import { resolveServicePiProvider, resolveServicePreset } from "./service-presets.js";
import { getServiceApiKey } from "./secrets.js";
import { getEndpoint } from "./providers/index.js";
import { lookupModel } from "./providers/lookup.js";
import { resolveChatCompat } from "./model-request-capabilities.js";
import { isApiKeyOptionalForEndpoint } from "../utils/llm-endpoint-auth.js";
import { toPiApi, type LLMApiFormat } from "./api-format.js";

export interface ResolvedModel {
  model: Model<Api>;
  apiKey: string;
  writingTemperature?: number;
  temperatureRange?: readonly [number, number];
  temperatureHint?: string;
}

export class ServiceApiKeyNotFoundError extends Error {
  constructor(readonly service: string) {
    super(`API key not found for service "${service}". Add it in .inkos/secrets.json or set the environment variable.`);
    this.name = "ServiceApiKeyNotFoundError";
  }
}

export async function resolveServiceModel(
  service: string,
  modelId: string,
  projectRoot: string,
  customBaseUrl?: string,
  customApiFormat?: LLMApiFormat,
): Promise<ResolvedModel> {
  // Determine pi-ai provider
  const baseService = service.startsWith("custom:") ? "custom" : service;
  const preset = resolveServicePreset(baseService);
  const endpoint = getEndpoint(baseService);
  const piProvider = baseService === "ollama"
    ? "ollama"
    : service.startsWith("custom:") && customApiFormat === "anthropic"
      ? "anthropic"
      : resolveServicePiProvider(baseService) ?? "openai";
  const apiType = service.startsWith("custom:")
    ? toPiApi(customApiFormat ?? "chat")
    : (preset?.api ?? "openai-completions");
  const configuredBaseUrl = customBaseUrl ?? preset?.baseUrl ?? "";
  const endpointModel = lookupModel(baseService, modelId);

  // Get pi-ai Model — may return undefined for model IDs not in the built-in registry
  const piModel = getModel(piProvider as any, modelId as any) as Model<Api> | undefined;
  const effectiveBaseUrl = configuredBaseUrl || piModel?.baseUrl || "";
  const compat = apiType === "openai-completions"
    ? resolveChatCompat(endpoint?.compat)
    : undefined;

  if (!effectiveBaseUrl) {
    throw new Error(
      `Cannot resolve model "${modelId}" for service "${service}": no baseUrl available.`,
    );
  }

  // Resolve API key after baseUrl/provider are known so local/self-hosted endpoints
  // such as Ollama can be used without forcing a fake secret.
  const apiKey = await getServiceApiKey(projectRoot, service);
  if (!apiKey && !isApiKeyOptionalForEndpoint({ provider: preset?.providerFamily, baseUrl: effectiveBaseUrl })) {
    throw new ServiceApiKeyNotFoundError(service);
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
