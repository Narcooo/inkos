import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import {
  generateOpenAICodexImage,
  OPENAI_CODEX_IMAGE_RESPONSES_URL,
} from "../llm/openai-codex-images.js";

function accessToken(accountId = "acct-image"): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({
    "https://api.openai.com/auth": { chatgpt_account_id: accountId },
  })}.signature`;
}

describe("OpenAI Codex OAuth image generation", () => {
  it("sends the hosted image tool through Codex Responses and parses the final SSE image", async () => {
    const image = Buffer.from("fake-image").toString("base64");
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response([
      "event: response.created",
      "data: {\"type\":\"response.created\"}",
      "",
      "event: response.output_item.done",
      `data: ${JSON.stringify({ type: "response.output_item.done", item: { type: "image_generation_call", result: image } })}`,
      "",
    ].join("\n"), { status: 200, headers: { "content-type": "text/event-stream" } }));

    const result = await generateOpenAICodexImage({
      accessToken: accessToken(),
      prompt: "竖版小说封面",
      size: "1024x1360",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.buffer).toEqual(Buffer.from("fake-image"));
    expect(fetchMock).toHaveBeenCalledWith(OPENAI_CODEX_IMAGE_RESPONSES_URL, expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        "ChatGPT-Account-Id": "acct-image",
        Accept: "text/event-stream",
      }),
    }));
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.model).toBe("gpt-5.6-sol");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body.tools).toEqual([expect.objectContaining({
      type: "image_generation",
      model: "gpt-image-2",
      size: "1024x1536",
      quality: "medium",
    })]);
  });

  it("falls back to an older host model only when Codex rejects the model slug", async () => {
    const image = Buffer.from("fallback-image").toString("base64");
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: "The 'gpt-5.6-sol' model is not supported" },
      }), { status: 400 }))
      .mockResolvedValueOnce(new Response(
        `data: ${JSON.stringify({ type: "image_generation_call", result: image })}\n\n`,
        { status: 200 },
      ));

    await expect(generateOpenAICodexImage({
      accessToken: accessToken(),
      prompt: "cover",
      size: "1024x1024",
      fetchImpl: fetchMock as unknown as typeof fetch,
    })).resolves.toMatchObject({ buffer: Buffer.from("fallback-image") });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).model).toBe("gpt-5.5");
  });
});
