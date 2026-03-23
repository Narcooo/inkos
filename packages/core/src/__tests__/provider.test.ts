import { describe, expect, it, vi } from "vitest";
import {
  chatCompletion,
  chatWithTools,
  type LLMClient,
  type ToolDefinition,
} from "../llm/provider.js";

function createOpenAIClientMock(create: ReturnType<typeof vi.fn>, stream: boolean): LLMClient {
  return {
    provider: "openai",
    apiFormat: "chat",
    stream,
    defaults: {
      temperature: 0.7,
      maxTokens: 256,
      thinkingBudget: 0,
      extra: {},
    },
    _openai: {
      chat: {
        completions: {
          create,
        },
      },
    } as unknown as LLMClient["_openai"],
  };
}

function streamFrom<T>(items: ReadonlyArray<T>): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<T> {
      for (const item of items) {
        yield item;
      }
    },
  };
}

describe("OpenAI chat token parameter compatibility", () => {
  it("uses max_completion_tokens for GPT-5 chat completions", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "OK" } }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    });
    const client = createOpenAIClientMock(create, false);

    await chatCompletion(client, "gpt-5.4-mini", [
      { role: "user", content: "Say OK" },
    ], { maxTokens: 16 });

    const params = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params.max_completion_tokens).toBe(16);
    expect(params).not.toHaveProperty("max_tokens");
  });

  it("falls back to max_tokens when a proxy rejects max_completion_tokens", async () => {
    const create = vi.fn()
      .mockRejectedValueOnce({
        param: "max_completion_tokens",
        message: "Unsupported parameter: 'max_completion_tokens'",
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "OK" } }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      });
    const client = createOpenAIClientMock(create, false);

    await chatCompletion(client, "gpt-5.4-mini", [
      { role: "user", content: "Say OK" },
    ], { maxTokens: 16 });

    const firstParams = create.mock.calls[0]?.[0] as Record<string, unknown>;
    const secondParams = create.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(firstParams.max_completion_tokens).toBe(16);
    expect(secondParams.max_tokens).toBe(16);
  });

  it("uses max_completion_tokens for GPT-5 tool-calling chat requests", async () => {
    const create = vi.fn().mockResolvedValue(streamFrom([
      { choices: [{ delta: { content: "OK" } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ]));
    const client = createOpenAIClientMock(create, true);
    const tools: ToolDefinition[] = [
      {
        name: "lookup",
        description: "Lookup something",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
        },
      },
    ];

    await chatWithTools(client, "gpt-5.4-mini", [
      { role: "user", content: "Find something" },
    ], tools, { temperature: 0.2, maxTokens: 24 });

    const params = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params.max_completion_tokens).toBe(24);
    expect(params).not.toHaveProperty("max_tokens");
  });
});
