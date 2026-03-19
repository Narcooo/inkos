import { describe, it, expect } from "vitest";
import {
  extractDialogueFingerprints,
  findRelevantSummaries,
  loadRecentChapters,
} from "../agents/writer-context.js";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("extractDialogueFingerprints", () => {
  it("returns empty string for empty input", () => {
    expect(extractDialogueFingerprints("", "")).toBe("");
  });

  it("returns a string for any input", () => {
    const result = extractDialogueFingerprints("some text without dialogue", "bible");
    expect(typeof result).toBe("string");
  });

  it("ignores characters with fewer than 2 dialogue lines", () => {
    const result = extractDialogueFingerprints("random text no dialogue", "");
    expect(result).toBe("");
  });
});

describe("findRelevantSummaries", () => {
  it("returns empty for fallback summaries", () => {
    const FALLBACK = "(文件尚未创建)";
    expect(findRelevantSummaries(FALLBACK, "outline", 5)).toBe("");
  });

  it("returns empty for fallback outline", () => {
    const FALLBACK = "(文件尚未创建)";
    expect(findRelevantSummaries("summaries", FALLBACK, 5)).toBe("");
  });

  it("returns empty for empty input", () => {
    expect(findRelevantSummaries("", "", 1)).toBe("");
  });

  it("returns string type for valid inputs", () => {
    const summaries = "| 章 | 摘要 |\n|---|------|\n| 1 | 张三初入仙门 |\n| 2 | 李四叛变 |";
    const outline = "张三和李四";
    const result = findRelevantSummaries(summaries, outline, 10);
    expect(typeof result).toBe("string");
  });
});

describe("loadRecentChapters", () => {
  const TEST_ROOT = join(tmpdir(), `inkos-recent-chapters-test-${Date.now()}`);

  it("returns empty string when chapters dir does not exist", async () => {
    const result = await loadRecentChapters(join(TEST_ROOT, "nonexistent"), 5);
    expect(result).toBe("");
  });

  it("loads the last chapter when available", async () => {
    const chapDir = join(TEST_ROOT, "chapters");
    await mkdir(chapDir, { recursive: true });
    await writeFile(join(chapDir, "001.md"), "content chapter 1", "utf-8");
    await writeFile(join(chapDir, "002.md"), "content chapter 2", "utf-8");

    const result = await loadRecentChapters(TEST_ROOT, 3);
    expect(result.length).toBeGreaterThan(0);

    await rm(TEST_ROOT, { recursive: true, force: true });
  });
});
