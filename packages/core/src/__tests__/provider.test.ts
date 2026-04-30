import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage, Model, Api } from "@mariozechner/pi-ai";
import {
  __resetFixedTemperatureWarnings,
  chatCompletion,
  type LLMClient,
} from "../llm/provider.js";

// ── Mock @mariozechner/pi-ai ──────────────────────────────────────────────────
// We intercept streamSimple so tests don't hit the network.

const mockStreamSimple = vi.fn();
const mockCompleteSimple = vi.fn();
const mockComplete = vi.fn();

vi.mock("@mariozechner/pi-ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("@mariozechner/pi-ai")>();
  return {
    ...original,
    streamSimple: (...args: unknown[]) => mockStreamSimple(...args),
    completeSimple: (...args: unknown[]) => mockCompleteSimple(...args),
    complete: (...args: unknown[]) => mockComplete(...args),
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
    service: "openai",
    configSource: "studio",
    apiFormat: "chat",
    stream: true,
    _piModel: MOCK_PI_MODEL,
    _apiKey: "test-key",
    defaults: {
      temperature,
      maxTokens: 512,
      thinkingBudget: 0,

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
    mockCompleteSimple.mockReset();
    mockComplete.mockReset();
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
    expect(error.message).toContain("temperature");
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

  it("uses completeSimple when client.stream is false", async () => {
    mockCompleteSimple.mockResolvedValue(makeAssistantMessage("offline hello"));

    const client = makeClient(0.7, { stream: false });
    const result = await chatCompletion(client, "test-model", [{ role: "user", content: "hi" }]);

    expect(result.content).toBe("offline hello");
    expect(mockCompleteSimple).toHaveBeenCalledOnce();
    expect(mockStreamSimple).not.toHaveBeenCalled();
  });

  it("uses native fetch transport for custom openai-compatible chat", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "你好！" } }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient(0.7, {
      service: "custom",
      stream: false,
      _piModel: {
        ...MOCK_PI_MODEL,
        provider: "openai",
        baseUrl: "https://gateway.example/v1",
      },
    });
    const result = await chatCompletion(client, "gpt-5.4", [{ role: "user", content: "nihao" }]);

    expect(result.content).toBe("你好！");
    expect(fetchMock).toHaveBeenCalledOnce();
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(payload.max_completion_tokens).toBe(512);
    expect(payload).not.toHaveProperty("max_tokens");
    expect(mockCompleteSimple).not.toHaveBeenCalled();
    expect(mockStreamSimple).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("falls back to max_tokens when a custom gateway rejects max_completion_tokens", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () => JSON.stringify({
          error: {
            param: "max_completion_tokens",
            message: "Unsupported parameter: 'max_completion_tokens'",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "fallback ok" } }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient(0.7, {
      service: "custom",
      stream: false,
      _piModel: {
        ...MOCK_PI_MODEL,
        provider: "openai",
        baseUrl: "https://gateway.example/v1",
      },
    });
    const result = await chatCompletion(client, "gpt-5.4-mini", [{ role: "user", content: "nihao" }], {
      maxTokens: 16,
    });

    expect(result.content).toBe("fallback ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstPayload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    const secondPayload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Record<string, unknown>;
    expect(firstPayload.max_completion_tokens).toBe(16);
    expect(firstPayload).not.toHaveProperty("max_tokens");
    expect(secondPayload.max_tokens).toBe(16);
    expect(secondPayload).not.toHaveProperty("max_completion_tokens");

    vi.unstubAllGlobals();
  });

  it("keeps legacy env custom openai-compatible chat on pi-ai path", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mockCompleteSimple.mockResolvedValue(makeAssistantMessage("legacy ok"));

    const client = makeClient(0.7, {
      service: "custom",
      configSource: "env",
      stream: false,
      _piModel: {
        ...MOCK_PI_MODEL,
        provider: "openai",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      },
    });

    const result = await chatCompletion(client, "gemma-4", [{ role: "user", content: "ping" }]);

    expect(result.content).toBe("legacy ok");
    expect(mockCompleteSimple).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("uses native fetch transport for custom anthropic-compatible non-stream chat", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "你好，Anthropic!" }],
        usage: { input_tokens: 5, output_tokens: 3 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient(0.7, {
      provider: "anthropic",
      service: "custom",
      stream: false,
      _piModel: {
        ...MOCK_PI_MODEL,
        provider: "anthropic",
        api: "anthropic-messages" as Api,
        baseUrl: "https://gateway.example",
      },
    });
    const result = await chatCompletion(client, "claude-sonnet-4-6", [{ role: "user", content: "nihao" }]);

    expect(result.content).toBe("你好，Anthropic!");
    expect(result.usage.promptTokens).toBe(5);
    expect(result.usage.completionTokens).toBe(3);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mockCompleteSimple).not.toHaveBeenCalled();
    expect(mockStreamSimple).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("uses native fetch transport for custom anthropic-compatible stream chat", async () => {
    const encoder = new TextEncoder();
    const sse = [
      "event: message_start\n",
      "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":4}}}\n\n",
      "event: content_block_delta\n",
      "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"你\"}}\n\n",
      "event: content_block_delta\n",
      "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"好\"}}\n\n",
      "event: message_delta\n",
      "data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":2}}\n\n",
      "event: message_stop\n",
      "data: {\"type\":\"message_stop\"}\n\n",
    ].join("");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sse));
          controller.close();
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient(0.7, {
      provider: "anthropic",
      service: "custom",
      stream: true,
      _piModel: {
        ...MOCK_PI_MODEL,
        provider: "anthropic",
        api: "anthropic-messages" as Api,
        baseUrl: "https://gateway.example",
      },
    });
    const result = await chatCompletion(client, "claude-sonnet-4-6", [{ role: "user", content: "nihao" }]);

    expect(result.content).toBe("你好");
    expect(result.usage.promptTokens).toBe(4);
    expect(result.usage.completionTokens).toBe(2);
    expect(result.usage.totalTokens).toBe(6);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mockCompleteSimple).not.toHaveBeenCalled();
    expect(mockStreamSimple).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

describe("chatCompletion fixed-temperature clamp (thinking models)", () => {
  beforeEach(() => {
    __resetFixedTemperatureWarnings();
    mockStreamSimple.mockReset();
    mockStreamSimple.mockReturnValue(makeTextStream("ok"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("clamps kimi-k2-thinking (bank-marked temperature:1)", async () => {
    const client = makeClient(0.5);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await chatCompletion(client, "kimi-k2-thinking", [
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

// ── 回归测试：per-call maxTokens 不被裁剪（v2.0.0 精简版）─────────────
// 背景：v2.0.0 删除了 config.maxTokens / maxTokensCap 字段，provider 层不再做 cap，
//      agent per-call 传的 maxTokens 原样透传到下游。
describe("createLLMClient per-call maxTokens not capped (v2.0.0)", () => {
  it("per-call maxTokens 16384 reaches the API as-is", async () => {
    const { createLLMClient } = await import("../llm/provider.js");
    const { LLMConfigSchema } = await import("../models/project.js");

    const client = createLLMClient(LLMConfigSchema.parse({
      provider: "openai",
      baseUrl: "http://localhost:0",
      model: "test-model",
    }));

    mockStreamSimple.mockReset();
    mockStreamSimple.mockReturnValue(makeTextStream("ok"));

    await chatCompletion(client, "test-model", [
      { role: "user", content: "architect" },
    ], { maxTokens: 16384 });

    const opts = mockStreamSimple.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(opts.maxTokens).toBe(16384);
  });
});

describe("createLLMClient with providers lookup", () => {
  it("anthropic + claude-sonnet-4-6 拿到 modelCard 的 maxOutput (64000)，不是未知模型兜底", async () => {
    const { createLLMClient } = await import("../llm/provider.js");
    const { LLMConfigSchema } = await import("../models/project.js");
    const client = createLLMClient(LLMConfigSchema.parse({
      provider: "anthropic",
      service: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "test",
      baseUrl: "https://api.anthropic.com",
    }));
    expect(client.defaults.maxTokens).toBe(64_000);
    expect(client._piModel?.maxTokens).toBe(64_000);
    expect(client._piModel?.contextWindow).toBe(1_000_000);
  });

  it("custom service + gpt-4o 靠 Layer 2 全局扫命中 openai provider", async () => {
    const { createLLMClient } = await import("../llm/provider.js");
    const { LLMConfigSchema } = await import("../models/project.js");
    const client = createLLMClient(LLMConfigSchema.parse({
      provider: "openai",
      service: "custom",
      model: "gpt-4o",
      apiKey: "test",
      baseUrl: "https://middleman.example/v1",
    }));
    // lobe 数据里 gpt-4o maxOutput=4096
    expect(client.defaults.maxTokens).toBe(4096);
  });

  it("未知 model 走 8192 * 3 的写作兜底预算", async () => {
    const { createLLMClient } = await import("../llm/provider.js");
    const { LLMConfigSchema } = await import("../models/project.js");
    const client = createLLMClient(LLMConfigSchema.parse({
      provider: "openai",
      service: "custom",
      model: "my-private-xyz-model-does-not-exist",
      apiKey: "test",
      baseUrl: "https://middleman.example/v1",
    }));
    expect(client.defaults.maxTokens).toBe(24_576);
    expect(client._piModel?.maxTokens).toBe(24_576);
  });

  it("config.maxTokens 命中 modelCard 后被覆盖（用户填 4000 还是用 modelCard 的 64000）", async () => {
    const { createLLMClient } = await import("../llm/provider.js");
    const { LLMConfigSchema } = await import("../models/project.js");
    const client = createLLMClient(LLMConfigSchema.parse({
      provider: "anthropic",
      service: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "test",
      baseUrl: "https://api.anthropic.com",
      maxTokens: 4000,
    }));
    expect(client.defaults.maxTokens).toBe(64_000);
  });

  it("B7: kimiCodingPlan 的 kimi-k2.5 走 API 时 piModel.id 是 deploymentName (k2p5)", async () => {
    const { createLLMClient } = await import("../llm/provider.js");
    const { LLMConfigSchema } = await import("../models/project.js");
    const client = createLLMClient(LLMConfigSchema.parse({
      provider: "anthropic",
      service: "kimiCodingPlan",
      model: "kimi-k2.5",
      apiKey: "test",
      baseUrl: "https://api.moonshot.cn/anthropic",
    }));
    expect(client._piModel?.id).toBe("k2p5");
  });

  it("B7: 没有 deploymentName 的 model piModel.id 保持原 config.model", async () => {
    const { createLLMClient } = await import("../llm/provider.js");
    const { LLMConfigSchema } = await import("../models/project.js");
    const client = createLLMClient(LLMConfigSchema.parse({
      provider: "anthropic",
      service: "kimiCodingPlan",
      model: "kimi-k2-thinking",
      apiKey: "test",
      baseUrl: "https://api.moonshot.cn/anthropic",
    }));
    expect(client._piModel?.id).toBe("kimi-k2-thinking");
  });

  it("Google Gemini uses native google-generative-ai provider", async () => {
    const { createLLMClient } = await import("../llm/provider.js");
    const { LLMConfigSchema } = await import("../models/project.js");
    const client = createLLMClient(LLMConfigSchema.parse({
      provider: "openai",
      service: "google",
      model: "gemini-2.5-flash",
      apiKey: "test",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    }));
    expect(client._piModel?.api).toBe("google-generative-ai");
    expect(client._piModel?.provider).toBe("google");
    expect(client._piModel?.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
    expect(client._piModel?.compat).toBeUndefined();
  });
});
