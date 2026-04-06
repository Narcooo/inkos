import { afterEach, describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { chatCompletion, type LLMClient } from "../llm/provider.js";

const ZERO_USAGE = {
  prompt_tokens: 11,
  completion_tokens: 7,
  total_tokens: 18,
} as const;

async function captureError(task: Promise<unknown>): Promise<Error> {
  try {
    await task;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected promise to reject");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chatCompletion stream fallback", () => {
  it("falls back to sync chat completion when streamed chat returns no chunks", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({
        async *[Symbol.asyncIterator](): AsyncIterableIterator<unknown> {
          return;
        },
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "fallback content" } }],
        usage: ZERO_USAGE,
      });

    const client: LLMClient = {
      provider: "openai",
      apiFormat: "chat",
      stream: true,
      _openai: {
        chat: {
          completions: {
            create,
          },
        },
      } as unknown as OpenAI,
      defaults: {
        temperature: 0.7,
        maxTokens: 512,
        thinkingBudget: 0, maxTokensCap: null,
        extra: {},
      },
    };

    const result = await chatCompletion(client, "test-model", [
      { role: "user", content: "ping" },
    ]);

    expect(result.content).toBe("fallback content");
    expect(result.usage).toEqual({
      promptTokens: 11,
      completionTokens: 7,
      totalTokens: 18,
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ stream: true });
    expect(create.mock.calls[1]?.[0]).toMatchObject({ stream: false });
  });

  it("does not blindly suggest stream false for generic 400 errors", async () => {
    const create = vi.fn().mockRejectedValue(new Error("400 Bad Request"));

    const client: LLMClient = {
      provider: "openai",
      apiFormat: "chat",
      stream: false,
      _openai: {
        chat: {
          completions: {
            create,
          },
        },
      } as unknown as OpenAI,
      defaults: {
        temperature: 0.7,
        maxTokens: 512,
        thinkingBudget: 0, maxTokensCap: null,
        extra: {},
      },
    };

    const error = await captureError(chatCompletion(client, "test-model", [
      { role: "user", content: "ping" },
    ]));

    expect(error.message).toContain("API 返回 400");
    expect(error.message).not.toContain("\"stream\": false");
    expect(error.message).toContain("检查提供方文档");
  });

  it("reports when sync fallback is rejected because provider requires streaming", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({
        async *[Symbol.asyncIterator](): AsyncIterableIterator<unknown> {
          return;
        },
      })
      .mockRejectedValueOnce(new Error("400 {\"detail\":\"Stream must be set to true\"}"));

    const client: LLMClient = {
      provider: "openai",
      apiFormat: "chat",
      stream: true,
      _openai: {
        chat: {
          completions: {
            create,
          },
        },
      } as unknown as OpenAI,
      defaults: {
        temperature: 0.7,
        maxTokens: 512,
        thinkingBudget: 0, maxTokensCap: null,
        extra: {},
      },
    };

    const error = await captureError(chatCompletion(client, "test-model", [
      { role: "user", content: "ping" },
    ]));

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ stream: true });
    expect(create.mock.calls[1]?.[0]).toMatchObject({ stream: false });
    expect(error.message).toContain("stream:true");
    expect(error.message).not.toContain("\"stream\": false");
  });

  it("calls Gemini native sync API and returns text", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({
        candidates: [
          { content: { parts: [{ text: "OK" }] } },
        ],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 1,
          totalTokenCount: 6,
        },
      })),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client: LLMClient = {
      provider: "google",
      apiFormat: "chat",
      stream: false,
      _google: {
        apiKey: "test-google-key",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      },
      defaults: {
        temperature: 0.7,
        maxTokens: 512,
        thinkingBudget: 0,
        maxTokensCap: null,
        extra: {},
      },
    };

    const result = await chatCompletion(client, "gemini-2.5-flash", [
      { role: "user", content: "Reply with exactly OK" },
    ]);

    expect(result.content).toBe("OK");
    expect(result.usage).toEqual({
      promptTokens: 5,
      completionTokens: 1,
      totalTokens: 6,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/models/gemini-2.5-flash:generateContent?key=test-google-key"),
      expect.objectContaining({ method: "POST" }),
    );

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      generationConfig: {
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    });
  });
});
