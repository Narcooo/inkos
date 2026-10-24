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

  it.each([
    ["openrouter", "minimax/minimax-m3", "minimax/minimax-m3.1-flash:free"],
    ["opencodeCodingPlan", "minimax-m3", "minimax-m3.1-flash-free"],
  ])("orders only the MiniMax slots for %s, keeping gateway metadata", async (service, m3, flash) => {
    const other = { id: "unrelated-before", name: "before", contextWindow: 1234 };
    const media = { id: "minimax/image-01", name: "cover", contextWindow: 0 };
    const last = { id: "unrelated-after", name: "after", contextWindow: 5678 };
    const m3Card = { id: m3, name: "gateway M3", contextWindow: 131072 };
    const flashCard = { id: flash, name: "gateway Flash", contextWindow: 262144 };
    for (const pair of [[m3Card, flashCard], [flashCard, m3Card]]) {
      probeModels.mockResolvedValue([other, pair[0], media, pair[1], last]);
      const models = await listModelsForService(service, "test-key");
      expect(models.slice(0, 5)).toEqual([other, flashCard, media, m3Card, last]);
      expect(models.find((model) => model.id === flash)).not.toHaveProperty("maxOutput");
    }
  });

  it.each([
    ["openrouter", "minimax/minimax-m3"],
    ["opencodeCodingPlan", "minimax-m3"],
  ])("does not invent Flash when %s only discovers M3", async (service, m3) => {
    probeModels.mockResolvedValue([{ id: m3, name: m3, contextWindow: 131072 }]);
    const models = await listModelsForService(service, "test-key");
    expect(models[0]?.id).toBe(m3);
    expect(models.some((model) => /minimax-m3\.1-flash/i.test(model.id))).toBe(false);
  });

  it.each(["custom", "newapi", "ollama", "lmstudio", "minimaxCodingPlan"])(
    "preserves the explicit catalog order for %s", async (service) => {
      const saved = ["MiniMax-M2.7", "MiniMax-M3", "image-01", "MiniMax-M3.1-Flash"];
      probeModels.mockResolvedValue(saved.map((id) => ({ id, name: id, contextWindow: 0 })));
      const models = await listModelsForService(service, "test-key", "https://custom.example/v1");
      expect(models.slice(0, saved.length).map((model) => model.id)).toEqual(saved);
    },
  );

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
