import { describe, it, expect } from "vitest";
import {
  PLANNER_MEMO_SYSTEM_PROMPT,
  PLANNER_MEMO_USER_TEMPLATE,
  buildPlannerUserMessage,
  buildGoldenOpeningGuidance,
} from "../agents/planner-prompts.js";

const LENGTH_BUDGET = {
  target: 2200,
  softMin: 1900,
  softMax: 2500,
  hardMin: 1600,
  hardMax: 2800,
  unit: "字",
} as const;

describe("PLANNER_MEMO_SYSTEM_PROMPT", () => {
  it("contains key mobile web-fiction craft phrases", () => {
    expect(PLANNER_MEMO_SYSTEM_PROMPT).toContain("1 主线 + 1 支线");
    expect(PLANNER_MEMO_SYSTEM_PROMPT).toContain("三连问");
    expect(PLANNER_MEMO_SYSTEM_PROMPT).toContain("不要 YAML frontmatter");
    expect(PLANNER_MEMO_SYSTEM_PROMPT).toContain("## 本章目标");
    expect(PLANNER_MEMO_SYSTEM_PROMPT).toContain("## 关联线索");
    expect(PLANNER_MEMO_SYSTEM_PROMPT).toContain("## 场景与篇幅预算");
    expect(PLANNER_MEMO_SYSTEM_PROMPT).toContain("不超过 50 字");
    expect(PLANNER_MEMO_SYSTEM_PROMPT).toContain("## 当前任务");
    expect(PLANNER_MEMO_SYSTEM_PROMPT).toContain("## 不要做");
  });

  it("is not accidentally empty", () => {
    expect(PLANNER_MEMO_SYSTEM_PROMPT.length).toBeGreaterThan(500);
  });
});

describe("PLANNER_MEMO_USER_TEMPLATE", () => {
  it("contains all placeholders", () => {
    const placeholders = [
      "{{chapterNumber}}",
      "{{previous_chapter_ending_excerpt}}",
      "{{recent_summaries}}",
      "{{current_arc_prose}}",
      "{{protagonist_matrix_row}}",
      "{{opponent_rows}}",
      "{{collaborator_rows}}",
      "{{relevant_threads}}",
      "{{recyclable_hooks}}",
      "{{isGoldenOpening}}",
      "{{lengthTarget}}",
      "{{lengthSoftMin}}",
      "{{lengthSoftMax}}",
      "{{lengthHardMin}}",
      "{{lengthHardMax}}",
      "{{lengthUnit}}",
      "{{book_rules_relevant}}",
    ];
    for (const ph of placeholders) {
      expect(PLANNER_MEMO_USER_TEMPLATE).toContain(ph);
    }
  });
});

describe("buildPlannerUserMessage", () => {
  it("fills placeholders in order", () => {
    const out = buildPlannerUserMessage({
      chapterNumber: 12,
      previousChapterEndingExcerpt: "上一屏结尾原文",
      recentSummaries: "| ch9 | ... |",
      currentArcProse: "主线推进七号门",
      protagonistMatrixRow: "| 阿泽 | 主角 | ... |",
      opponentRows: "| 老李 | 对手 | ... |",
      collaboratorRows: "| 小白 | 盟友 | ... |",
      relevantThreads: "- H03: 未解码信\n- S004: 七号门异常",
      recyclableHooks: "（暂无陈旧 hook——账本干净）",
      isGoldenOpening: false,
      lengthBudget: LENGTH_BUDGET,
      bookRulesRelevant: "- 禁止主角降智",
    });

    expect(out).toContain("# 第 12 章 memo 请求");
    expect(out).toContain("上一屏结尾原文");
    expect(out).toContain("| ch9 | ... |");
    expect(out).toContain("主线推进七号门");
    expect(out).toContain("| 阿泽 | 主角 | ... |");
    expect(out).toContain("| 老李 | 对手 | ... |");
    expect(out).toContain("| 小白 | 盟友 | ... |");
    expect(out).toContain("- H03: 未解码信");
    expect(out).toContain("是否黄金三章：否");
    expect(out).toContain("目标 2200 字");
    expect(out).toContain("硬区间 1600-2800");
    expect(out).toContain("- 禁止主角降智");
    expect(out).not.toContain("{{");
  });

  it("translates isGoldenOpening true to 是", () => {
    const out = buildPlannerUserMessage({
      chapterNumber: 1,
      previousChapterEndingExcerpt: "",
      recentSummaries: "",
      currentArcProse: "",
      protagonistMatrixRow: "",
      opponentRows: "",
      collaboratorRows: "",
      relevantThreads: "",
      recyclableHooks: "",
      isGoldenOpening: true,
      lengthBudget: LENGTH_BUDGET,
      bookRulesRelevant: "",
    });
    expect(out).toContain("是否黄金三章：是");
  });
});

// ---------------------------------------------------------------------------
// Phase 6.5 — Golden Opening Guidance prose
// ---------------------------------------------------------------------------

describe("buildGoldenOpeningGuidance", () => {
  it("emits zh slot prose for chapter 1 (confront core conflict)", () => {
    const out = buildGoldenOpeningGuidance(1, "zh");
    expect(out).toContain("黄金三章规划指引");
    expect(out).toContain("第 1 章");
    // Ch1 slot: throw protagonist into core conflict
    expect(out).toContain("核心冲突");
    expect(out).toContain("主角出场即面对主线矛盾");
    // Opening economy
    expect(out).toContain("场景 ≤ 3");
    expect(out).toContain("人物 ≤ 3");
    // Information layering
    expect(out).toContain("信息分层");
  });

  it("emits zh slot prose for chapter 2 (demonstrate the edge)", () => {
    const out = buildGoldenOpeningGuidance(2, "zh");
    expect(out).toContain("第 2 章");
    expect(out).toContain("金手指");
    // Must demand a concrete event, not narration
    expect(out).toContain("一次具体事件");
  });

  it("emits zh slot prose for chapter 3 (lock the short-term goal)", () => {
    const out = buildGoldenOpeningGuidance(3, "zh");
    expect(out).toContain("第 3 章");
    expect(out).toContain("短期目标");
    expect(out).toContain("3-10 章");
  });

  it("emits en slot prose for chapter 1 with all three slot descriptions", () => {
    const out = buildGoldenOpeningGuidance(1, "en");
    expect(out).toContain("Golden Opening Guidance");
    expect(out).toContain("Chapter 1");
    expect(out).toContain("core conflict");
    expect(out).toContain("concrete event");
    expect(out).toContain("short-term goal");
  });

  it("returns empty string for ch>=4 in both languages", () => {
    expect(buildGoldenOpeningGuidance(4, "zh")).toBe("");
    expect(buildGoldenOpeningGuidance(5, "zh")).toBe("");
    expect(buildGoldenOpeningGuidance(4, "en")).toBe("");
    expect(buildGoldenOpeningGuidance(99, "en")).toBe("");
  });

  it("renders as cohesive prose, not a numbered or bulleted checklist", () => {
    const zh = buildGoldenOpeningGuidance(1, "zh");
    // Heading is allowed; body must not contain enumerated lines.
    expect(zh).not.toMatch(/^\s*1\.\s/m);
    expect(zh).not.toMatch(/^\s*-\s/m);
    expect(zh).not.toMatch(/^\s*\*\s/m);
  });

  it("buildPlannerUserMessage appends guidance for ch<=3 and omits it for ch>=4", () => {
    const base = {
      previousChapterEndingExcerpt: "",
      recentSummaries: "",
      currentArcProse: "",
      protagonistMatrixRow: "",
      opponentRows: "",
      collaboratorRows: "",
      relevantThreads: "",
      recyclableHooks: "",
      isGoldenOpening: false,
      lengthBudget: LENGTH_BUDGET,
      bookRulesRelevant: "",
    };

    const ch2 = buildPlannerUserMessage({ ...base, chapterNumber: 2 });
    expect(ch2).toContain("黄金三章规划指引");
    expect(ch2).toContain("第 2 章");

    const ch4 = buildPlannerUserMessage({ ...base, chapterNumber: 4 });
    expect(ch4).not.toContain("黄金三章规划指引");
  });
});
