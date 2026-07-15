/**
 * AgnesAI
 *
 * - GitHub: https://github.com/AgnesAI-Labs/AgnesAI-Models
 * - OpenAI-compatible base URL: https://apihub.agnes-ai.com/v1
 *
 * AgnesAI exposes chat and image-generation models from the same OpenAI-compatible
 * gateway. Text-capable models are enabled for Studio model selection; image-only
 * models are listed as nonText so they can be used by cover generation without
 * polluting chat model menus.
 */
import type { InkosEndpoint } from "../types.js";

export const AGNESAI: InkosEndpoint = {
  id: "agnesai",
  label: "AgnesAI",
  group: "china",
  api: "openai-completions",
  baseUrl: "https://apihub.agnes-ai.com/v1",
  modelsBaseUrl: "https://apihub.agnes-ai.com/v1",
  checkModel: "agnes-2.0-flash",
  models: [
    { id: "agnes-2.0-flash", maxOutput: 8192, contextWindowTokens: 1_000_000, enabled: true },
    { id: "agnes-1.5-flash", maxOutput: 8192, contextWindowTokens: 1_000_000, enabled: true },
    {
      id: "agnes-image-2.1-flash",
      maxOutput: 1,
      contextWindowTokens: 1,
      enabled: false,
      status: "nonText",
      capabilities: { text: false, imageOutput: true },
    },
    {
      id: "agnes-image-2.0-flash",
      maxOutput: 1,
      contextWindowTokens: 1,
      enabled: false,
      status: "nonText",
      capabilities: { text: false, imageOutput: true },
    },
    {
      id: "agnes-video-v2.0",
      maxOutput: 1,
      contextWindowTokens: 1,
      enabled: false,
      status: "nonText",
    },
  ],
};
