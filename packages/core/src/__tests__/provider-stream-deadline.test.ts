import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { guardAssistantMessageStream } from "../llm/provider.js";

const MODEL = {
  id: "slow-model",
  name: "slow-model",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "https://example.invalid/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 4096,
} satisfies Model<"openai-completions">;

describe("guardAssistantMessageStream", () => {
  afterEach(() => {
    delete process.env.INKOS_LLM_FIRST_EVENT_TIMEOUT_MS;
    delete process.env.INKOS_LLM_STREAM_IDLE_TIMEOUT_MS;
  });

  it("ends a stream that never produces its first event", async () => {
    const guarded = guardAssistantMessageStream(
      MODEL,
      () => createAssistantMessageEventStream(),
      undefined,
      { firstEventTimeoutMs: 10 },
    );

    const events = [];
    for await (const event of guarded) events.push(event);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "error",
      reason: "error",
      error: {
        stopReason: "error",
        errorMessage: "LLM stream produced no event within 10ms",
      },
    });
  });

  it("keeps environment overrides authoritative", async () => {
    process.env.INKOS_LLM_FIRST_EVENT_TIMEOUT_MS = "10";
    const guarded = guardAssistantMessageStream(
      MODEL,
      () => createAssistantMessageEventStream(),
      undefined,
      { firstEventTimeoutMs: 60_000 },
    );

    const events = [];
    for await (const event of guarded) events.push(event);

    expect(events[0]).toMatchObject({
      type: "error",
      error: { errorMessage: "LLM stream produced no event within 10ms" },
    });
  });
});
