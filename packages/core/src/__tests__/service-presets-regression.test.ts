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
      expect(preset!.baseUrl).toBe("https://api.minimaxi.com/v1");
    });

    it("uses openai-completions api format", () => {
      const preset = resolveServicePreset("minimax");
      expect(preset!.providerFamily).toBe("openai");
      expect(preset!.api).toBe("openai-completions");
    });

    it("has knownModels with all 7 MiniMax models", () => {
      const preset = resolveServicePreset("minimax");
      expect(preset!.knownModels).toBeDefined();
      expect(preset!.knownModels).toHaveLength(7);
      expect(preset!.knownModels).toContain("MiniMax-M2.7");
      expect(preset!.knownModels).toContain("MiniMax-M2.7-highspeed");
      expect(preset!.knownModels).toContain("MiniMax-M2.5");
      expect(preset!.knownModels).toContain("MiniMax-M2");
    });
  });

  describe("listModelsForService", () => {
    it("exposes AgnesAI as an OpenAI-compatible provider with text models", async () => {
      const preset = resolveServicePreset("agnesai");
      expect(preset).toMatchObject({
        providerFamily: "openai",
        api: "openai-completions",
        baseUrl: "https://apihub.agnes-ai.com/v1",
      });

      const models = await listModelsForService("agnesai");
      expect(models.map((m) => m.id)).toEqual(expect.arrayContaining([
        "agnes-2.0-flash",
        "agnes-1.5-flash",
      ]));
      expect(models.some((m) => m.id.includes("image"))).toBe(false);
      expect(guessServiceFromBaseUrl("https://apihub.agnes-ai.com/v1")).toBe("agnesai");
    });

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

    it("returns provider bank models for minimax (B8 升级：provider.models 替代 preset.knownModels)", async () => {
      const models = await listModelsForService("minimax");
      expect(models.length).toBeGreaterThanOrEqual(7);
      expect(models.some((m) => m.id === "MiniMax-M2.7")).toBe(true);
    });

    it("returns empty for custom service without apikey + baseUrl", async () => {
      const models = await listModelsForService("custom");
      expect(models).toEqual([]);
    });
  });
});
