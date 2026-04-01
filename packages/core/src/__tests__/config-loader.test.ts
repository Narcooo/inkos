import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

  it("rejects placeholder API keys copied from env examples", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-config-loader-placeholder-"));
    for (const key of ENV_KEYS) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = "";
    }

    await writeFile(join(root, "inkos.json"), JSON.stringify({
      name: "placeholder-project",
      version: "0.1.0",
      llm: {
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.4",
      },
    }, null, 2), "utf-8");
    await writeFile(join(root, ".env"), "INKOS_LLM_API_KEY=your-api-key-here\n", "utf-8");

    await expect(loadProjectConfig(root)).rejects.toThrow(/INKOS_LLM_API_KEY not set/i);
  });
});
