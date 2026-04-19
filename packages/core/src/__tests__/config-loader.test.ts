import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProjectConfig } from "../utils/config-loader.js";

const ENV_KEYS = [
  "INKOS_LLM_PROVIDER",
  "INKOS_LLM_BASE_URL",
  "INKOS_LLM_MODEL",
  "INKOS_LLM_API_KEY",
  "INKOS_LLM_TEMPERATURE",
  "INKOS_LLM_MAX_TOKENS",
  "INKOS_LLM_THINKING_BUDGET",
  "INKOS_LLM_API_FORMAT",
] as const;

describe("loadProjectConfig local provider auth", () => {
  let root = "";
  const previousEnv = new Map<string, string | undefined>();

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      const previous = previousEnv.get(key);
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    previousEnv.clear();

    if (root) {
      await rm(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("allows missing API keys for localhost OpenAI-compatible endpoints", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-config-loader-local-"));
    for (const key of ENV_KEYS) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = "";
    }

    await writeFile(join(root, "inkos.json"), JSON.stringify({
      name: "local-project",
      version: "0.1.0",
      llm: {
        provider: "openai",
        baseUrl: "http://127.0.0.1:11434/v1",
        model: "gpt-oss:20b",
      },
    }, null, 2), "utf-8");
    await writeFile(join(root, ".env"), "", "utf-8");

    const config = await loadProjectConfig(root);

    expect(config.llm.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(config.llm.model).toBe("gpt-oss:20b");
    expect(config.llm.apiKey).toBe("");
  });

  it("still requires API keys for remote hosted endpoints", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-config-loader-remote-"));
    for (const key of ENV_KEYS) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = "";
    }

    await writeFile(join(root, "inkos.json"), JSON.stringify({
      name: "remote-project",
      version: "0.1.0",
      llm: {
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.4",
      },
    }, null, 2), "utf-8");
    await writeFile(join(root, ".env"), "", "utf-8");
    await expect(loadProjectConfig(root)).rejects.toThrow(/INKOS_LLM_API_KEY not set/i);
  });

  it("loads service-based config using defaultModel and project secrets", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-config-loader-services-"));
    for (const key of ENV_KEYS) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = "";
    }

    await writeFile(join(root, "inkos.json"), JSON.stringify({
      name: "service-project",
      version: "0.1.0",
      language: "zh",
      llm: {
        services: [
          { service: "moonshot", temperature: 1, maxTokens: 4096 },
        ],
        defaultModel: "kimi-k2.5",
      },
      notify: [],
    }, null, 2), "utf-8");
    await mkdir(join(root, ".inkos"), { recursive: true });
    await writeFile(
      join(root, ".inkos", "secrets.json"),
      JSON.stringify({ services: { moonshot: { apiKey: "sk-moon" } } }, null, 2),
      "utf-8",
    );

    const config = await loadProjectConfig(root);

    expect(config.llm.service).toBe("moonshot");
    expect(config.llm.provider).toBe("openai");
    expect(config.llm.baseUrl).toBe("https://api.moonshot.cn/v1");
    expect(config.llm.model).toBe("kimi-k2.5");
    expect(config.llm.apiKey).toBe("sk-moon");
    expect(config.llm.temperature).toBe(1);
    expect(config.llm.maxTokens).toBe(4096);
  });

  it("derives provider/baseUrl from the MiniMax preset single source of truth", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-config-loader-minimax-"));
    for (const key of ENV_KEYS) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = "";
    }

    await writeFile(join(root, "inkos.json"), JSON.stringify({
      name: "minimax-project",
      version: "0.1.0",
      language: "zh",
      llm: {
        services: [
          { service: "minimax", temperature: 0.9, maxTokens: 4096 },
        ],
        defaultModel: "MiniMax-M2.7",
      },
      notify: [],
    }, null, 2), "utf-8");
    await mkdir(join(root, ".inkos"), { recursive: true });
    await writeFile(
      join(root, ".inkos", "secrets.json"),
      JSON.stringify({ services: { minimax: { apiKey: "sk-minimax" } } }, null, 2),
      "utf-8",
    );

    const config = await loadProjectConfig(root);

    expect(config.llm.service).toBe("minimax");
    expect(config.llm.provider).toBe("anthropic");
    expect(config.llm.baseUrl).toBe("https://api.minimaxi.com/anthropic");
    expect(config.llm.model).toBe("MiniMax-M2.7");
    expect(config.llm.apiKey).toBe("sk-minimax");
  });

  it("loads custom service config using custom secret key and entry baseUrl", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-config-loader-custom-"));
    for (const key of ENV_KEYS) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = "";
    }

    await writeFile(join(root, "inkos.json"), JSON.stringify({
      name: "custom-project",
      version: "0.1.0",
      language: "zh",
      llm: {
        services: [
          { service: "custom", name: "内网GPT", baseUrl: "https://llm.internal.corp/v1", temperature: 0.9, apiFormat: "responses", stream: false },
        ],
        defaultModel: "corp-chat",
      },
      notify: [],
    }, null, 2), "utf-8");
    await mkdir(join(root, ".inkos"), { recursive: true });
    await writeFile(
      join(root, ".inkos", "secrets.json"),
      JSON.stringify({ services: { "custom:内网GPT": { apiKey: "sk-corp" } } }, null, 2),
      "utf-8",
    );

    const config = await loadProjectConfig(root);

    expect(config.llm.service).toBe("custom");
    expect(config.llm.provider).toBe("custom");
    expect(config.llm.baseUrl).toBe("https://llm.internal.corp/v1");
    expect(config.llm.model).toBe("corp-chat");
    expect(config.llm.apiKey).toBe("sk-corp");
    expect(config.llm.temperature).toBe(0.9);
    expect(config.llm.apiFormat).toBe("responses");
    expect(config.llm.stream).toBe(false);
  });

  it("keeps Studio config active when llm.configSource is studio", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-config-loader-studio-source-"));
    for (const key of ENV_KEYS) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = "";
    }

    await writeFile(join(root, "inkos.json"), JSON.stringify({
      name: "studio-source-project",
      version: "0.1.0",
      language: "zh",
      llm: {
        configSource: "studio",
        services: [
          { service: "custom", name: "内网GPT", baseUrl: "https://llm.internal.corp/v1", temperature: 0.9 },
        ],
        defaultModel: "corp-chat",
      },
      notify: [],
    }, null, 2), "utf-8");
    await writeFile(join(root, ".env"), [
      "INKOS_LLM_PROVIDER=openai",
      "INKOS_LLM_BASE_URL=https://api-vip.codex-for.me/v1",
      "INKOS_LLM_MODEL=gpt-5.4",
      "INKOS_LLM_API_KEY=sk-env",
    ].join("\n"), "utf-8");
    await mkdir(join(root, ".inkos"), { recursive: true });
    await writeFile(
      join(root, ".inkos", "secrets.json"),
      JSON.stringify({ services: { "custom:内网GPT": { apiKey: "sk-corp" } } }, null, 2),
      "utf-8",
    );

    const config = await loadProjectConfig(root);

    expect(config.llm.configSource).toBe("studio");
    expect(config.llm.provider).toBe("custom");
    expect(config.llm.baseUrl).toBe("https://llm.internal.corp/v1");
    expect(config.llm.model).toBe("corp-chat");
    expect(config.llm.apiKey).toBe("sk-corp");
  });

  it("falls back to env when Studio config is still the empty bootstrap state", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-config-loader-studio-bootstrap-"));
    for (const key of ENV_KEYS) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = "";
    }

    process.env.INKOS_LLM_PROVIDER = "openai";
    process.env.INKOS_LLM_BASE_URL = "https://api-vip.codex-for.me/v1";
    process.env.INKOS_LLM_MODEL = "gpt-5.4";
    process.env.INKOS_LLM_API_KEY = "sk-env";

    await writeFile(join(root, "inkos.json"), JSON.stringify({
      name: "studio-bootstrap-project",
      version: "0.1.0",
      language: "zh",
      llm: {
        provider: "openai",
        service: "custom",
        configSource: "studio",
        baseUrl: "",
        model: "",
        apiFormat: "chat",
        stream: true,
      },
      notify: [],
    }, null, 2), "utf-8");
    await writeFile(join(root, ".env"), "", "utf-8");

    const config = await loadProjectConfig(root);

    expect(config.llm.configSource).toBe("studio");
    expect(config.llm.provider).toBe("openai");
    expect(config.llm.baseUrl).toBe("https://api-vip.codex-for.me/v1");
    expect(config.llm.model).toBe("gpt-5.4");
    expect(config.llm.apiKey).toBe("sk-env");
  });
});
