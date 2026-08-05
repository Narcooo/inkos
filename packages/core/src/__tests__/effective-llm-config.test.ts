import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveEffectiveLLMConfig } from "../utils/effective-llm-config.js";

describe("resolveEffectiveLLMConfig", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  async function writeProject(llm: Record<string, unknown>) {
    root = await mkdtemp(join(tmpdir(), "inkos-effective-llm-"));
    await writeFile(join(root, "inkos.json"), JSON.stringify({
      name: "effective-project",
      version: "0.1.0",
      language: "zh",
      llm,
      notify: [],
    }, null, 2), "utf-8");
  }

  async function writeSecrets(services: Record<string, { apiKey: string }>) {
    await mkdir(join(root, ".inkos"), { recursive: true });
    await writeFile(join(root, ".inkos", "secrets.json"), JSON.stringify({ services }, null, 2), "utf-8");
  }

  it("Studio consumer 使用 Studio/project 配置，并忽略旧顶层 model/baseUrl", async () => {
    await writeProject({
      configSource: "studio",
      service: "google",
      provider: "custom",
      baseUrl: "https://api.moonshot.cn/v1",
      model: "kimi-k2.5",
      services: [{ service: "google", apiFormat: "chat", stream: true }],
      defaultModel: "gemini-2.5-flash",
    });
    await writeSecrets({ google: { apiKey: "sk-google" } });

    const result = await resolveEffectiveLLMConfig({
      consumer: "studio",
      projectRoot: root,
      envLayers: { global: {}, project: {}, process: {} },
      requireApiKey: true,
    });

    expect(result.llm.configSource).toBe("studio");
    expect(result.diagnostics.configMode).toBe("studio-project");
    expect(result.llm.service).toBe("google");
    expect(result.llm.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
    expect(result.llm.model).toBe("gemini-2.5-flash");
    expect(result.llm.apiKey).toBe("sk-google");
    expect(result.diagnostics.apiKeySource).toBe("studio-secret");
    expect(result.diagnostics.warnings.join("\n")).toContain("旧顶层");
  });

  it("CLI consumer 允许 INKOS_LLM_SERVICE 切换服务，并从 provider bank 推导 baseUrl", async () => {
    await writeProject({
      configSource: "studio",
      service: "google",
      services: [{ service: "google" }, { service: "moonshot", temperature: 1 }],
      defaultModel: "gemini-2.5-flash",
    });
    await writeSecrets({
      google: { apiKey: "sk-google" },
      moonshot: { apiKey: "sk-moon" },
    });

    const result = await resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      envLayers: {
        global: {},
        project: {
          INKOS_LLM_SERVICE: "moonshot",
          INKOS_LLM_MODEL: "kimi-k2.5",
        },
        process: {},
      },
    });

    expect(result.llm.service).toBe("moonshot");
    expect(result.llm.baseUrl).toBe("https://api.moonshot.cn/v1");
    expect(result.llm.model).toBe("kimi-k2.5");
    expect(result.llm.apiKey).toBe("sk-moon");
    expect(result.diagnostics.serviceSource).toBe("env");
    expect(result.diagnostics.modelSource).toBe("env");
  });

  it("CLI consumer 兼容旧 env：没有 INKOS_LLM_SERVICE 时从 baseUrl 反推 service", async () => {
    await writeProject({
      configSource: "studio",
      service: "google",
      services: [{ service: "google" }],
      defaultModel: "gemini-2.5-flash",
    });
    await writeSecrets({ google: { apiKey: "sk-google" } });

    const result = await resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      envLayers: {
        global: {
          INKOS_LLM_PROVIDER: "custom",
          INKOS_LLM_BASE_URL: "https://api.moonshot.cn/v1",
          INKOS_LLM_MODEL: "kimi-k2.5",
          INKOS_LLM_API_KEY: "sk-env-moon",
        },
        project: {},
        process: {},
      },
    });

    expect(result.llm.service).toBe("moonshot");
    expect(result.llm.baseUrl).toBe("https://api.moonshot.cn/v1");
    expect(result.llm.model).toBe("kimi-k2.5");
    expect(result.llm.apiKey).toBe("sk-env-moon");
    expect(result.diagnostics.serviceSource).toBe("env");
  });

  it("Studio consumer 不让任何 env 里的旧模型污染 Studio service", async () => {
    await writeProject({
      configSource: "studio",
      service: "google",
      services: [{ service: "google" }],
      defaultModel: "gemini-2.5-flash",
    });
    await writeSecrets({ google: { apiKey: "sk-google" } });

    const result = await resolveEffectiveLLMConfig({
      consumer: "studio",
      projectRoot: root,
      envLayers: {
        global: {
          INKOS_LLM_SERVICE: "moonshot",
          INKOS_LLM_MODEL: "kimi-k2.5",
          INKOS_LLM_API_KEY: "sk-global-moon",
        },
        project: {
          INKOS_LLM_SERVICE: "deepseek",
          INKOS_LLM_MODEL: "deepseek-chat",
          INKOS_LLM_API_KEY: "sk-project-deepseek",
        },
        process: {
          INKOS_LLM_SERVICE: "zhipu",
          INKOS_LLM_MODEL: "glm-4-flash",
          INKOS_LLM_API_KEY: "sk-process-zhipu",
        },
      },
      requireApiKey: true,
    });

    expect(result.llm.service).toBe("google");
    expect(result.llm.model).toBe("gemini-2.5-flash");
    expect(result.llm.apiKey).toBe("sk-google");
    expect(result.diagnostics.warnings.join("\n")).toContain("Studio 运行时不会使用 env");
  });

  it("旧 configSource=env 保持 legacy-env 行为", async () => {
    await writeProject({
      configSource: "env",
      provider: "openai",
      baseUrl: "https://stale.example.com/v1",
      model: "stale-model",
      services: [{ service: "google" }],
      defaultModel: "gemini-2.5-flash",
    });
    await writeSecrets({ google: { apiKey: "sk-google" } });

    const result = await resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      envLayers: {
        global: {
          INKOS_LLM_PROVIDER: "custom",
          INKOS_LLM_BASE_URL: "https://api.example.com/v1",
          INKOS_LLM_MODEL: "legacy-model",
          INKOS_LLM_API_KEY: "sk-env",
        },
        project: {},
        process: {},
      },
    });

    expect(result.diagnostics.configMode).toBe("legacy-env");
    expect(result.llm.service).toBe("custom");
    expect(result.llm.provider).toBe("custom");
    expect(result.llm.baseUrl).toBe("https://api.example.com/v1");
    expect(result.llm.model).toBe("legacy-model");
    expect(result.llm.apiKey).toBe("sk-env");
  });

  it("legacy-env 模式下 CLI --service 覆盖会切换到目标 service 的 endpoint 默认值", async () => {
    await writeProject({
      configSource: "env",
      provider: "custom",
      baseUrl: "https://api.moonshot.cn/v1",
      model: "kimi-k2.5",
    });

    const result = await resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      envLayers: {
        global: {
          INKOS_LLM_PROVIDER: "custom",
          INKOS_LLM_BASE_URL: "https://api.moonshot.cn/v1",
          INKOS_LLM_MODEL: "kimi-k2.5",
          INKOS_LLM_API_KEY: "sk-moon",
        },
        project: {},
        process: {
          GOOGLE_API_KEY: "sk-google",
        },
      },
      cli: {
        service: "google",
        model: "gemini-2.5-flash",
        apiKeyEnv: "GOOGLE_API_KEY",
      },
    });

    expect(result.diagnostics.configMode).toBe("legacy-env");
    expect(result.llm.service).toBe("google");
    expect(result.llm.provider).toBe("openai");
    expect(result.llm.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
    expect(result.llm.apiFormat).toBe("chat");
    expect(result.llm.model).toBe("gemini-2.5-flash");
    expect(result.llm.apiKey).toBe("sk-google");
  });

  it("legacy-env 模式下 CLI transport 覆盖优先级高于 env", async () => {
    await writeProject({
      configSource: "env",
      provider: "openai",
      baseUrl: "https://api.example.com/v1",
      model: "legacy-model",
    });

    const result = await resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      envLayers: {
        global: {
          INKOS_LLM_PROVIDER: "openai",
          INKOS_LLM_BASE_URL: "https://api.example.com/v1",
          INKOS_LLM_MODEL: "legacy-model",
          INKOS_LLM_API_KEY: "sk-env",
          INKOS_LLM_API_FORMAT: "chat",
          INKOS_LLM_STREAM: "true",
        },
        project: {},
        process: {},
      },
      cli: {
        apiFormat: "responses",
        stream: false,
      },
    });

    expect(result.diagnostics.configMode).toBe("legacy-env");
    expect(result.llm.apiFormat).toBe("responses");
    expect(result.llm.stream).toBe(false);
  });

  it("保留旧 INKOS_LLM_EXTRA_* 和 INKOS_DEFAULT_LANGUAGE 行为", async () => {
    await writeProject({
      configSource: "env",
      provider: "openai",
      baseUrl: "https://api.example.com/v1",
      model: "legacy-model",
    });

    const result = await resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      envLayers: {
        global: {},
        project: {
          INKOS_LLM_API_KEY: "sk-env",
          INKOS_LLM_EXTRA_top_p: "0.9",
          INKOS_DEFAULT_LANGUAGE: "en",
        },
        process: {},
      },
    });

    expect(result.config.language).toBe("en");
    expect(result.llm.extra).toMatchObject({ top_p: 0.9 });
  });

  it("CLI override 优先级高于 env", async () => {
    await writeProject({
      configSource: "studio",
      service: "google",
      services: [{ service: "google" }, { service: "zhipu" }],
      defaultModel: "gemini-2.5-flash",
    });
    await writeSecrets({ google: { apiKey: "sk-google" }, zhipu: { apiKey: "sk-zhipu" } });

    const result = await resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      envLayers: {
        global: {},
        project: { INKOS_LLM_SERVICE: "google", INKOS_LLM_MODEL: "gemini-2.5-pro" },
        process: {},
      },
      cli: { service: "zhipu", model: "glm-4-flash" },
    });

    expect(result.llm.service).toBe("zhipu");
    expect(result.llm.model).toBe("glm-4-flash");
    expect(result.llm.baseUrl).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(result.diagnostics.serviceSource).toBe("cli");
    expect(result.diagnostics.modelSource).toBe("cli");
  });

  it("CLI 指定 service 时不会继承旧 env 的 baseUrl/model/apiKey", async () => {
    await writeProject({
      configSource: "studio",
      service: "google",
      services: [{ service: "google" }, { service: "moonshot" }],
      defaultModel: "gemini-2.5-flash",
    });
    await writeSecrets({ google: { apiKey: "sk-google" }, moonshot: { apiKey: "sk-moon" } });

    const result = await resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      envLayers: {
        global: {
          INKOS_LLM_PROVIDER: "custom",
          INKOS_LLM_BASE_URL: "https://api.moonshot.cn/v1",
          INKOS_LLM_MODEL: "kimi-k2.5",
          INKOS_LLM_API_KEY: "sk-env-moon",
        },
        project: {},
        process: {},
      },
      cli: { service: "google" },
    });

    expect(result.llm.service).toBe("google");
    expect(result.llm.provider).toBe("openai");
    expect(result.llm.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
    expect(result.llm.model).toBe("gemini-2.5-flash");
    expect(result.llm.apiKey).toBe("sk-google");
    expect(result.diagnostics.serviceSource).toBe("cli");
    expect(result.diagnostics.modelSource).toBe("project");
    expect(result.diagnostics.apiKeySource).toBe("studio-secret");
  });

  it("拒绝不属于最终 service 的模型", async () => {
    await writeProject({
      configSource: "studio",
      service: "google",
      services: [{ service: "google" }],
      defaultModel: "gemini-2.5-flash",
    });
    await writeSecrets({ google: { apiKey: "sk-google" } });

    await expect(resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      envLayers: {
        global: {},
        project: { INKOS_LLM_MODEL: "kimi-k2.5" },
        process: {},
      },
    })).rejects.toThrow(/模型.*kimi-k2\.5.*不属于.*google/);
  });

  it("openrouter 配置了不在静态 bank 的模型时保留用户模型，不回退 checkModel（issue #300）", async () => {
    await writeProject({
      configSource: "studio",
      service: "openrouter",
      services: [{ service: "openrouter" }],
      defaultModel: "moonshotai/kimi-k2-thinking",
    });
    await writeSecrets({ openrouter: { apiKey: "sk-or" } });

    const result = await resolveEffectiveLLMConfig({
      consumer: "studio",
      projectRoot: root,
      envLayers: { global: {}, project: {}, process: {} },
      requireApiKey: true,
    });

    expect(result.llm.service).toBe("openrouter");
    expect(result.llm.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(result.llm.model).toBe("moonshotai/kimi-k2-thinking");
  });

  it("CLI env 显式指定 openrouter 未列出模型时也直接透传", async () => {
    await writeProject({
      configSource: "studio",
      service: "openrouter",
      services: [{ service: "openrouter" }],
      defaultModel: "openrouter/auto",
    });
    await writeSecrets({ openrouter: { apiKey: "sk-or" } });

    const result = await resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      envLayers: {
        global: {},
        project: { INKOS_LLM_MODEL: "z-ai/glm-4.7" },
        process: {},
      },
    });

    expect(result.llm.service).toBe("openrouter");
    expect(result.llm.model).toBe("z-ai/glm-4.7");
    expect(result.diagnostics.modelSource).toBe("env");
  });

  it("openrouter 完全没配模型时才回退到 checkModel", async () => {
    await writeProject({
      configSource: "studio",
      service: "openrouter",
      services: [{ service: "openrouter" }],
    });
    await writeSecrets({ openrouter: { apiKey: "sk-or" } });

    const result = await resolveEffectiveLLMConfig({
      consumer: "studio",
      projectRoot: root,
      envLayers: { global: {}, project: {}, process: {} },
      requireApiKey: true,
    });

    expect(result.llm.service).toBe("openrouter");
    expect(result.llm.model).toBe("openrouter/auto");
  });

  it("CLI env 指向 Ollama 时允许用户本地安装的动态模型", async () => {
    await writeProject({
      configSource: "studio",
      service: "google",
      services: [{ service: "google" }, { service: "ollama" }],
      defaultModel: "gemini-2.5-flash",
    });

    const result = await resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      envLayers: {
        global: {
          INKOS_LLM_SERVICE: "ollama",
          INKOS_LLM_PROVIDER: "openai",
          INKOS_LLM_BASE_URL: "http://127.0.0.1:11434/v1",
          INKOS_LLM_MODEL: "qwen3.6:35b-a3b",
        },
        project: {},
        process: {},
      },
      requireApiKey: false,
    });

    expect(result.llm.service).toBe("ollama");
    expect(result.llm.provider).toBe("openai");
    expect(result.llm.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(result.llm.model).toBe("qwen3.6:35b-a3b");
    expect(result.llm.apiKey).toBe("");
  });

  it("CLI 使用 Studio Ollama 配置时保留不在内置 bank 的默认模型", async () => {
    await writeProject({
      configSource: "studio",
      service: "ollama",
      services: [{ service: "ollama", apiFormat: "chat", stream: true }],
      defaultModel: "Qwen3.6-35B-A3B-APEX-I-Mini.gguf",
    });

    const result = await resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      envLayers: { global: {}, project: {}, process: {} },
      requireApiKey: false,
    });

    expect(result.llm.service).toBe("ollama");
    expect(result.llm.baseUrl).toBe("http://localhost:11434/v1");
    expect(result.llm.model).toBe("Qwen3.6-35B-A3B-APEX-I-Mini.gguf");
  });

  it("CLI 建书路径使用 Studio Ollama 配置时不要求 API key", async () => {
    await writeProject({
      configSource: "studio",
      service: "ollama",
      services: [{ service: "ollama", apiFormat: "chat", stream: false }],
      defaultModel: "Qwen3.6-35B-A3B-APEX-I-Mini.gguf",
    });

    const result = await resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      envLayers: { global: {}, project: {}, process: {} },
    });

    expect(result.llm.service).toBe("ollama");
    expect(result.llm.baseUrl).toBe("http://localhost:11434/v1");
    expect(result.llm.model).toBe("Qwen3.6-35B-A3B-APEX-I-Mini.gguf");
    expect(result.llm.apiKey).toBe("");
  });

  it("Studio 建书路径使用 Studio Ollama 配置时不要求 API key", async () => {
    await writeProject({
      configSource: "studio",
      service: "ollama",
      services: [{ service: "ollama", apiFormat: "chat", stream: false }],
      defaultModel: "Qwen3.6-35B-A3B-APEX-I-Mini.gguf",
    });

    const result = await resolveEffectiveLLMConfig({
      consumer: "studio",
      projectRoot: root,
      envLayers: { global: {}, project: {}, process: {} },
    });

    expect(result.llm.service).toBe("ollama");
    expect(result.llm.baseUrl).toBe("http://localhost:11434/v1");
    expect(result.llm.model).toBe("Qwen3.6-35B-A3B-APEX-I-Mini.gguf");
    expect(result.llm.apiKey).toBe("");
  });

  it("Studio 使用 LM Studio 动态模型时不要求 API key", async () => {
    await writeProject({
      configSource: "studio",
      service: "lmstudio",
      services: [{ service: "lmstudio", apiFormat: "chat", stream: true }],
      defaultModel: "openai/gpt-oss-20b",
    });

    const result = await resolveEffectiveLLMConfig({
      consumer: "studio",
      projectRoot: root,
      envLayers: { global: {}, project: {}, process: {} },
    });

    expect(result.llm.service).toBe("lmstudio");
    expect(result.llm.baseUrl).toBe("http://localhost:1234/v1");
    expect(result.llm.model).toBe("openai/gpt-oss-20b");
    expect(result.llm.apiKey).toBe("");
  });

  it("从 provider bank 应用 service transport 默认值", async () => {
    await writeProject({
      configSource: "studio",
      service: "minimaxCodingPlan",
      services: [{ service: "minimaxCodingPlan" }],
      defaultModel: "MiniMax-M2.7",
    });
    await writeSecrets({ minimaxCodingPlan: { apiKey: "sk-minimax" } });

    const result = await resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      envLayers: { global: {}, project: {}, process: {} },
    });

    expect(result.llm.service).toBe("minimaxCodingPlan");
    expect(result.llm.stream).toBe(false);
  });
});
