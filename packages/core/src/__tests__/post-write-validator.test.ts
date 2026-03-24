import { describe, it, expect } from "vitest";
import { validatePostWrite, type PostWriteViolation } from "../agents/post-write-validator.js";
import type { GenreProfile } from "../models/genre-profile.js";

const baseProfile: GenreProfile = {
  id: "test",
  name: "测试",
  language: "zh",
  chapterTypes: [],
  fatigueWords: [],
  pacingRule: "",
  numericalSystem: false,
  powerScaling: false,
  eraResearch: false,
  auditDimensions: [],
  satisfactionTypes: [],
};

function findRule(violations: ReadonlyArray<PostWriteViolation>, rule: string): PostWriteViolation | undefined {
  return violations.find(v => v.rule === rule);
}

describe("validatePostWrite", () => {
  it("returns no violations for clean content", () => {
    const content = "他走过去，端起杯子，灌了一口。外面的雨越下越大。\n\n她站在窗前，看着街上的行人匆匆走过。";
    const result = validatePostWrite(content, baseProfile, null);
    expect(result).toHaveLength(0);
  });

  it("detects '不是…而是…' pattern", () => {
    const content = "这不是勇气，而是愚蠢。他知道这一点。";
    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "禁止句式")).toBeDefined();
    expect(findRule(result, "禁止句式")!.severity).toBe("error");
  });

  it("detects dash '——'", () => {
    const content = "他走了过去——然后停下来。";
    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "禁止破折号")).toBeDefined();
    expect(findRule(result, "禁止破折号")!.severity).toBe("error");
  });

  it("skips Chinese-only rules when the book language override is English", () => {
    const content = "He stepped forward——then stopped at the door.";
    const validateWithLanguage = validatePostWrite as (
      content: string,
      genreProfile: GenreProfile,
      bookRules: null,
      languageOverride?: "zh" | "en",
    ) => ReadonlyArray<PostWriteViolation>;

    const result = validateWithLanguage(content, baseProfile, null, "en");

    expect(findRule(result, "禁止破折号")).toBeUndefined();
  });

  it("detects surprise marker density exceeding threshold", () => {
    // ~100 chars total, threshold = max(1, floor(100/3000)) = 1, but we put 3 markers
    const content = "他忽然站起来。仿佛听到了什么声音。竟然是那个人回来了。";
    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "转折词密度")).toBeDefined();
  });

  it("allows markers within threshold", () => {
    // 3000+ chars with only 1 marker
    const filler = "这是一段很长的正文内容，描述了角色的行动和场景的变化。".repeat(60);
    const content = `${filler}他忽然站起来。${filler}`;
    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "转折词密度")).toBeUndefined();
  });

  it("detects fatigue words from genre profile", () => {
    const profile = { ...baseProfile, fatigueWords: ["一道目光"] };
    const content = "一道目光扫过来，又一道目光从侧面射来，第三道目光也来了。";
    const result = validatePostWrite(content, profile, null);
    expect(findRule(result, "高疲劳词")).toBeDefined();
  });

  it("detects meta-narration patterns", () => {
    const content = "故事发展到了这里，主角终于做出了选择。他站起来走向门口。";
    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "元叙事")).toBeDefined();
  });

  it("detects report-style terms in prose", () => {
    const content = "他的核心动机其实很简单，就是想活下去。信息边界在此刻变得模糊。";
    const result = validatePostWrite(content, baseProfile, null);
    const v = findRule(result, "报告术语");
    expect(v).toBeDefined();
    expect(v!.severity).toBe("error");
    expect(v!.description).toContain("核心动机");
    expect(v!.description).toContain("信息边界");
  });

  it("detects sermon words", () => {
    const content = "显然，对方低估了他的实力。毋庸置疑，这将是一场硬仗。";
    const result = validatePostWrite(content, baseProfile, null);
    const v = findRule(result, "作者说教");
    expect(v).toBeDefined();
    expect(v!.description).toContain("显然");
    expect(v!.description).toContain("毋庸置疑");
  });

  it("detects collective shock patterns", () => {
    const content = "众人齐齐震惊，没有人想到他居然能赢。";
    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "集体反应")).toBeDefined();
  });

  it("detects consecutive '了' sentences", () => {
    const content = "他走了过去。他拿了杯子。他喝了一口。他放了下来。他转了身。他叹了口气。他摇了摇头。";
    const result = validatePostWrite(content, baseProfile, null);
    const v = findRule(result, "连续了字");
    expect(v).toBeDefined();
    expect(v!.severity).toBe("warning");
  });

  it("detects overly long paragraphs", () => {
    const longPara = "这是一段非常长的段落。".repeat(30); // ~300+ chars
    const content = `${longPara}\n\n${longPara}\n\n短段落。`;
    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "段落过长")).toBeDefined();
  });

  it("detects book-level prohibitions", () => {
    const bookRules = {
      version: "1",
      protagonist: { name: "张三", personalityLock: [], behavioralConstraints: [] },
      prohibitions: ["跪舔"],
      genreLock: { primary: "xuanhuan" as const, forbidden: [] },
      chapterTypesOverride: [],
      fatigueWordsOverride: [],
      additionalAuditDimensions: [],
      enableFullCastTracking: false,
      allowedDeviations: [],
    };
    const content = "他一脸跪舔的样子让人恶心。";
    const result = validatePostWrite(content, baseProfile, bookRules);
    expect(findRule(result, "本书禁忌")).toBeDefined();
  });

  it("does not flag allowed content", () => {
    // Content that is clean across all rules
    const content = `他站起来，环顾四周。窗外的月光洒在地板上，像一层薄薄的霜。\n\n\u201c走吧。\u201d她转身推开门。冷风从缝隙里钻进来，她裹紧了衣服。`;
    const result = validatePostWrite(content, baseProfile, null);
    expect(result).toHaveLength(0);
  });
});
