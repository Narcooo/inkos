import { describe, expect, it, vi } from "vitest";
import { resolveEffectiveLLMConfig } from "../utils/effective-llm-config.js";
import { chatCompletion, createLLMClient } from "../llm/provider.js";

const { fixture, requests } = vi.hoisted(() => ({
  fixture: { llm: {} as Record<string, unknown> },
  requests: [] as Array<{ url: string; body: Record<string, unknown> }>,
}));
vi.mock("node:fs/promises", () => ({
  access: vi.fn(async () => undefined),
  readFile: vi.fn(async () => JSON.stringify({ name: "test", version: "0.1.0", llm: fixture.llm })),
}));
vi.mock("../llm/secrets.js", () => ({
  loadSecrets: vi.fn(async () => ({ services: { minimax: { apiKey: "test-key" } } })),
}));
vi.mock("../utils/llm-env.js", () => ({ mergedLLMEnv: () => ({}), studioIgnoredEnv: () => ({}) }));
vi.mock("@mariozechner/pi-ai", () => ({
  completeSimple: vi.fn(() => { throw new Error("Expected native transport"); }),
  streamSimple: vi.fn(() => { throw new Error("Expected native transport"); }),
}));
vi.mock("../utils/proxy-fetch.js", () => ({
  fetchWithProxy: vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) });
    return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
  }),
}));

describe("MiniMax configuration to request boundary", () => {
  it.each(["studio", "cli"] as const)("defaults new %s configurations to Flash", async (consumer) => {
    fixture.llm = { service: "minimax", services: [{ service: "minimax" }] };
    requests.length = 0;
    const { llm } = await resolveEffectiveLLMConfig({
      consumer, projectRoot: "/fixture", envLayers: {} as never,
    });
    expect(llm.model).toBe("MiniMax-M3.1-Flash");
    await chatCompletion(createLLMClient(llm), llm.model, [{ role: "user", content: "hi" }], { retry: false });
    expect(requests[0]).toMatchObject({
      url: "https://api.minimax.cn/v1/chat/completions",
      body: { model: "MiniMax-M3.1-Flash", thinking: { type: "adaptive" }, reasoning_split: true },
    });
  });

  it.each(["studio", "cli"] as const)("preserves saved legacy IDs and implicit routes in %s", async (consumer) => {
    fixture.llm = {
      service: "minimax", defaultModel: "MiniMax-M2.7",
      services: [{ service: "minimax", models: ["MiniMax-M2.7"] }],
    };
    requests.length = 0;
    const { llm } = await resolveEffectiveLLMConfig({ consumer, projectRoot: "/fixture", envLayers: {} as never });
    expect(llm.model).toBe("MiniMax-M2.7");
    await chatCompletion(createLLMClient(llm), llm.model, [{ role: "user", content: "hi" }], { retry: false });
    expect(requests[0]!.url).toBe("https://api.minimaxi.com/v1/chat/completions");
    expect(requests[0]!.body.model).toBe("MiniMax-M2.7");
    expect(requests[0]!.body).not.toHaveProperty("thinking");
  });

  it("preserves an explicit service URL", async () => {
    fixture.llm = {
      service: "minimax", defaultModel: "MiniMax-M3.1-Flash",
      services: [{ service: "minimax", baseUrl: "https://custom.example/v1" }],
    };
    requests.length = 0;
    const { llm } = await resolveEffectiveLLMConfig({ consumer: "studio", projectRoot: "/fixture", envLayers: {} as never });
    await chatCompletion(createLLMClient(llm), llm.model, [{ role: "user", content: "hi" }], { retry: false });
    expect(requests[0]!.url).toBe("https://custom.example/v1/chat/completions");
  });
});
