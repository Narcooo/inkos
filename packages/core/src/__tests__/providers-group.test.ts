import { describe, expect, it } from "vitest";
import { getAllEndpoints } from "../llm/providers/index.js";

describe("InkosEndpoint.group", () => {
  it("每个非 custom endpoint 都必须声明 group 字段", () => {
    const missing = getAllEndpoints().filter((ep) => ep.id !== "custom" && !ep.group);
    expect(missing, `missing group: ${missing.map((e) => e.id).join(", ")}`).toHaveLength(0);
  });

  it("每个 group 的 endpoint 数量匹配分组清单", () => {
    const all = getAllEndpoints();
    const byGroup = (g: string) => all.filter((ep) => ep.group === g).map((e) => e.id).sort();

    expect(byGroup("overseas")).toEqual(["anthropic", "google", "mistral", "openai", "openaiCodex", "xai"].sort());
    expect(byGroup("china")).toEqual([
      "ai360", "baichuan", "bailian", "deepseek", "hunyuan", "internlm", "longcat",
      "minimax", "moonshot", "sensenova", "spark", "stepfun", "tencentcloud",
      "volcengine", "wenxin", "xiaomimimo", "zeroone", "zhipu",
    ].sort());
    expect(byGroup("aggregator")).toEqual([
      "kkaiapi", "newapi", "openrouter", "siliconcloud",
    ].sort());
    expect(byGroup("local")).toEqual(["githubCopilot", "ollama"].sort());
    expect(byGroup("codingPlan")).toEqual([
      "astronCodingPlan", "bailianCodingPlan", "glmCodingPlan", "kimiCodingPlan", "kimicode",
      "minimaxCodingPlan", "opencodeCodingPlan", "volcengineCodingPlan",
    ].sort());
  });

  it("custom endpoint 不参与分组计数", () => {
    const custom = getAllEndpoints().find((ep) => ep.id === "custom");
    expect(custom).toBeDefined();
  });
});
