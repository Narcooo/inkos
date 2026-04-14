// packages/core/src/__tests__/service-resolver.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock pi-ai's getModel
vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn((provider: string, modelId: string) => ({
    id: modelId,
    api: { name: "mock-api" },
    _provider: provider,
  })),
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
