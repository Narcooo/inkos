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
