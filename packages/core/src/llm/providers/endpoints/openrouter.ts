/**
 * OpenRouter
 *
 * - 官网：https://openrouter.ai/
 * - 控制台 / API key：https://openrouter.ai/keys
 * - 模型广场：https://openrouter.ai/models
 * - API 文档：https://openrouter.ai/docs/api-reference/overview
 * - 模型列表 JSON：https://openrouter.ai/api/v1/models
 *
 * 聚合所有主流家 (Anthropic / OpenAI / Google / xAI / Meta 等) 的统一入口。
 * 350+ 模型，bank 只列最常用的；完整清单用户侧 live /models probe。
 */
import type { InkosEndpoint } from "../types.js";

export const OPENROUTER: InkosEndpoint = {
  id: "openrouter",
  label: "OpenRouter",
  group: "aggregator",
  api: "openai-responses",
  baseUrl: "https://openrouter.ai/api/v1",
  // openrouter/auto 是 OpenRouter 官方的自动路由入口，长期存在；
  // 具体模型 id（如 google/gemma-2-9b-it:free）会随上游下架失效（issue #300）。
  checkModel: "openrouter/auto",
  temperatureRange: [0, 2],
  defaultTemperature: 0.7,
  writingTemperature: 1,
  models: [
    { id: "openrouter/auto", maxOutput: 4096, contextWindowTokens: 2000000, enabled: true },
    { id: "z-ai/glm-5.2", maxOutput: 32768, contextWindowTokens: 1048576, enabled: true, releasedAt: "2026-06-16" },
    { id: "deepseek/deepseek-chat-v3.1", maxOutput: 4096, contextWindowTokens: 163840, releasedAt: "2025-08-21" },
    { id: "google/gemini-3.1-flash-image-preview", maxOutput: 65536, contextWindowTokens: 131072, releasedAt: "2026-02-26" },
    { id: "google/gemini-3-pro-image-preview", maxOutput: 32768, contextWindowTokens: 163840, releasedAt: "2025-11-20" },
    { id: "google/gemini-2.5-flash-image", maxOutput: 8192, contextWindowTokens: 40960, releasedAt: "2025-10-07" },
    { id: "qwen/qwen3-30b-a3b:free", maxOutput: 4096, contextWindowTokens: 40960 },
    { id: "qwen/qwen3-30b-a3b", maxOutput: 40960, contextWindowTokens: 40960 },
    { id: "qwen/qwen3-8b:free", maxOutput: 40960, contextWindowTokens: 40960 },
    { id: "qwen/qwen3-14b:free", maxOutput: 4096, contextWindowTokens: 40960 },
    { id: "qwen/qwen3-14b", maxOutput: 40960, contextWindowTokens: 40960 },
    { id: "qwen/qwen3-32b:free", maxOutput: 4096, contextWindowTokens: 40960 },
    { id: "qwen/qwen3-32b", maxOutput: 4096, contextWindowTokens: 40960 },
    { id: "qwen/qwen3-235b-a22b:free", maxOutput: 4096, contextWindowTokens: 131072 },
    { id: "qwen/qwen3-235b-a22b", maxOutput: 40960, contextWindowTokens: 40960 },
    { id: "tngtech/deepseek-r1t-chimera:free", maxOutput: 4096, contextWindowTokens: 163840 },
    { id: "thudm/glm-z1-rumination-32b", maxOutput: 4096, contextWindowTokens: 32000 },
    { id: "thudm/glm-z1-32b", maxOutput: 4096, contextWindowTokens: 32768 },
    { id: "thudm/glm-4-32b:free", maxOutput: 4096, contextWindowTokens: 32000 },
    { id: "thudm/glm-4-32b", maxOutput: 4096, contextWindowTokens: 32000 },
    { id: "google/gemini-2.5-pro", maxOutput: 65536, contextWindowTokens: 1048576 },
    { id: "google/gemini-2.5-pro-preview", maxOutput: 65536, contextWindowTokens: 1048576 },
    { id: "google/gemini-2.5-flash", maxOutput: 65535, contextWindowTokens: 1048576 },
    { id: "google/gemini-2.5-flash-preview", maxOutput: 65535, contextWindowTokens: 1048576 },
    { id: "google/gemini-2.5-flash-preview:thinking", maxOutput: 65535, contextWindowTokens: 1048576 },
    { id: "openai/o3", maxOutput: 100000, contextWindowTokens: 200000, releasedAt: "2025-04-17" },
    { id: "openai/o4-mini-high", maxOutput: 100000, contextWindowTokens: 200000, releasedAt: "2025-04-17" },
    { id: "openai/o4-mini", maxOutput: 100000, contextWindowTokens: 200000, releasedAt: "2025-04-17" },
    { id: "openai/gpt-4.1", maxOutput: 32768, contextWindowTokens: 1047576, releasedAt: "2025-04-14" },
    { id: "openai/gpt-4.1-mini", maxOutput: 32768, contextWindowTokens: 1047576, releasedAt: "2025-04-14" },
    { id: "openai/gpt-4.1-nano", maxOutput: 32768, contextWindowTokens: 1047576, releasedAt: "2025-04-14" },
    { id: "openai/o3-mini-high", maxOutput: 100000, contextWindowTokens: 200000, releasedAt: "2025-01-31" },
    { id: "openai/o3-mini", maxOutput: 100000, contextWindowTokens: 200000, releasedAt: "2025-01-31" },
    { id: "openai/o1-mini", maxOutput: 65536, contextWindowTokens: 128000, releasedAt: "2024-09-12" },
    { id: "openai/o1-preview", maxOutput: 32768, contextWindowTokens: 128000, releasedAt: "2024-09-12" },
    { id: "openai/gpt-4o-mini", maxOutput: 16385, contextWindowTokens: 128000 },
    { id: "openai/gpt-4o", maxOutput: 4096, contextWindowTokens: 128000 },
    { id: "deepseek/deepseek-r1-0528", maxOutput: 4096, contextWindowTokens: 163840, releasedAt: "2025-05-28" },
    { id: "deepseek/deepseek-r1-0528:free", maxOutput: 4096, contextWindowTokens: 163840, releasedAt: "2025-05-28" },
    { id: "deepseek/deepseek-r1", maxOutput: 4096, contextWindowTokens: 163840, releasedAt: "2025-01-20" },
    { id: "deepseek/deepseek-r1:free", maxOutput: 4096, contextWindowTokens: 163840, releasedAt: "2025-01-20" },
    { id: "deepseek/deepseek-chat-v3-0324", maxOutput: 4096, contextWindowTokens: 163840 },
    { id: "deepseek/deepseek-chat-v3-0324:free", maxOutput: 4096, contextWindowTokens: 163840 },
    { id: "anthropic/claude-opus-4.5", maxOutput: 64000, contextWindowTokens: 200000, releasedAt: "2025-11-24" },
    { id: "anthropic/claude-sonnet-4.5", maxOutput: 64000, contextWindowTokens: 200000, releasedAt: "2025-09-30" },
    { id: "anthropic/claude-3-haiku", maxOutput: 4096, contextWindowTokens: 200000, releasedAt: "2024-03-07" },
    { id: "anthropic/claude-3.5-haiku", maxOutput: 8192, contextWindowTokens: 200000, releasedAt: "2024-11-05" },
    { id: "anthropic/claude-3.5-sonnet", maxOutput: 8192, contextWindowTokens: 200000, releasedAt: "2024-06-20" },
    { id: "anthropic/claude-3.7-sonnet", maxOutput: 8192, contextWindowTokens: 200000, releasedAt: "2025-02-24" },
    { id: "anthropic/claude-sonnet-4", maxOutput: 64000, contextWindowTokens: 200000, releasedAt: "2025-05-23" },
    { id: "anthropic/claude-opus-4", maxOutput: 32000, contextWindowTokens: 200000, releasedAt: "2025-05-23" },
    { id: "anthropic/claude-3-opus", maxOutput: 4096, contextWindowTokens: 200000, releasedAt: "2024-02-29" },
    { id: "google/gemini-flash-1.5", maxOutput: 8192, contextWindowTokens: 1008192 },
    { id: "google/gemini-2.0-flash-001", maxOutput: 8192, contextWindowTokens: 1056768, releasedAt: "2025-02-05" },
    { id: "google/gemini-pro-1.5", maxOutput: 8192, contextWindowTokens: 2008192 },
    { id: "meta-llama/llama-3.2-11b-vision-instruct", maxOutput: 4096, contextWindowTokens: 131072 },
    { id: "meta-llama/llama-3.3-70b-instruct", maxOutput: 4096, contextWindowTokens: 131072 },
    { id: "meta-llama/llama-3.3-70b-instruct:free", maxOutput: 4096, contextWindowTokens: 65536 },
    { id: "qwen/qwen-2-7b-instruct:free", maxOutput: 4096, contextWindowTokens: 32768 },
    { id: "meta-llama/llama-3.1-8b-instruct:free", maxOutput: 4096, contextWindowTokens: 131072 },
  ],
};
