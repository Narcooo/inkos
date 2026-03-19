import { describe, it, expect } from "vitest";
import { buildWriterSystemPrompt } from "../agents/writer-prompts.js";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseBook: BookConfig = {
  id: "test-book",
  title: "Test Novel",
  platform: "tomato",
  genre: "xuanhuan",
  status: "active",
  targetChapters: 200,
  chapterWordCount: 3000,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const baseGenreProfile: GenreProfile = {
  id: "xuanhuan",
  name: "玄幻",
  language: "zh",
  fatigueWords: ["竟然", "不禁"],
  chapterTypes: ["过渡", "冲突", "高潮", "收束"],
  pacingRule: "爽点间隔不超过3章",
  numericalSystem: true,
  powerScaling: true,
  eraResearch: false,
  satisfactionTypes: [],
  auditDimensions: [],
};

const minimalGenreProfile: GenreProfile = {
  id: "urban",
  name: "都市",
  language: "zh",
  fatigueWords: [],
  chapterTypes: [],
  pacingRule: "",
  numericalSystem: false,
  powerScaling: false,
  eraResearch: false,
  satisfactionTypes: [],
  auditDimensions: [],
};

const baseBookRules: BookRules = {
  version: "1.0",
  protagonist: {
    name: "张三",
    personalityLock: ["冷静", "果断"],
    behavioralConstraints: ["不杀无辜", "不背叛盟友"],
  },
  prohibitions: ["不写感情线", "不出现现代科技"],
  genreLock: {
    primary: "xuanhuan",
    forbidden: ["穿越", "重生"],
  },
  enableFullCastTracking: false,
  chapterTypesOverride: [],
  fatigueWordsOverride: [],
  additionalAuditDimensions: [],
  allowedDeviations: [],
};

// ---------------------------------------------------------------------------
// buildWriterSystemPrompt — 综合测试
// ---------------------------------------------------------------------------

describe("buildWriterSystemPrompt", () => {
  /** Helper: genera prompt con defaults cómodos */
  function buildPrompt(overrides?: {
    book?: Partial<BookConfig>;
    gp?: Partial<GenreProfile>;
    bookRules?: BookRules | null;
    bookRulesBody?: string;
    genreBody?: string;
    styleGuide?: string;
    styleFingerprint?: string;
    chapterNumber?: number;
    mode?: "full" | "creative";
  }): string {
    const merged = { ...baseBook, ...overrides?.book } as BookConfig;
    const gp = { ...baseGenreProfile, ...overrides?.gp } as GenreProfile;
    return buildWriterSystemPrompt(
      merged,
      gp,
      overrides?.bookRules ?? null,
      overrides?.bookRulesBody ?? "",
      overrides?.genreBody ?? "",
      overrides?.styleGuide ?? "",
      overrides?.styleFingerprint,
      overrides?.chapterNumber,
      overrides?.mode ?? "full",
    );
  }

  // -------------------------------------------------------------------------
  // Secciones fijas presentes
  // -------------------------------------------------------------------------

  it("includes genre intro with platform name", () => {
    const result = buildPrompt();
    expect(result).toContain("玄幻");
    expect(result).toContain("tomato");
  });

  it("includes core rules with word count", () => {
    const result = buildPrompt({ book: { chapterWordCount: 5000 } });
    expect(result).toContain("5000字左右");
  });

  it("includes anti-AI examples section", () => {
    const result = buildPrompt();
    expect(result).toContain("去AI味：反例→正例对照");
  });

  it("includes character psychology method", () => {
    const result = buildPrompt();
    expect(result).toContain("六步走人物心理分析");
    expect(result).toContain("当前处境");
    expect(result).toContain("情绪外化");
  });

  it("includes supporting character method", () => {
    const result = buildPrompt();
    expect(result).toContain("配角设计方法论");
    expect(result).toContain("配角B面原则");
  });

  it("includes reader psychology framework", () => {
    const result = buildPrompt();
    expect(result).toContain("读者心理学框架");
    expect(result).toContain("期待管理");
  });

  it("includes emotional pacing method", () => {
    const result = buildPrompt();
    expect(result).toContain("情感节点设计");
  });

  it("includes immersion techniques", () => {
    const result = buildPrompt();
    expect(result).toContain("代入感技法");
  });

  it("includes pre-write checklist", () => {
    const result = buildPrompt();
    expect(result).toContain("动笔前必须自问");
    expect(result).toContain("大纲锚定");
  });

  // -------------------------------------------------------------------------
  // Capítulos dorados (1-3 vs 4+)
  // -------------------------------------------------------------------------

  describe("golden chapters rules", () => {
    it("includes golden chapter rules for chapter 1", () => {
      const result = buildPrompt({ chapterNumber: 1 });
      expect(result).toContain("黄金三章特殊指令（当前第1章）");
      expect(result).toContain("第一章：抛出核心冲突");
      expect(result).toContain("开篇直接进入冲突场景");
    });

    it("includes golden chapter rules for chapter 2", () => {
      const result = buildPrompt({ chapterNumber: 2 });
      expect(result).toContain("当前第2章");
      expect(result).toContain("第二章：展现金手指");
    });

    it("includes golden chapter rules for chapter 3", () => {
      const result = buildPrompt({ chapterNumber: 3 });
      expect(result).toContain("当前第3章");
      expect(result).toContain("第三章：明确短期目标");
    });

    it("omits golden chapter rules for chapter 4+", () => {
      const result = buildPrompt({ chapterNumber: 4 });
      expect(result).not.toContain("黄金三章特殊指令");
    });

    it("omits golden chapter rules when chapterNumber is undefined", () => {
      const result = buildPrompt({ chapterNumber: undefined });
      expect(result).not.toContain("黄金三章特殊指令");
    });
  });

  // -------------------------------------------------------------------------
  // Condicional por numericalSystem
  // -------------------------------------------------------------------------

  describe("numerical system conditional", () => {
    it("includes resource checklist item when numericalSystem is true", () => {
      const result = buildPrompt({ gp: { numericalSystem: true } });
      expect(result).toContain("资源、数值增量");
    });

    it("omits resource checklist item when numericalSystem is false", () => {
      const result = buildPrompt({ gp: minimalGenreProfile });
      expect(result).not.toContain("资源、数值增量");
    });

    it("includes resource row in output format when numericalSystem is true", () => {
      const result = buildPrompt({ gp: { numericalSystem: true }, mode: "full" });
      expect(result).toContain("当前资源总量");
      expect(result).toContain("UPDATED_LEDGER");
    });

    it("omits resource row and UPDATED_LEDGER when numericalSystem is false", () => {
      const result = buildPrompt({ gp: minimalGenreProfile, mode: "full" });
      expect(result).not.toContain("当前资源总量");
      expect(result).not.toContain("UPDATED_LEDGER");
    });
  });

  // -------------------------------------------------------------------------
  // powerScaling condicional
  // -------------------------------------------------------------------------

  describe("power scaling conditional", () => {
    it("includes 战力崩坏 in risk scan when powerScaling is true", () => {
      const result = buildPrompt({ gp: { powerScaling: true } });
      expect(result).toContain("战力崩坏");
    });

    it("omits 战力崩坏 from risk scan when powerScaling is false", () => {
      const result = buildPrompt({ gp: { powerScaling: false } });
      expect(result).not.toContain("战力崩坏");
    });
  });

  // -------------------------------------------------------------------------
  // Genre rules: fatigue words, pacing, chapter types
  // -------------------------------------------------------------------------

  describe("genre rules", () => {
    it("includes fatigue words when present", () => {
      const result = buildPrompt({ gp: { fatigueWords: ["仿佛", "宛如"] } });
      expect(result).toContain("仿佛");
      expect(result).toContain("宛如");
      expect(result).toContain("高疲劳词");
    });

    it("omits fatigue line when fatigueWords is empty", () => {
      const result = buildPrompt({ gp: { fatigueWords: [] } });
      expect(result).not.toContain("高疲劳词");
    });

    it("includes pacing rule when present", () => {
      const result = buildPrompt({ gp: { pacingRule: "每3章一个爽点" } });
      expect(result).toContain("每3章一个爽点");
    });

    it("includes chapter types when present", () => {
      const result = buildPrompt({ gp: { chapterTypes: ["过渡", "高潮"] } });
      expect(result).toContain("判断本章类型");
      expect(result).toContain("过渡");
    });

    it("includes genre body in output", () => {
      const result = buildPrompt({ genreBody: "## 玄幻特殊设定\n\n修仙体系..." });
      expect(result).toContain("玄幻特殊设定");
    });
  });

  // -------------------------------------------------------------------------
  // Book rules (protagonist, prohibitions, genreLock)
  // -------------------------------------------------------------------------

  describe("book rules", () => {
    it("includes protagonist rules when bookRules provided", () => {
      const result = buildPrompt({ bookRules: baseBookRules });
      expect(result).toContain("主角铁律（张三）");
      expect(result).toContain("冷静");
      expect(result).toContain("果断");
    });

    it("includes behavioral constraints", () => {
      const result = buildPrompt({ bookRules: baseBookRules });
      expect(result).toContain("不杀无辜");
      expect(result).toContain("不背叛盟友");
    });

    it("includes prohibitions", () => {
      const result = buildPrompt({ bookRules: baseBookRules });
      expect(result).toContain("本书禁忌");
      expect(result).toContain("不写感情线");
    });

    it("includes genreLock forbidden items", () => {
      const result = buildPrompt({ bookRules: baseBookRules });
      expect(result).toContain("风格禁区");
      expect(result).toContain("穿越");
      expect(result).toContain("重生");
    });

    it("omits protagonist rules when bookRules is null", () => {
      const result = buildPrompt({ bookRules: null });
      expect(result).not.toContain("主角铁律");
    });

    it("includes book rules body when provided", () => {
      const result = buildPrompt({ bookRulesBody: "主角禁止使用火系法术" });
      expect(result).toContain("本书专属规则");
      expect(result).toContain("主角禁止使用火系法术");
    });

    it("omits book rules body when empty", () => {
      const result = buildPrompt({ bookRulesBody: "" });
      expect(result).not.toContain("本书专属规则");
    });
  });

  // -------------------------------------------------------------------------
  // Full cast tracking
  // -------------------------------------------------------------------------

  describe("full cast tracking", () => {
    it("includes full cast tracking when enabled", () => {
      const rules = { ...baseBookRules, enableFullCastTracking: true };
      const result = buildPrompt({ bookRules: rules });
      expect(result).toContain("全员追踪");
    });

    it("omits full cast tracking when disabled", () => {
      const rules = { ...baseBookRules, enableFullCastTracking: false };
      const result = buildPrompt({ bookRules: rules });
      expect(result).not.toContain("全员追踪");
    });
  });

  // -------------------------------------------------------------------------
  // Style guide & fingerprint
  // -------------------------------------------------------------------------

  describe("style guide", () => {
    it("includes style guide when provided", () => {
      const result = buildPrompt({ styleGuide: "用短句为主，口语化表达" });
      expect(result).toContain("文风指南");
      expect(result).toContain("口语化表达");
    });

    it("omits style guide when empty", () => {
      const result = buildPrompt({ styleGuide: "" });
      expect(result).not.toContain("文风指南");
    });

    it("omits style guide when placeholder", () => {
      const result = buildPrompt({ styleGuide: "(文件尚未创建)" });
      expect(result).not.toContain("文风指南");
    });
  });

  describe("style fingerprint", () => {
    it("includes style fingerprint when provided", () => {
      const result = buildPrompt({ styleFingerprint: "平均句长12字，对话占比40%" });
      expect(result).toContain("文风指纹（模仿目标）");
      expect(result).toContain("平均句长12字");
    });

    it("omits style fingerprint when undefined", () => {
      const result = buildPrompt({ styleFingerprint: undefined });
      expect(result).not.toContain("文风指纹");
    });
  });

  // -------------------------------------------------------------------------
  // Output format: full vs creative mode
  // -------------------------------------------------------------------------

  describe("output format modes", () => {
    it("full mode includes POST_SETTLEMENT and state update blocks", () => {
      const result = buildPrompt({ mode: "full" });
      expect(result).toContain("POST_SETTLEMENT");
      expect(result).toContain("UPDATED_STATE");
      expect(result).toContain("UPDATED_HOOKS");
      expect(result).toContain("CHAPTER_SUMMARY");
      expect(result).toContain("UPDATED_SUBPLOTS");
      expect(result).toContain("UPDATED_EMOTIONAL_ARCS");
      expect(result).toContain("UPDATED_CHARACTER_MATRIX");
    });

    it("creative mode omits settlement and state blocks", () => {
      const result = buildPrompt({ mode: "creative" });
      // Usar delimitadores exactos porque "POST_SETTLEMENT" aparece también en buildCoreRules
      expect(result).not.toContain("=== POST_SETTLEMENT ===");
      expect(result).not.toContain("=== UPDATED_STATE ===");
      expect(result).not.toContain("=== UPDATED_HOOKS ===");
      expect(result).toContain("PRE_WRITE_CHECK");
      expect(result).toContain("CHAPTER_TITLE");
      expect(result).toContain("CHAPTER_CONTENT");
    });

    it("creative mode includes notice about no settlement output", () => {
      const result = buildPrompt({ mode: "creative" });
      expect(result).toContain("只需输出以上三个区块");
    });

    it("full mode includes chapter word count in output format", () => {
      const result = buildPrompt({ book: { chapterWordCount: 4000 }, mode: "full" });
      expect(result).toContain("4000字左右");
    });
  });

  // -------------------------------------------------------------------------
  // Integración completa: prompt no está vacío y las secciones se unen
  // -------------------------------------------------------------------------

  it("returns a non-empty string with all major sections joined", () => {
    const result = buildPrompt({
      bookRules: baseBookRules,
      bookRulesBody: "额外规则",
      genreBody: "题材规范",
      styleGuide: "文风",
      styleFingerprint: "指纹",
      chapterNumber: 1,
      mode: "full",
    });

    // Verifica que todas las secciones principales están presentes
    const expectedSections = [
      "核心规则",
      "去AI味",
      "六步走",
      "配角设计",
      "读者心理学",
      "情感节点",
      "代入感技法",
      "黄金三章",
      "题材规范",
      "主角铁律",
      "本书专属规则",
      "文风指南",
      "文风指纹",
      "动笔前必须自问",
      "输出格式",
    ];

    for (const section of expectedSections) {
      expect(result).toContain(section);
    }
  });

  it("uses double newline as section separator", () => {
    const result = buildPrompt();
    // Debe contener secciones separadas por doble salto de línea
    expect(result).toContain("\n\n");
    // No debe empezar con líneas vacías
    expect(result.startsWith("\n")).toBe(false);
  });
});
