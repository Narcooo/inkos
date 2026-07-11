/**
 * Requesty
 *
 * - 官网：https://requesty.ai/
 * - 控制台 / API key：https://app.requesty.ai/api-keys
 * - 模型广场：https://app.requesty.ai/router/list
 * - API 文档：https://docs.requesty.ai/
 * - 模型列表 JSON：https://router.requesty.ai/v1/models
 *
 * OpenAI 兼容的 LLM 路由/网关（与 OpenRouter 同类）。统一入口聚合 Anthropic /
 * OpenAI / Google / DeepSeek / Meta 等多家上游，模型命名沿用 provider/model 形式
 * （与 OpenRouter 相同）。600+ 模型，bank 只列最常用的；完整清单走用户侧 live /models probe。
 */
import type { InkosEndpoint } from "../types.js";

export const REQUESTY: InkosEndpoint = {
  id: "requesty",
  label: "Requesty",
  group: "aggregator",
  api: "openai-responses",
  baseUrl: "https://router.requesty.ai/v1",
  // openai/gpt-4o-mini 是长期稳定的低成本入口，用作 apikey 两步验证的 hello 模型；
  // 具体模型 id 会随上游增删变化，所以 Requesty 走动态 /models 清单（见 effective-llm-config）。
  checkModel: "openai/gpt-4o-mini",
  temperatureRange: [0, 2],
  defaultTemperature: 0.7,
  writingTemperature: 1,
  models: [
    { id: "deepseek/deepseek-chat", maxOutput: 8192, contextWindowTokens: 163840 },
    { id: "deepseek/deepseek-reasoner", maxOutput: 8192, contextWindowTokens: 163840 },
    { id: "google/gemini-2.5-pro", maxOutput: 65536, contextWindowTokens: 1048576 },
    { id: "google/gemini-2.5-flash", maxOutput: 65535, contextWindowTokens: 1048576 },
    { id: "openai/o3", maxOutput: 100000, contextWindowTokens: 200000, releasedAt: "2025-04-17" },
    { id: "openai/o4-mini", maxOutput: 100000, contextWindowTokens: 200000, releasedAt: "2025-04-17" },
    { id: "openai/gpt-4.1", maxOutput: 32768, contextWindowTokens: 1047576, releasedAt: "2025-04-14" },
    { id: "openai/gpt-4.1-mini", maxOutput: 32768, contextWindowTokens: 1047576, releasedAt: "2025-04-14" },
    { id: "openai/gpt-4.1-nano", maxOutput: 32768, contextWindowTokens: 1047576, releasedAt: "2025-04-14" },
    { id: "openai/gpt-4o-mini", maxOutput: 16385, contextWindowTokens: 128000 },
    { id: "openai/gpt-4o", maxOutput: 4096, contextWindowTokens: 128000 },
    { id: "anthropic/claude-opus-4.5", maxOutput: 64000, contextWindowTokens: 200000, releasedAt: "2025-11-24" },
    { id: "anthropic/claude-sonnet-4-5", maxOutput: 64000, contextWindowTokens: 200000, releasedAt: "2025-09-30" },
    { id: "anthropic/claude-sonnet-4", maxOutput: 64000, contextWindowTokens: 200000, releasedAt: "2025-05-23" },
    { id: "anthropic/claude-opus-4", maxOutput: 32000, contextWindowTokens: 200000, releasedAt: "2025-05-23" },
    { id: "anthropic/claude-3.7-sonnet", maxOutput: 8192, contextWindowTokens: 200000, releasedAt: "2025-02-24" },
    { id: "anthropic/claude-3.5-sonnet", maxOutput: 8192, contextWindowTokens: 200000, releasedAt: "2024-06-20" },
    { id: "anthropic/claude-3.5-haiku", maxOutput: 8192, contextWindowTokens: 200000, releasedAt: "2024-11-05" },
  ],
};
