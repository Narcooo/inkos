import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { migrateConfig } from "../llm/config-migration.js";
import { loadSecrets } from "../llm/secrets.js";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("config migration", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-migrate-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("migrates old llm.provider+model+apiKey to services[] + secrets", async () => {
    const oldConfig = {
      name: "mybook",
      llm: {
        provider: "openai",
        model: "kimi-k2.5",
        baseUrl: "https://api.moonshot.cn/v1",
        apiKey: "sk-old-key",
      },
      language: "zh",
    };
    await writeFile(join(root, "inkos.json"), JSON.stringify(oldConfig));

    const result = await migrateConfig(root);

    expect(result.migrated).toBe(true);

    const raw = await readFile(join(root, "inkos.json"), "utf-8");
    const config = JSON.parse(raw);
    expect(config.llm.services).toHaveLength(1);
    expect(config.llm.services[0].service).toBe("moonshot");
    expect(config.llm.services[0].apiKey).toBeUndefined();
    expect(config.llm.defaultModel).toBe("kimi-k2.5");
    expect(config.llm.provider).toBeUndefined();
    expect(config.llm.model).toBeUndefined();
    expect(config.llm.apiKey).toBeUndefined();

    const secrets = await loadSecrets(root);
    expect(secrets.services.moonshot.apiKey).toBe("sk-old-key");
  });

  it("does nothing if already in new format", async () => {
    const newConfig = {
      name: "mybook",
      llm: {
        services: [{ service: "moonshot" }],
        defaultModel: "kimi-k2.5",
      },
      language: "zh",
    };
    await writeFile(join(root, "inkos.json"), JSON.stringify(newConfig));

    const result = await migrateConfig(root);
    expect(result.migrated).toBe(false);
  });

  it("guesses service from baseUrl", async () => {
    const oldConfig = {
      llm: {
        provider: "openai",
        model: "deepseek-chat",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-deep",
      },
    };
    await writeFile(join(root, "inkos.json"), JSON.stringify(oldConfig));

    await migrateConfig(root);

    const raw = await readFile(join(root, "inkos.json"), "utf-8");
    const config = JSON.parse(raw);
    expect(config.llm.services[0].service).toBe("deepseek");
  });

  it("creates custom service when baseUrl is unrecognized", async () => {
    const oldConfig = {
      llm: {
        provider: "openai",
        model: "my-model",
        baseUrl: "https://llm.internal.corp/v1",
        apiKey: "sk-corp",
      },
    };
    await writeFile(join(root, "inkos.json"), JSON.stringify(oldConfig));

    await migrateConfig(root);

    const raw = await readFile(join(root, "inkos.json"), "utf-8");
    const config = JSON.parse(raw);
    expect(config.llm.services[0].service).toBe("custom");
    expect(config.llm.services[0].baseUrl).toBe("https://llm.internal.corp/v1");
    expect(config.llm.services[0].name).toBe("Custom");
  });
});
