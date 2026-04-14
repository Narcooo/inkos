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

  // Get pi-ai Model
  const model = getModel(piProvider as any, modelId as any);

  return {
    model,
    apiKey,
    writingTemperature: preset?.writingTemperature,
    temperatureRange: preset?.temperatureRange,
    temperatureHint: preset?.temperatureHint,
  };
}
