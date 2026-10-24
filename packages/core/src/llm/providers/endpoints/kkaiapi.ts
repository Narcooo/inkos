/**
 * kkaiapi
 *
 * - 官网：https://kkaiapi.com/
 * - API 文档：https://kkaiapi.com/docs
 * - 模型列表：https://kkaiapi.com/models
 * - 价格页：https://kkaiapi.com/pricing
 *
 * OpenAI-compatible 聚合入口。站点文档标注统一 /v1 入口，chat、stream、
 * tools 和 image generation 均按 OpenAI 兼容接口调用。
 */
import type { InkosEndpoint } from "../types.js";

export const KKAIAPI: InkosEndpoint = {
  id: "kkaiapi",
  label: "kkaiapi",
  group: "aggregator",
  api: "openai-completions",
  baseUrl: "https://api.kkaiapi.com/v1",
  modelsBaseUrl: "https://api.kkaiapi.com/v1",
  checkModel: "deepseek-v4-flash",
  temperatureRange: [0, 2],
  defaultTemperature: 0.9,
  writingTemperature: 1.2,
  models: [
    { id: "claude-sonnet-5-5", maxOutput: 128_000, contextWindowTokens: 1_000_000, enabled: true, releasedAt: "2026-09-28", supportsSampling: false },
    { id: "deepseek-v4-flash", maxOutput: 393216, contextWindowTokens: 1_000_000, enabled: true, releasedAt: "2026-04-24" },
    { id: "deepseek-v4-pro", maxOutput: 393216, contextWindowTokens: 1_000_000, enabled: true, releasedAt: "2026-04-24" },
    { id: "gpt-5.5", maxOutput: 128000, contextWindowTokens: 1_050_000, enabled: true },
    { id: "gpt-5.4", maxOutput: 128000, contextWindowTokens: 1_050_000, enabled: true },
    { id: "gpt-5.4-mini", maxOutput: 128000, contextWindowTokens: 400000, enabled: true },
    { id: "gpt-5.4-nano", maxOutput: 128000, contextWindowTokens: 400000, enabled: true },
    { id: "gpt-5.3-codex", maxOutput: 128000, contextWindowTokens: 400000 },
    { id: "gpt-5.3-codex-spark", maxOutput: 128000, contextWindowTokens: 400000 },
    { id: "gpt-5.2", maxOutput: 128000, contextWindowTokens: 400000 },
    { id: "claude-opus-4-7", maxOutput: 128000, contextWindowTokens: 1_000_000 },
    { id: "claude-opus-4-6", maxOutput: 128000, contextWindowTokens: 1_000_000 },
    { id: "claude-sonnet-4-6", maxOutput: 64000, contextWindowTokens: 1_000_000 },
    { id: "claude-sonnet-4-5-20250929", maxOutput: 64000, contextWindowTokens: 200000 },
    { id: "claude-haiku-4-5", maxOutput: 64000, contextWindowTokens: 200000 },
    { id: "claude-haiku-4-5-20251001", maxOutput: 64000, contextWindowTokens: 200000 },
    { id: "gemini-3.1-pro-preview", maxOutput: 65536, contextWindowTokens: 1_048_576 },
    { id: "glm-5.1", maxOutput: 32768, contextWindowTokens: 128000 },
    { id: "glm-5", maxOutput: 32768, contextWindowTokens: 128000 },
    { id: "kimi-k2.6", maxOutput: 32768, contextWindowTokens: 256000, temperature: 1 },
    { id: "kimi-k2.5", maxOutput: 32768, contextWindowTokens: 256000, temperature: 1 },
    { id: "qwen3.6-plus", maxOutput: 32768, contextWindowTokens: 128000 },
    { id: "qwen3.5-plus", maxOutput: 32768, contextWindowTokens: 128000 },
    { id: "mimo-v2.5-pro", maxOutput: 32768, contextWindowTokens: 128000 },
    { id: "mimo-v2.5", maxOutput: 32768, contextWindowTokens: 128000 },
    { id: "mimo-v2-pro", maxOutput: 32768, contextWindowTokens: 128000 },
    // Hide until kkaiapi exposes a verified MiniMax chat route/model id.
    { id: "MiniMax-M2.7", maxOutput: 64000, contextWindowTokens: 1_000_000, enabled: false, status: "disabled" },
    { id: "gpt-image-2-pro", maxOutput: 1, contextWindowTokens: 1, enabled: false, status: "nonText", capabilities: { text: false, imageOutput: true } },
    { id: "gpt-image-2", maxOutput: 1, contextWindowTokens: 1, enabled: false, status: "nonText", capabilities: { text: false, imageOutput: true } },
  ],
};
