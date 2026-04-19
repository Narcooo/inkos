import { describe, it, expect } from "vitest";
import { resolveServicePreset, listModelsForService } from "../llm/service-presets.js";

describe("service-presets regression", () => {
  describe("MiniMax preset", () => {
    it("has correct domestic MiniMax baseUrl (api.minimaxi.com/anthropic)", () => {
      const preset = resolveServicePreset("minimax");
      expect(preset).toBeDefined();
      expect(preset!.baseUrl).toBe("https://api.minimaxi.com/anthropic");
    });

    it("uses anthropic-messages api format", () => {
      const preset = resolveServicePreset("minimax");
      expect(preset!.api).toBe("anthropic-messages");
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
    it("returns knownModels immediately for minimax without calling /models API", async () => {
      const models = await listModelsForService("minimax");
      expect(models.length).toBe(7);
      expect(models[0].id).toBe("MiniMax-M2.7");
    });

    it("returns empty for custom service", async () => {
      const models = await listModelsForService("custom");
      expect(models).toEqual([]);
    });
  });
});
