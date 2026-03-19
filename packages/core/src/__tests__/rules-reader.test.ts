import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readGenreProfile, readBookRules, listAvailableGenres, getBuiltinGenresDir } from "../agents/rules-reader.js";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Usa un directorio temporal para los tests de escritura
const TEST_ROOT = join(tmpdir(), `inkos-rules-reader-test-${Date.now()}`);

beforeEach(async () => {
  await mkdir(join(TEST_ROOT, "genres"), { recursive: true });
});

afterEach(async () => {
  try { await rm(TEST_ROOT, { recursive: true, force: true }); } catch { /* ok */ }
});

describe("readGenreProfile", () => {
  it("reads built-in genre profile", async () => {
    const result = await readGenreProfile(TEST_ROOT, "xuanhuan");
    expect(result.profile.id).toBe("xuanhuan");
    expect(result.profile.name.length).toBeGreaterThan(0);
    expect(result.body.length).toBeGreaterThan(0);
  });

  it("falls back to other.md for unknown genre", async () => {
    const result = await readGenreProfile(TEST_ROOT, "nonexistent-genre-12345");
    expect(result.profile.id).toBe("other");
  });

  it("prefers project-level genre over built-in", async () => {
    const customGenre = `---
id: xuanhuan
name: 自定义玄幻
chapterTypes: [custom]
fatigueWords: []
pacingRule: custom rule
numericalSystem: false
powerScaling: false
eraResearch: false
auditDimensions: []
satisfactionTypes: []
---
Custom genre body.`;
    await writeFile(join(TEST_ROOT, "genres", "xuanhuan.md"), customGenre, "utf-8");

    const result = await readGenreProfile(TEST_ROOT, "xuanhuan");
    expect(result.profile.name).toBe("自定义玄幻");
    expect(result.body).toBe("Custom genre body.");
  });
});

describe("readBookRules", () => {
  it("returns null when book_rules.md does not exist", async () => {
    const result = await readBookRules(TEST_ROOT);
    expect(result).toBeNull();
  });

  it("reads and parses book_rules.md", async () => {
    await mkdir(join(TEST_ROOT, "story"), { recursive: true });
    await writeFile(join(TEST_ROOT, "story", "book_rules.md"), `---
version: "2.0"
prohibitions: [测试词]
---
Body content here.`, "utf-8");

    const result = await readBookRules(TEST_ROOT);
    expect(result).not.toBeNull();
    expect(result!.rules.version).toBe("2.0");
    expect(result!.rules.prohibitions).toEqual(["测试词"]);
    expect(result!.body).toBe("Body content here.");
  });
});

describe("listAvailableGenres", () => {
  it("returns built-in genres", async () => {
    const genres = await listAvailableGenres(TEST_ROOT);
    expect(genres.length).toBeGreaterThan(0);
    // xuanhuan and other should always exist as built-ins
    const ids = genres.map(g => g.id);
    expect(ids).toContain("xuanhuan");
    expect(ids).toContain("other");
  });

  it("includes project-level genres that override built-in", async () => {
    await writeFile(join(TEST_ROOT, "genres", "custom-test.md"), `---
id: custom-test
name: Custom Test Genre
chapterTypes: []
fatigueWords: []
pacingRule: ""
numericalSystem: false
powerScaling: false
eraResearch: false
auditDimensions: []
satisfactionTypes: []
---
Body.`, "utf-8");

    const genres = await listAvailableGenres(TEST_ROOT);
    const custom = genres.find(g => g.id === "custom-test");
    expect(custom).toBeDefined();
    expect(custom!.source).toBe("project");
  });

  it("results are sorted by id", async () => {
    const genres = await listAvailableGenres(TEST_ROOT);
    const ids = genres.map(g => g.id);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });
});

describe("getBuiltinGenresDir", () => {
  it("returns a valid directory path", () => {
    const dir = getBuiltinGenresDir();
    expect(dir.length).toBeGreaterThan(0);
    expect(existsSync(dir)).toBe(true);
  });
});
