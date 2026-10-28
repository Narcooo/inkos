import { afterEach, describe, expect, it, vi } from "vitest";
import { createAssistantMessageEventStream, type AssistantMessage } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { createLLMClient } from "../llm/provider.js";
import { runWorkerAgentTool } from "../agent/worker-agent.js";

const mocks = vi.hoisted(() => ({ stream: vi.fn(), fetch: vi.fn() }));
vi.mock("@mariozechner/pi-ai", async (original) => ({
  ...await original<typeof import("@mariozechner/pi-ai")>(), streamSimple: mocks.stream,
}));
vi.mock("../utils/proxy-fetch.js", () => ({ fetchWithProxy: mocks.fetch }));
afterEach(() => { mocks.stream.mockReset(); mocks.fetch.mockReset(); });

function providerResponse(stopReason: "length" | "stop", thinking: string) {
  const message: AssistantMessage = {
    role: "assistant", api: "openai-completions", provider: "openai", model: "fixture-model",
    content: thinking ? [{ type: "thinking", thinking }] : [], stopReason, timestamp: 1,
    usage: { input: 10, output: 128, totalTokens: 138, cacheRead: 0, cacheWrite: 0,
      cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } },
  };
  mocks.stream.mockImplementation(() => {
    const events = createAssistantMessageEventStream();
    queueMicrotask(() => { events.push({ type: "done", reason: stopReason, message }); events.end(message); });
    return events;
  });
  mocks.fetch.mockImplementation(async () => new Response(JSON.stringify({
    choices: [{ finish_reason: stopReason, message: { reasoning_content: thinking, content: null } }],
    usage: { prompt_tokens: 10, completion_tokens: 128, total_tokens: 138 },
  })));
}

function runWorker(stream: boolean) {
  const client = createLLMClient({ provider: "openai", service: "custom", configSource: "studio", apiFormat: "chat",
    temperature: 0.7, thinkingBudget: 0, model: "fixture-model", baseUrl: "https://example.test/v1", apiKey: "fixture", stream });
  return runWorkerAgentTool(client, "fixture-model", [{ role: "user", content: "Submit the result." }], {
    name: "submit_fixture", label: "Submit fixture", description: "Submit the complete result.",
    parameters: Type.Object({ ok: Type.Boolean() }),
  }, { maxTokens: 128 });
}

describe.each([true, false])("structured worker recovery (stream=%s)", (stream) => {
  it.each(["", "Unfinished reasoning"])("reports length exhaustion without retrying, with thinking=%j", async (thinking) => {
    providerResponse("length", thinking);
    await expect(runWorker(stream)).rejects.toMatchObject({ code: "MODEL_OUTPUT_LIMIT", stopReason: "length", resultTool: "submit_fixture" });
    expect(stream ? mocks.stream : mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("retains bounded retries for a genuinely empty normal completion", async () => {
    providerResponse("stop", "");
    await expect(runWorker(stream)).rejects.toMatchObject({ code: "MODEL_EMPTY_RESPONSE" });
    expect(stream ? mocks.stream : mocks.fetch).toHaveBeenCalledTimes(2);
  });
});
