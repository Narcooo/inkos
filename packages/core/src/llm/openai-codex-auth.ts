import {
  loginOpenAICodex as loginWithPiAi,
  type OAuthCredentials,
  type OAuthPrompt,
} from "@mariozechner/pi-ai/oauth";
import { Buffer } from "node:buffer";

export const OPENAI_CODEX_SERVICE_ID = "openaiCodex";
export const OPENAI_CODEX_OAUTH_PROVIDER_ID = "openai-codex";
export const OPENAI_CODEX_DEFAULT_MODEL = "gpt-5.6-sol";
export const OPENAI_CODEX_MODELS_URL = "https://chatgpt.com/backend-api/codex/models?client_version=1.0.0";
export const OPENAI_CODEX_FALLBACK_MODEL_IDS = [
  "gpt-5.6-sol",
  "gpt-5.6-sol-pro",
  "gpt-5.6-terra",
  "gpt-5.6-terra-pro",
  "gpt-5.6-luna",
  "gpt-5.6-luna-pro",
  "gpt-5.5",
  "gpt-5.4-mini",
  "gpt-5.4",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
] as const;

const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth";

export interface OpenAICodexLoginOptions {
  onAuth: (info: { url: string; instructions?: string }) => void;
  onPrompt: (prompt: OAuthPrompt) => Promise<string>;
  onProgress?: (message: string) => void;
  onManualCodeInput?: () => Promise<string>;
}

export async function loginOpenAICodex(
  options: OpenAICodexLoginOptions,
): Promise<OAuthCredentials> {
  return loginWithPiAi({ ...options, originator: "inkos" });
}

export function extractOpenAICodexAccountId(accessToken: string): string | null {
  try {
    const parts = accessToken.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as Record<string, unknown>;
    const auth = payload[OPENAI_AUTH_CLAIM];
    if (!auth || typeof auth !== "object") return null;
    const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
    return typeof accountId === "string" && accountId.trim() ? accountId.trim() : null;
  } catch {
    return null;
  }
}

export function addOpenAICodexForwardCompatibleModels(modelIds: readonly string[]): string[] {
  const result = Array.from(new Set(modelIds.map((id) => id.trim()).filter(Boolean)));
  const templates = new Set(result);
  if (["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"].some((id) => templates.has(id))) {
    for (const id of OPENAI_CODEX_FALLBACK_MODEL_IDS.slice(0, 6)) {
      if (!templates.has(id)) result.push(id);
    }
  }
  return result;
}

export async function listOpenAICodexModels(
  accessToken: string,
  options: { readonly fetchImpl?: typeof fetch; readonly timeoutMs?: number } = {},
): Promise<string[]> {
  const accountId = extractOpenAICodexAccountId(accessToken);
  if (!accountId) throw new Error("OpenAI Codex access token does not contain a ChatGPT account ID.");

  const response = await (options.fetchImpl ?? fetch)(OPENAI_CODEX_MODELS_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "ChatGPT-Account-Id": accountId,
      originator: "inkos",
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
  });
  if (!response.ok) {
    throw new Error(`OpenAI Codex model discovery failed: HTTP ${response.status}`);
  }

  const payload = await response.json() as { models?: unknown };
  const entries = Array.isArray(payload.models) ? payload.models : [];
  const visible = entries.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const slug = typeof item.slug === "string" ? item.slug.trim() : "";
    const visibility = typeof item.visibility === "string" ? item.visibility.trim().toLowerCase() : "";
    if (!slug || visibility === "hide" || visibility === "hidden") return [];
    return [{
      slug,
      priority: typeof item.priority === "number" && Number.isFinite(item.priority) ? item.priority : 10_000,
      index,
    }];
  });
  visible.sort((left, right) => left.priority - right.priority || left.index - right.index || left.slug.localeCompare(right.slug));
  return addOpenAICodexForwardCompatibleModels(visible.map((item) => item.slug));
}

export type { OAuthCredentials };
