/**
 * Integration tests for MiniMax LLM provider.
 *
 * These tests verify the MiniMax integration end-to-end against the real API.
 * They require the MINIMAX_API_KEY environment variable to be set.
 *
 * Run with:
 *   MINIMAX_API_KEY=<your-key> npx vitest run src/__tests__/minimax-integration.test.ts
 */
import { describe, expect, it } from "vitest";
import { createLLMClient, chatCompletion } from "../llm/provider.js";
import { LLMConfigSchema } from "../models/project.js";

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;

const describeIf = MINIMAX_API_KEY ? describe : describe.skip;

describeIf("MiniMax integration (real API)", () => {
  const config = LLMConfigSchema.parse({
    provider: "minimax",
    baseUrl: "https://api.minimax.io/v1",
    apiKey: MINIMAX_API_KEY ?? "",
    model: "MiniMax-M2.7-highspeed",
    temperature: 0.7,
    maxTokens: 64,
  });
  const client = createLLMClient(config);

  it("completes a simple chat request (sync)", async () => {
    const syncClient = createLLMClient({ ...config, stream: false });
    const result = await chatCompletion(syncClient, config.model, [
      { role: "user", content: "Say OK and nothing else." },
    ], { maxTokens: 16 });

    expect(result.content).toBeTruthy();
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.usage.totalTokens).toBeGreaterThan(0);
  }, 30000);

  it("completes a simple chat request (streaming)", async () => {
    const result = await chatCompletion(client, config.model, [
      { role: "user", content: "Say OK and nothing else." },
    ], { maxTokens: 16 });

    expect(result.content).toBeTruthy();
    expect(result.content.length).toBeGreaterThan(0);
  }, 30000);

  it("handles system messages correctly", async () => {
    const result = await chatCompletion(client, config.model, [
      { role: "system", content: "You are a helpful assistant. Always reply with exactly one word." },
      { role: "user", content: "What color is the sky?" },
    ], { maxTokens: 16 });

    expect(result.content).toBeTruthy();
  }, 30000);
});
