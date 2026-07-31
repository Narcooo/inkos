import { describe, it, expect } from "vitest";
import { getAllEndpoints, getEndpoint } from "../llm/providers/index.js";

describe("providers structural integrity", () => {
  it("每个 provider 必填字段都存在", () => {
    const gatewayProviders = new Set(["custom", "newapi"]);
    for (const p of getAllEndpoints()) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.api).toMatch(/^(openai-completions|openai-responses|openai-codex-responses|anthropic-messages|google-generative-ai)$/);
      // gateway/anchor provider 允许 baseUrl 为空（由用户填）
      if (gatewayProviders.has(p.id)) {
        expect(typeof p.baseUrl).toBe("string");
      } else {
        expect(p.baseUrl, `provider=${p.id}`).toBeTruthy();
      }
    }
  });

  it("每个 model card 必填字段都存在且 contextWindowTokens >= maxOutput", () => {
    for (const p of getAllEndpoints()) {
      for (const m of p.models) {
        expect(m.id, `provider=${p.id}`).toBeTruthy();
        expect(m.maxOutput, `provider=${p.id} model=${m.id}`).toBeGreaterThan(0);
        expect(m.contextWindowTokens, `provider=${p.id} model=${m.id}`).toBeGreaterThanOrEqual(m.maxOutput);
      }
    }
  });

  it("每个 provider 的 id 唯一", () => {
    const ids = getAllEndpoints().map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每个 provider 里 models 的 id 唯一", () => {
    for (const p of getAllEndpoints()) {
      const ids = p.models.map((m) => m.id);
      expect(new Set(ids).size, `provider=${p.id} 有重复 model id`).toBe(ids.length);
    }
  });

  it("DeepSeek 官方 API model card 跟进 V4", () => {
    const deepseek = getEndpoint("deepseek");
    expect(deepseek?.checkModel).toBe("deepseek-v4-flash");

    expect(deepseek?.models).toEqual([
      { id: "deepseek-v4-flash", maxOutput: 393216, contextWindowTokens: 1_000_000, enabled: true, releasedAt: "2026-04-24" },
      { id: "deepseek-v4-pro", maxOutput: 393216, contextWindowTokens: 1_000_000, enabled: true, releasedAt: "2026-04-24" },
      { id: "deepseek-chat", maxOutput: 393216, contextWindowTokens: 1_000_000, releasedAt: "2026-04-24" },
      { id: "deepseek-reasoner", maxOutput: 393216, contextWindowTokens: 1_000_000, releasedAt: "2026-04-24" },
    ]);
  });

  it("Zhipu check model uses a stable chat alias", () => {
    const zhipu = getEndpoint("zhipu");
    expect(zhipu?.checkModel).toBe("glm-4-flash");
    expect(zhipu?.models.some((model) => model.id === "glm-4-flash" && model.enabled !== false)).toBe(true);
  });

  it("A 组至少有 5 个核心 provider", () => {
    const ids = getAllEndpoints().map((p) => p.id);
    expect(ids).toContain("anthropic");
    expect(ids).toContain("openai");
    expect(ids).toContain("google");
    expect(ids).toContain("deepseek");
    expect(ids).toContain("minimax");
    // 阿里通义千问：仅保留 bailian（Anthropic 协议，工具调用更稳），
    // 已删除重复的 qwen endpoint（OpenAI 协议同家）
    expect(ids).toContain("bailian");
    expect(ids).not.toContain("qwen");
  });

  it("B1：中国原厂批次 1 全部收录（9 个，PPIO 默认入口已下架）", () => {
    const ids = getAllEndpoints().map((p) => p.id);
    for (const id of [
      "moonshot", "zhipu", "siliconcloud", "bailian",
      "volcengine", "hunyuan", "baichuan", "stepfun", "wenxin",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("B1：bailian 保留 anthropic-messages api（例外，不按 lobe 迁移）", () => {
    expect(getEndpoint("bailian")?.api).toBe("anthropic-messages");
    expect(getEndpoint("bailian")?.baseUrl).toContain("/anthropic");
  });

  it("B1：minimax 使用 OpenAI-compatible chat endpoint", () => {
    expect(getEndpoint("minimax")?.api).toBe("openai-completions");
    expect(getEndpoint("minimax")?.baseUrl).toBe("https://api.minimaxi.com/v1");
  });

  it("B2：小米 MiMo 使用当前 OpenAI-compatible endpoint", () => {
    expect(getEndpoint("xiaomimimo")?.api).toBe("openai-completions");
    expect(getEndpoint("xiaomimimo")?.baseUrl).toBe("https://api.xiaomimimo.com/v1");
  });

  it("B2：中国原厂批次 2 全部收录（6 个）", () => {
    const ids = getAllEndpoints().map((p) => p.id);
    for (const id of ["spark", "sensenova", "tencentcloud", "xiaomimimo", "longcat", "internlm"]) {
      expect(ids).toContain(id);
    }
  });

  it("B3：中国原厂批次 3 保留公开服务列表中的原厂入口（R5 已删 higress）", () => {
    const ids = getAllEndpoints().map((p) => p.id);
    for (const id of ["zeroone", "ai360"]) {
      expect(ids).toContain(id);
    }
    for (const id of ["modelscope", "giteeai", "qiniu", "infiniai"]) {
      expect(ids).not.toContain(id);
    }
    expect(ids).not.toContain("higress");
  });

  it("B4：海外/本地/自定义/聚合/GH 全部收录（8 个）", () => {
    const ids = getAllEndpoints().map((p) => p.id);
    for (const id of ["ollama", "openrouter", "custom", "mistral", "xai", "newapi", "githubCopilot", "kkaiapi"]) {
      expect(ids).toContain(id);
    }
  });

  it("B4：custom / newapi baseUrl 为空（gateway 占位）", () => {
    expect(getEndpoint("custom")?.baseUrl).toBe("");
    expect(getEndpoint("newapi")?.baseUrl).toBe("");
  });

  it("OpenAI Codex uses the ChatGPT OAuth Responses transport", () => {
    const codex = getEndpoint("openaiCodex");
    expect(codex).toMatchObject({
      label: "OpenAI Codex (ChatGPT)",
      group: "overseas",
      api: "openai-codex-responses",
      baseUrl: "https://chatgpt.com/backend-api",
      checkModel: "gpt-5.6-sol",
      transportDefaults: { apiFormat: "responses", stream: true },
    });
    expect(codex?.models.some((model) => model.id === "gpt-5.6-sol")).toBe(true);
    expect(codex?.models.some((model) => model.id === "gpt-5.6-terra")).toBe(true);
    expect(codex?.models.some((model) => model.id === "gpt-5.6-luna")).toBe(true);
    expect(codex?.models.some((model) => model.id === "gpt-5.4")).toBe(true);
  });

  it("B4：总 provider 数 = 31（不含 CodingPlan 分组）", () => {
    const nonCoding = getAllEndpoints().filter((p) => p.group !== "codingPlan");
    expect(nonCoding.length).toBe(31);
  });

  it("B6：CodingPlan 8 个 provider 全部收录", () => {
    const ids = getAllEndpoints().map((p) => p.id);
    for (const id of [
      "kimiCodingPlan", "minimaxCodingPlan", "bailianCodingPlan",
      "glmCodingPlan", "volcengineCodingPlan", "opencodeCodingPlan",
      "astronCodingPlan", "kimicode",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("B6：总 provider 数 = 39 (31 base + 8 CodingPlan)", () => {
    expect(getAllEndpoints().length).toBe(39);
  });

  it("B6：CodingPlan provider 都走 anthropic-messages", () => {
    for (const id of [
      "kimiCodingPlan", "minimaxCodingPlan", "bailianCodingPlan",
      "glmCodingPlan", "volcengineCodingPlan", "opencodeCodingPlan",
      "astronCodingPlan", "kimicode",
    ]) {
      expect(getEndpoint(id)?.api).toBe("anthropic-messages");
    }
  });

  it("R3：endpoint 不再出现 piProvider 字段（已移到 provider-to-pi-ai adapter）", () => {
    for (const ep of getAllEndpoints()) {
      expect((ep as any).piProvider, `endpoint=${ep.id}`).toBeUndefined();
    }
  });
});
