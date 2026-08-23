import { describe, expect, it } from "vitest";
import { classifyLLMCallFailure, isTransientLLMHttpError } from "../llm/provider.js";

describe("isTransientLLMHttpError", () => {
  it("classifies the bounded autonomous HTTP set (408/429/500/502/503/504)", () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(classifyLLMCallFailure(Object.assign(new Error(`HTTP ${status}`), { status }))).toMatchObject({
        classification: "RETRYABLE_PROVIDER_HTTP",
        httpStatus: status,
      });
    }
  });

  it("matches the real aggregator 503 message that aborted whole runs", () => {
    expect(
      isTransientLLMHttpError(
        new Error("503 The model provider is temporarily unavailable. Please retry later or contact support."),
      ),
    ).toBe(true);
  });

  it("matches transient phrasing without a status code", () => {
    expect(isTransientLLMHttpError(new Error("the model is currently overloaded"))).toBe(true);
    expect(isTransientLLMHttpError(new Error("service unavailable, try again later"))).toBe(true);
    expect(isTransientLLMHttpError(new Error("rate limit exceeded"))).toBe(true);
  });

  it("looks through a nested cause", () => {
    const err = new Error("upstream call failed") as Error & { cause?: unknown };
    err.cause = new Error("503 temporarily unavailable");
    expect(isTransientLLMHttpError(err)).toBe(true);
  });

  it("does NOT retry permanent failures", () => {
    expect(isTransientLLMHttpError(new Error("401 Unauthorized"))).toBe(false);
    expect(isTransientLLMHttpError(new Error("403 Forbidden"))).toBe(false);
    expect(isTransientLLMHttpError(new Error("400 Bad Request"))).toBe(false);
    expect(isTransientLLMHttpError(new Error("some ordinary validation error"))).toBe(false);
  });

  it("does NOT retry a 500 / MODEL_NOT_AVAILABLE (model not on inference — retry is futile)", () => {
    expect(
      isTransientLLMHttpError(new Error('{"code":500,"reason":"MODEL_NOT_AVAILABLE","message":"model not available"}')),
    ).toBe(false);
  });

  it("classifies pre-transport DNS/connect failures separately from ambiguous disconnects", () => {
    const dns = Object.assign(new Error("getaddrinfo failed"), { code: "ENOTFOUND" });
    expect(classifyLLMCallFailure(dns)).toMatchObject({
      classification: "RETRYABLE_PRE_TRANSPORT",
      transportStarted: false,
      transportReturned: false,
    });
    const reset = Object.assign(new Error("socket reset after request write"), { code: "ECONNRESET" });
    expect(classifyLLMCallFailure(reset)).toMatchObject({
      classification: "AMBIGUOUS_PROVIDER_OUTCOME",
      transportStarted: true,
      transportReturned: false,
    });
    const provenPreSendReset = Object.assign(new Error("socket reset before request write"), {
      code: "ECONNRESET",
      transportStarted: false,
    });
    expect(classifyLLMCallFailure(provenPreSendReset)).toMatchObject({
      classification: "RETRYABLE_PRE_TRANSPORT",
      transportStarted: false,
      transportReturned: false,
    });
  });

  it("treats an explicit temporary Provider rejection as returned, not as a speculative pre-send failure", () => {
    expect(classifyLLMCallFailure(new Error("Provider temporarily unavailable; try again later"))).toMatchObject({
      classification: "RETRYABLE_PROVIDER_HTTP",
      transportStarted: true,
      transportReturned: true,
    });
  });

  it("reads HTTP status and Retry-After without treating 400/401/403 as retryable", () => {
    const retryable = Object.assign(new Error("temporarily unavailable"), {
      status: 503,
      headers: { "retry-after": "600" },
    });
    expect(classifyLLMCallFailure(retryable)).toMatchObject({
      classification: "RETRYABLE_PROVIDER_HTTP",
      httpStatus: 503,
      retryAfterMs: 600_000,
      transportReturned: true,
    });
    for (const status of [400, 401, 403]) {
      expect(classifyLLMCallFailure(Object.assign(new Error("provider rejected request"), { status }))).toMatchObject({
        classification: "DETERMINISTIC_PROVIDER_ERROR",
        httpStatus: status,
      });
    }
  });
});
