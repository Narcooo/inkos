import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage, Model, Api } from "@mariozechner/pi-ai";
import {
  __resetFixedTemperatureWarnings,
  chatCompletion,
  type LLMClient,
} from "../llm/provider.js";

// ── Mock @mariozechner/pi-ai ──────────────────────────────────────────────────
// We intercept streamSimple so tests don't hit the network.

const mockStreamSimple = vi.fn();

vi.mock("@mariozechner/pi-ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("@mariozechner/pi-ai")>();
  return {
    ...original,
    streamSimple: (...args: unknown[]) => mockStreamSimple(...args),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const MOCK_USAGE = {
  input: 11,
  output: 7,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 18,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function makeAssistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions" as Api,
    provider: "openai",
    model: "test-model",
    usage: MOCK_USAGE,
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

/** Builds an async iterable that emits the given events. */
function makeEventStream(
  events: Array<Record<string, unknown>>,
): AsyncIterable<Record<string, unknown>> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>> {
      let i = 0;
      return {
        async next() {
          if (i < events.length) return { value: events[i++]!, done: false };
          return { value: undefined as unknown as Record<string, unknown>, done: true };
        },
      };
    },
  };
}

/** Stream that emits one text_delta and then done. */
function makeTextStream(text: string): AsyncIterable<Record<string, unknown>> {
  const msg = makeAssistantMessage(text);
  return makeEventStream([
    { type: "text_delta", contentIndex: 0, delta: text, partial: msg },
    { type: "done", reason: "stop", message: msg },
  ]);
}

/** Stream that emits only done with empty content. */
function makeEmptyStream(): AsyncIterable<Record<string, unknown>> {
  const msg = makeAssistantMessage("");
  return makeEventStream([
    { type: "done", reason: "stop", message: msg },
  ]);
}

/** Stream that throws immediately. */
function makeErrorStream(message: string): AsyncIterable<Record<string, unknown>> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>> {
      return {
        async next() {
          throw new Error(message);
        },
      };
    },
  };
}

const MOCK_PI_MODEL: Model<Api> = {
  id: "test-model",
  name: "test-model",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 8192,
};

function makeClient(temperature = 0.7, extra: Partial<LLMClient> = {}): LLMClient {
  return {
    provider: "openai",
    apiFormat: "chat",
    stream: true,
    _piModel: MOCK_PI_MODEL,
    _apiKey: "test-key",
    defaults: {
      temperature,
      maxTokens: 512,
      thinkingBudget: 0,
      maxTokensCap: null,
      extra: {},
    },
    ...extra,
  };
}

async function captureError(task: Promise<unknown>): Promise<Error> {
  try {
    await task;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected promise to reject");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("chatCompletion via pi-ai", () => {
  beforeEach(() => {
    mockStreamSimple.mockReset();
  });

  it("returns text content from a successful stream", async () => {
    mockStreamSimple.mockReturnValue(makeTextStream("hello world"));

    const client = makeClient();
    const result = await chatCompletion(client, "test-model", [
      { role: "user", content: "ping" },
    ]);

    expect(result.content).toBe("hello world");
    expect(result.usage.promptTokens).toBe(11);
    expect(result.usage.completionTokens).toBe(7);
    expect(result.usage.totalTokens).toBe(18);
    expect(mockStreamSimple).toHaveBeenCalledOnce();
  });

  it("throws when stream produces no text content", async () => {
    mockStreamSimple.mockReturnValue(makeEmptyStream());

    const client = makeClient();
    const error = await captureError(
      chatCompletion(client, "test-model", [{ role: "user", content: "ping" }]),
    );

    expect(error.message).toContain("empty response");
  });

  it("wraps 400 API errors with a user-friendly message", async () => {
    mockStreamSimple.mockReturnValue(makeErrorStream("400 Bad Request"));

    const client = makeClient();
    const error = await captureError(
      chatCompletion(client, "test-model", [{ role: "user", content: "ping" }]),
    );

    expect(error.message).toContain("API 返回 400");
    expect(error.message).toContain("检查提供方文档");
  });

  it("wraps 401 errors with an unauthorized message", async () => {
    mockStreamSimple.mockReturnValue(makeErrorStream("401 Unauthorized"));

    const client = makeClient();
    const error = await captureError(
      chatCompletion(client, "test-model", [{ role: "user", content: "ping" }]),
    );

    expect(error.message).toContain("API 返回 401");
  });

  it("wraps connection errors with a friendly message", async () => {
    mockStreamSimple.mockReturnValue(makeErrorStream("fetch failed: ECONNREFUSED"));

    const client = makeClient();
    const error = await captureError(
      chatCompletion(client, "test-model", [{ role: "user", content: "ping" }]),
    );

    expect(error.message).toContain("无法连接到 API 服务");
  });

  it("passes temperature and maxTokens to streamSimple", async () => {
    mockStreamSimple.mockReturnValue(makeTextStream("ok"));

    const client = makeClient(0.5);
    await chatCompletion(client, "test-model", [{ role: "user", content: "hi" }], {
      temperature: 0.3,
      maxTokens: 256,
    });

    const opts = mockStreamSimple.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(opts.temperature).toBe(0.3);
    expect(opts.maxTokens).toBe(256);
  });

  it("uses client defaults when no per-call overrides are provided", async () => {
    mockStreamSimple.mockReturnValue(makeTextStream("ok"));

    const client = makeClient(0.8);
    await chatCompletion(client, "test-model", [{ role: "user", content: "hi" }]);

    const opts = mockStreamSimple.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(opts.temperature).toBe(0.8);
    expect(opts.maxTokens).toBe(512);
  });

  it("calls onTextDelta for each text chunk", async () => {
    const msg = makeAssistantMessage("abc");
    mockStreamSimple.mockReturnValue(makeEventStream([
      { type: "text_delta", contentIndex: 0, delta: "a", partial: msg },
      { type: "text_delta", contentIndex: 0, delta: "b", partial: msg },
      { type: "text_delta", contentIndex: 0, delta: "c", partial: msg },
      { type: "done", reason: "stop", message: msg },
    ]));

    const deltas: string[] = [];
    const client = makeClient();
    await chatCompletion(client, "test-model", [{ role: "user", content: "hi" }], {
      onTextDelta: (d) => deltas.push(d),
    });

    expect(deltas).toEqual(["a", "b", "c"]);
  });
});

describe("chatCompletion fixed-temperature clamp (thinking models)", () => {
  beforeEach(() => {
    __resetFixedTemperatureWarnings();
    mockStreamSimple.mockReset();
    mockStreamSimple.mockReturnValue(makeTextStream("ok"));
  });

  it("forces temperature=1 for kimi-k2.5 even when client default is 0.7", async () => {
    const client = makeClient(0.7);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await chatCompletion(client, "kimi-k2.5", [{ role: "user", content: "hi" }]);

    const opts = mockStreamSimple.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(opts.temperature).toBe(1);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("kimi-k2.5");
    warn.mockRestore();
  });

  it("clamps per-call temperature override (0.3) to 1 for kimi-k2.5", async () => {
    const client = makeClient(0.7);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await chatCompletion(
      client,
      "kimi-k2.5",
      [{ role: "user", content: "hi" }],
      { temperature: 0.3 },
    );

    const opts = mockStreamSimple.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(opts.temperature).toBe(1);
  });

  it("only warns once per model name across multiple calls", async () => {
    const client = makeClient(0.7);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await chatCompletion(client, "kimi-k2.5", [{ role: "user", content: "a" }]);
    await chatCompletion(client, "kimi-k2.5", [{ role: "user", content: "b" }]);
    await chatCompletion(client, "kimi-k2.5", [{ role: "user", content: "c" }]);

    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("also clamps any model name containing 'thinking'", async () => {
    const client = makeClient(0.5);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await chatCompletion(client, "kimi-thinking-preview", [
      { role: "user", content: "hi" },
    ]);

    const opts = mockStreamSimple.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(opts.temperature).toBe(1);
  });

  it("leaves regular models untouched (no clamp, no warning)", async () => {
    const client = makeClient(0.7);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await chatCompletion(
      client,
      "moonshot-v1-32k",
      [{ role: "user", content: "hi" }],
      { temperature: 0.3 },
    );

    const opts = mockStreamSimple.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(opts.temperature).toBe(0.3);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not warn when requested temperature is already 1", async () => {
    const client = makeClient(1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await chatCompletion(client, "kimi-k2.5", [{ role: "user", content: "hi" }]);

    const opts = mockStreamSimple.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(opts.temperature).toBe(1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
