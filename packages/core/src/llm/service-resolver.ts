import { getModel } from "@mariozechner/pi-ai";
import type { Model, Api } from "@mariozechner/pi-ai";
import { resolveServicePreset, SERVICE_TO_PI_PROVIDER } from "./service-presets.js";
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
  const piProvider = SERVICE_TO_PI_PROVIDER[baseService] ?? "openai";

  // Get pi-ai Model — may return undefined for model IDs not in the built-in registry
  let model = getModel(piProvider as any, modelId as any) as Model<Api> | undefined;

  if (!model) {
    // Construct a Model object from service preset for models not in pi-ai's registry
    const apiType = preset?.api ?? "openai-completions";
    const baseUrl = customBaseUrl ?? preset?.baseUrl ?? "";
    if (!baseUrl) {
      throw new Error(
        `Cannot resolve model "${modelId}" for service "${service}": no baseUrl available.`,
      );
    }
    model = {
      id: modelId,
      name: modelId,
      api: apiType as Api,
      provider: piProvider,
      baseUrl,
      reasoning: false,
      input: ["text"] as ("text" | "image")[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 0,
      maxTokens: 16384,
    };
  }

  return {
    model,
    apiKey,
    writingTemperature: preset?.writingTemperature,
    temperatureRange: preset?.temperatureRange,
    temperatureHint: preset?.temperatureHint,
  };
}
