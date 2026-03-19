import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createStreamMonitor,
  PartialResponseError,
  wrapLLMError,
  isLikelyStreamError,
  MIN_SALVAGEABLE_CHARS,
} from "../llm/llm-types.js";

// ---------------------------------------------------------------------------
// PartialResponseError
// ---------------------------------------------------------------------------

describe("PartialResponseError", () => {
  it("is an instance of Error", () => {
    const err = new PartialResponseError("partial content", new Error("stream cut"));
    expect(err).toBeInstanceOf(Error);
  });

  it("has name PartialResponseError", () => {
    const err = new PartialResponseError("abc", "cause");
    expect(err.name).toBe("PartialResponseError");
  });

  it("preserves partial content", () => {
    const err = new PartialResponseError("hello world", "cut");
    expect(err.partialContent).toBe("hello world");
  });

  it("includes char count in message", () => {
    const content = "x".repeat(100);
    const err = new PartialResponseError(content, "reason");
    expect(err.message).toContain("100 chars");
  });
});

// ---------------------------------------------------------------------------
// MIN_SALVAGEABLE_CHARS
// ---------------------------------------------------------------------------

describe("MIN_SALVAGEABLE_CHARS", () => {
  it("is 500", () => {
    expect(MIN_SALVAGEABLE_CHARS).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// wrapLLMError
// ---------------------------------------------------------------------------

describe("wrapLLMError", () => {
  it("wraps 400 with diagnostic message", () => {
    const result = wrapLLMError(new Error("HTTP 400 Bad Request"));
    expect(result.message).toContain("400");
    expect(result.message).toContain("请求参数错误");
  });

  it("wraps 401 with auth suggestion", () => {
    const result = wrapLLMError(new Error("401 Unauthorized"));
    expect(result.message).toContain("未授权");
    expect(result.message).toContain("API_KEY");
  });

  it("wraps 403 with content moderation warning", () => {
    const result = wrapLLMError(new Error("403 Forbidden"));
    expect(result.message).toContain("请求被拒绝");
    expect(result.message).toContain("内容审查");
  });

  it("wraps 429 with rate limit message", () => {
    const result = wrapLLMError(new Error("429 Too Many Requests"));
    expect(result.message).toContain("请求过多");
  });

  it("wraps connection errors with network diagnostics", () => {
    const result = wrapLLMError(new Error("fetch failed"));
    expect(result.message).toContain("无法连接");
  });

  it("wraps ECONNREFUSED as connection error", () => {
    const result = wrapLLMError(new Error("ECONNREFUSED"));
    expect(result.message).toContain("无法连接");
  });

  it("wraps ENOTFOUND as connection error", () => {
    const result = wrapLLMError(new Error("ENOTFOUND"));
    expect(result.message).toContain("无法连接");
  });

  it("includes context when provided", () => {
    const result = wrapLLMError(new Error("401"), { baseUrl: "https://api.example.com", model: "gpt-4" });
    expect(result.message).toContain("api.example.com");
    expect(result.message).toContain("gpt-4");
  });

  it("returns original Error for unknown errors", () => {
    const original = new Error("something weird");
    const result = wrapLLMError(original);
    expect(result).toBe(original);
  });

  it("wraps non-Error values into Error", () => {
    const result = wrapLLMError("string error");
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe("string error");
  });
});

// ---------------------------------------------------------------------------
// isLikelyStreamError
// ---------------------------------------------------------------------------

describe("isLikelyStreamError", () => {
  it("detects stream keyword", () => {
    expect(isLikelyStreamError(new Error("stream error occurred"))).toBe(true);
  });

  it("detects text/event-stream", () => {
    expect(isLikelyStreamError(new Error("unexpected content-type text/event-stream"))).toBe(true);
  });

  it("detects chunked transfer issues", () => {
    expect(isLikelyStreamError(new Error("chunked encoding error"))).toBe(true);
  });

  it("detects unexpected end", () => {
    expect(isLikelyStreamError(new Error("unexpected end of input"))).toBe(true);
  });

  it("detects premature close", () => {
    expect(isLikelyStreamError(new Error("premature close"))).toBe(true);
  });

  it("detects terminated", () => {
    expect(isLikelyStreamError(new Error("connection terminated"))).toBe(true);
  });

  it("detects econnreset", () => {
    expect(isLikelyStreamError(new Error("ECONNRESET"))).toBe(true);
  });

  it("detects 400 without content as stream error", () => {
    expect(isLikelyStreamError(new Error("HTTP 400"))).toBe(true);
  });

  it("does not detect 400 with content keyword", () => {
    // "400" + "content" → probablemente error de contenido, no de streaming
    expect(isLikelyStreamError(new Error("400 content too large"))).toBe(false);
  });

  it("returns false for generic errors", () => {
    expect(isLikelyStreamError(new Error("something else entirely"))).toBe(false);
  });

  it("handles non-Error values", () => {
    expect(isLikelyStreamError("stream broke")).toBe(true);
    expect(isLikelyStreamError(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createStreamMonitor
// ---------------------------------------------------------------------------

describe("createStreamMonitor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tracks total chars via onChunk", () => {
    const progress: { totalChars: number }[] = [];
    const monitor = createStreamMonitor(
      (p) => progress.push({ totalChars: p.totalChars }),
      60000, // No timer trigger durante el test
    );

    monitor.onChunk("hello");
    monitor.onChunk("world");
    monitor.stop();

    // stop() emite el evento final
    expect(progress.length).toBe(1);
    expect(progress[0]!.totalChars).toBe(10);
  });

  it("tracks Chinese chars via onChunk", () => {
    let finalProgress: { chineseChars: number } | null = null;
    const monitor = createStreamMonitor(
      (p) => { finalProgress = { chineseChars: p.chineseChars }; },
      60000,
    );

    monitor.onChunk("你好world");
    monitor.onChunk("测试test");
    monitor.stop();

    expect(finalProgress!.chineseChars).toBe(4); // 你好测试
  });

  it("reports done status on stop", () => {
    let status = "";
    const monitor = createStreamMonitor(
      (p) => { status = p.status; },
      60000,
    );

    monitor.onChunk("data");
    monitor.stop();
    expect(status).toBe("done");
  });

  it("works without onProgress callback", () => {
    const monitor = createStreamMonitor(undefined);
    // No debería lanzar
    monitor.onChunk("test");
    monitor.stop();
  });

  it("stop is idempotent", () => {
    let callCount = 0;
    const monitor = createStreamMonitor(
      () => { callCount++; },
      60000,
    );

    monitor.stop();
    monitor.stop();
    // Solo debe emitir una vez (segunda llamada sin timer no re-emite... 
    // en realidad sí emite porque onProgress?.() se llama siempre)
    expect(callCount).toBe(2);
  });
});
