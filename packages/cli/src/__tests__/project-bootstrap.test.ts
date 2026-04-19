import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("project bootstrap", () => {
  const originalHome = process.env.HOME;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "inkos-bootstrap-"));
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates a minimal Studio-first project when none exists", async () => {
    const { ensureProjectDirectoryInitialized } = await import("../project-bootstrap.js");

    const initialized = await ensureProjectDirectoryInitialized(tempDir, { language: "zh" });

    expect(initialized).toBe(true);
    const config = JSON.parse(await readFile(join(tempDir, "inkos.json"), "utf-8"));
    expect(config.name).toMatch(/^inkos-bootstrap-/);
    expect(config.version).toBe("0.1.0");
    expect(config.llm.configSource).toBe("studio");
    expect(config.llm.service).toBe("custom");
    expect(config.llm.model).toBe("");
    expect(config.llm.baseUrl).toBe("");
    await expect(readFile(join(tempDir, ".nvmrc"), "utf-8")).resolves.toBe("22\n");
    await expect(readFile(join(tempDir, ".node-version"), "utf-8")).resolves.toBe("22\n");
  });

  it("does not overwrite support files when auto-initializing", async () => {
    await writeFile(join(tempDir, ".env"), "EXISTING=1\n", "utf-8");
    await writeFile(join(tempDir, ".gitignore"), "CUSTOM\n", "utf-8");

    const { ensureProjectDirectoryInitialized } = await import("../project-bootstrap.js");
    await ensureProjectDirectoryInitialized(tempDir, { language: "zh" });

    await expect(readFile(join(tempDir, ".env"), "utf-8")).resolves.toBe("EXISTING=1\n");
    await expect(readFile(join(tempDir, ".gitignore"), "utf-8")).resolves.toBe("CUSTOM\n");
  });

  it("returns false when the directory is already an InkOS project", async () => {
    await writeFile(join(tempDir, "inkos.json"), "{}\n", "utf-8");
    const { ensureProjectDirectoryInitialized } = await import("../project-bootstrap.js");

    await expect(ensureProjectDirectoryInitialized(tempDir, { language: "zh" })).resolves.toBe(false);
  });
});
