/**
 * Atlas Cloud
 *
 * - 官网：https://www.atlascloud.ai/
 * - 控制台 / API key：https://www.atlascloud.ai/console
 * - API 文档：https://docs.atlascloud.ai/
 * - 模型列表 JSON：https://api.atlascloud.ai/v1/models
 *
 * 聚合 OpenAI / Anthropic / Google / DeepSeek / Qwen / GLM / Kimi / MiniMax / xAI
 * 等主流家的统一入口，OpenAI 兼容（/v1/chat/completions）。一个 API Key 接入多模型。
 * 300+ 模型，bank 只列最常用的文本模型；完整清单走用户侧 live /models probe。
 */
import type { InkosEndpoint } from "../types.js";

export const ATLASCLOUD: InkosEndpoint = {
  id: "atlascloud",
  label: "Atlas Cloud",
  group: "aggregator",
  api: "openai-completions",
  baseUrl: "https://api.atlascloud.ai/v1",
  checkModel: "deepseek-ai/DeepSeek-V3.1",
  temperatureRange: [0, 2],
  defaultTemperature: 0.7,
  writingTemperature: 1,
  models: [
    // Anthropic Claude
    { id: "anthropic/claude-opus-4.5-20251101", maxOutput: 64000, contextWindowTokens: 200000, enabled: true },
    { id: "anthropic/claude-sonnet-4.5-20250929", maxOutput: 64000, contextWindowTokens: 200000, enabled: true },
    { id: "anthropic/claude-haiku-4.5-20251001", maxOutput: 64000, contextWindowTokens: 200000, enabled: true },
    // OpenAI
    { id: "openai/gpt-5.1", maxOutput: 128000, contextWindowTokens: 400000, enabled: true },
    { id: "openai/gpt-5", maxOutput: 128000, contextWindowTokens: 400000, enabled: true },
    { id: "openai/gpt-5-mini", maxOutput: 128000, contextWindowTokens: 400000, enabled: true },
    { id: "openai/gpt-4o", maxOutput: 16384, contextWindowTokens: 128000, enabled: true },
    { id: "openai/gpt-4.1", maxOutput: 32768, contextWindowTokens: 1047576, enabled: true },
    // Google Gemini
    { id: "google/gemini-2.5-pro", maxOutput: 65536, contextWindowTokens: 1048576, enabled: true },
    { id: "google/gemini-2.5-flash", maxOutput: 65536, contextWindowTokens: 1048576, enabled: true },
    // DeepSeek
    { id: "deepseek-ai/DeepSeek-V3.1", maxOutput: 65536, contextWindowTokens: 163840, enabled: true },
    { id: "deepseek-ai/DeepSeek-V3.2-Exp", maxOutput: 65536, contextWindowTokens: 163840, enabled: true },
    { id: "deepseek-ai/deepseek-r1-0528", maxOutput: 65536, contextWindowTokens: 163840, enabled: true },
    // Qwen
    { id: "Qwen/Qwen3-235B-A22B-Instruct-2507", maxOutput: 32768, contextWindowTokens: 262144, enabled: true },
    { id: "Qwen/Qwen3-Coder", maxOutput: 65536, contextWindowTokens: 262144, enabled: true },
    // Zhipu GLM
    { id: "zai-org/GLM-4.6", maxOutput: 98304, contextWindowTokens: 204800, enabled: true },
    // Moonshot Kimi
    { id: "moonshotai/Kimi-K2-Instruct-0905", maxOutput: 16384, contextWindowTokens: 262144, enabled: true },
    // MiniMax
    { id: "MiniMaxAI/MiniMax-M2", maxOutput: 16384, contextWindowTokens: 204800, enabled: true },
  ],
};
