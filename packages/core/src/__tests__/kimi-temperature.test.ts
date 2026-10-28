import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAssistantMessageEventStream, type AssistantMessage, type Model } from "@mariozechner/pi-ai";
import { guardedPiNonStreaming, guardedPiStream } from "../agent/pi-stream.js";
import { createLLMClient } from "../llm/provider.js";
import { ShortFictionOutlineAgent } from "../agents/short-fiction.js";

const mocks = vi.hoisted(() => ({ stream: vi.fn(), fetch: vi.fn() }));
vi.mock("@mariozechner/pi-ai", async (original) => ({
  ...await original<typeof import("@mariozechner/pi-ai")>(),
  streamSimple: mocks.stream,
}));
vi.mock("../utils/proxy-fetch.js", () => ({ fetchWithProxy: mocks.fetch }));

const model: Model<"openai-completions"> = {
  id: "k3.1-pro", name: "k3.1-pro", api: "openai-completions", provider: "openai",
  baseUrl: "https://api.kimi.com/coding/v1", reasoning: false, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 8192,
};
const submitted = { storyTitle: "Fixture", planMarkdown: "A shared premise.", chapter_1_plan: "The requested scene." };
let payloads: Record<string, unknown>[];

beforeEach(() => {
  payloads = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.stream.mockImplementation((activeModel, context, options) => {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      const payload = await options.onPayload({ model: activeModel.id, temperature: options.temperature,
        max_tokens: options.maxTokens, tools: context.tools }, activeModel);
      payloads.push(payload);
      const tool = context.tools?.[0]?.name;
      const message: AssistantMessage = {
        role: "assistant", api: activeModel.api, provider: activeModel.provider, model: activeModel.id,
        content: tool ? [{ type: "toolCall", id: "fixture", name: tool, arguments: submitted }] : [{ type: "text", text: "OK" }],
        stopReason: tool ? "toolUse" : "stop", timestamp: Date.now(),
        usage: { input: 0, output: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0,
          cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } },
      };
      stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message });
      stream.end(message);
    })();
    return stream;
  });
  mocks.fetch.mockImplementation(async (_url, options) => {
    const payload = JSON.parse(options.body);
    payloads.push(payload);
    const tool = payload.tools?.[0]?.function?.name;
    return new Response(JSON.stringify({ choices: [{ finish_reason: tool ? "tool_calls" : "stop",
      message: tool ? { tool_calls: [{ id: "fixture", type: "function", function: { name: tool, arguments: JSON.stringify(submitted) } }] } : { content: "OK" },
    }] }));
  });
});
afterEach(() => { vi.restoreAllMocks(); mocks.stream.mockReset(); mocks.fetch.mockReset(); });

describe("Kimi Coding Plan fixed temperature", () => {
  it.each([true, false])("preserves native outline submission and overrides its 0.55 temperature (stream=%s)", async (stream) => {
    const client = createLLMClient({ provider: "openai", service: "custom", configSource: "studio",
      baseUrl: model.baseUrl, model: model.id, apiKey: "fixture", apiFormat: "chat", stream,
      temperature: 0.7, thinkingBudget: 0 });
    const result = await new ShortFictionOutlineAgent({ client, model: model.id, projectRoot: join(tmpdir(), "inkos-kimi-parameter-fixture") }).createOutline({
      title: "Fixture", direction: "A fixture scene.", chapterCount: 1, charsPerChapter: 1000, language: "en",
    });
    expect(result.storyTitle).toBe("Fixture");
    expect(result.rawContent).toContain(submitted.chapter_1_plan);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ temperature: 1, tool_choice: "required", max_tokens: 8192 });
  });

  it.each([true, false])("applies the fixed value after payload callbacks (stream=%s)", async (stream) => {
    const options = { temperature: 0.3, apiKey: "fixture", onPayload: (body: unknown) => ({ ...(body as object), temperature: 0.1 }) };
    const events = stream ? guardedPiStream(model, { messages: [] }, options) : guardedPiNonStreaming(model, { messages: [] }, options);
    await events.result();
    expect(payloads[0].temperature).toBe(1);
  });

  it("does not change unrelated endpoints or omit-default requests", async () => {
    await guardedPiStream({ ...model, baseUrl: "https://example.test/v1" }, { messages: [] }, { temperature: 0.55 }).result();
    await guardedPiStream(model, { messages: [] }, {}).result();
    expect(payloads[0].temperature).toBe(0.55);
    expect(payloads[1].temperature).toBeUndefined();
  });

});
