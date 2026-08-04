/**
 * 火山方舟 Coding Plan (豆包编程订阅)
 *
 * - 官网：https://www.volcengine.com/product/ark
 * - 订阅入口：https://www.volcengine.com/docs/82379/1925114
 * - 快速开始：https://www.volcengine.com/docs/82379/1928261
 * - 支持的模型：https://www.volcengine.com/docs/82379/1928262?lang=zh
 * - 模型价格：https://www.volcengine.com/docs/82379/1544106
 * - Anthropic 协议 baseUrl：https://ark.cn-beijing.volces.com/api/coding
 *
 * 火山方舟 Coding Plan 是火山引擎针对编程场景的订阅服务，订阅包内解锁多家
 * 主力编程模型（豆包 / MiniMax / GLM / DeepSeek / Kimi），走 Anthropic
 * 兼容协议，Claude Code / Cursor 等客户端可直连。
 *
 * 注：baseUrl 是 /api/coding（不是 /api/v3/anthropic）-- 后者是火山通用
 * Anthropic 兼容接入，和 CodingPlan 订阅计量不通。
 *
 * 长度限制来自 1928262。下线型号保留 enabled=false + status="deprecated" +
 * replacement 指向替代品，老配置不会断。
 */
import type { InkosEndpoint } from "../types.js";

export const VOLCENGINE_CODING_PLAN: InkosEndpoint = {
  id: "volcengineCodingPlan",
  label: "火山 Coding Plan",
  group: "codingPlan",
  api: "anthropic-messages",
  baseUrl: "https://ark.cn-beijing.volces.com/api/coding",
  checkModel: "doubao-seed-2.0-code",
  temperatureRange: [0, 1],
  defaultTemperature: 0.7,
  writingTemperature: 1,
  models: [
    // --- Doubao 豆包（Seed 2.0 全系 + 老版均支持多模态视觉理解） ---
    { id: "doubao-seed-2.0-code", maxOutput: 128000, contextWindowTokens: 256000, enabled: true, releasedAt: "2026-02-15" },
    { id: "doubao-seed-2.0-pro", maxOutput: 128000, contextWindowTokens: 256000, enabled: true, releasedAt: "2026-02-15" },
    { id: "doubao-seed-2.0-lite", maxOutput: 128000, contextWindowTokens: 256000, enabled: true, releasedAt: "2026-02-15" },
    { id: "doubao-seed-code", maxOutput: 32000, contextWindowTokens: 256000, enabled: true, releasedAt: "2025-11-01" },

    // --- MiniMax（M2.7 抵扣系数高，建议重难点用；M3 新一代） ---
    { id: "minimax-m2.7", maxOutput: 128000, contextWindowTokens: 200000, enabled: true},
    { id: "minimax-m3", maxOutput: 128000, contextWindowTokens: 512000, enabled: true},
    { id: "minimax-m2.5", maxOutput: 128000, contextWindowTokens: 200000, enabled: false, status: "deprecated"},

    // --- Kimi（走 Moonshot，强制 temperature=1，违反 400） ---
    // K2.6 抵扣系数高；K2.7-Code 文本/图片/视频输入都支持
    { id: "kimi-k2.6", maxOutput: 32000, contextWindowTokens: 256000, enabled: true, temperature:1},
    { id: "kimi-k2.7-code", maxOutput: 32000, contextWindowTokens: 256000, enabled: true, temperature:1},

    // --- GLM（智谱，5.2 公开名，API 实际走 glm-latest 别名） ---
    { id: "glm-5.2", maxOutput: 128000, contextWindowTokens: 1024000, enabled: true, deploymentName: "glm-latest" },


    // --- DeepSeek（V4 默认开深度思考，尝鲜版遇拥堵建议切换） ---
    { id: "deepseek-v4-flash", maxOutput: 384000, contextWindowTokens: 1024000, enabled: true},
    { id: "deepseek-v4-pro", maxOutput: 384000, contextWindowTokens: 1024000, enabled: true},

  ],
};
