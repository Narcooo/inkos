/**
 * Codex OAuth
 *
 * Uses the local Codex CLI ChatGPT OAuth login from CODEX_HOME/auth.json.
 * Runtime credentials stay outside project secrets.
 */
import { CODEX_OAUTH_BASE_URL } from "../../codex-oauth.js";
import type { InkosEndpoint } from "../types.js";

export const CODEX_OAUTH: InkosEndpoint = {
  id: "codexOAuth",
  label: "Codex OAuth",
  group: "local",
  authKind: "codexOAuth",
  api: "openai-codex-responses",
  baseUrl: CODEX_OAUTH_BASE_URL,
  checkModel: "gpt-5.5",
  temperatureRange: [0, 2],
  defaultTemperature: 1,
  writingTemperature: 1,
  transportDefaults: { apiFormat: "responses", stream: true },
  models: [
    { id: "gpt-5.5", maxOutput: 272000, contextWindowTokens: 272000, enabled: true },
  ],
};
