import { describe, expect, it, vi } from "vitest";
import {
  deleteServiceConfig,
  matchServiceConfigEntryForDetail,
  mergeServiceDetailModels,
  rehydrateServiceConnectionStatus,
  saveServiceConfig,
} from "./service-detail-state";

describe("mergeServiceDetailModels", () => {
  it("keeps discovered and user-added models in one stable catalog", () => {
    expect(mergeServiceDetailModels(
      [{ id: "MiniMax-M2.7" }],
      ["minimax-m2.7", "MiniMax-M2.8"],
    )).toEqual([
      { id: "MiniMax-M2.7" },
      { id: "MiniMax-M2.8" },
    ]);
  });
});

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
  it("shows a plain error when API key is empty", async () => {
    await expect(saveServiceConfig({
      effectiveServiceId: "openai",
      serviceId: "openai",
      isCustom: false,
      resolvedCustomName: "",
      apiKey: "",
      baseUrl: "",
      apiFormat: "chat",
      stream: true,
      temperature: "0.7",
      detectedModel: "",
    })).resolves.toMatchObject({
      status: {
        state: "error",
        message: "请先输入 API Key",
      },
    });
  });

  it("allows a built-in local service to validate and save without an API key", async () => {
    const calls: string[] = [];
    const fetchJsonImpl = vi.fn(async (path: string) => {
      calls.push(path);
      if (path === "/services/lmstudio/test") {
        return {
          ok: true,
          models: [{ id: "qwen3-30b" }],
          selectedModel: "qwen3-30b",
          detected: { apiFormat: "chat", stream: true },
        };
      }
      if (path === "/services/lmstudio/secret") return { ok: true };
      if (path === "/services/config") return { ok: true };
      throw new Error(`unexpected path: ${path}`);
    });

    const result = await saveServiceConfig({
      effectiveServiceId: "lmstudio",
      serviceId: "lmstudio",
      isCustom: false,
      apiKeyOptional: true,
      resolvedCustomName: "",
      apiKey: "",
      baseUrl: "",
      apiFormat: "chat",
      stream: true,
      temperature: "0.7",
      detectedModel: "",
      fetchJsonImpl: fetchJsonImpl as never,
    });

    expect(calls).toEqual([
      "/services/lmstudio/test",
      "/services/lmstudio/secret",
      "/services/config",
    ]);
    expect(result).toMatchObject({
      status: { state: "connected", models: [{ id: "qwen3-30b" }] },
      detectedModel: "qwen3-30b",
    });
  });

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
      detectedModel: "",
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
          { service: "openai", temperature: 0.7, apiFormat: "chat", stream: true, models: ["gpt-5.5"] },
        ],
      },
    ]);
    expect(result).toEqual({
      detectedModel: "gpt-5.5",
      detectedConfig: { apiFormat: "chat", stream: true },
      status: { state: "connected", models: [{ id: "gpt-5.5" }] },
    });
  });

  it("reuses a matching successful test result when saving", async () => {
    const calls: string[] = [];
    const bodies: unknown[] = [];
    const fetchJsonImpl = vi.fn(async (path: string, init?: { body?: string }) => {
      calls.push(path);
      if (init?.body) bodies.push(JSON.parse(init.body));
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
      detectedModel: "",
      verifiedProbe: {
        apiKey: "sk-live",
        baseUrl: "",
        apiFormat: "chat",
        stream: true,
        models: [{ id: "gpt-5.5" }],
        selectedModel: "gpt-5.5",
        detected: { apiFormat: "chat", stream: true },
      },
      fetchJsonImpl: fetchJsonImpl as never,
    });

    expect(calls).toEqual([
      "/services/openai/secret",
      "/services/config",
    ]);
    expect(bodies).toEqual([
      { apiKey: "sk-live" },
      {
        service: "openai",
        defaultModel: "gpt-5.5",
        services: [
          { service: "openai", temperature: 0.7, apiFormat: "chat", stream: true, models: ["gpt-5.5"] },
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
      detectedModel: "",
      fetchJsonImpl: fetchJsonImpl as never,
    })).resolves.toEqual({
      detectedModel: "",
      detectedConfig: null,
      status: { state: "error", message: "invalid key" },
    });

    expect(calls).toEqual(["/services/openai/test"]);
  });

  it("allows local custom services to validate and save without an API key", async () => {
    const calls: string[] = [];
    const bodies: unknown[] = [];
    const fetchJsonImpl = vi.fn(async (path: string, init?: { body?: string }) => {
      calls.push(path);
      if (init?.body) bodies.push(JSON.parse(init.body));
      if (path === "/services/custom%3ALocal/test") {
        return {
          ok: true,
          models: [{ id: "qwen3.6:35b-a3b" }],
          selectedModel: "qwen3.6:35b-a3b",
          detected: { apiFormat: "chat", stream: false, baseUrl: "http://127.0.0.1:8001/v1" },
        };
      }
      if (path === "/services/custom%3ALocal/secret") return { ok: true };
      if (path === "/services/config") return { ok: true };
      throw new Error(`unexpected path: ${path}`);
    });

    const result = await saveServiceConfig({
      effectiveServiceId: "custom:Local",
      serviceId: "custom",
      isCustom: true,
      resolvedCustomName: "Local",
      apiKey: "",
      baseUrl: "http://127.0.0.1:8001/v1",
      apiFormat: "chat",
      stream: false,
      temperature: "0.7",
      detectedModel: "",
      fetchJsonImpl: fetchJsonImpl as never,
    });

    expect(calls).toEqual([
      "/services/custom%3ALocal/test",
      "/services/custom%3ALocal/secret",
      "/services/config",
    ]);
    expect(bodies).toEqual([
      { apiKey: "", apiFormat: "chat", stream: false, baseUrl: "http://127.0.0.1:8001/v1" },
      { apiKey: "" },
      {
        service: "custom:Local",
        defaultModel: "qwen3.6:35b-a3b",
        services: [
          {
            service: "custom",
            temperature: 0.7,
            apiFormat: "chat",
            stream: false,
            models: ["qwen3.6:35b-a3b"],
            name: "Local",
            baseUrl: "http://127.0.0.1:8001/v1",
          },
        ],
      },
    ]);
    expect(result.status).toEqual({ state: "connected", models: [{ id: "qwen3.6:35b-a3b" }] });
  });
});

describe("deleteServiceConfig", () => {
  it("deletes a configured service through the service endpoint", async () => {
    const fetchJsonImpl = vi.fn(async () => ({ ok: true }));

    await deleteServiceConfig("custom:Local", { fetchJsonImpl: fetchJsonImpl as never });

    expect(fetchJsonImpl).toHaveBeenCalledWith("/services/custom%3ALocal", {
      method: "DELETE",
    });
  });
});
