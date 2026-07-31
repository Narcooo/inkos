export const COVER_PROVIDER_IDS = ["kkaiapi", "openai", "openaiCodex", "google"] as const;
export type CoverProviderId = typeof COVER_PROVIDER_IDS[number];

export interface CoverProviderPreset {
  readonly service: CoverProviderId;
  readonly label: string;
  readonly baseUrl: string;
  readonly api: "responses" | "codex-responses" | "images" | "gemini";
  readonly defaultModel: string;
  readonly models: readonly string[];
}

export const COVER_PROVIDER_PRESETS: readonly CoverProviderPreset[] = [
  {
    service: "kkaiapi",
    label: "kkaiapi",
    baseUrl: "https://api.kkaiapi.com/v1",
    api: "images",
    defaultModel: "gpt-image-2",
    models: ["gpt-image-2"],
  },
  {
    service: "openai",
    label: "OpenAI Images",
    baseUrl: "https://api.openai.com/v1",
    api: "images",
    defaultModel: "gpt-image-2",
    models: ["gpt-image-2"],
  },
  {
    service: "openaiCodex",
    label: "OpenAI Codex (ChatGPT OAuth)",
    baseUrl: "https://chatgpt.com/backend-api/codex",
    api: "codex-responses",
    defaultModel: "gpt-image-2",
    models: ["gpt-image-2"],
  },
  {
    service: "google",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    api: "gemini",
    defaultModel: "gemini-3.1-flash-image-preview",
    models: ["gemini-3.1-flash-image-preview", "gemini-2.5-flash-image"],
  },
];

export function resolveCoverProviderPreset(service: string | undefined): CoverProviderPreset | undefined {
  return COVER_PROVIDER_PRESETS.find((provider) => provider.service === service);
}

export function coverSecretKey(service: string): string {
  return `cover:${service}`;
}
