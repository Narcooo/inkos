import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage, Model, Api } from "@mariozechner/pi-ai";
import {
  __resetFixedTemperatureWarnings,
  chatCompletion,
  type LLMClient,
} from "../llm/provider.js";
import { runWithAgentTrajectory } from "../llm/agent-trajectory.js";

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

function makeNeverStream(): AsyncIterable<Record<string, unknown>> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>> {
      return {
        async next() {
          return new Promise<IteratorResult<Record<string, unknown>>>(() => {});
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
    expect(error.message).not.toMatch(/kkaiapi/i);
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
    expect(error.message).not.toMatch(/kkaiapi/i);
  });

  it("retries transient socket termination errors before failing the chapter pipeline", async () => {
    mockStreamSimple
      .mockReturnValueOnce(makeErrorStream("terminated: UND_ERR_SOCKET other side closed"))
      .mockReturnValueOnce(makeTextStream("recovered"));

    const client = makeClient();
    const result = await chatCompletion(client, "test-model", [{ role: "user", content: "ping" }]);

    expect(result.content).toBe("recovered");
    expect(mockStreamSimple).toHaveBeenCalledTimes(2);
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

  it("propagates caller aborts through the guarded signal passed to pi-ai", async () => {
    mockStreamSimple.mockReturnValue(makeTextStream("ok"));
    const controller = new AbortController();

    await chatCompletion(makeClient(), "test-model", [{ role: "user", content: "hi" }], {
      signal: controller.signal,
    });

    const opts = mockStreamSimple.mock.calls[0]?.[2] as Record<string, unknown>;
    const signal = opts.signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });

  it("honors a caller-specific first-event deadline", async () => {
    mockStreamSimple.mockReturnValue(makeNeverStream());

    const error = await captureError(
      chatCompletion(makeClient(), "test-model", [{ role: "user", content: "hi" }], {
        firstEventTimeoutMs: 10,
        retry: false,
      }),
    );

    expect(error.message).toContain("LLM stream produced no event within 10ms");
  });

  it("drops non-ByteString headers before calling pi-ai", async () => {
    mockStreamSimple.mockReturnValue(makeTextStream("ok"));

    const client = makeClient(0.7, {
      _piModel: {
        ...MOCK_PI_MODEL,
        headers: {
          "X-Valid": "ok",
          "X-Bad": "服务测试",
        },
      },
    });
    await chatCompletion(client, "test-model", [{ role: "user", content: "hi" }]);

    const opts = mockStreamSimple.mock.calls[0]?.[2] as { headers?: Record<string, string> };
    expect(opts.headers).toMatchObject({ "User-Agent": "InkOS/1.3.5", "X-Valid": "ok" });
    expect(opts.headers).not.toHaveProperty("X-Bad");
  });

  it("uses client defaults when no per-call overrides are provided", async () => {
    mockStreamSimple.mockReturnValue(makeTextStream("ok"));

    const client = makeClient(0.8);
    await chatCompletion(client, "test-model", [{ role: "user", content: "hi" }]);

    const opts = mockStreamSimple.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(opts.temperature).toBe(0.8);
    expect(opts.maxTokens).toBe(512);
  });

  it("rejects oversized chat context before sending to pi-ai", async () => {
    const client = makeClient(0.7, {
      _piModel: {
        ...MOCK_PI_MODEL,
        contextWindow: 80,
      },
    });

    const error = await captureError(
      chatCompletion(client, "test-model", [
        { role: "system", content: "系统设定".repeat(40) },
        { role: "user", content: "用户消息".repeat(40) },
      ], { maxTokens: 20 }),
    );

    expect(error.message).toContain("context window");
    expect(error.message).toContain("compress");
    expect(mockStreamSimple).not.toHaveBeenCalled();
    expect(mockCompleteSimple).not.toHaveBeenCalled();
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
    expect(mockCompleteSimple).not.toHaveBeenCalled();
    expect(mockStreamSimple).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("rejects non-ASCII API keys before native custom fetch builds headers", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient(0.7, {
      service: "custom",
      stream: false,
      _apiKey: "sk-test测试",
      _piModel: {
        ...MOCK_PI_MODEL,
        provider: "openai",
        baseUrl: "https://gateway.example/v1",
      },
    });

    const error = await captureError(
      chatCompletion(client, "gpt-5.4", [{ role: "user", content: "ping" }]),
    );

    expect(error.message).toContain("non-ASCII");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("uses native fetch transport for kkaiapi chat and sanitizes headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "kkai ok" } }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient(0.7, {
      service: "kkaiapi",
      stream: false,
      _piModel: {
        ...MOCK_PI_MODEL,
        provider: "openai",
        baseUrl: "https://api.kkaiapi.com/v1",
        headers: {
          "X-Valid": "ok",
          "X-Bad": "服务测试",
        },
      },
    });
    const controller = new AbortController();
    const result = await chatCompletion(client, "deepseek-v4-flash", [{ role: "user", content: "nihao" }], {
      signal: controller.signal,
    });

    expect(result.content).toBe("kkai ok");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mockCompleteSimple).not.toHaveBeenCalled();
    expect(mockStreamSimple).not.toHaveBeenCalled();

    const init = fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string>; signal?: AbortSignal };
    expect(init.signal).toBe(controller.signal);
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
      "X-Valid": "ok",
    });
    expect(init.headers).not.toHaveProperty("X-Bad");

    vi.unstubAllGlobals();
  });

  it("keeps one model-call id while incrementing kkaiapi client retry attempts", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Unavailable",
        headers: new Headers(),
        text: async () => JSON.stringify({ error: { message: "temporary unavailable" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "recovered" } }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient(0.7, {
      service: "kkaiapi",
      stream: false,
      _piModel: { ...MOCK_PI_MODEL, baseUrl: "https://api.kkaiapi.com/v1" },
    });

    const result = await runWithAgentTrajectory({
      conversationId: "inkos-conv",
      runId: "run-7",
      agentRole: "workflow",
    }, () => chatCompletion(client, "deepseek-v4-flash", [{ role: "user", content: "write" }]));

    expect(result.content).toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const second = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(first["X-InkOS-Model-Call-ID"]).toBeTruthy();
    expect(second["X-InkOS-Model-Call-ID"]).toBe(first["X-InkOS-Model-Call-ID"]);
    expect(first["X-InkOS-Client-Attempt"]).toBe("1");
    expect(second["X-InkOS-Client-Attempt"]).toBe("2");
    expect(second).toMatchObject({
      "X-InkOS-Conversation-ID": "inkos-conv",
      "X-InkOS-Run-ID": "run-7",
      "X-InkOS-Agent-Role": "workflow",
    });
    vi.unstubAllGlobals();
  });

  it("aborts a pending kkaiapi request instead of leaving the writer blocked", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient(0.7, {
      service: "kkaiapi",
      stream: true,
      _piModel: {
        ...MOCK_PI_MODEL,
        provider: "openai",
        baseUrl: "https://api.kkaiapi.com/v1",
      },
    });

    const pending = chatCompletion(client, "deepseek-v4-flash", [{ role: "user", content: "write" }], {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort(new Error("Stopped by user"));

    await expect(pending).rejects.toThrow("Stopped by user");
    vi.unstubAllGlobals();
  });

  it("does not leave a stream monitor timer after native non-stream chat", async () => {
    vi.useFakeTimers();
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
    const result = await chatCompletion(client, "gpt-5.4", [{ role: "user", content: "nihao" }], {
      onStreamProgress: vi.fn(),
    });

    expect(result.content).toBe("你好！");
    expect(vi.getTimerCount()).toBe(0);

    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("attaches a proxy dispatcher for custom openai-compatible chat when proxyUrl is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "proxied" } }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient(0.7, {
      service: "custom",
      stream: false,
      proxyUrl: "http://127.0.0.1:9910",
      _piModel: {
        ...MOCK_PI_MODEL,
        provider: "openai",
        baseUrl: "https://gateway.example/v1",
      },
    });
    const result = await chatCompletion(client, "gpt-5.4", [{ role: "user", content: "nihao" }]);

    expect(result.content).toBe("proxied");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      dispatcher: expect.any(Object),
    });

    vi.unstubAllGlobals();
  });

  it("rejects reasoning-only custom non-stream responses instead of treating thinking as final text", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { reasoning_content: "推理通道文本" } }],
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
    await expect(chatCompletion(client, "glm-compat", [{ role: "user", content: "nihao" }], { retry: false }))
      .rejects.toThrow(/final answer|empty response/i);
    expect(fetchMock).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });

  it("rejects reasoning-only custom streams instead of persisting thinking as final text", async () => {
    const encoder = new TextEncoder();
    const sse = [
      "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"你\"}}]}\n\n",
      "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"好\"}}]}\n\n",
      "data: {\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2,\"total_tokens\":5}}\n\n",
      "data: [DONE]\n\n",
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
      service: "custom",
      stream: true,
      _piModel: {
        ...MOCK_PI_MODEL,
        provider: "openai",
        baseUrl: "https://gateway.example/v1",
      },
    });
    await expect(chatCompletion(client, "glm-compat", [{ role: "user", content: "nihao" }], { retry: false }))
      .rejects.toThrow(/final answer|empty response/i);
    expect(fetchMock).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });

  it("retries a reasoning-only non-stream response inside the same model stage", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { reasoning_content: "先分析但没有最终答案" } }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "完整最终答案" } }],
          usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
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
    const result = await chatCompletion(client, "glm-compat", [{ role: "user", content: "nihao" }]);

    expect(result.content).toBe("完整最终答案");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("retries custom openai-compatible chat by folding system messages into user when system role is unsupported", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () => JSON.stringify({ error: { message: "role system is unsupported" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 9, completion_tokens: 1, total_tokens: 10 },
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
    const result = await chatCompletion(client, "wild-compatible", [
      { role: "system", content: "只输出中文。" },
      { role: "user", content: "ping" },
    ]);

    expect(result.content).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    const secondBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(firstBody.messages).toEqual([
      { role: "system", content: "只输出中文。" },
      { role: "user", content: "ping" },
    ]);
    expect(secondBody.messages).toHaveLength(1);
    expect(secondBody.messages[0]).toMatchObject({ role: "user" });
    expect(secondBody.messages[0].content).toContain("只输出中文。");
    expect(secondBody.messages[0].content).toContain("ping");

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

  it("uses native fetch transport for local Ollama without an API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "本地 Ollama 可用" } }],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient(0.7, {
      service: "ollama",
      configSource: "env",
      stream: false,
      _apiKey: "",
      _piModel: {
        ...MOCK_PI_MODEL,
        provider: "ollama",
        baseUrl: "http://127.0.0.1:11434/v1",
      },
    });
    const result = await chatCompletion(client, "Qwen3.6-35B-A3B-APEX-I-Mini.gguf", [
      { role: "user", content: "ping" },
    ]);

    expect(result.content).toBe("本地 Ollama 可用");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mockCompleteSimple).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("uses native fetch transport for local LM Studio without an API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "本地 LM Studio 可用" } }],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient(0.7, {
      service: "lmstudio",
      configSource: "studio",
      stream: false,
      _apiKey: "",
      _piModel: {
        ...MOCK_PI_MODEL,
        provider: "openai",
        baseUrl: "http://127.0.0.1:1234/v1",
      },
    });
    const result = await chatCompletion(client, "openai/gpt-oss-20b", [
      { role: "user", content: "ping" },
    ]);

    expect(result.content).toBe("本地 LM Studio 可用");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mockCompleteSimple).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("uses native fetch transport for local custom OpenAI-compatible endpoints without an API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "本地自定义端点可用" } }],
        usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient(0.7, {
      service: "custom",
      configSource: "env",
      stream: false,
      _apiKey: "",
      _piModel: {
        ...MOCK_PI_MODEL,
        provider: "openai",
        baseUrl: "http://127.0.0.1:11434/v1",
      },
    });
    const result = await chatCompletion(client, "local-qwen", [{ role: "user", content: "ping" }]);

    expect(result.content).toBe("本地自定义端点可用");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty("Authorization");
    expect(mockCompleteSimple).not.toHaveBeenCalled();

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
      apiKey: "test-key",
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

describe("stream interruption detection", () => {
  beforeEach(() => {
    // mockStreamSimple 是模块级共享 mock，清掉前面测试累积的调用计数和队列
    mockStreamSimple.mockClear();
  });

  function sseResponse(sse: string) {
    const encoder = new TextEncoder();
    return {
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sse));
          controller.close();
        },
      }),
    };
  }

  function nativeStreamClient(): LLMClient {
    return makeClient(0.7, {
      service: "custom",
      stream: true,
      _piModel: {
        ...MOCK_PI_MODEL,
        provider: "openai",
        baseUrl: "https://gateway.example/v1",
      },
    });
  }

  const COMPLETE_SSE = [
    "data: {\"choices\":[{\"delta\":{\"content\":\"完整的正文内容\"}}]}\n\n",
    "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
    "data: [DONE]\n\n",
  ].join("");
  // 网关把长流掐断：连接正常关闭，但既没有 finish_reason 也没有 [DONE]
  const TRUNCATED_SSE = "data: {\"choices\":[{\"delta\":{\"content\":\"写到一半的正文\"}}]}\n\n";

  it("retries a native chat stream that closes without [DONE]/finish_reason and succeeds on the retry", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse(TRUNCATED_SSE))
      .mockResolvedValueOnce(sseResponse(COMPLETE_SSE));
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatCompletion(nativeStreamClient(), "glm-compat", [{ role: "user", content: "写第1章" }]);

    expect(result.content).toBe("完整的正文内容");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("throws instead of returning truncated content when every attempt is cut mid-stream", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => sseResponse(TRUNCATED_SSE));
    vi.stubGlobal("fetch", fetchMock);

    await expect(chatCompletion(nativeStreamClient(), "glm-compat", [{ role: "user", content: "写第1章" }]))
      .rejects.toThrow(/Stream interrupted|completion signal/);
    // 初次 + TRANSIENT_LLM_RETRIES(2) 次重试
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it("accepts a native chat stream that ends with finish_reason even when [DONE] is missing", async () => {
    const sse = [
      "data: {\"choices\":[{\"delta\":{\"content\":\"内容\"}}]}\n\n",
      "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
    ].join("");
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(sse));
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatCompletion(nativeStreamClient(), "glm-compat", [{ role: "user", content: "hi" }]);

    expect(result.content).toBe("内容");
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("rejects a native chat stream that reaches the output limit", async () => {
    const sse = [
      "data: {\"choices\":[{\"delta\":{\"content\":\"写到上限的正文\"}}]}\n\n",
      "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"length\"}]}\n\n",
      "data: [DONE]\n\n",
    ].join("");
    const fetchMock = vi.fn().mockImplementation(async () => sseResponse(sse));
    vi.stubGlobal("fetch", fetchMock);

    await expect(chatCompletion(nativeStreamClient(), "glm-compat", [{ role: "user", content: "写正文" }]))
      .rejects.toThrow(/output limit|length|Stream interrupted/i);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it("retries a pi-ai stream that errors after a long partial instead of silently keeping the truncation", async () => {
    const longPartial = "长".repeat(600);
    const partialMsg = makeAssistantMessage(longPartial);
    const partialThenError: AsyncIterable<Record<string, unknown>> = {
      [Symbol.asyncIterator]() {
        let emitted = false;
        return {
          async next() {
            if (!emitted) {
              emitted = true;
              return { value: { type: "text_delta", contentIndex: 0, delta: longPartial, partial: partialMsg }, done: false };
            }
            // 非关键字错误：验证 PartialResponseError 本身可重试，而非靠错误文案匹配
            throw new Error("upstream replied with malformed frame");
          },
        };
      },
    };
    mockStreamSimple
      .mockReturnValueOnce(partialThenError as never)
      .mockReturnValueOnce(makeTextStream("重试后的完整内容") as never);

    const result = await chatCompletion(makeClient(), "test-model", [{ role: "user", content: "写" }]);

    expect(result.content).toBe("重试后的完整内容");
    expect(mockStreamSimple).toHaveBeenCalledTimes(2);
  });

  it("treats a pi-ai stream that ends without a done event as interrupted and retries", async () => {
    const partialMsg = makeAssistantMessage("只有一半");
    mockStreamSimple
      .mockReturnValueOnce(makeEventStream([
        { type: "text_delta", contentIndex: 0, delta: "只有一半", partial: partialMsg },
      ]) as never)
      .mockReturnValueOnce(makeTextStream("第二次完整") as never);

    const result = await chatCompletion(makeClient(), "test-model", [{ role: "user", content: "写" }]);

    expect(result.content).toBe("第二次完整");
    expect(mockStreamSimple).toHaveBeenCalledTimes(2);
  });

  it("rejects a pi-ai done message whose stop reason is length", async () => {
    const partial = makeAssistantMessage("只写到一半");
    const lengthMessage = { ...partial, stopReason: "length" } as AssistantMessage;
    mockStreamSimple.mockImplementation(() => makeEventStream([
      { type: "text_delta", contentIndex: 0, delta: "只写到一半", partial },
      { type: "done", reason: "length", message: lengthMessage },
    ]) as never);

    await expect(chatCompletion(makeClient(), "test-model", [{ role: "user", content: "写" }]))
      .rejects.toThrow(/output limit|length|Stream interrupted/i);
    expect(mockStreamSimple).toHaveBeenCalledTimes(3);
  });
});
