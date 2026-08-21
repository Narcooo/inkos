import { describe, expect, it } from "vitest";
import { buildProductionRoleOverrides, validateProductionRoleSelection } from "./production-role-models.js";
import * as roleModels from "./production-role-models.js";

const catalog = ["openai/gpt", "deepseek/chat", "google/gemini"];

describe("production role model configuration", () => {
  it("maps fixed UI roles to the existing model override contract", () => {
    expect(buildProductionRoleOverrides({
      writer: "openai/gpt",
      logicAuditor: "deepseek/chat",
      commercialReader: "google/gemini",
      reviser: "openai/gpt",
      observerReflector: "deepseek/chat",
    }, { unrelated: "preserved" })).toEqual({
      defaultModel: "openai/gpt",
      modelOverrides: {
        unrelated: "preserved",
        auditor: "deepseek/chat",
        "commercial-reader": "google/gemini",
        reviser: "openai/gpt",
        "observer-reflector": "deepseek/chat",
      },
    });
  });

  it("allows an explicit OpenRouter slug even when it is not in the current catalog", () => {
    expect(validateProductionRoleSelection({
      writer: "new-provider/new-model",
      logicAuditor: "deepseek/chat",
      commercialReader: "google/gemini",
      reviser: "openai/gpt",
      observerReflector: "deepseek/chat",
    }, catalog).writer).toBe("new-provider/new-model");
  });

  it("rejects blank or malformed manual model ids", () => {
    const selection = {
      writer: "openai/gpt",
      logicAuditor: "deepseek/chat",
      commercialReader: "google/gemini",
      reviser: "openai/gpt",
      observerReflector: "deepseek/chat",
    };
    expect(() => validateProductionRoleSelection({ ...selection, writer: "" }, catalog)).toThrow(/required/i);
    expect(() => validateProductionRoleSelection({ ...selection, writer: "not a slug" }, catalog)).toThrow(/model id/i);
  });

  it("searches a live catalog by model id and display name", () => {
    const models = [
      { id: "openai/gpt-new", name: "New GPT", contextWindow: 1000 },
      { id: "deepseek/review", name: "DeepSeek Reviewer", contextWindow: 2000 },
    ];
    expect(roleModels.searchProductionModelCatalog(models, "gpt").map((model) => model.id)).toEqual(["openai/gpt-new"]);
    expect(roleModels.searchProductionModelCatalog(models, "reviewer").map((model) => model.id)).toEqual(["deepseek/review"]);
  });

  it("requires explicit text input and output capability for live OpenRouter entries", () => {
    expect(roleModels.isTextGenerationCatalogModel({ id: "provider/text", name: "Text", contextWindow: 1, inputModalities: ["text"], outputModalities: ["text"] })).toBe(true);
    expect(roleModels.isTextGenerationCatalogModel({ id: "provider/image", name: "Image", contextWindow: 1, inputModalities: ["text"], outputModalities: ["image"] })).toBe(false);
  });

  it("binds every saved role to exact live-catalog pricing without treating it as provider actual", () => {
    const selection = {
      writer: "openai/gpt-5.6-terra",
      logicAuditor: "deepseek/deepseek-v4-pro-0813",
      commercialReader: "google/gemini-3.7-flash",
      reviser: "openai/gpt-5.6-terra",
      observerReflector: "deepseek/deepseek-v4-flash-0731",
    };
    const liveCatalog = [...new Set(Object.values(selection))].map((id, index) => ({
      id,
      name: id,
      contextWindow: 128_000 + index,
      maxOutputTokens: 16_000 + index,
      inputPrice: `0.00000${index + 1}`,
      outputPrice: `0.00001${index + 1}`,
      inputModalities: ["text"],
      outputModalities: ["text"],
    }));

    const bound = roleModels.bindProductionRolePricing(selection, liveCatalog);

    expect(Object.values(bound)).toHaveLength(5);
    expect(Object.values(bound).every((entry) => entry.status === "VERIFIED_IN_CURRENT_CATALOG")).toBe(true);
    expect(bound.writer).toMatchObject({
      modelId: "openai/gpt-5.6-terra",
      inputUsdPerToken: 0.000001,
      outputUsdPerToken: 0.000011,
      pricingUnit: "USD_PER_TOKEN",
      contextWindow: 128_000,
      maxOutputTokens: 16_000,
    });
  });

  it("fails pricing closed for an unknown model or missing price", () => {
    const selection = { writer: "missing/model", logicAuditor: "priced/model", commercialReader: "priced/model", reviser: "priced/model", observerReflector: "priced/model" };
    const liveCatalog = [{ id: "priced/model", name: "Priced", contextWindow: 1, inputPrice: "0.1", inputModalities: ["text"], outputModalities: ["text"] }];
    const bound = roleModels.bindProductionRolePricing(selection, liveCatalog);
    expect(bound.writer.status).toBe("MODEL_NOT_IN_CURRENT_CATALOG");
    expect(bound.logicAuditor.status).toBe("PRICING_UNAVAILABLE");
  });
});
