/**
 * 商汤日日新 (SenseNova) — 公测新平台
 *
 * - 平台：https://platform.sensenova.cn/
 * - API key：控制台 → API Keys（sk- 开头）
 * - OpenAI 兼容端点：https://token.sensenova.cn/v1
 * - 平台 max_tokens 硬上限 384000；各模型实际 max_output 见下方卡片。
 */
import type { InkosEndpoint } from "../types.js";

export const SENSENOVA: InkosEndpoint = {
  id: "sensenova",
  label: "商汤日日新",
  group: "china",
  api: "openai-completions",
  baseUrl: "https://token.sensenova.cn/v1",
  checkModel: "sensenova-6.7-flash-lite",
  temperatureRange: [0, 2],
  defaultTemperature: 0.7,
  writingTemperature: 1,
  models: [
    { id: "sensenova-6.7-flash-lite", maxOutput: 65536, contextWindowTokens: 262144, enabled: true, releasedAt: "2026-07-11" },
    { id: "deepseek-v4-flash", maxOutput: 65536, contextWindowTokens: 1048576, enabled: true, releasedAt: "2026-07-11" },
    { id: "glm-5.2", maxOutput: 131072, contextWindowTokens: 1048576, enabled: true, releasedAt: "2026-07-11" },
    { id: "sensenova-u1-fast", maxOutput: 65536, contextWindowTokens: 262144, releasedAt: "2026-07-11" },
  ],
};
