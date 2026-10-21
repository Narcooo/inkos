import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAllEndpoints, getEndpoint, isCurrentMiniMaxChoice } from "../llm/providers/index.js";
import { lookupModel } from "../llm/providers/lookup.js";
import { guessServiceFromBaseUrl, listModelsForService } from "../llm/service-presets.js";

const { probeModels } = vi.hoisted(() => ({ probeModels: vi.fn() }));
vi.mock("../llm/providers/probe.js", () => ({ probeModelsFromUpstream: probeModels }));

beforeEach(() => probeModels.mockReset().mockResolvedValue([]));

describe("MiniMax ordinary model choices", () => {
  it("defaults to Flash while retaining legacy lookup metadata", async () => {
    expect(getEndpoint("minimax")?.checkModel).toBe("MiniMax-M3.1-Flash");
    expect(await listModelsForService("minimax")).toEqual([
      { id: "MiniMax-M3.1-Flash", name: "MiniMax-M3.1-Flash", maxOutput: 524288, contextWindow: 1_000_000 },
      { id: "MiniMax-M3", name: "MiniMax-M3", maxOutput: 131072, contextWindow: 1_000_000 },
    ]);
    expect(lookupModel("minimax", "MiniMax-M2.7")).toMatchObject({
      id: "MiniMax-M2.7", maxOutput: 131072, contextWindowTokens: 204800,
    });
  });

  it("filters stale live recommendations and keeps Flash first", async () => {
    probeModels.mockResolvedValue([
      { id: "MiniMax-M2.7", name: "MiniMax-M2.7", contextWindow: 204800 },
      { id: "MiniMax-M3", name: "MiniMax-M3", contextWindow: 1_000_000 },
      { id: "MiniMax-M3.1-Flash", name: "MiniMax-M3.1-Flash", contextWindow: 1_000_000 },
    ]);
    expect((await listModelsForService("minimax", "test-key")).map((m) => m.id))
      .toEqual(["MiniMax-M3.1-Flash", "MiniMax-M3"]);
  });

  it("filters legacy gateway text IDs without inventing routes or changing other models", async () => {
    probeModels.mockResolvedValue([
      { id: "minimax/minimax-m2.7", name: "legacy", contextWindow: 1 },
      { id: "minimax/minimax-m3.1-flash:free", name: "current", contextWindow: 262144 },
      { id: "unrelated-model", name: "unrelated", contextWindow: 1234 },
      { id: "MiniMax-M3.1-Flash", name: "gateway", contextWindow: 262144 },
    ]);
    const models = await listModelsForService("openrouter", "test-key");
    expect(models.some((m) => m.id === "minimax/minimax-m2.7")).toBe(false);
    expect(models.find((m) => m.id === "minimax/minimax-m3.1-flash:free")?.contextWindow).toBe(262144);
    expect(models.find((m) => m.id === "unrelated-model")?.contextWindow).toBe(1234);
    expect(models.find((m) => m.id === "MiniMax-M3.1-Flash")).toMatchObject({ contextWindow: 262144 });
    expect(models.find((m) => m.id === "MiniMax-M3.1-Flash")).not.toHaveProperty("maxOutput");
    for (const endpoint of getAllEndpoints()) {
      if (endpoint.id === "minimaxCodingPlan") continue;
      expect(endpoint.models.filter((model) => model.enabled !== false)
        .every((model) => isCurrentMiniMaxChoice(endpoint.id, model.id))).toBe(true);
    }
  });

  it("preserves custom catalogs, legacy subscriptions, and nontext IDs", async () => {
    probeModels.mockResolvedValue([{ id: "MiniMax-M2.7", name: "saved", contextWindow: 204800 }]);
    expect((await listModelsForService("custom", "test-key", "https://custom.example/v1"))[0]?.id).toBe("MiniMax-M2.7");
    expect(getEndpoint("minimaxCodingPlan")?.checkModel).toBe("MiniMax-M2.7");
    expect((await listModelsForService("minimaxCodingPlan")).some((m) => m.id === "MiniMax-M2.7")).toBe(true);
    expect(isCurrentMiniMaxChoice("minimax", "image-01")).toBe(true);
    expect(isCurrentMiniMaxChoice("custom:private", "MiniMax-M2.7")).toBe(true);
  });

  it.each(["api.minimax.cn", "api.minimax.io", "api.minimaxi.com"])("recognizes %s without rewriting saved URLs", (host) => {
    expect(guessServiceFromBaseUrl(`https://${host}/v1`)).toBe("minimax");
  });
});
