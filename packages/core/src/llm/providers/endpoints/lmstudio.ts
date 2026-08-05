/**
 * LM Studio local OpenAI-compatible server.
 *
 * The desktop app serves chat completions and the dynamic model catalog under
 * http://localhost:1234/v1 by default. Authentication is optional and can be
 * enabled in LM Studio's server settings.
 */
import type { InkosEndpoint } from "../types.js";

export const LMSTUDIO: InkosEndpoint = {
  id: "lmstudio",
  label: "LM Studio (本地)",
  group: "local",
  api: "openai-completions",
  baseUrl: "http://localhost:1234/v1",
  modelsBaseUrl: "http://localhost:1234/v1",
  transportDefaults: {
    apiFormat: "chat",
    stream: true,
  },
  // LM Studio exposes the models installed by the user through /v1/models.
  models: [],
};
