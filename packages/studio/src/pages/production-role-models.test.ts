import { describe, expect, it } from "vitest";
import { buildProductionRoleOverrides, validateProductionRoleSelection } from "./production-role-models.js";

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

  it("rejects a model string that is not in the connected service catalog", () => {
    expect(() => validateProductionRoleSelection({
      writer: "unregistered/model",
      logicAuditor: "deepseek/chat",
      commercialReader: "google/gemini",
      reviser: "openai/gpt",
      observerReflector: "deepseek/chat",
    }, catalog)).toThrow(/not registered/i);
  });
});
