import { describe, it, expect } from "vitest";
import {
  buildRecentChapterFull,
  buildRecentChapterTail,
} from "../utils/recent-chapter-compressor.js";

// === Helper ===

function buildTestChapter(paragraphCount: number): string {
  return Array.from({ length: paragraphCount }, (_, i) =>
    `这是第${i + 1}段的内容，包含了一些叙述和对话。"你好啊，"主角说道。`
  ).join("\n\n");
}

// === buildRecentChapterFull ===

describe("buildRecentChapterFull", () => {
  it("returns content unchanged", () => {
    const content = "原始章节内容";
    expect(buildRecentChapterFull(content)).toBe(content);
  });

  it("returns empty string for empty input", () => {
    expect(buildRecentChapterFull("")).toBe("");
  });
});

// === buildRecentChapterTail ===

describe("buildRecentChapterTail", () => {
  it("returns full content for short chapters (≤6 paragraphs)", () => {
    const content = buildTestChapter(5);
    const result = buildRecentChapterTail(content);
    // Capítulo corto — devuelve completo
    expect(result).toBe(content);
  });

  it("returns roughly second half for long chapters", () => {
    const content = buildTestChapter(20);
    const result = buildRecentChapterTail(content);

    // Debe incluir la marca de truncado
    expect(result).toContain("[…前文省略…]");
    // Debe incluir los últimos párrafos
    expect(result).toContain("第20段");
    // NO debe incluir los primeros párrafos
    expect(result).not.toContain("第1段");
    // Debe ser más corto que el original
    expect(result.length).toBeLessThan(content.length);
  });

  it("always includes at least the last 5 paragraphs", () => {
    const content = buildTestChapter(12);
    const result = buildRecentChapterTail(content);

    // Los últimos 5 deben estar presentes
    expect(result).toContain("第12段");
    expect(result).toContain("第11段");
    expect(result).toContain("第10段");
    expect(result).toContain("第9段");
    expect(result).toContain("第8段");
  });

  it("returns empty for empty input", () => {
    expect(buildRecentChapterTail("")).toBe("");
  });

  it("handles single paragraph", () => {
    const content = "只有一段内容";
    const result = buildRecentChapterTail(content);
    expect(result).toBe(content);
  });
});
