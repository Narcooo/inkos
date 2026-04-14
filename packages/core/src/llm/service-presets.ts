export interface ServicePreset {
  readonly api: string;
  readonly baseUrl: string;
  readonly label: string;
}

export const SERVICE_PRESETS: Record<string, ServicePreset> = {
  openai:       { api: "openai-responses",   baseUrl: "https://api.openai.com/v1",                         label: "OpenAI" },
  anthropic:    { api: "anthropic-messages",  baseUrl: "https://api.anthropic.com",                         label: "Anthropic" },
  deepseek:     { api: "openai-completions",  baseUrl: "https://api.deepseek.com",                          label: "DeepSeek" },
  moonshot:     { api: "openai-completions",  baseUrl: "https://api.moonshot.cn/v1",                        label: "Moonshot (Kimi)" },
  minimax:      { api: "openai-completions",  baseUrl: "https://api.minimax.chat/v1",                       label: "MiniMax" },
  bailian:      { api: "openai-completions",  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", label: "百炼 (通义千问)" },
  zhipu:        { api: "openai-completions",  baseUrl: "https://open.bigmodel.cn/api/paas/v4",              label: "智谱 GLM" },
  siliconflow:  { api: "openai-completions",  baseUrl: "https://api.siliconflow.cn/v1",                     label: "硅基流动" },
  ppio:         { api: "openai-completions",  baseUrl: "https://api.ppinfra.com/v3/openai",                 label: "PPIO" },
  openrouter:   { api: "openai-responses",    baseUrl: "https://openrouter.ai/api/v1",                      label: "OpenRouter" },
  ollama:       { api: "openai-completions",  baseUrl: "http://localhost:11434/v1",                          label: "Ollama (本地)" },
  custom:       { api: "openai-completions",  baseUrl: "",                                                   label: "自定义端点" },
};

export function resolveServicePreset(service: string): ServicePreset | undefined {
  return SERVICE_PRESETS[service];
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

// pi-ai service → pi-ai provider 映射
const SERVICE_TO_PI_PROVIDER: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  deepseek: "openai",         // OpenAI 兼容，pi-ai 无独立 provider
  moonshot: "openai",         // Moonshot API (api.moonshot.cn) 是 OpenAI 兼容，不是 kimi-coding (api.kimi.com)
  minimax: "minimax",
  bailian: "openai",          // 百炼走 OpenAI 兼容
  zhipu: "zai",               // pi-ai 有 zai provider
  siliconflow: "openai",      // OpenAI 兼容
  ppio: "openai",             // OpenAI 兼容
  openrouter: "openrouter",
  ollama: "openai",           // OpenAI 兼容
};

export interface ModelInfo {
  readonly id: string;
  readonly name: string;
  readonly reasoning: boolean;
  readonly contextWindow: number;
}

/**
 * 动态获取某个 service 下可用的模型列表。
 * 优先调用服务商的 GET /models API（OpenAI 兼容），回退到 pi-ai 内置模型列表。
 *
 * @param apiKey 用户配置的 API key，用于认证 /models 请求
 */
export async function listModelsForService(service: string, apiKey?: string): Promise<ReadonlyArray<ModelInfo>> {
  const preset = SERVICE_PRESETS[service];
  if (!preset || service === "custom") return [];

  // 1) 尝试动态获取：调用 GET {baseUrl}/models
  if (apiKey && preset.baseUrl) {
    try {
      const modelsUrl = preset.baseUrl.replace(/\/$/, "") + "/models";
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
      // /models 不可用，回退
    }
  }

  // 2) 回退到 pi-ai 内置模型列表
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

/**
 * 获取所有 service 及其可用模型数。
 */
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
