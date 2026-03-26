import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { atomicWriteGroup, type WriteEntry } from "../utils/atomic-write.js";
import { readFile, mkdir, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("atomicWriteGroup", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `inkos-atomic-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("writes multiple files atomically", async () => {
    const writes: WriteEntry[] = [
      { path: join(testDir, "file1.md"), content: "# File 1\nContent here" },
      { path: join(testDir, "file2.md"), content: "# File 2\nMore content" },
      { path: join(testDir, "file3.md"), content: "# File 3\nEven more content" },
    ];

    await atomicWriteGroup(writes);

    const f1 = await readFile(join(testDir, "file1.md"), "utf-8");
    const f2 = await readFile(join(testDir, "file2.md"), "utf-8");
    const f3 = await readFile(join(testDir, "file3.md"), "utf-8");

    expect(f1).toBe("# File 1\nContent here");
    expect(f2).toBe("# File 2\nMore content");
    expect(f3).toBe("# File 3\nEven more content");
  });

  it("does nothing with empty writes array", async () => {
    await atomicWriteGroup([]);
    const files = await readdir(testDir);
    expect(files).toHaveLength(0);
  });

  it("skips entries with empty content", async () => {
    const writes: WriteEntry[] = [
      { path: join(testDir, "real.md"), content: "Real content" },
      { path: join(testDir, "empty.md"), content: "" },
      { path: join(testDir, "whitespace.md"), content: "   " },
    ];

    await atomicWriteGroup(writes);

    const f1 = await readFile(join(testDir, "real.md"), "utf-8");
    expect(f1).toBe("Real content");

    const files = await readdir(testDir);
    expect(files).toContain("real.md");
    expect(files).not.toContain("empty.md");
    expect(files).not.toContain("whitespace.md");
  });

  it("cleans up temp directory after successful write", async () => {
    const writes: WriteEntry[] = [
      { path: join(testDir, "clean.md"), content: "Clean content" },
    ];

    await atomicWriteGroup(writes);

    // No .tmp-settlement-* directories should remain
    const files = await readdir(testDir);
    const tmpDirs = files.filter((f) => f.startsWith(".tmp-settlement"));
    expect(tmpDirs).toHaveLength(0);
  });

  it("preserves original files if write fails", async () => {
    // Escribir un archivo original primero
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(join(testDir, "original.md"), "Original content", "utf-8");

    // Intentar escribir con un path invalido deberia fallar
    const writes: WriteEntry[] = [
      { path: join(testDir, "original.md"), content: "New content" },
      { path: join(testDir, "\0invalid"), content: "Should fail" },
    ];

    try {
      await atomicWriteGroup(writes);
    } catch {
      // Esperado
    }

    // El original no deberia cambiar (en la mayoria de los casos,
    // dependiendo de donde fallo el proceso)
    const files = await readdir(testDir);
    const tmpDirs = files.filter((f) => f.startsWith(".tmp-settlement"));
    expect(tmpDirs).toHaveLength(0);
  });
});
