import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  ensureRawLlmConfig,
  readProjectConfigFile,
  updateProjectConfigFile,
} from "./project-config-file";

async function createProjectRoot(config: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "inkos-config-file-"));
  await writeFile(join(root, "inkos.json"), JSON.stringify(config, null, 2), "utf-8");
  return root;
}

describe("project-config-file", () => {
  it("reads and updates inkos.json without dropping existing fields", async () => {
    const root = await createProjectRoot({
      name: "Demo",
      language: "zh",
      llm: { provider: "custom", temperature: 0.7 },
      notify: ["desktop"],
    });

    await updateProjectConfigFile(root, (config) => {
      const llm = ensureRawLlmConfig(config);
      llm.temperature = 0.4;
      config.language = "en";
    });

    const updated = JSON.parse(await readFile(join(root, "inkos.json"), "utf-8"));
    expect(updated).toMatchObject({
      name: "Demo",
      language: "en",
      llm: { provider: "custom", temperature: 0.4 },
      notify: ["desktop"],
    });
  });

  it("creates an llm object when an update needs it", async () => {
    const root = await createProjectRoot({ name: "Demo" });

    await updateProjectConfigFile(root, (config) => {
      ensureRawLlmConfig(config).stream = true;
    });

    await expect(readProjectConfigFile(root)).resolves.toMatchObject({
      llm: { stream: true },
    });
  });

  it("rejects non-object project config files", async () => {
    const root = await createProjectRoot([]);
    await expect(readProjectConfigFile(root)).rejects.toThrow("inkos.json must contain a JSON object");
  });
});
