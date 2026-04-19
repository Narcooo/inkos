export interface ServicePreset {
  readonly providerFamily: "openai" | "anthropic";
  readonly api: string;
  readonly baseUrl: string;
  readonly label: string;
  readonly temperatureRange?: [number, number];
  readonly defaultTemperature?: number;
  readonly writingTemperature?: number;
  readonly temperatureHint?: string;
  readonly knownModels?: readonly string[];
  readonly piProvider?: string;
  readonly modelsBaseUrl?: string;
}

export const SERVICE_PRESETS: Record<string, ServicePreset> = {
  openai:      { providerFamily: "openai",    api: "openai-responses",   baseUrl: "https://api.openai.com/v1",                          label: "OpenAI",          temperatureRange: [0, 2], defaultTemperature: 1.0, writingTemperature: 1.0 },
  anthropic:   { providerFamily: "anthropic", api: "anthropic-messages", baseUrl: "https://api.anthropic.com",                          label: "Anthropic",       temperatureRange: [0, 1], defaultTemperature: 1.0, writingTemperature: 1.0, temperatureHint: "不要同时改 temperature 和 top_p" },
  deepseek:    { providerFamily: "openai",    api: "openai-completions", baseUrl: "https://api.deepseek.com",                           label: "DeepSeek",        temperatureRange: [0, 2], defaultTemperature: 1.0, writingTemperature: 1.5, temperatureHint: "创意写作推荐 1.5" },
  moonshot:    { providerFamily: "openai",    api: "openai-completions", baseUrl: "https://api.moonshot.cn/v1",                         label: "Moonshot (Kimi)", temperatureRange: [0, 1], defaultTemperature: 0.3, writingTemperature: 1.0, temperatureHint: "kimi-k2.5 推荐 temperature=1.0" },
  minimax:     {
    providerFamily: "anthropic",
    api: "anthropic-messages",
    baseUrl: "https://api.minimaxi.com/anthropic",
    label: "MiniMax",
    temperatureRange: [0, 2],
    defaultTemperature: 0.9,
    writingTemperature: 0.9,
    knownModels: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5", "MiniMax-M2.5-highspeed", "MiniMax-M2.1", "MiniMax-M2.1-highspeed", "MiniMax-M2"],
    piProvider: "anthropic",
  },
  bailian:     {
    providerFamily: "anthropic",
    api: "anthropic-messages",
    baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
    modelsBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    label: "百炼 (通义千问)",
    temperatureRange: [0, 2],
    defaultTemperature: 0.7,
    writingTemperature: 1.0,
    piProvider: "anthropic",
  },
  zhipu:       { providerFamily: "openai",    api: "openai-completions", baseUrl: "https://open.bigmodel.cn/api/paas/v4",               label: "智谱 GLM",        temperatureRange: [0, 1], defaultTemperature: 0.95, writingTemperature: 0.95, piProvider: "zai" },
  siliconflow: { providerFamily: "openai",    api: "openai-completions", baseUrl: "https://api.siliconflow.cn/v1",                      label: "硅基流动" },
  ppio:        { providerFamily: "openai",    api: "openai-completions", baseUrl: "https://api.ppinfra.com/v3/openai",                  label: "PPIO" },
  openrouter:  { providerFamily: "openai",    api: "openai-responses",   baseUrl: "https://openrouter.ai/api/v1",                       label: "OpenRouter",      piProvider: "openrouter" },
  ollama:      { providerFamily: "openai",    api: "openai-completions", baseUrl: "http://localhost:11434/v1",                          label: "Ollama (本地)" },
  custom:      { providerFamily: "openai",    api: "openai-completions", baseUrl: "",                                                    label: "自定义端点" },
};

export function resolveServicePreset(service: string): ServicePreset | undefined {
  return SERVICE_PRESETS[service];
}

export function resolveServiceProviderFamily(service: string): "openai" | "anthropic" | undefined {
  return resolveServicePreset(service)?.providerFamily;
}

export function resolveServicePiProvider(service: string): string | undefined {
  const preset = resolveServicePreset(service);
  if (!preset) return undefined;
  return preset.piProvider ?? preset.providerFamily;
}

export function resolveServiceModelsBaseUrl(service: string): string | undefined {
  const preset = resolveServicePreset(service);
  if (!preset) return undefined;
  return preset.modelsBaseUrl ?? preset.baseUrl;
}

const DEFAULT_TEMPERATURE_RANGE: [number, number] = [0, 2];

export function clampTemperature(service: string, temperature: number): number {
  const preset = resolveServicePreset(service);
  const [min, max] = preset?.temperatureRange ?? DEFAULT_TEMPERATURE_RANGE;
  return Math.max(min, Math.min(max, temperature));
}

export function getWritingTemperature(service: string): number {
  const preset = resolveServicePreset(service);
  return preset?.writingTemperature ?? preset?.defaultTemperature ?? 1.0;
}

export function guessServiceFromBaseUrl(baseUrl: string): string {
  for (const [key, preset] of Object.entries(SERVICE_PRESETS)) {
    if (key === "custom" || !preset.baseUrl) continue;
    try {
      if (baseUrl.includes(new URL(preset.baseUrl).hostname)) return key;
    } catch {
      continue;
    }
  }
  return "custom";
}

export const SERVICE_TO_PI_PROVIDER: Record<string, string> = Object.fromEntries(
  Object.entries(SERVICE_PRESETS)
    .filter(([service]) => service !== "custom")
    .map(([service, preset]) => [service, preset.piProvider ?? preset.providerFamily]),
) as Record<string, string>;

export interface ModelInfo {
  readonly id: string;
  readonly name: string;
  readonly reasoning: boolean;
  readonly contextWindow: number;
}

export async function listModelsForService(service: string, apiKey?: string): Promise<ReadonlyArray<ModelInfo>> {
  const preset = SERVICE_PRESETS[service];
  if (!preset || service === "custom") return [];

  if (preset.knownModels && preset.knownModels.length > 0) {
    return preset.knownModels.map((id) => ({ id, name: id, reasoning: false, contextWindow: 0 }));
  }

  const modelsBaseUrl = resolveServiceModelsBaseUrl(service);
  if (apiKey && modelsBaseUrl) {
    try {
      const modelsUrl = modelsBaseUrl.replace(/\/$/, "") + "/models";
      const res = await fetch(modelsUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const json = await res.json() as { data?: Array<{ id: string; owned_by?: string }> };
        if (json.data && json.data.length > 0) {
          return json.data.map((m) => ({
            id: m.id,
            name: m.id,
            reasoning: false,
            contextWindow: 0,
          }));
        }
      }
    } catch {
      // /models unavailable, fall through
    }
  }

  const piProvider = SERVICE_TO_PI_PROVIDER[service];
  if (!piProvider) return [];

  try {
    const { getModels } = await import("@mariozechner/pi-ai");
    const models = getModels(piProvider as any);
    return models.map((m: any) => ({
      id: m.id,
      name: m.name,
      reasoning: m.reasoning ?? false,
      contextWindow: m.contextWindow ?? 0,
    }));
  } catch {
    return [];
  }
}

export async function listServicesWithModelCount(): Promise<ReadonlyArray<{ service: string; label: string; modelCount: number }>> {
  const result: { service: string; label: string; modelCount: number }[] = [];
  for (const [key, preset] of Object.entries(SERVICE_PRESETS)) {
    if (key === "custom") {
      result.push({ service: key, label: preset.label, modelCount: 0 });
      continue;
    }
    const models = await listModelsForService(key);
    result.push({ service: key, label: preset.label, modelCount: models.length });
  }
  return result;
}
