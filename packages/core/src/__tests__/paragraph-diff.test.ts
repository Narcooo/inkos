import { describe, it, expect } from "vitest";
import {
  buildParagraphDiff,
  formatDiffForSettler,
  shouldUseIncrementalSettle,
} from "../utils/paragraph-diff.js";

describe("buildParagraphDiff", () => {
  it("should detect no changes for identical texts", () => {
    const text = "第一段\n\n第二段\n\n第三段";
    const diff = buildParagraphDiff(text, text);
    expect(diff.changedParagraphs).toBe(0);
    expect(diff.changeRatio).toBe(0);
  });

  it("should detect modified paragraphs", () => {
    const original = "他走进房间。\n\n桌上放着一本旧书。\n\n窗外下着雨。";
    const revised = "他走进房间。\n\n桌上放着一把匕首，匕首上还沾着血迹。\n\n窗外下着雨。";
    const diff = buildParagraphDiff(original, revised);
    expect(diff.changedParagraphs).toBe(1);
    expect(diff.changes[0]!.type).toBe("modified");
    expect(diff.changes[0]!.index).toBe(1);
  });

  it("should detect added paragraphs", () => {
    const original = "第一段\n\n第二段";
    const revised = "第一段\n\n第二段\n\n第三段";
    const diff = buildParagraphDiff(original, revised);
    expect(diff.changes.some((c) => c.type === "added")).toBe(true);
  });

  it("should detect removed paragraphs", () => {
    const original = "第一段\n\n第二段\n\n第三段";
    const revised = "第一段\n\n第二段";
    const diff = buildParagraphDiff(original, revised);
    expect(diff.changes.some((c) => c.type === "removed")).toBe(true);
  });

  it("should skip near-identical paragraphs (>95% similarity)", () => {
    // Para textos cortos, un solo carácter puede bajar mucho la similitud bigram
    // así que usamos texto más largo donde un cambio menor es insignificante
    const longPara = "他走进了房间，看到桌子上放着一本旧书，封面已经泛黄，角落有些破损，散发着淡淡的旧纸味";
    const original = longPara + "。";
    const revised = longPara + "！";
    const diff = buildParagraphDiff(original, revised);
    expect(diff.changedParagraphs).toBe(0);
  });

  it("should handle empty texts", () => {
    expect(buildParagraphDiff("", "").changedParagraphs).toBe(0);
    expect(buildParagraphDiff("", "新内容").changedParagraphs).toBe(1);
    expect(buildParagraphDiff("旧内容", "").changedParagraphs).toBe(1);
  });
});

describe("formatDiffForSettler", () => {
  it("should format no-change diff", () => {
    const diff = buildParagraphDiff("同样", "同样");
    const text = formatDiffForSettler(diff);
    expect(text).toContain("无实质性变更");
  });

  it("should format modified paragraph", () => {
    const original = "段落一\n\n原始段落内容\n\n段落三";
    const revised = "段落一\n\n修改后的全新段落内容，完全不同了\n\n段落三";
    const diff = buildParagraphDiff(original, revised);
    const text = formatDiffForSettler(diff);
    expect(text).toContain("修改段落");
    expect(text).toContain("修改后");
  });
});

describe("shouldUseIncrementalSettle", () => {
  it("should return true for minor revisions", () => {
    const diff = buildParagraphDiff(
      "段1\n\n段2\n\n段3\n\n段4\n\n段5\n\n段6\n\n段7\n\n段8\n\n段9\n\n段10",
      "段1\n\n段2改\n\n段3\n\n段4\n\n段5\n\n段6\n\n段7\n\n段8\n\n段9\n\n段10",
    );
    expect(shouldUseIncrementalSettle(diff)).toBe(true);
  });

  it("should return false for major revisions", () => {
    const diff = buildParagraphDiff(
      "段1\n\n段2\n\n段3",
      "完全不同1\n\n完全不同2\n\n完全不同3",
    );
    expect(shouldUseIncrementalSettle(diff)).toBe(false);
  });

  it("should return false for no changes (no settle needed)", () => {
    const diff = buildParagraphDiff("相同", "相同");
    expect(shouldUseIncrementalSettle(diff)).toBe(false);
  });
});
