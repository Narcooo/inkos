export type CoverProviderId = "kkaiapi" | "openai" | "google" | "agnesai";

export interface CoverProviderPreset {
  readonly service: CoverProviderId;
  readonly label: string;
  readonly baseUrl: string;
  readonly api: "responses" | "images" | "gemini";
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
    service: "google",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    api: "gemini",
    defaultModel: "gemini-3.1-flash-image-preview",
    models: ["gemini-3.1-flash-image-preview", "gemini-2.5-flash-image"],
  },
  {
    service: "agnesai",
    label: "AgnesAI Images",
    baseUrl: "https://apihub.agnes-ai.com/v1",
    api: "images",
    defaultModel: "agnes-image-2.1-flash",
    models: ["agnes-image-2.1-flash", "agnes-image-2.0-flash"],
  },
];

export function resolveCoverProviderPreset(service: string | undefined): CoverProviderPreset | undefined {
  return COVER_PROVIDER_PRESETS.find((provider) => provider.service === service);
}

export function coverSecretKey(service: string): string {
  return `cover:${service}`;
}
