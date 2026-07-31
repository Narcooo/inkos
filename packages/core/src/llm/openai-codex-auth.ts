import {
  loginOpenAICodex as loginWithPiAi,
  type OAuthCredentials,
  type OAuthPrompt,
} from "@mariozechner/pi-ai/oauth";

export const OPENAI_CODEX_SERVICE_ID = "openaiCodex";
export const OPENAI_CODEX_OAUTH_PROVIDER_ID = "openai-codex";
export const OPENAI_CODEX_DEFAULT_MODEL = "gpt-5.4";

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

export type { OAuthCredentials };
