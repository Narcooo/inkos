import { describe, it, expect } from "vitest";
import { parseWriterOutput, parseCreativeOutput, type ParsedWriterOutput } from "../agents/writer-parser.js";
import type { GenreProfile } from "../models/genre-profile.js";
import { countChapterLength } from "../utils/length-metrics.js";

const defaultGenreProfile: GenreProfile = {
  name: "测试",
  id: "test",
  language: "zh",
  chapterTypes: [],
  fatigueWords: [],
  numericalSystem: true,
  powerScaling: false,
  eraResearch: false,
  pacingRule: "",
  satisfactionTypes: [],
  auditDimensions: [],
};

function callParseOutput(
  chapterNumber: number,
  content: string,
  genreProfile: GenreProfile = defaultGenreProfile,
  countingMode: "zh_chars" | "en_words" = "zh_chars",
): ParsedWriterOutput {
  return parseWriterOutput(chapterNumber, content, genreProfile, countingMode);
}

// ---------------------------------------------------------------------------
// Full tagged output
// ---------------------------------------------------------------------------

describe("WriterAgent parseOutput", () => {
  const fullOutput = [
    "=== PRE_WRITE_CHECK ===",
    "| 检查项 | 本章记录 | 备注 |",
    "|--------|----------|------|",
    "| 上下文范围 | 第1章 | |",
    "",
    "=== CHAPTER_TITLE ===",
    "吞天之始",
    "",
    "=== CHAPTER_CONTENT ===",
    "陈风站在悬崖边，俯视着脚下的万丈深渊。",
    "一股强烈的吸力从深渊中传来，仿佛有什么东西在召唤他。",
    "",
    "=== POST_SETTLEMENT ===",
    "| 结算项 | 本章记录 | 备注 |",
    "|--------|----------|------|",
    "| 资源账本 | 期初0 / 增量+100 / 期末100 | |",
    "",
    "=== UPDATED_STATE ===",
    "# 状态卡",
    "| 字段 | 值 |",
    "|------|-----|",
    "| 章节 | 1 |",
    "",
    "=== UPDATED_LEDGER ===",
    "# 资源账本",
    "| 章节 | 期初 | 来源 | 增量 | 期末 |",
    "|------|------|------|------|------|",
    "| 1 | 0 | 深渊果实 | +100 | 100 |",
    "",
    "=== UPDATED_HOOKS ===",
    "# 伏笔池",
    "| ID | 伏笔 | 状态 |",
    "|-----|------|------|",
    "| H001 | 深渊之物 | open |",
  ].join("\n");

  it("extracts all sections from a complete tagged output", () => {
    const result = callParseOutput(1, fullOutput);

    expect(result.chapterNumber).toBe(1);
    expect(result.title).toBe("吞天之始");
    expect(result.content).toContain("陈风站在悬崖边");
    expect(result.content).toContain("召唤他");
    expect(result.preWriteCheck).toContain("检查项");
    expect(result.postSettlement).toContain("资源账本");
    expect(result.updatedState).toContain("状态卡");
    expect(result.updatedLedger).toContain("深渊果实");
    expect(result.updatedHooks).toContain("H001");
  });

  it("calculates wordCount with the shared counting helper", () => {
    const result = callParseOutput(1, fullOutput);
    const expectedContent =
      "陈风站在悬崖边，俯视着脚下的万丈深渊。\n一股强烈的吸力从深渊中传来，仿佛有什么东西在召唤他。";
    expect(result.wordCount).toBe(countChapterLength(expectedContent, "zh_chars"));
  });

  // -------------------------------------------------------------------------
  // Missing sections
  // -------------------------------------------------------------------------

  it("returns default title when CHAPTER_TITLE is missing", () => {
    const output = [
      "=== CHAPTER_CONTENT ===",
      "Some content here.",
    ].join("\n");

    const result = callParseOutput(42, output);
    expect(result.title).toBe("第42章");
  });

  it("returns an English default title when CHAPTER_TITLE is missing in English mode", () => {
    const output = [
      "=== CHAPTER_CONTENT ===",
      "Some content here.",
    ].join("\n");

    const result = callParseOutput(42, output, defaultGenreProfile, "en_words");
    expect(result.title).toBe("Chapter 42");
  });

  it("returns empty content when CHAPTER_CONTENT is missing", () => {
    const output = [
      "=== CHAPTER_TITLE ===",
      "A Title",
    ].join("\n");

    const result = callParseOutput(1, output);
    expect(result.content).toBe("");
    expect(result.wordCount).toBe(0);
  });

  it("returns fallback strings for missing state sections", () => {
    const output = [
      "=== CHAPTER_TITLE ===",
      "Title",
      "",
      "=== CHAPTER_CONTENT ===",
      "Content.",
    ].join("\n");

    const result = callParseOutput(1, output);
    expect(result.updatedState).toBe("(状态卡未更新)");
    expect(result.updatedLedger).toBe("(账本未更新)");
    expect(result.updatedHooks).toBe("(伏笔池未更新)");
  });

  it("returns English fallback strings for missing state sections in English mode", () => {
    const output = [
      "=== CHAPTER_TITLE ===",
      "Title",
      "",
      "=== CHAPTER_CONTENT ===",
      "Content.",
    ].join("\n");

    const result = callParseOutput(1, output, defaultGenreProfile, "en_words");
    expect(result.updatedState).toBe("(state card not updated)");
    expect(result.updatedLedger).toBe("(ledger not updated)");
    expect(result.updatedHooks).toBe("(hooks pool not updated)");
  });

  it("returns empty string for missing PRE_WRITE_CHECK", () => {
    const output = [
      "=== CHAPTER_TITLE ===",
      "Title",
      "",
      "=== CHAPTER_CONTENT ===",
      "Content.",
    ].join("\n");

    const result = callParseOutput(1, output);
    expect(result.preWriteCheck).toBe("");
  });

  it("returns empty string for missing POST_SETTLEMENT", () => {
    const output = [
      "=== CHAPTER_TITLE ===",
      "Title",
      "",
      "=== CHAPTER_CONTENT ===",
      "Content.",
    ].join("\n");

    const result = callParseOutput(1, output);
    expect(result.postSettlement).toBe("");
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it("handles completely empty input", () => {
    const result = callParseOutput(1, "");
    expect(result.chapterNumber).toBe(1);
    expect(result.title).toBe("第1章");
    expect(result.content).toBe("");
    expect(result.wordCount).toBe(0);
    expect(result.updatedState).toBe("(状态卡未更新)");
    expect(result.updatedLedger).toBe("(账本未更新)");
    expect(result.updatedHooks).toBe("(伏笔池未更新)");
  });

  it("handles content with no tags at all", () => {
    const result = callParseOutput(5, "Just some random text without tags");
    expect(result.title).toBe("第5章");
    expect(result.content).toBe("");
    expect(result.wordCount).toBe(0);
  });

  it("preserves multiline content within a section", () => {
    const output = [
      "=== CHAPTER_CONTENT ===",
      "第一段：这里是开头。",
      "",
      "第二段：这里是中间。",
      "",
      "第三段：这里是结尾。",
      "",
      "=== POST_SETTLEMENT ===",
      "No settlement.",
    ].join("\n");

    const result = callParseOutput(1, output);
    expect(result.content).toContain("第一段");
    expect(result.content).toContain("第二段");
    expect(result.content).toContain("第三段");
  });

  it("trims whitespace from extracted section values", () => {
    const output = [
      "=== CHAPTER_TITLE ===",
      "   吞天之始   ",
      "",
      "=== CHAPTER_CONTENT ===",
      "  内容  ",
    ].join("\n");

    const result = callParseOutput(1, output);
    expect(result.title).toBe("吞天之始");
    expect(result.content).toBe("内容");
  });

  it("correctly counts Chinese characters in wordCount", () => {
    const chineseContent = "这是一段测试文本，包含二十个中文字符加上标点符号。";
    const output = [
      "=== CHAPTER_CONTENT ===",
      chineseContent,
    ].join("\n");

    const result = callParseOutput(1, output);
    // wordCount is content.length which counts each character (including punctuation)
    expect(result.wordCount).toBe(chineseContent.length);
  });

  it("counts English content with the shared counting helper when requested", () => {
    const englishContent = "He looked at the sky.";
    const output = [
      "=== CHAPTER_CONTENT ===",
      englishContent,
    ].join("\n");

    const result = callParseOutput(1, output, defaultGenreProfile, "en_words");
    expect(result.wordCount).toBe(countChapterLength(englishContent, "en_words"));
  });
});

// ---------------------------------------------------------------------------
// Fallback parsing for local/small models (#13)
// ---------------------------------------------------------------------------

describe("parseCreativeOutput fallback", () => {
  it("extracts content from markdown heading when tags are missing", () => {
    const raw = `# 第1章 觉醒之日

林风缓缓睁开了眼睛，映入眼帘的是一片陌生的天花板。他的脑海中充斥着混乱的记忆碎片，${"一段很长的正文内容".repeat(30)}完。`;

    const result = parseCreativeOutput(1, raw);
    expect(result.title).toBe("觉醒之日");
    expect(result.content.length).toBeGreaterThan(100);
    expect(result.content).toContain("林风");
  });

  it("extracts English content from markdown headings when tags are missing", () => {
    const raw = `# Chapter 1: Awakening Day

He woke to the sound of distant bells and the taste of salt in the air. ${"Long English prose follows. ".repeat(15)}`;

    const result = parseCreativeOutput(1, raw, "en_words");
    expect(result.title).toBe("Awakening Day");
    expect(result.content.length).toBeGreaterThan(100);
    expect(result.content).toContain("distant bells");
  });

  it("extracts content from 正文 label when tags are missing", () => {
    const raw = `章节标题：暗夜追踪

正文：
${"黑暗中一道身影掠过屋顶，无声无息。".repeat(20)}`;

    const result = parseCreativeOutput(5, raw);
    expect(result.title).toBe("暗夜追踪");
    expect(result.content.length).toBeGreaterThan(100);
  });

  it("falls back to longest prose block when no structure is found", () => {
    const prose = "这是一段完整的小说正文，描述了主角在黑暗中探索未知世界的经历。".repeat(10);
    const raw = `PRE_WRITE_CHECK: 已完成自检
CHAPTER_TITLE: 探索

${prose}`;

    const result = parseCreativeOutput(3, raw);
    expect(result.content.length).toBeGreaterThan(100);
  });

  it("returns empty content when raw output is too short", () => {
    const result = parseCreativeOutput(1, "太短了");
    expect(result.content).toBe("");
    expect(result.title).toBe("第1章");
  });

  it("returns an English fallback title when short English output has no structure", () => {
    const result = parseCreativeOutput(1, "too short", "en_words");
    expect(result.content).toBe("");
    expect(result.title).toBe("Chapter 1");
  });

  it("still works with proper === TAG === format", () => {
    const raw = `=== PRE_WRITE_CHECK ===
自检完成

=== CHAPTER_TITLE ===
正常标题

=== CHAPTER_CONTENT ===
正常的章节内容，这里是完整的正文。`;

    const result = parseCreativeOutput(1, raw);
    expect(result.title).toBe("正常标题");
    expect(result.content).toBe("正常的章节内容，这里是完整的正文。");
  });

  it("counts creative output with the shared helper when a counting mode is supplied", () => {
    const raw = `=== CHAPTER_TITLE ===
English Chapter

=== CHAPTER_CONTENT ===
He looked at the sky.`;

    const result = parseCreativeOutput(1, raw, "en_words");
    expect(result.wordCount).toBe(countChapterLength("He looked at the sky.", "en_words"));
  });
});
