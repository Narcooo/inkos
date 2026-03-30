import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { createLLMClient, chatCompletion, chatWithTools, type LLMClient, type ToolDefinition } from "../llm/provider.js";
import { LLMConfigSchema } from "../models/project.js";

// === Schema validation ===

describe("LLMConfigSchema minimax provider", () => {
  it("accepts minimax as a valid provider", () => {
    const config = LLMConfigSchema.parse({
      provider: "minimax",
      baseUrl: "https://api.minimax.io/v1",
      apiKey: "test-key",
      model: "MiniMax-M2.7",
    });
    expect(config.provider).toBe("minimax");
    expect(config.model).toBe("MiniMax-M2.7");
  });

  it("defaults temperature to 0.7 for minimax", () => {
    const config = LLMConfigSchema.parse({
      provider: "minimax",
      baseUrl: "https://api.minimax.io/v1",
      apiKey: "test-key",
      model: "MiniMax-M2.7",
    });
    expect(config.temperature).toBe(0.7);
  });

  it("defaults stream to true for minimax", () => {
    const config = LLMConfigSchema.parse({
      provider: "minimax",
      baseUrl: "https://api.minimax.io/v1",
      apiKey: "test-key",
      model: "MiniMax-M2.7",
    });
    expect(config.stream).toBe(true);
  });
});

// === createLLMClient ===

describe("createLLMClient minimax", () => {
  it("creates a minimax client with OpenAI SDK internally", () => {
    const config = LLMConfigSchema.parse({
      provider: "minimax",
      baseUrl: "https://api.minimax.io/v1",
      apiKey: "test-key",
      model: "MiniMax-M2.7",
    });
    const client = createLLMClient(config);
    expect(client.provider).toBe("minimax");
    expect(client._openai).toBeDefined();
    expect(client._anthropic).toBeUndefined();
    expect(client.stream).toBe(true);
  });

  it("uses default base URL when baseUrl matches the MiniMax endpoint", () => {
    const config = LLMConfigSchema.parse({
      provider: "minimax",
      baseUrl: "https://api.minimax.io/v1",
      apiKey: "test-key",
      model: "MiniMax-M2.7",
    });
    const client = createLLMClient(config);
    expect(client._openai?.baseURL).toBe("https://api.minimax.io/v1");
  });

  it("clamps temperature 0 to 0.01 for minimax", () => {
    const config = LLMConfigSchema.parse({
      provider: "minimax",
      baseUrl: "https://api.minimax.io/v1",
      apiKey: "test-key",
      model: "MiniMax-M2.7",
      temperature: 0,
    });
    const client = createLLMClient(config);
    expect(client.defaults.temperature).toBe(0.01);
  });

  it("clamps temperature 1.5 to 1.0 for minimax", () => {
    const config = LLMConfigSchema.parse({
      provider: "minimax",
      baseUrl: "https://api.minimax.io/v1",
      apiKey: "test-key",
      model: "MiniMax-M2.7",
      temperature: 1.5,
    });
    const client = createLLMClient(config);
    expect(client.defaults.temperature).toBe(1.0);
  });

  it("keeps valid temperature 0.7 unchanged for minimax", () => {
    const config = LLMConfigSchema.parse({
      provider: "minimax",
      baseUrl: "https://api.minimax.io/v1",
      apiKey: "test-key",
      model: "MiniMax-M2.7",
      temperature: 0.7,
    });
    const client = createLLMClient(config);
    expect(client.defaults.temperature).toBe(0.7);
  });

  it("does not clamp temperature for openai provider", () => {
    const config = LLMConfigSchema.parse({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-4o",
      temperature: 0,
    });
    const client = createLLMClient(config);
    expect(client.defaults.temperature).toBe(0);
  });
});

// === chatCompletion with minimax client ===

const ZERO_USAGE = {
  prompt_tokens: 11,
  completion_tokens: 7,
  total_tokens: 18,
} as const;

function makeMiniMaxClient(overrides?: Partial<LLMClient>): LLMClient {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content: "minimax response" } }],
    usage: ZERO_USAGE,
  });
  return {
    provider: "minimax",
    apiFormat: "chat",
    stream: false,
    _openai: {
      chat: { completions: { create } },
    } as unknown as OpenAI,
    defaults: {
      temperature: 0.7,
      maxTokens: 8192,
      thinkingBudget: 0,
      maxTokensCap: null,
      extra: {},
    },
    ...overrides,
  };
}

describe("chatCompletion with minimax provider", () => {
  it("routes minimax through OpenAI Chat API", async () => {
    const client = makeMiniMaxClient();
    const result = await chatCompletion(client, "MiniMax-M2.7", [
      { role: "user", content: "Hello" },
    ]);
    expect(result.content).toBe("minimax response");
    expect(result.usage.promptTokens).toBe(11);
    expect(result.usage.completionTokens).toBe(7);
  });

  it("clamps per-call temperature override for minimax", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "ok" } }],
      usage: ZERO_USAGE,
    });
    const client: LLMClient = {
      provider: "minimax",
      apiFormat: "chat",
      stream: false,
      _openai: {
        chat: { completions: { create } },
      } as unknown as OpenAI,
      defaults: {
        temperature: 0.7,
        maxTokens: 8192,
        thinkingBudget: 0,
        maxTokensCap: null,
        extra: {},
      },
    };

    await chatCompletion(client, "MiniMax-M2.7", [
      { role: "user", content: "ping" },
    ], { temperature: 0 });

    expect(create).toHaveBeenCalledTimes(1);
    const callArgs = create.mock.calls[0]?.[0];
    expect(callArgs.temperature).toBe(0.01);
  });

  it("does not clamp temperature for openai provider on per-call override", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "ok" } }],
      usage: ZERO_USAGE,
    });
    const client: LLMClient = {
      provider: "openai",
      apiFormat: "chat",
      stream: false,
      _openai: {
        chat: { completions: { create } },
      } as unknown as OpenAI,
      defaults: {
        temperature: 0.7,
        maxTokens: 8192,
        thinkingBudget: 0,
        maxTokensCap: null,
        extra: {},
      },
    };

    await chatCompletion(client, "gpt-4o", [
      { role: "user", content: "ping" },
    ], { temperature: 0 });

    expect(create.mock.calls[0]?.[0].temperature).toBe(0);
  });

  it("handles streaming with minimax provider", async () => {
    const create = vi.fn().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: "mini" } }] };
        yield { choices: [{ delta: { content: "max" } }] };
        yield { choices: [{ delta: {} }], usage: ZERO_USAGE };
      },
    });
    const client: LLMClient = {
      provider: "minimax",
      apiFormat: "chat",
      stream: true,
      _openai: {
        chat: { completions: { create } },
      } as unknown as OpenAI,
      defaults: {
        temperature: 0.7,
        maxTokens: 8192,
        thinkingBudget: 0,
        maxTokensCap: null,
        extra: {},
      },
    };

    const result = await chatCompletion(client, "MiniMax-M2.7", [
      { role: "user", content: "ping" },
    ]);
    expect(result.content).toBe("minimax");
    expect(create.mock.calls[0]?.[0].stream).toBe(true);
  });
});

// === chatWithTools with minimax client ===

describe("chatWithTools with minimax provider", () => {
  it("routes tool calls through OpenAI Chat API for minimax", async () => {
    const create = vi.fn().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [{
            delta: {
              content: null,
              tool_calls: [{
                index: 0,
                id: "call_1",
                function: { name: "search", arguments: '{"q":"test"}' },
              }],
            },
          }],
        };
      },
    });
    const client: LLMClient = {
      provider: "minimax",
      apiFormat: "chat",
      stream: true,
      _openai: {
        chat: { completions: { create } },
      } as unknown as OpenAI,
      defaults: {
        temperature: 0.7,
        maxTokens: 8192,
        thinkingBudget: 0,
        maxTokensCap: null,
        extra: {},
      },
    };

    const tools: ToolDefinition[] = [{
      name: "search",
      description: "Search the web",
      parameters: { type: "object", properties: { q: { type: "string" } } },
    }];

    const result = await chatWithTools(client, "MiniMax-M2.7", [
      { role: "user", content: "search for cats" },
    ], tools);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe("search");
    expect(result.toolCalls[0]?.arguments).toBe('{"q":"test"}');
  });

  it("clamps temperature in chatWithTools for minimax", async () => {
    const create = vi.fn().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: "ok" } }] };
      },
    });
    const client: LLMClient = {
      provider: "minimax",
      apiFormat: "chat",
      stream: true,
      _openai: {
        chat: { completions: { create } },
      } as unknown as OpenAI,
      defaults: {
        temperature: 0.7,
        maxTokens: 8192,
        thinkingBudget: 0,
        maxTokensCap: null,
        extra: {},
      },
    };

    await chatWithTools(client, "MiniMax-M2.7", [
      { role: "user", content: "hello" },
    ], [], { temperature: 0 });

    expect(create.mock.calls[0]?.[0].temperature).toBe(0.01);
  });
});

// === MiniMax M2.7-highspeed model ===

describe("MiniMax M2.7-highspeed model", () => {
  it("accepts MiniMax-M2.7-highspeed in schema", () => {
    const config = LLMConfigSchema.parse({
      provider: "minimax",
      baseUrl: "https://api.minimax.io/v1",
      apiKey: "test-key",
      model: "MiniMax-M2.7-highspeed",
    });
    expect(config.model).toBe("MiniMax-M2.7-highspeed");
  });

  it("creates client with MiniMax-M2.7-highspeed model", () => {
    const config = LLMConfigSchema.parse({
      provider: "minimax",
      baseUrl: "https://api.minimax.io/v1",
      apiKey: "test-key",
      model: "MiniMax-M2.7-highspeed",
    });
    const client = createLLMClient(config);
    expect(client.provider).toBe("minimax");
    expect(client._openai).toBeDefined();
  });
});
