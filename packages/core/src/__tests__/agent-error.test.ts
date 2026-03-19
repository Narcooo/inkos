import { describe, it, expect } from "vitest";
import { AgentError } from "../agents/agent-error.js";

describe("AgentError", () => {
  // -------------------------------------------------------------------------
  // Construcción del mensaje
  // -------------------------------------------------------------------------

  it("formats message with agent name prefix", () => {
    const err = new AgentError({
      agent: "writer",
      message: "LLM timeout",
      cause: new Error("timeout"),
    });
    expect(err.message).toContain("[writer]");
    expect(err.message).toContain("LLM timeout");
  });

  it("includes bookId in message when provided", () => {
    const err = new AgentError({
      agent: "auditor",
      message: "audit failed",
      cause: null,
      bookId: "my-novel",
    });
    expect(err.message).toContain('book="my-novel"');
  });

  it("includes chapterNumber in message when provided", () => {
    const err = new AgentError({
      agent: "reviser",
      message: "revise failed",
      cause: null,
      chapterNumber: 42,
    });
    expect(err.message).toContain("ch=42");
  });

  it("includes both bookId and chapterNumber", () => {
    const err = new AgentError({
      agent: "writer",
      message: "failed",
      cause: null,
      bookId: "book-1",
      chapterNumber: 7,
    });
    expect(err.message).toMatch(/book="book-1".*ch=7/);
  });

  it("omits bookId and chapterNumber when not provided", () => {
    const err = new AgentError({
      agent: "writer",
      message: "generic failure",
      cause: null,
    });
    expect(err.message).not.toContain("book=");
    expect(err.message).not.toContain("ch=");
  });

  // -------------------------------------------------------------------------
  // Propiedades del error
  // -------------------------------------------------------------------------

  it("has name 'AgentError'", () => {
    const err = new AgentError({
      agent: "writer",
      message: "error",
      cause: null,
    });
    expect(err.name).toBe("AgentError");
  });

  it("is an instance of Error", () => {
    const err = new AgentError({
      agent: "writer",
      message: "error",
      cause: null,
    });
    expect(err).toBeInstanceOf(Error);
  });

  it("preserves the original cause", () => {
    const original = new TypeError("network issue");
    const err = new AgentError({
      agent: "writer",
      message: "chat failed",
      cause: original,
    });
    expect(err.cause).toBe(original);
  });

  // -------------------------------------------------------------------------
  // Retryable heuristic
  // -------------------------------------------------------------------------

  it("uses explicit retryable flag when provided", () => {
    const err = new AgentError({
      agent: "writer",
      message: "forced retry",
      cause: new Error("401 unauthorized"),
      retryable: true,
    });
    // Aunque 401 normalmente no es reintentable, el flag explícito gana
    expect(err.retryable).toBe(true);
  });

  it("detects 429 as retryable", () => {
    const err = new AgentError({
      agent: "writer",
      message: "rate limited",
      cause: new Error("API returned 429"),
    });
    expect(err.retryable).toBe(true);
  });

  it("detects 502 as retryable", () => {
    const err = new AgentError({
      agent: "writer",
      message: "bad gateway",
      cause: new Error("502 Bad Gateway"),
    });
    expect(err.retryable).toBe(true);
  });

  it("detects 503 as retryable", () => {
    const err = new AgentError({
      agent: "writer",
      message: "service unavailable",
      cause: new Error("503 Service Unavailable"),
    });
    expect(err.retryable).toBe(true);
  });

  it("detects ECONNRESET as retryable", () => {
    const err = new AgentError({
      agent: "writer",
      message: "connection reset",
      cause: new Error("ECONNRESET"),
    });
    expect(err.retryable).toBe(true);
  });

  it("detects ETIMEDOUT as retryable", () => {
    const err = new AgentError({
      agent: "writer",
      message: "timed out",
      cause: new Error("ETIMEDOUT"),
    });
    expect(err.retryable).toBe(true);
  });

  it("detects fetch failed as retryable", () => {
    const err = new AgentError({
      agent: "writer",
      message: "fetch error",
      cause: new TypeError("fetch failed"),
    });
    expect(err.retryable).toBe(true);
  });

  it("detects 401 as non-retryable", () => {
    const err = new AgentError({
      agent: "writer",
      message: "unauthorized",
      cause: new Error("401 Unauthorized"),
    });
    expect(err.retryable).toBe(false);
  });

  it("detects 403 as non-retryable", () => {
    const err = new AgentError({
      agent: "writer",
      message: "forbidden",
      cause: new Error("403 Forbidden"),
    });
    expect(err.retryable).toBe(false);
  });

  it("detects 400 as non-retryable", () => {
    const err = new AgentError({
      agent: "writer",
      message: "bad request",
      cause: new Error("400 Bad Request"),
    });
    expect(err.retryable).toBe(false);
  });

  it("detects invalid_api_key as non-retryable", () => {
    const err = new AgentError({
      agent: "writer",
      message: "bad key",
      cause: new Error("invalid_api_key"),
    });
    expect(err.retryable).toBe(false);
  });

  it("defaults to non-retryable for unknown errors", () => {
    const err = new AgentError({
      agent: "writer",
      message: "unknown",
      cause: new Error("something weird happened"),
    });
    expect(err.retryable).toBe(false);
  });

  it("handles null cause gracefully", () => {
    const err = new AgentError({
      agent: "writer",
      message: "null cause",
      cause: null,
    });
    expect(err.retryable).toBe(false);
    expect(err.cause).toBeNull();
  });
});
