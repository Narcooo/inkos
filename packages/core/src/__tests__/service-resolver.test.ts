// packages/core/src/__tests__/service-resolver.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Models that exist in pi-ai's built-in registry (simulated)
const KNOWN_MODELS = new Set(["gpt-4o", "kimi-k2.5"]);

// Mock pi-ai's getModel — returns undefined for models not in registry (like the real implementation)
vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn((provider: string, modelId: string) => {
    if (!KNOWN_MODELS.has(modelId)) return undefined;
    return {
      id: modelId,
      name: modelId,
      api: "openai-completions",
      provider,
      baseUrl: "https://api.openai.com/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 16384,
    };
  }),
  getEnvApiKey: vi.fn(() => undefined),
}));

import { resolveServiceModel } from "../llm/service-resolver.js";

describe("resolveServiceModel", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-resolver-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("resolves built-in service with key from secrets", async () => {
    await mkdir(join(root, ".inkos"), { recursive: true });
    await writeFile(
      join(root, ".inkos", "secrets.json"),
      JSON.stringify({ services: { moonshot: { apiKey: "sk-moon" } } }),
    );

    const result = await resolveServiceModel("moonshot", "kimi-k2.5", root);

    expect(result.model.id).toBe("kimi-k2.5");
    expect(result.apiKey).toBe("sk-moon");
    expect(result.writingTemperature).toBe(1.0);
    expect(result.temperatureRange).toEqual([0, 1]);
  });

  it("resolves deepseek with correct temperature", async () => {
    await mkdir(join(root, ".inkos"), { recursive: true });
    await writeFile(
      join(root, ".inkos", "secrets.json"),
      JSON.stringify({ services: { deepseek: { apiKey: "sk-deep" } } }),
    );

    const result = await resolveServiceModel("deepseek", "deepseek-chat", root);

    expect(result.apiKey).toBe("sk-deep");
    expect(result.writingTemperature).toBe(1.5);
    expect(result.temperatureRange).toEqual([0, 2]);
  });

  it("constructs model from preset when getModel returns undefined", async () => {
    await mkdir(join(root, ".inkos"), { recursive: true });
    await writeFile(
      join(root, ".inkos", "secrets.json"),
      JSON.stringify({ services: { deepseek: { apiKey: "sk-deep" } } }),
    );

    // "deepseek-chat" is NOT in KNOWN_MODELS, so getModel returns undefined
    const result = await resolveServiceModel("deepseek", "deepseek-chat", root);

    expect(result.model).toBeDefined();
    expect(result.model.id).toBe("deepseek-chat");
    expect(result.model.api).toBe("openai-completions");
    expect(result.model.baseUrl).toBe("https://api.deepseek.com");
    expect(result.model.provider).toBe("openai");
    expect(result.apiKey).toBe("sk-deep");
  });

  it("falls back to env var when no secrets file", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-env");

    const result = await resolveServiceModel("deepseek", "deepseek-chat", root);

    expect(result.apiKey).toBe("sk-env");
  });

  it("throws when no key found", async () => {
    await expect(
      resolveServiceModel("moonshot", "kimi-k2.5", root),
    ).rejects.toThrow(/API key/i);
  });

  it("resolves custom service with baseUrl", async () => {
    await mkdir(join(root, ".inkos"), { recursive: true });
    await writeFile(
      join(root, ".inkos", "secrets.json"),
      JSON.stringify({ services: { "custom:内网GPT": { apiKey: "sk-corp" } } }),
    );

    const result = await resolveServiceModel(
      "custom:内网GPT",
      "gpt-4o",
      root,
      "https://llm.internal.corp/v1",
    );

    expect(result.apiKey).toBe("sk-corp");
    expect(result.model.id).toBe("gpt-4o");
  });
});
