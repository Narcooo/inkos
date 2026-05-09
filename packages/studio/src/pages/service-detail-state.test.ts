import { describe, expect, it, vi } from "vitest";
import {
  matchServiceConfigEntryForDetail,
  rehydrateServiceConnectionStatus,
  saveServiceConfig,
} from "./service-detail-state";

describe("rehydrateServiceConnectionStatus", () => {
  it("loads saved key without probing models on page load", async () => {
    const fetchJsonImpl = vi.fn(async (path: string) => {
      if (path === "/services/openai/secret") {
        return { apiKey: "sk-live" };
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const result = await rehydrateServiceConnectionStatus({
      effectiveServiceId: "openai",
      shouldVerify: true,
      isCustom: false,
      baseUrl: "",
      apiFormat: "chat",
      stream: true,
      fetchJsonImpl: fetchJsonImpl as never,
    });

    expect(fetchJsonImpl).toHaveBeenCalledTimes(1);
    expect(fetchJsonImpl).toHaveBeenCalledWith("/services/openai/secret");
    expect(result).toMatchObject({
      apiKey: "sk-live",
      detectedModel: "",
      detectedConfig: null,
      status: { state: "idle" },
    });
  });
});

describe("matchServiceConfigEntryForDetail", () => {
  const entries = [
    { service: "moonshot", temperature: 0.5 },
    { service: "custom", name: "内网GPT", baseUrl: "https://llm.internal.corp/v1" },
    { service: "custom", name: "本地Ollama", baseUrl: "http://localhost:11434/v1" },
  ];

  it("matches concrete custom services without treating bare custom as an existing config", () => {
    expect(matchServiceConfigEntryForDetail(entries, "custom")).toBeUndefined();
    expect(matchServiceConfigEntryForDetail(entries, "custom:内网GPT")).toEqual(entries[1]);
  });

  it("matches non-custom services by service id", () => {
    expect(matchServiceConfigEntryForDetail(entries, "moonshot")).toEqual(entries[0]);
  });
});

describe("saveServiceConfig", () => {
  it("validates the upstream service before persisting secrets/config", async () => {
    const calls: string[] = [];
    const bodies: unknown[] = [];
    const fetchJsonImpl = vi.fn(async (path: string, init?: { body?: string }) => {
      calls.push(path);
      if (init?.body) bodies.push(JSON.parse(init.body));
      if (path === "/services/openai/test") {
        return {
          ok: true,
          models: [{ id: "gpt-5.5" }],
          selectedModel: "gpt-5.5",
          detected: { apiFormat: "chat", stream: true },
        };
      }
      if (path === "/services/openai/secret") return { ok: true };
      if (path === "/services/config") return { ok: true };
      throw new Error(`unexpected path: ${path}`);
    });

    const result = await saveServiceConfig({
      effectiveServiceId: "openai",
      serviceId: "openai",
      isCustom: false,
      resolvedCustomName: "",
      apiKey: "sk-live",
      baseUrl: "",
      apiFormat: "chat",
      stream: true,
      temperature: "0.7",
      selectedModel: "",
      fetchJsonImpl: fetchJsonImpl as never,
    });

    expect(calls).toEqual([
      "/services/openai/test",
      "/services/openai/secret",
      "/services/config",
    ]);
    expect(bodies).toEqual([
      { apiKey: "sk-live", apiFormat: "chat", stream: true },
      { apiKey: "sk-live" },
      {
        service: "openai",
        defaultModel: "gpt-5.5",
        services: [
          { service: "openai", temperature: 0.7, apiFormat: "chat", stream: true },
        ],
      },
    ]);
    expect(result).toEqual({
      detectedModel: "gpt-5.5",
      detectedConfig: { apiFormat: "chat", stream: true },
      status: { state: "connected", models: [{ id: "gpt-5.5" }] },
    });
  });

  it("does not persist secrets/config when validation fails", async () => {
    const calls: string[] = [];
    const fetchJsonImpl = vi.fn(async (path: string, init?: { body?: string }) => {
      calls.push(path);
      if (path === "/services/openai/test") {
        expect(init?.body ? JSON.parse(init.body) : null).toEqual({
          apiKey: "sk-bad",
          apiFormat: "chat",
          stream: true,
        });
        return { ok: false, error: "invalid key" };
      }
      throw new Error(`unexpected path: ${path}`);
    });

    await expect(saveServiceConfig({
      effectiveServiceId: "openai",
      serviceId: "openai",
      isCustom: false,
      resolvedCustomName: "",
      apiKey: "sk-bad",
      baseUrl: "",
      apiFormat: "chat",
      stream: true,
      temperature: "0.7",
      selectedModel: "",
      fetchJsonImpl: fetchJsonImpl as never,
    })).resolves.toEqual({
      detectedModel: "",
      detectedConfig: null,
      status: { state: "error", message: "invalid key" },
    });

    expect(calls).toEqual(["/services/openai/test"]);
  });

  it("passes the selected custom model through test and save", async () => {
    const bodies: unknown[] = [];
    const fetchJsonImpl = vi.fn(async (path: string, init?: { body?: string }) => {
      if (init?.body) bodies.push(JSON.parse(init.body));
      if (path === "/services/custom%3AOMLX/test") {
        return {
          ok: true,
          models: [{ id: "qwen-local" }],
          selectedModel: "qwen-local",
          detected: { apiFormat: "chat", stream: false, baseUrl: "http://127.0.0.1:8000/v1" },
        };
      }
      if (path === "/services/custom%3AOMLX/secret") return { ok: true };
      if (path === "/services/config") return { ok: true };
      throw new Error(`unexpected path: ${path}`);
    });

    await saveServiceConfig({
      effectiveServiceId: "custom:OMLX",
      serviceId: "custom:OMLX",
      isCustom: true,
      resolvedCustomName: "OMLX",
      apiKey: "sk-local",
      baseUrl: "http://127.0.0.1:8000/v1",
      apiFormat: "chat",
      stream: true,
      temperature: "0.7",
      selectedModel: "qwen-local",
      fetchJsonImpl: fetchJsonImpl as never,
    });

    expect(bodies).toEqual([
      {
        apiKey: "sk-local",
        apiFormat: "chat",
        stream: true,
        baseUrl: "http://127.0.0.1:8000/v1",
        model: "qwen-local",
      },
      { apiKey: "sk-local" },
      {
        service: "custom:OMLX",
        defaultModel: "qwen-local",
        services: [
          {
            service: "custom",
            name: "OMLX",
            baseUrl: "http://127.0.0.1:8000/v1",
            temperature: 0.7,
            apiFormat: "chat",
            stream: false,
          },
        ],
      },
    ]);
  });
});
