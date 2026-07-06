/**
 * MiniMax
 *
 * - 官网：https://www.minimax.io/
 * - 控制台 / API key：https://platform.minimaxi.com/user-center/basic-information/interface-key
 * - API 文档：https://platform.minimaxi.com/document/platform%20introduction
 * - 模型列表：https://platform.minimaxi.com/document/text
 *
 * inkos 用 MiniMax 官方 OpenAI-compatible Chat 接入：
 * https://api.minimaxi.com/v1/chat/completions
 * MiniMax 没有公开的 /models 端点，模型清单只能按官方文档手维护。
 */
import type { InkosEndpoint } from "../types.js";

export const MINIMAX: InkosEndpoint = {
  id: "minimax",
  label: "MiniMax",
  group: "china",
  api: "openai-completions",
  baseUrl: "https://api.minimaxi.com/v1",
  checkModel: "MiniMax-M2.7",
  transportDefaults: { stream: false },
  temperatureRange: [0, 1],
  defaultTemperature: 0.9,
  writingTemperature: 0.9,
  models: [
    { id: "MiniMax-M3", maxOutput: 131072, contextWindowTokens: 204800, enabled: true },
    { id: "MiniMax-M2.7", maxOutput: 131072, contextWindowTokens: 204800, enabled: true, releasedAt: "2026-03-18" },
    { id: "MiniMax-M2.7-highspeed", maxOutput: 131072, contextWindowTokens: 204800, releasedAt: "2026-03-18" },
    { id: "MiniMax-M2.5", maxOutput: 131072, contextWindowTokens: 204800, releasedAt: "2026-02-12" },
    { id: "MiniMax-M2.5-highspeed", maxOutput: 131072, contextWindowTokens: 204800, releasedAt: "2026-02-12" },
    { id: "M2-her", maxOutput: 2048, contextWindowTokens: 65536, releasedAt: "2026-01-23" },
    { id: "MiniMax-M2.1", maxOutput: 131072, contextWindowTokens: 204800, releasedAt: "2025-12-23" },
    { id: "MiniMax-M2.1-highspeed", maxOutput: 131072, contextWindowTokens: 204800, releasedAt: "2025-12-23" },
    { id: "MiniMax-M2", maxOutput: 131072, contextWindowTokens: 204800, releasedAt: "2025-10-27" },
    { id: "MiniMax-M2-Stable", maxOutput: 131072, contextWindowTokens: 204800, releasedAt: "2025-10-27" },
    { id: "MiniMax-M1", maxOutput: 40000, contextWindowTokens: 1000192, releasedAt: "2025-06-16" },
    { id: "MiniMax-Text-01", maxOutput: 40000, contextWindowTokens: 1000192, releasedAt: "2025-01-15" },
  ],
};
