import { describe, it, expect } from "vitest";
import { guessServiceFromBaseUrl, resolveServicePreset, listModelsForService } from "../llm/service-presets.js";

describe("service-presets regression", () => {
  describe("Kimi Code preset", () => {
    it("uses Anthropic protocol on the Kimi Code coding endpoint", () => {
      const preset = resolveServicePreset("kimicode");
      expect(preset).toBeDefined();
      expect(preset!.providerFamily).toBe("anthropic");
      expect(preset!.api).toBe("anthropic-messages");
      expect(preset!.baseUrl).toBe("https://api.kimi.com/coding");
      expect(preset!.modelsBaseUrl).toBe("https://api.kimi.com/coding/v1");
    });

    it("exposes the Kimi Code model through provider-bank model listing", async () => {
      const models = await listModelsForService("kimicode");
      expect(models.map((m) => m.id)).toContain("kimi-for-coding");
    });
  });

  describe("MiniMax preset", () => {
    it("has correct domestic MiniMax OpenAI-compatible baseUrl", () => {
      const preset = resolveServicePreset("minimax");
      expect(preset).toBeDefined();
      expect(preset!.baseUrl).toBe("https://api.minimax.cn/v1");
    });

    it("uses openai-completions api format", () => {
      const preset = resolveServicePreset("minimax");
      expect(preset!.providerFamily).toBe("openai");
      expect(preset!.api).toBe("openai-completions");
    });

  });

  describe("listModelsForService", () => {
    it("exposes kkaiapi as an OpenAI-compatible aggregator with text models", async () => {
      const preset = resolveServicePreset("kkaiapi");
      expect(preset).toMatchObject({
        providerFamily: "openai",
        api: "openai-completions",
        baseUrl: "https://api.kkaiapi.com/v1",
      });
      const models = await listModelsForService("kkaiapi");
      expect(models.map((m) => m.id)).toEqual(expect.arrayContaining([
        "gpt-5.5",
        "deepseek-v4-flash",
        "deepseek-v4-pro",
      ]));
      expect(guessServiceFromBaseUrl("https://api.kkaiapi.com/v1")).toBe("kkaiapi");
    });

    it("returns endpoint registry models for minimax", async () => {
      const models = await listModelsForService("minimax");
      expect(models.map((m) => m.id)).toEqual(["MiniMax-M3.1-Flash", "MiniMax-M3"]);
    });

    it("returns empty for custom service without apikey + baseUrl", async () => {
      const models = await listModelsForService("custom");
      expect(models).toEqual([]);
    });
  });
});
