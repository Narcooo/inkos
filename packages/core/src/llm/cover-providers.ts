export type CoverProviderId = "kkaiapi" | "openai" | "google" | "dashscope";

export interface CoverProviderPreset {
  readonly service: CoverProviderId;
  readonly label: string;
  readonly baseUrl: string;
  readonly api: "responses" | "images" | "gemini" | "dashscope";
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
    service: "dashscope",
    label: "通义万相 (DashScope)",
    baseUrl: "https://dashscope.aliyuncs.com/api/v1",
    api: "dashscope",
    defaultModel: "wan2.6-t2i",
    models: ["wan2.6-t2i", "wan2.5-t2i", "wan2.1-t2i-plus", "wan2.1-t2i-turbo", "wanx-v1"],
  },
];

export function resolveCoverProviderPreset(service: string | undefined): CoverProviderPreset | undefined {
  return COVER_PROVIDER_PRESETS.find((provider) => provider.service === service);
}

export function normalizeCoverBaseUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) return undefined;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return undefined;
    return trimmed.replace(/\/+$/u, "");
  } catch {
    return undefined;
  }
}

export function coverSecretKey(service: string): string {
  return `cover:${service}`;
}
