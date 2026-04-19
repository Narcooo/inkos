import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";
import { createProgram } from "../program.js";

describe("tui command", () => {
  const originalArgv = process.argv;
  const originalCwd = process.cwd();
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "inkos-default-studio-"));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.argv = originalArgv;
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("launches Studio when no subcommand is provided", async () => {
    const launchStudio = vi.fn(async () => {});
    const program = createProgram({ launchStudio });

    await program.parseAsync([], { from: "user" });

    expect(launchStudio).toHaveBeenCalledTimes(1);
    expect(launchStudio).toHaveBeenCalledWith(process.cwd(), "4567");
  });

  it("auto-initializes a minimal project before launching Studio by default", async () => {
    const launchStudio = vi.fn(async () => {});
    const program = createProgram({ launchStudio });

    await program.parseAsync([], { from: "user" });

    const config = JSON.parse(await readFile(join(tempDir, "inkos.json"), "utf-8"));
    expect(config.name).toMatch(/^inkos-default-studio-/);
    expect(config.llm.configSource).toBe("studio");
    expect(config.llm.model).toBe("");
    expect(config.llm.baseUrl).toBe("");
    expect(launchStudio).toHaveBeenCalledTimes(1);
    const [calledRoot, calledPort] = launchStudio.mock.calls[0] as unknown as [string, string];
    expect(realpathSync(calledRoot)).toBe(realpathSync(tempDir));
    expect(calledPort).toBe("4567");
  });

  it("does not overwrite an existing .env during automatic Studio init", async () => {
    await writeFile(join(tempDir, ".env"), "EXISTING_ENV=1\n", "utf-8");
    const launchStudio = vi.fn(async () => {});
    const program = createProgram({ launchStudio });

    await program.parseAsync([], { from: "user" });

    await expect(readFile(join(tempDir, ".env"), "utf-8")).resolves.toBe("EXISTING_ENV=1\n");
  });

  it("launches the TUI when the explicit tui command is used", async () => {
    const launchTui = vi.fn(async () => {});
    const launchStudio = vi.fn(async () => {});
    const program = createProgram({ launchTui, launchStudio });

    await program.parseAsync(["tui"], { from: "user" });

    expect(launchTui).toHaveBeenCalledTimes(1);
    expect(launchStudio).not.toHaveBeenCalled();
  });

  it("auto-initializes a minimal project before launching the explicit studio command", async () => {
    const launchStudio = vi.fn(async () => {});
    const program = createProgram({ launchStudio });

    await program.parseAsync(["studio"], { from: "user" });

    const config = JSON.parse(await readFile(join(tempDir, "inkos.json"), "utf-8"));
    expect(config.llm.configSource).toBe("studio");
    expect(launchStudio).toHaveBeenCalledTimes(1);
    const [calledRoot, calledPort] = launchStudio.mock.calls[0] as unknown as [string, string];
    expect(realpathSync(calledRoot)).toBe(realpathSync(tempDir));
    expect(calledPort).toBe("4567");
  });
});
