import type { InkosEndpoint } from "../types.js";
import { OPENAI_CODEX_DEFAULT_MODEL } from "../../openai-codex-auth.js";

export const OPENAI_CODEX: InkosEndpoint = {
  id: "openaiCodex",
  label: "OpenAI Codex (ChatGPT)",
  group: "overseas",
  api: "openai-codex-responses",
  baseUrl: "https://chatgpt.com/backend-api",
  checkModel: OPENAI_CODEX_DEFAULT_MODEL,
  temperatureRange: [0, 2],
  defaultTemperature: 1,
  writingTemperature: 1,
  transportDefaults: { apiFormat: "responses", stream: true },
  models: [
    { id: "gpt-5.6-sol", maxOutput: 128_000, contextWindowTokens: 1_050_000 },
    { id: "gpt-5.6-sol-pro", maxOutput: 128_000, contextWindowTokens: 1_050_000 },
    { id: "gpt-5.6-terra", maxOutput: 128_000, contextWindowTokens: 1_050_000 },
    { id: "gpt-5.6-terra-pro", maxOutput: 128_000, contextWindowTokens: 1_050_000 },
    { id: "gpt-5.6-luna", maxOutput: 128_000, contextWindowTokens: 400_000 },
    { id: "gpt-5.6-luna-pro", maxOutput: 128_000, contextWindowTokens: 400_000 },
    { id: "gpt-5.5", maxOutput: 128_000, contextWindowTokens: 1_000_000 },
    { id: "gpt-5.4-mini", maxOutput: 128_000, contextWindowTokens: 272_000 },
    { id: "gpt-5.4", maxOutput: 128_000, contextWindowTokens: 272_000 },
    { id: "gpt-5.3-codex", maxOutput: 128_000, contextWindowTokens: 272_000 },
    { id: "gpt-5.3-codex-spark", maxOutput: 128_000, contextWindowTokens: 128_000 },
  ],
};
