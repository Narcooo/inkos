import type { InkosEndpoint } from "../types.js";

export const OPENAI_CODEX: InkosEndpoint = {
  id: "openaiCodex",
  label: "OpenAI Codex (ChatGPT)",
  group: "overseas",
  api: "openai-codex-responses",
  baseUrl: "https://chatgpt.com/backend-api",
  checkModel: "gpt-5.4",
  temperatureRange: [0, 2],
  defaultTemperature: 1,
  writingTemperature: 1,
  transportDefaults: { apiFormat: "responses", stream: true },
  models: [
    { id: "gpt-5.1", maxOutput: 128_000, contextWindowTokens: 272_000 },
    { id: "gpt-5.1-codex-max", maxOutput: 128_000, contextWindowTokens: 272_000 },
    { id: "gpt-5.1-codex-mini", maxOutput: 128_000, contextWindowTokens: 272_000 },
    { id: "gpt-5.2", maxOutput: 128_000, contextWindowTokens: 272_000 },
    { id: "gpt-5.2-codex", maxOutput: 128_000, contextWindowTokens: 272_000 },
    { id: "gpt-5.3-codex", maxOutput: 128_000, contextWindowTokens: 272_000 },
    { id: "gpt-5.3-codex-spark", maxOutput: 128_000, contextWindowTokens: 128_000 },
    { id: "gpt-5.4", maxOutput: 128_000, contextWindowTokens: 272_000 },
    { id: "gpt-5.4-mini", maxOutput: 128_000, contextWindowTokens: 272_000 },
  ],
};
