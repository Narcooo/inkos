/**
 * Atlas Cloud
 *
 * OpenAI-compatible aggregator with live model discovery through /models.
 */
import type { InkosEndpoint } from "../types.js";

export const ATLASCLOUD: InkosEndpoint = {
  id: "atlascloud",
  label: "Atlas Cloud",
  group: "aggregator",
  api: "openai-completions",
  baseUrl: "https://api.atlascloud.ai/v1",
  modelsBaseUrl: "https://api.atlascloud.ai/v1",
  checkModel: "deepseek-ai/deepseek-v4-pro",
  temperatureRange: [0, 2],
  defaultTemperature: 0.7,
  writingTemperature: 1,
  models: [
    {
      id: "deepseek-ai/deepseek-v4-pro",
      maxOutput: 32768,
      contextWindowTokens: 1_000_000,
      enabled: true,
    },
  ],
};
