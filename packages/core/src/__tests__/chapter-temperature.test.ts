import { describe, it, expect } from "vitest";
import { inferChapterTemperature, inferChapterWordCount } from "../utils/chapter-temperature.js";

describe("inferChapterTemperature", () => {
  const sampleOutline = `
## 第一卷：初入江湖

第1章 过渡铺垫，主角进入宗门
第2章 冲突对抗，与师兄产生矛盾
第3章 高潮决战，宗门大比
第4章 收束收尾，离开宗门
第5章 对话谈判，与城主密谈
第6章 普通章节，探索密境
第7章 激战危机，遭遇伏击
`;

  it("detects transition chapter with lower temperature", () => {
    const result = inferChapterTemperature(sampleOutline, 1);
    expect(result.detectedType).toBe("transition");
    expect(result.temperature).toBe(0.65);
  });

  it("detects conflict chapter with moderate-high temperature", () => {
    const result = inferChapterTemperature(sampleOutline, 2);
    expect(result.detectedType).toBe("conflict");
    expect(result.temperature).toBe(0.75);
  });

  it("detects climax chapter with high temperature", () => {
    const result = inferChapterTemperature(sampleOutline, 3);
    expect(result.detectedType).toBe("climax");
    expect(result.temperature).toBe(0.85);
  });

  it("detects resolution chapter", () => {
    const result = inferChapterTemperature(sampleOutline, 4);
    expect(result.detectedType).toBe("resolution");
    expect(result.temperature).toBe(0.65);
  });

  it("detects dialogue chapter with low temperature", () => {
    const result = inferChapterTemperature(sampleOutline, 5);
    expect(result.detectedType).toBe("dialogue");
    expect(result.temperature).toBe(0.6);
  });

  it("returns default for chapters without type keywords", () => {
    const result = inferChapterTemperature(sampleOutline, 6);
    expect(result.detectedType).toBe("default");
    expect(result.temperature).toBe(0.7);
  });

  it("detects conflict via secondary keywords", () => {
    const result = inferChapterTemperature(sampleOutline, 7);
    expect(result.detectedType).toBe("conflict");
    expect(result.temperature).toBe(0.75);
  });

  it("returns default when volume outline is empty", () => {
    const result = inferChapterTemperature("", 1);
    expect(result.detectedType).toBe("default");
    expect(result.temperature).toBe(0.7);
  });

  it("returns default when chapter not found in outline", () => {
    const result = inferChapterTemperature(sampleOutline, 99);
    expect(result.detectedType).toBe("default");
    expect(result.temperature).toBe(0.7);
  });
});

describe("inferChapterWordCount", () => {
  const sampleOutline = `
第1章 过渡铺垫，主角进入宗门
第2章 高潮决战，宗门大比
第3章 冲突对抗，与师兄产生矛盾
第4章 对话谈判，与城主密谈
第5章 收束收尾，离开宗门
第6章 普通章节，探索密境
`;

  it("reduces word count for transition chapters (0.85x)", () => {
    const result = inferChapterWordCount(3000, sampleOutline, 1);
    expect(result.detectedType).toBe("transition");
    expect(result.multiplier).toBe(0.85);
    // 3000 * 0.85 = 2550, rounded to 2600
    expect(result.wordCount).toBe(2600);
  });

  it("increases word count for climax chapters (1.2x)", () => {
    const result = inferChapterWordCount(3000, sampleOutline, 2);
    expect(result.detectedType).toBe("climax");
    expect(result.multiplier).toBe(1.2);
    // 3000 * 1.2 = 3600
    expect(result.wordCount).toBe(3600);
  });

  it("slightly increases for conflict chapters (1.1x)", () => {
    const result = inferChapterWordCount(3000, sampleOutline, 3);
    expect(result.detectedType).toBe("conflict");
    expect(result.multiplier).toBe(1.1);
    // 3000 * 1.1 = 3300
    expect(result.wordCount).toBe(3300);
  });

  it("reduces for dialogue chapters (0.85x)", () => {
    const result = inferChapterWordCount(3000, sampleOutline, 4);
    expect(result.detectedType).toBe("dialogue");
    expect(result.multiplier).toBe(0.85);
    expect(result.wordCount).toBe(2600);
  });

  it("slightly reduces for resolution chapters (0.9x)", () => {
    const result = inferChapterWordCount(3000, sampleOutline, 5);
    expect(result.detectedType).toBe("resolution");
    expect(result.multiplier).toBe(0.9);
    // 3000 * 0.9 = 2700
    expect(result.wordCount).toBe(2700);
  });

  it("returns base word count for default type (1.0x)", () => {
    const result = inferChapterWordCount(3000, sampleOutline, 6);
    expect(result.detectedType).toBe("default");
    expect(result.multiplier).toBe(1.0);
    expect(result.wordCount).toBe(3000);
  });

  it("rounds to nearest hundred", () => {
    // 2500 * 1.2 = 3000 → 3000
    const r1 = inferChapterWordCount(2500, sampleOutline, 2);
    expect(r1.wordCount).toBe(3000);

    // 2800 * 0.85 = 2380 → 2400
    const r2 = inferChapterWordCount(2800, sampleOutline, 1);
    expect(r2.wordCount).toBe(2400);
  });

  it("returns base count when outline is empty", () => {
    const result = inferChapterWordCount(3000, "", 1);
    expect(result.wordCount).toBe(3000);
    expect(result.multiplier).toBe(1.0);
  });
});
