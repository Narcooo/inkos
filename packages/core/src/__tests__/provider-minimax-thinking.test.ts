import { describe, expect, it, vi } from "vitest";
import { chatCompletion, createLLMClient } from "../llm/provider.js";

const { fetchCalls, responseQueue } = vi.hoisted(() => ({
  fetchCalls: [] as Array<{ url: string; init: RequestInit; body: Record<string, unknown> }>,
  responseQueue: [] as Response[],
}));

vi.mock("../utils/proxy-fetch.js", () => ({
  fetchWithProxy: vi.fn(async (url: string, init: RequestInit) => {
    fetchCalls.push({
      url,
      init,
      body: JSON.parse(String(init.body ?? "{}")),
    });
    const queued = responseQueue.shift();
    if (queued) return queued;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    } as Response;
  }),
}));

vi.mock("@mariozechner/pi-ai", () => ({
  completeSimple: vi.fn(async () => {
    throw new Error("MiniMax OpenAI-compatible requests must use InkOS native transport");
  }),
  streamSimple: vi.fn(async function* () {
    throw new Error("MiniMax OpenAI-compatible requests must use InkOS native transport");
  }),
}));

function minimaxClient(model: string, stream = false) {
  return createLLMClient({
    provider: "openai",
    service: "minimax",
    model,
    apiKey: "sk-test",
    apiFormat: "chat",
    stream,
    temperature: 0.9,
    thinkingBudget: 0,
    extra: {},
  } as never);
}

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    json: async () => payload,
  } as Response;
}

function sseResponse(events: string[]): Response {
  const chunks = events.map((event) => `data: ${event}\n\n`);
  let index = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => index < chunks.length
          ? { value: new TextEncoder().encode(chunks[index++]), done: false }
          : { value: undefined, done: true },
      }),
    },
  } as unknown as Response;
}

describe("MiniMax thinking defaults", () => {
  it.each([
    undefined,
    "https://api.minimax.io/v1",
    "https://api.minimaxi.com/v1",
    "https://custom.example/v1",
  ])("keeps Flash adaptive and preserves an explicit base URL (%s)", async (baseUrl) => {
    fetchCalls.length = 0;
    const client = createLLMClient({
      provider: "openai", service: "minimax", model: "MiniMax-M3.1-Flash",
      apiKey: "sk-test", apiFormat: "chat", stream: false, baseUrl,
      thinkingBudget: 0, extra: { reasoning_effort: "low" },
    } as never);

    await chatCompletion(client, "MiniMax-M3.1-Flash", [
      { role: "user", content: "hi" },
    ], { retry: false });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toBe(`${baseUrl ?? "https://api.minimax.cn/v1"}/chat/completions`);
    expect(fetchCalls[0]!.body).toMatchObject({
      model: "MiniMax-M3.1-Flash", thinking: { type: "adaptive" },
      reasoning_split: true, reasoning_effort: "low",
    });
    expect(fetchCalls[0]!.body).not.toHaveProperty("service_tier");
  });

  it("uses adaptive thinking with the default Flash request options", async () => {
    fetchCalls.length = 0;
    await chatCompletion(minimaxClient("MiniMax-M3.1-Flash"), "MiniMax-M3.1-Flash", [
      { role: "user", content: "hi" },
    ], { retry: false });
    expect(fetchCalls[0]!.body).toMatchObject({ thinking: { type: "adaptive" }, reasoning_split: true });
    expect(fetchCalls[0]!.body).not.toHaveProperty("reasoning_effort");
    expect(fetchCalls[0]!.body).not.toHaveProperty("service_tier");
  });

  it("disables MiniMax-M3 thinking and requests reasoning_split by default", async () => {
    fetchCalls.length = 0;
    const client = minimaxClient("MiniMax-M3");

    const result = await chatCompletion(client, "MiniMax-M3", [
      { role: "user", content: "hi" },
    ], { retry: false });

    expect(result.content).toBe("ok");
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toBe("https://api.minimax.cn/v1/chat/completions");
    expect(fetchCalls[0]!.body).toMatchObject({
      model: "MiniMax-M3",
      thinking: { type: "disabled" },
      reasoning_split: true,
    });
  });

  it("sends reasoning_split but no thinking control to MiniMax-M2.x models", async () => {
    fetchCalls.length = 0;
    const client = minimaxClient("MiniMax-M2.7");

    await chatCompletion(client, "MiniMax-M2.7", [
      { role: "user", content: "hi" },
    ], { retry: false });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.body).not.toHaveProperty("thinking");
    expect(fetchCalls[0]!.body).toMatchObject({ reasoning_split: true });
  });
});

describe("MiniMax thinking leak prevention (issue #329)", () => {
  it("does not merge reasoning_content into the returned content (non-stream)", async () => {
    fetchCalls.length = 0;
    responseQueue.push(jsonResponse({
      choices: [{
        message: {
          content: "第一章正文开始。",
          reasoning_content: "让我先推演一下剧情走向……",
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
    const client = minimaxClient("MiniMax-M2.7");

    const result = await chatCompletion(client, "MiniMax-M2.7", [
      { role: "user", content: "写第一章" },
    ], { retry: false });

    expect(result.content).toBe("第一章正文开始。");
    expect(result.content).not.toContain("推演");
  });

  it("strips a leading inline <think> block from non-stream content", async () => {
    fetchCalls.length = 0;
    responseQueue.push(jsonResponse({
      choices: [{
        message: {
          content: "<think>这里是模型的内心推理，不该出现在章节里</think>\n\n第一章正文开始。",
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
    const client = minimaxClient("MiniMax-M2.7");

    const result = await chatCompletion(client, "MiniMax-M2.7", [
      { role: "user", content: "写第一章" },
    ], { retry: false });

    expect(result.content).toBe("第一章正文开始。");
    expect(result.content).not.toContain("内心推理");
  });

  it("keeps reasoning_content and reasoning_details deltas out of streamed content", async () => {
    fetchCalls.length = 0;
    responseQueue.push(sseResponse([
      JSON.stringify({ choices: [{ delta: { reasoning_content: "思考片段A" } }] }),
      JSON.stringify({ choices: [{ delta: { reasoning_details: [{ text: "思考片段B" }] } }] }),
      JSON.stringify({ choices: [{ delta: { content: "第一章" } }] }),
      JSON.stringify({ choices: [{ delta: { content: "正文。" } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }),
      "[DONE]",
    ]));
    const client = minimaxClient("MiniMax-M2.7", true);
    const deltas: string[] = [];

    const result = await chatCompletion(client, "MiniMax-M2.7", [
      { role: "user", content: "写第一章" },
    ], { retry: false, onTextDelta: (text) => deltas.push(text) });

    expect(result.content).toBe("第一章正文。");
    expect(result.content).not.toContain("思考片段");
    expect(deltas.join("")).toBe("第一章正文。");
  });

  it("strips a leading inline <think> block split across stream chunks", async () => {
    fetchCalls.length = 0;
    responseQueue.push(sseResponse([
      JSON.stringify({ choices: [{ delta: { content: "<th" } }] }),
      JSON.stringify({ choices: [{ delta: { content: "ink>模型内心推理" } }] }),
      JSON.stringify({ choices: [{ delta: { content: "</think>\n第一" } }] }),
      JSON.stringify({ choices: [{ delta: { content: "章正文。" } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      "[DONE]",
    ]));
    const client = minimaxClient("MiniMax-M2.7", true);
    const deltas: string[] = [];

    const result = await chatCompletion(client, "MiniMax-M2.7", [
      { role: "user", content: "写第一章" },
    ], { retry: false, onTextDelta: (text) => deltas.push(text) });

    expect(result.content).toBe("第一章正文。");
    expect(deltas.join("")).toBe("第一章正文。");
    expect(deltas.join("")).not.toContain("内心推理");
  });
});
