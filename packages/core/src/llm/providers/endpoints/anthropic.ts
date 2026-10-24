/**
 * Anthropic (Claude)
 *
 * - 官网：https://www.anthropic.com/
 * - 控制台：https://console.anthropic.com/
 * - API key：https://console.anthropic.com/settings/keys
 * - API 文档：https://docs.anthropic.com/en/api/
 * - 模型列表：https://docs.anthropic.com/en/docs/about-claude/models/overview
 */
import type { InkosEndpoint } from "../types.js";

export const ANTHROPIC: InkosEndpoint = {
  id: "anthropic",
  label: "Anthropic",
  group: "overseas",
  api: "anthropic-messages",
  baseUrl: "https://api.anthropic.com",
  checkModel: "claude-haiku-4-5-20251001",
  temperatureRange: [0, 1],
  defaultTemperature: 1.0,
  writingTemperature: 1.0,
  temperatureHint: "不要同时改 temperature 和 top_p",
  models: [
    {
      // https://platform.claude.com/docs/en/models/sonnet-5-5/overview
      id: "claude-sonnet-5-5",
      maxOutput: 128_000,
      contextWindowTokens: 1_000_000,
      enabled: true,
      releasedAt: "2026-09-28",
      supportsSampling: false,
    },
    {
      id: "claude-opus-4-6",
      maxOutput: 128_000,
      contextWindowTokens: 1_000_000,
      enabled: true,
      releasedAt: "2026-02-05",
    },
    {
      id: "claude-sonnet-4-6",
      maxOutput: 64_000,
      contextWindowTokens: 1_000_000,
      enabled: true,
      releasedAt: "2026-02-17",
    },
    {
      id: "claude-opus-4-5-20251101",
      maxOutput: 64_000,
      contextWindowTokens: 200_000,
      releasedAt: "2025-11-24",
    },
    {
      id: "claude-sonnet-4-5-20250929",
      maxOutput: 64_000,
      contextWindowTokens: 200_000,
      releasedAt: "2025-09-29",
    },
    {
      id: "claude-haiku-4-5-20251001",
      maxOutput: 64_000,
      contextWindowTokens: 200_000,
      enabled: true,
      releasedAt: "2025-10-16",
    },
    {
      id: "claude-opus-4-1-20250805",
      maxOutput: 32_000,
      contextWindowTokens: 200_000,
      releasedAt: "2025-08-05",
    },
    {
      id: "claude-opus-4-20250514",
      maxOutput: 32_000,
      contextWindowTokens: 200_000,
      releasedAt: "2025-05-23",
    },
    {
      id: "claude-sonnet-4-20250514",
      maxOutput: 64_000,
      contextWindowTokens: 200_000,
      releasedAt: "2025-05-23",
    },
    {
      id: "claude-3-haiku-20240307",
      maxOutput: 4096,
      contextWindowTokens: 200_000,
      releasedAt: "2024-03-07",
    },
  ],
};
