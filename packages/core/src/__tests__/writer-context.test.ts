import { describe, it, expect } from "vitest";
import {
  buildStyleFingerprint,
  extractDialogueFingerprints,
  findRelevantSummaries,
} from "../agents/writer-context.js";

// ---------------------------------------------------------------------------
// buildStyleFingerprint
// ---------------------------------------------------------------------------

describe("buildStyleFingerprint", () => {
  it("returns undefined for empty string", () => {
    expect(buildStyleFingerprint("")).toBeUndefined();
  });

  it("returns undefined for fallback placeholder", () => {
    expect(buildStyleFingerprint("(文件尚未创建)")).toBeUndefined();
  });

  it("returns undefined for invalid JSON", () => {
    expect(buildStyleFingerprint("{broken json")).toBeUndefined();
  });

  it("returns undefined for empty profile object", () => {
    expect(buildStyleFingerprint("{}")).toBeUndefined();
  });

  it("includes avgSentenceLength when present", () => {
    const json = JSON.stringify({ avgSentenceLength: 12 });
    const result = buildStyleFingerprint(json);
    expect(result).toContain("平均句长：12字");
  });

  it("includes multiple fields", () => {
    const json = JSON.stringify({
      avgSentenceLength: 15,
      sentenceLengthStdDev: 3.5,
      avgParagraphLength: 200,
      vocabularyDiversity: 0.65,
    });
    const result = buildStyleFingerprint(json)!;
    expect(result).toContain("15字");
    expect(result).toContain("3.5");
    expect(result).toContain("200字");
    expect(result).toContain("0.65");
  });

  it("includes paragraphLengthRange min-max", () => {
    const json = JSON.stringify({
      paragraphLengthRange: { min: 50, max: 300 },
    });
    const result = buildStyleFingerprint(json)!;
    expect(result).toContain("50-300字");
  });

  it("includes topPatterns joined with 、", () => {
    const json = JSON.stringify({
      topPatterns: ["短句", "排比"],
    });
    const result = buildStyleFingerprint(json)!;
    expect(result).toContain("短句、排比");
  });

  it("includes rhetoricalFeatures joined with 、", () => {
    const json = JSON.stringify({
      rhetoricalFeatures: ["比喻", "夸张"],
    });
    const result = buildStyleFingerprint(json)!;
    expect(result).toContain("比喻、夸张");
  });
});

// ---------------------------------------------------------------------------
// extractDialogueFingerprints
// ---------------------------------------------------------------------------

describe("extractDialogueFingerprints", () => {
  it("returns empty for empty input", () => {
    expect(extractDialogueFingerprints("", "")).toBe("");
  });

  it("returns empty when no dialogue patterns found", () => {
    expect(extractDialogueFingerprints("这是一段纯叙述文字，没有对话。", "")).toBe("");
  });

  it("returns empty for characters with only 1 dialogue line", () => {
    // Solo una línea de diálogo → no alcanza ≥2 líneas
    const text = "听完之后，张三说道：「你好世界」";
    expect(extractDialogueFingerprints(text, "")).toBe("");
  });

  it("returns non-empty for repeated speaker pattern", () => {
    // Usamos el mismo patrón exacto para que .{1,6} capture el mismo speaker
    const text =
      "听完之后，张三道：「今天天气不错」\n" +
      "听完之后，张三道：「是的确实很好」";
    const result = extractDialogueFingerprints(text, "");
    expect(result.length).toBeGreaterThan(0);
  });

  it("includes sentence length marker", () => {
    // Frases cortas (< 15 chars) con patrón consistente
    const shortText =
      "听完之后，张三道：「好的走」\n" +
      "听完之后，张三道：「没问题」";
    const shortResult = extractDialogueFingerprints(shortText, "");
    expect(shortResult).toContain("短句为主");

    // Frases largas (>= 15 chars)
    const longText =
      "听完之后，李四道：「这件事情我们需要仔细考虑一下再做决定比较好」\n" +
      "听完之后，李四道：「那我们就按照之前商量好的方案来执行吧」";
    const longResult = extractDialogueFingerprints(longText, "");
    expect(longResult).toContain("长句为主");
  });

  it("detects question-heavy characters", () => {
    const text =
      "听完之后，王五道：「你确定吗？」\n" +
      "听完之后，王五道：「为什么不行？」\n" +
      "听完之后，王五道：「还有什么别的办法？」";
    const result = extractDialogueFingerprints(text, "");
    expect(result).toContain("反问多");
  });

  it("separates multiple characters with ；", () => {
    const text =
      "听完之后，张三道：「好的走吧」\n" +
      "听完之后，张三道：「没问题的」\n" +
      "听完之后，李四道：「我也同意」\n" +
      "听完之后，李四道：「这不可能」";
    const result = extractDialogueFingerprints(text, "");
    expect(result).toContain("；");
  });
});

// ---------------------------------------------------------------------------
// findRelevantSummaries
// ---------------------------------------------------------------------------

describe("findRelevantSummaries", () => {
  const sampleSummaries = [
    "| 章节 | 标题 | 出场人物 | 关键事件 |",
    "|------|------|----------|----------|",
    "| 1 | 开篇 | 张三、李四 | 初次相遇 |",
    "| 2 | 冲突 | 张三、王五 | 争夺宝物H01 |",
    "| 3 | 转折 | 李四 | 发现秘密H02 |",
    "| 4 | 高潮 | 张三、李四 | 联手对敌 |",
    "| 5 | 收束 | 王五 | 背叛揭露 |",
  ].join("\n");

  it("returns empty for fallback summaries", () => {
    expect(findRelevantSummaries("(文件尚未创建)", "纲要", 5)).toBe("");
  });

  it("returns empty for fallback outline", () => {
    expect(findRelevantSummaries(sampleSummaries, "(文件尚未创建)", 5)).toBe("");
  });

  it("returns empty when no names or hooks found in outline", () => {
    expect(findRelevantSummaries(sampleSummaries, "no matches here 123", 5)).toBe("");
  });

  it("matches rows by character name from outline", () => {
    // “张三、” matches because 张三 is followed by 、
    const outline = "第六章：张三、李四联手。";
    const result = findRelevantSummaries(sampleSummaries, outline, 6);
    expect(result).toContain("张三");
    expect(result.split("\n").length).toBeGreaterThanOrEqual(1);
  });

  it("matches rows by hook ID from outline", () => {
    const outline = "第六章：解开伏笔H01。";
    const result = findRelevantSummaries(sampleSummaries, outline, 6);
    expect(result).toContain("H01");
  });

  it("excludes the previous chapter (chapterNumber - 1)", () => {
    // 张三 matches in ch1,2,4 — but NOT ch5 (=6-1)
    const outline = "第六章：张三、李四。";
    const result = findRelevantSummaries(sampleSummaries, outline, 6);
    expect(result).not.toContain("| 5 ");
  });

  it("filters by name match from outline sentence", () => {
    // 王五 appears in ch2 and ch5. Ch5 excluded (6-1=5). Ch2 should remain.
    const outline = "第六章：王五、张三联手。";
    const result = findRelevantSummaries(sampleSummaries, outline, 6);
    expect(result).toContain("| 2 ");
    expect(result).not.toContain("| 5 ");
  });

  it("handles empty summaries", () => {
    expect(findRelevantSummaries("", "张三出场，", 5)).toBe("");
  });
});
