import { describe, it, expect, vi } from "vitest";
import {
  withRetry,
  isRetryableError,
  computeBackoffDelay,
} from "../llm/retry.js";

// Función de retardo falsa para que los tests no esperen realmente
const noDelay = () => Promise.resolve();

describe("isRetryableError", () => {
  it("returns true for 429 rate limit errors", () => {
    expect(isRetryableError(new Error("API 返回 429 (请求过多)"))).toBe(true);
  });

  it("returns true for 502 gateway errors", () => {
    expect(isRetryableError(new Error("502 Bad Gateway"))).toBe(true);
  });

  it("returns true for 503 service unavailable", () => {
    expect(isRetryableError(new Error("503 Service Unavailable"))).toBe(true);
  });

  it("returns true for ECONNRESET", () => {
    expect(isRetryableError(new Error("ECONNRESET"))).toBe(true);
  });

  it("returns true for ETIMEDOUT", () => {
    expect(isRetryableError(new Error("ETIMEDOUT"))).toBe(true);
  });

  it("returns true for socket hang up", () => {
    expect(isRetryableError(new Error("socket hang up"))).toBe(true);
  });

  it("returns true for fetch failed (TypeError)", () => {
    expect(isRetryableError(new TypeError("fetch failed"))).toBe(true);
  });

  it("returns true for wrapped Chinese 429 message", () => {
    expect(isRetryableError(new Error("请求过多"))).toBe(true);
  });

  it("returns false for 401 unauthorized", () => {
    expect(isRetryableError(new Error("API 返回 401 (未授权)"))).toBe(false);
  });

  it("returns false for 403 forbidden", () => {
    expect(isRetryableError(new Error("API 返回 403 (请求被拒绝)"))).toBe(false);
  });

  it("returns false for 400 bad request", () => {
    expect(isRetryableError(new Error("400 Bad Request"))).toBe(false);
  });

  it("returns false for invalid_api_key", () => {
    expect(isRetryableError(new Error("invalid_api_key"))).toBe(false);
  });

  it("returns false for unknown errors without retryable patterns", () => {
    expect(isRetryableError(new Error("something else"))).toBe(false);
  });
});

describe("computeBackoffDelay", () => {
  it("returns base delay for attempt 0", () => {
    // Con jitter entre 50%-100%, el resultado debe estar entre 500 y 1000
    const delay = computeBackoffDelay(0, 1000, 30000);
    expect(delay).toBeGreaterThanOrEqual(500);
    expect(delay).toBeLessThanOrEqual(1000);
  });

  it("doubles delay for each attempt", () => {
    // attempt=2 → base * 4 = 4000, con jitter entre 2000-4000
    const delay = computeBackoffDelay(2, 1000, 30000);
    expect(delay).toBeGreaterThanOrEqual(2000);
    expect(delay).toBeLessThanOrEqual(4000);
  });

  it("caps at maxDelayMs", () => {
    // attempt=10 → base * 1024 = 1024000, pero capped a 30000, con jitter 15000-30000
    const delay = computeBackoffDelay(10, 1000, 30000);
    expect(delay).toBeGreaterThanOrEqual(15000);
    expect(delay).toBeLessThanOrEqual(30000);
  });
});

describe("withRetry", () => {
  it("returns result immediately on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { delayFn: noDelay });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable error and succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("502 Bad Gateway"))
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValue("recovered");

    const result = await withRetry(fn, { delayFn: noDelay });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-retryable errors (401)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("API 返回 401 (未授权)"));

    await expect(
      withRetry(fn, { delayFn: noDelay }),
    ).rejects.toThrow("401");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry non-retryable errors (403)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("API 返回 403 (请求被拒绝)"));

    await expect(
      withRetry(fn, { delayFn: noDelay }),
    ).rejects.toThrow("403");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws last error after exhausting all retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("429 rate limited"));

    await expect(
      withRetry(fn, { maxRetries: 2, delayFn: noDelay }),
    ).rejects.toThrow("429");
    // 1 intento inicial + 2 reintentos = 3 llamadas
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("respects maxRetries option", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("502"));

    await expect(
      withRetry(fn, { maxRetries: 1, delayFn: noDelay }),
    ).rejects.toThrow("502");
    // 1 intento inicial + 1 reintento = 2 llamadas
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("calls delayFn between retries with increasing delays", async () => {
    const delays: number[] = [];
    const trackingDelay = async (ms: number) => { delays.push(ms); };

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("502"))
      .mockRejectedValueOnce(new Error("502"))
      .mockResolvedValue("ok");

    await withRetry(fn, {
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      delayFn: trackingDelay,
    });

    expect(delays).toHaveLength(2);
    // Primer reintento (attempt=0): 500-1000ms
    expect(delays[0]).toBeGreaterThanOrEqual(500);
    expect(delays[0]).toBeLessThanOrEqual(1000);
    // Segundo reintento (attempt=1): 1000-2000ms
    expect(delays[1]).toBeGreaterThanOrEqual(1000);
    expect(delays[1]).toBeLessThanOrEqual(2000);
  });

  it("logs retry attempts to stderr", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("429 rate limited"))
      .mockResolvedValue("ok");

    await withRetry(fn, { delayFn: noDelay });

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("[llm-retry]"),
    );

    stderrSpy.mockRestore();
  });

  it("supports custom retryableCheck", async () => {
    const customCheck = (error: unknown) =>
      String(error).includes("CUSTOM_RETRYABLE");

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("CUSTOM_RETRYABLE error"))
      .mockResolvedValue("ok");

    const result = await withRetry(fn, {
      retryableCheck: customCheck,
      delayFn: noDelay,
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry unknown errors by default", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("unknown error xyz"));

    await expect(
      withRetry(fn, { delayFn: noDelay }),
    ).rejects.toThrow("unknown error xyz");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
