import { describe, it, expect, beforeEach } from "vitest";
import {
  ModelFailoverManager,
  createFailoverManager,
  isQuotaError,
  createDefaultFailoverConfig,
} from "../llm/model-failover-manager.js";

describe("isQuotaError", () => {
  it("should detect 429 errors", () => {
    expect(isQuotaError(new Error("API 返回 429 (请求过多)"))).toBe(true);
  });

  it("should detect quota exceeded errors", () => {
    expect(isQuotaError(new Error("You exceeded your current quota"))).toBe(true);
    expect(isQuotaError(new Error("insufficient_quota"))).toBe(true);
  });

  it("should detect rate limit errors", () => {
    expect(isQuotaError(new Error("Rate limit exceeded"))).toBe(true);
    expect(isQuotaError(new Error("rate_limit_exceeded"))).toBe(true);
  });

  it("should detect Chinese quota errors", () => {
    expect(isQuotaError(new Error("额度已用完"))).toBe(true);
    expect(isQuotaError(new Error("超出配额"))).toBe(true);
    expect(isQuotaError(new Error("余额不足"))).toBe(true);
  });

  it("should not detect other errors", () => {
    expect(isQuotaError(new Error("API 返回 400"))).toBe(false);
    expect(isQuotaError(new Error("Connection error"))).toBe(false);
    expect(isQuotaError(new Error("Some random error"))).toBe(false);
  });
});

describe("ModelFailoverManager", () => {
  let manager: ModelFailoverManager;

  const config = {
    enabled: true,
    mode: "auto" as const,
    fallbacks: [
      { service: "moonshot", model: "kimi-k2.5" },
      { service: "deepseek", model: "deepseek-chat" },
    ],
    maxAutoSwitches: 3,
    retryDelayMs: 100,
  };

  beforeEach(() => {
    manager = createFailoverManager(config, "openai", "gpt-4");
  });

  it("should be created with initial state", () => {
    const state = manager.getState();
    expect(state.currentService).toBe("openai");
    expect(state.currentModel).toBe("gpt-4");
    expect(state.switchedCount).toBe(0);
  });

  it("should detect quota errors", () => {
    const quotaError = new Error("You exceeded your current quota");
    expect(manager.isQuotaErrorForCurrentService(quotaError)).toBe(true);
  });

  it("should not allow auto switch when disabled", () => {
    const disabledManager = createFailoverManager(
      { ...config, enabled: false },
      "openai",
      "gpt-4",
    );
    expect(disabledManager.canAutoSwitch()).toBe(false);
  });

  it("should not allow auto switch in manual mode", () => {
    const manualManager = createFailoverManager(
      { ...config, mode: "manual" },
      "openai",
      "gpt-4",
    );
    expect(manualManager.canAutoSwitch()).toBe(false);
  });

  it("should require manual switch in manual mode", () => {
    const manualManager = createFailoverManager(
      { ...config, mode: "manual" },
      "openai",
      "gpt-4",
    );
    const quotaError = new Error("You exceeded your current quota");
    expect(manualManager.requiresManualSwitch(quotaError)).toBe(true);
  });

  it("should allow auto switch when enabled and in auto mode", () => {
    expect(manager.canAutoSwitch()).toBe(true);
  });

  it("should record errors", () => {
    const quotaError = new Error("You exceeded your current quota");
    manager.recordError("openai", "gpt-4", quotaError);
    expect(manager.isQuotaErrorForCurrentService(quotaError)).toBe(true);
  });

  it("should create SSE event for failover", () => {
    const result = {
      switched: true,
      newService: "moonshot",
      newModel: "kimi-k2.5",
      fallbackIndex: 0,
      reason: "API quota exceeded",
    };
    const event = manager.createSSEEvent(result, "openai", "gpt-4");
    expect(event.type).toBe("model:failover");
    expect(event.previousService).toBe("openai");
    expect(event.newService).toBe("moonshot");
  });
});

describe("createDefaultFailoverConfig", () => {
  it("should return disabled config by default", () => {
    const config = createDefaultFailoverConfig();
    expect(config.enabled).toBe(false);
    expect(config.mode).toBe("manual");
    expect(config.fallbacks).toEqual([]);
    expect(config.maxAutoSwitches).toBe(3);
    expect(config.retryDelayMs).toBe(5000);
  });
});
