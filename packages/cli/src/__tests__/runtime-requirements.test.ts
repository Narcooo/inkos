import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureNodeRuntimePinFiles,
  evaluateSqliteMemorySupport,
  formatSqliteMemorySupportWarning,
  inspectNodeRuntimePinFiles,
  parseNodeMajor,
} from "../runtime-requirements.js";

let tempRoot: string;

describe("runtime requirements", () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "inkos-runtime-requirements-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("parses Node major versions", () => {
    expect(parseNodeMajor("v20.17.0")).toBe(20);
    expect(parseNodeMajor("v22.19.0")).toBe(22);
  });

  it("marks sqlite memory acceleration unavailable below Node 22", () => {
    const result = evaluateSqliteMemorySupport({
      nodeVersion: "v20.17.0",
      hasNodeSqlite: false,
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Node 22+");
    expect(result.detail).toContain("v20.17.0");
  });

  it("marks sqlite memory acceleration available on supported runtimes", () => {
    const result = evaluateSqliteMemorySupport({
      nodeVersion: "v22.19.0",
      hasNodeSqlite: true,
    });

    expect(result.ok).toBe(true);
    expect(result.detail).toContain("v22.19.0");
  });

  it("formats an early warning for unsupported sqlite memory runtimes", () => {
    const warning = formatSqliteMemorySupportWarning({
      nodeVersion: "v20.17.0",
      hasNodeSqlite: false,
    });

    expect(warning).toContain("v20.17.0");
    expect(warning).toContain("Node 22+");
    expect(warning).toContain("memory.db live sync");
  });

  it("does not format a warning on supported runtimes", () => {
    const warning = formatSqliteMemorySupportWarning({
      nodeVersion: "v22.19.0",
      hasNodeSqlite: true,
    });

    expect(warning).toBeNull();
  });

  it("reports missing node runtime pin files", async () => {
    const status = await inspectNodeRuntimePinFiles(tempRoot);

    expect(status.ok).toBe(false);
    expect(status.detail).toContain(".nvmrc");
    expect(status.detail).toContain(".node-version");
  });

  it("writes node runtime pin files for old projects", async () => {
    const repair = await ensureNodeRuntimePinFiles(tempRoot);

    expect(repair.updated).toBe(true);
    expect(repair.written).toEqual([".nvmrc", ".node-version"]);
    await expect(readFile(join(tempRoot, ".nvmrc"), "utf-8")).resolves.toBe("22\n");
    await expect(readFile(join(tempRoot, ".node-version"), "utf-8")).resolves.toBe("22\n");

    const status = await inspectNodeRuntimePinFiles(tempRoot);
    expect(status.ok).toBe(true);
  });
});
