import { getModel } from "@mariozechner/pi-ai";
import type { Model, Api } from "@mariozechner/pi-ai";
import { resolveServicePiProvider, resolveServicePreset } from "./service-presets.js";
import { getServiceApiKey } from "./secrets.js";

export interface ResolvedModel {
  model: Model<Api>;
  apiKey: string;
  writingTemperature?: number;
  temperatureRange?: [number, number];
  temperatureHint?: string;
}

export async function resolveServiceModel(
  service: string,
  modelId: string,
  projectRoot: string,
  customBaseUrl?: string,
  customApiFormat?: "chat" | "responses",
): Promise<ResolvedModel> {
  // Resolve API key
  const apiKey = await getServiceApiKey(projectRoot, service);
  if (!apiKey) {
    throw new Error(
      `API key not found for service "${service}". Add it in .inkos/secrets.json or set the environment variable.`,
    );
  }

  // Determine pi-ai provider
  const baseService = service.startsWith("custom:") ? "custom" : service;
  const preset = resolveServicePreset(baseService);
  const piProvider = resolveServicePiProvider(baseService) ?? "openai";
  const apiType = service.startsWith("custom:")
    ? (customApiFormat === "responses" ? "openai-responses" : "openai-completions")
    : (preset?.api ?? "openai-completions");
  const configuredBaseUrl = customBaseUrl ?? preset?.baseUrl ?? "";

  // Get pi-ai Model — may return undefined for model IDs not in the built-in registry
  const piModel = getModel(piProvider as any, modelId as any) as Model<Api> | undefined;
  const effectiveBaseUrl = configuredBaseUrl || piModel?.baseUrl || "";
  if (!effectiveBaseUrl) {
    throw new Error(
      `Cannot resolve model "${modelId}" for service "${service}": no baseUrl available.`,
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
    contextWindow: piModel?.contextWindow ?? 0,
    maxTokens: piModel?.maxTokens ?? 16384,
  };

  return {
    model,
    apiKey,
    writingTemperature: preset?.writingTemperature,
    temperatureRange: preset?.temperatureRange,
    temperatureHint: preset?.temperatureHint,
  };
}
