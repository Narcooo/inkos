import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listModelsForService, resolveServiceModelsBaseUrl } from "../llm/service-presets.js";

describe("listModelsForService (B8)", () => {
  const originalEnv = process.env.INKOS_LLM_MODEL;
  const originalFetch = global.fetch;

  beforeEach(() => {
    delete process.env.INKOS_LLM_MODEL;
  });

  afterEach(() => {
    if (originalEnv) process.env.INKOS_LLM_MODEL = originalEnv;
    else delete process.env.INKOS_LLM_MODEL;
    global.fetch = originalFetch;
  });

  it("anthropic service 无 apikey 时返回 provider 内置 enabled 子集", async () => {
    const models = await listModelsForService("anthropic");
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.id === "claude-sonnet-4-6")).toBe(true);
    const sonnet = models.find((m) => m.id === "claude-sonnet-4-6");
    expect(sonnet?.maxOutput).toBe(64_000);
    expect(sonnet?.contextWindow).toBe(1_000_000);
  });

  it("google service 的文本模型列表不包含 image preview 模型", async () => {
    const models = await listModelsForService("google");
    expect(models.some((m) => m.id === "gemini-2.5-flash")).toBe(true);
    expect(models.some((m) => m.id.includes("image"))).toBe(false);
  });

  it("custom service 走 live probe + bank 补元数据", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "gpt-4o" }, { id: "my-proxy-model" }] }),
    } as any) as typeof fetch;
    const models = await listModelsForService("custom", "sk-test", "https://myproxy.example/v1");
    // gpt-4o 命中 openai provider，拿到元数据
    const gpt = models.find((m) => m.id === "gpt-4o");
    expect(gpt).toBeDefined();
    expect(gpt?.maxOutput).toBe(4096);
    // 自定义 id 没元数据也保留
    expect(models.some((m) => m.id === "my-proxy-model")).toBe(true);
  });

  it("ollama 无 apiKey 时也探测本地 /models 并保留本地动态模型", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "qwen3.6:35b-a3b" }] }),
    } as any);
    global.fetch = fetchMock as unknown as typeof fetch;

    const models = await listModelsForService("ollama");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/v1/models",
      expect.any(Object),
    );
    expect(models.some((m) => m.id === "qwen3.6:35b-a3b")).toBe(true);
  });

  it("LM Studio 无 apiKey 时探测本地 /models 并保留动态模型", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "openai/gpt-oss-20b" }] }),
    } as any);
    global.fetch = fetchMock as unknown as typeof fetch;

    const models = await listModelsForService("lmstudio");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:1234/v1/models",
      expect.any(Object),
    );
    expect(models.some((m) => m.id === "openai/gpt-oss-20b")).toBe(true);
  });

  it("R4：env 补丁已删除 — INKOS_LLM_MODEL 不再污染跨 service 菜单", async () => {
    process.env.INKOS_LLM_MODEL = "my-secret-model";
    const models = await listModelsForService("anthropic");
    // my-secret-model 不在 anthropic bank → 不应该出现
    expect(models.some((m) => m.id === "my-secret-model")).toBe(false);
  });

  it("live 挂了降级到 provider 内置 models（没有 fetch 错误 crash）", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as typeof fetch;
    const models = await listModelsForService("anthropic", "sk-test");
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.id === "claude-sonnet-4-6")).toBe(true);
  });

  it("bailian 不用 OpenAI 兼容 /models 污染 Anthropic 通道模型列表", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://dashscope.aliyuncs.com/compatible-mode/v1/models") {
        return {
          ok: true,
          json: async () => ({ data: [{ id: "kimi-k2.6" }, { id: "deepseek-v3.2" }] }),
        };
      }
      return {
        ok: false,
        json: async () => ({ data: [] }),
      };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const models = await listModelsForService("bailian", "sk-test");

    expect(resolveServiceModelsBaseUrl("bailian")).toBe("https://dashscope.aliyuncs.com/apps/anthropic");
    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
      expect.any(Object),
    );
    expect(models.some((m) => m.id === "qwen-turbo")).toBe(true);
    expect(models.some((m) => m.id === "kimi-k2.6")).toBe(false);
    expect(models.some((m) => m.id === "deepseek-v3.2")).toBe(false);
  });

  it("未知 service 返回空数组", async () => {
    const models = await listModelsForService("nonexistent-xyz");
    expect(models).toEqual([]);
  });
});
