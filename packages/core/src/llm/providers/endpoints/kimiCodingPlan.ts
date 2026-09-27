/**
 * Kimi CodingPlan
 *
 * - 官网：https://platform.moonshot.cn/
 * - Moonshot 针对编程场景的订阅套餐。
 */
import type { InkosEndpoint } from "../types.js";

export const KIMI_CODING_PLAN: InkosEndpoint = {
  id: "kimiCodingPlan",
  label: "Kimi Coding Plan",
  group: "codingPlan",
  api: "anthropic-messages",
  baseUrl: "https://api.moonshot.cn/anthropic",
  modelsBaseUrl: "https://api.moonshot.cn/v1",
  checkModel: "kimi-k2.6",
  temperatureRange: [0, 1],
  defaultTemperature: 1,
  writingTemperature: 1,
  temperatureHint: "kimi-k2.x 推荐 temperature=1.0",
  models: [
    { id: "kimi-k2.6", maxOutput: 32768, contextWindowTokens: 262144, enabled: true, releasedAt: "2026-04-21", temperature: 1 },
    { id: "kimi-k2.5", maxOutput: 32768, contextWindowTokens: 262144, enabled: true, releasedAt: "2026-01-27", deploymentName: "k2p5", temperature: 1 },
    { id: "kimi-k2-thinking", maxOutput: 65536, contextWindowTokens: 262144, releasedAt: "2025-11-06", temperature: 1 },
  ],
};
