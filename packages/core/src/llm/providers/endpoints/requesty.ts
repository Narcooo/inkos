/**
 * Requesty
 *
 * - 官网：https://requesty.ai/
 * - 控制台 / API key：https://app.requesty.ai/api-keys
 * - 模型广场：https://www.requesty.ai/models
 * - API 文档：https://docs.requesty.ai/
 * - 模型列表 JSON：https://router.requesty.ai/v1/models
 *
 * OpenAI 兼容的 LLM 路由/网关（与 OpenRouter 同类）。统一入口聚合 Anthropic /
 * OpenAI / Google / DeepSeek / Meta 等多家上游，模型命名沿用 provider/model 形式
 * （与 OpenRouter 相同）。数百个模型，bank 只列最常用的；完整清单走用户侧 live /models probe。
 */
import type { InkosEndpoint } from "../types.js";

export const REQUESTY: InkosEndpoint = {
  id: "requesty",
  label: "Requesty",
  group: "aggregator",
  api: "openai-responses",
  baseUrl: "https://router.requesty.ai/v1",
  // deepseek/deepseek-chat 是长期稳定的低成本入口，用作 apikey 两步验证的 hello 模型。
  // 不用 openai/* 模型：verify 只发 maxTokens 10，而 OpenAI Responses 要求 max_output_tokens >= 16，会直接 400。
  // 具体模型 id 会随上游增删变化，所以 Requesty 走动态 /models 清单（见 effective-llm-config）。
  checkModel: "deepseek/deepseek-chat",
  temperatureRange: [0, 2],
  defaultTemperature: 0.7,
  writingTemperature: 1,
  models: [
    { id: "anthropic/claude-sonnet-5-5", maxOutput: 128000, contextWindowTokens: 1000000 },
    { id: "anthropic/claude-opus-5-5", maxOutput: 128000, contextWindowTokens: 1000000 },
    { id: "anthropic/claude-haiku-5-5", maxOutput: 128000, contextWindowTokens: 1000000 },
    { id: "anthropic/claude-sonnet-5", maxOutput: 128000, contextWindowTokens: 1000000 },
    { id: "openai/gpt-6.1-terra", maxOutput: 128000, contextWindowTokens: 1050000 },
    { id: "openai/gpt-5.4", maxOutput: 128000, contextWindowTokens: 1050000 },
    { id: "openai/gpt-5-mini", maxOutput: 128000, contextWindowTokens: 400000 },
    { id: "openai/gpt-4o-mini", maxOutput: 16384, contextWindowTokens: 128000 },
    { id: "google/gemini-3.6-flash", maxOutput: 65535, contextWindowTokens: 1048576 },
    { id: "google/gemini-3.1-pro-preview", maxOutput: 65535, contextWindowTokens: 1048576 },
    { id: "google/gemini-2.5-flash", maxOutput: 65535, contextWindowTokens: 1048576 },
    { id: "deepseek/deepseek-chat", maxOutput: 384000, contextWindowTokens: 1000000 },
    { id: "deepseek/deepseek-reasoner", maxOutput: 384000, contextWindowTokens: 1000000 },
  ],
};
