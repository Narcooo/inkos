import { describe, expect, it, vi } from "vitest";
import {
  rehydrateServiceConnectionStatus,
  saveServiceConfigWithValidation,
} from "./service-detail-state";

describe("rehydrateServiceConnectionStatus", () => {
  it("verifies the saved key via /test on page load instead of /models", async () => {
    const fetchJsonImpl = vi.fn(async (path: string) => {
      if (path === "/services/openai/secret") {
        return { apiKey: "sk-live" };
      }
      if (path === "/services/openai/test") {
        return {
          ok: true,
          models: [{ id: "gpt-5.4", name: "gpt-5.4" }],
          selectedModel: "gpt-5.4",
          detected: { apiFormat: "responses", stream: false, modelsSource: "api" },
        };
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

    expect(fetchJsonImpl).toHaveBeenCalledTimes(2);
    expect(fetchJsonImpl).toHaveBeenNthCalledWith(1, "/services/openai/secret");
    expect(fetchJsonImpl).toHaveBeenNthCalledWith(
      2,
      "/services/openai/test",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toMatchObject({
      apiKey: "sk-live",
      detectedModel: "gpt-5.4",
      detectedConfig: { apiFormat: "responses", stream: false, modelsSource: "api" },
      status: {
        state: "connected",
        models: [{ id: "gpt-5.4", name: "gpt-5.4" }],
      },
    });
  });
});

describe("saveServiceConfigWithValidation", () => {
  it("validates the key before persisting secrets/config", async () => {
    const calls: string[] = [];
    const fetchJsonImpl = vi.fn(async (path: string) => {
      calls.push(path);
      if (path === "/services/openai/test") {
        return {
          ok: true,
          models: [{ id: "gpt-5.4", name: "gpt-5.4" }],
          selectedModel: "gpt-5.4",
          detected: { apiFormat: "responses", stream: false },
        };
      }
      if (path === "/services/openai/secret") return { ok: true };
      if (path === "/services/config") return { ok: true };
      throw new Error(`unexpected path: ${path}`);
    });

    const result = await saveServiceConfigWithValidation({
      effectiveServiceId: "openai",
      serviceId: "openai",
      isCustom: false,
      resolvedCustomName: "",
      apiKey: "sk-live",
      baseUrl: "",
      apiFormat: "chat",
      stream: true,
      temperature: "0.7",
      maxTokens: "4096",
      detectedModel: "",
      fetchJsonImpl: fetchJsonImpl as never,
    });

    expect(calls).toEqual([
      "/services/openai/test",
      "/services/openai/secret",
      "/services/config",
    ]);
    expect(result).toMatchObject({
      detectedModel: "gpt-5.4",
      detectedConfig: { apiFormat: "responses", stream: false },
      status: {
        state: "connected",
        models: [{ id: "gpt-5.4", name: "gpt-5.4" }],
      },
    });
  });

  it("does not persist secrets/config when validation fails", async () => {
    const calls: string[] = [];
    const fetchJsonImpl = vi.fn(async (path: string) => {
      calls.push(path);
      if (path === "/services/openai/test") {
        throw new Error("401 Unauthorized");
      }
      throw new Error(`unexpected path: ${path}`);
    });

    await expect(saveServiceConfigWithValidation({
      effectiveServiceId: "openai",
      serviceId: "openai",
      isCustom: false,
      resolvedCustomName: "",
      apiKey: "sk-bad",
      baseUrl: "",
      apiFormat: "chat",
      stream: true,
      temperature: "0.7",
      maxTokens: "4096",
      detectedModel: "",
      fetchJsonImpl: fetchJsonImpl as never,
    })).rejects.toThrow("401 Unauthorized");

    expect(calls).toEqual(["/services/openai/test"]);
  });
});
