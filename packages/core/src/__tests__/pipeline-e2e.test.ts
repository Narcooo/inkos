/**
 * E2E integration test for the full PipelineRunner flow.
 *
 * Mocks `chatCompletion` (the single LLM bottleneck) and exercises
 * the real filesystem, state management, parsing, and validation layers.
 *
 * Flow tested: initBook → writeDraft → auditDraft → getBookStatus
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PipelineRunner } from "../pipeline/runner.js";
import type { LLMClient } from "../llm/provider.js";

// ---------------------------------------------------------------------------
// Mock chatCompletion — all agents funnel through this single function
// ---------------------------------------------------------------------------

let chatCallCount = 0;
let chatCallLog: Array<{ messages: ReadonlyArray<{ role: string; content: string }> }> = [];

vi.mock("../llm/provider.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../llm/provider.js")>();
  return {
    ...actual,
    chatCompletion: vi.fn(async (_client, _model, messages) => {
      chatCallCount++;
      chatCallLog.push({ messages: messages as ReadonlyArray<{ role: string; content: string }> });
      const systemContent = (messages as ReadonlyArray<{ role: string; content: string }>)
        .find((m) => m.role === "system")?.content ?? "";

      // ── Architect: génesis de fundación ──
      if (systemContent.includes("网络小说架构师")) {
        return {
          content: buildArchitectResponse(),
          usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
        };
      }

      // ── Auditor (checked before writer to avoid substring collision) ──
      if (systemContent.includes("审稿编辑") || systemContent.includes("审查维度")) {
        return {
          content: buildAuditResponse(true),
          usage: { promptTokens: 200, completionTokens: 150, totalTokens: 350 },
        };
      }

      // ── Writer Phase 2: settlement (状态追踪分析师) ──
      if (systemContent.includes("状态追踪分析师")) {
        return {
          content: buildSettlementResponse(),
          usage: { promptTokens: 120, completionTokens: 300, totalTokens: 420 },
        };
      }

      // ── Writer Phase 1: creative writing (网络小说作家) ──
      if (systemContent.includes("网络小说作家")) {
        return {
          content: buildCreativeResponse(),
          usage: { promptTokens: 150, completionTokens: 500, totalTokens: 650 },
        };
      }

      // Fallback — return minimal valid response
      return {
        content: "Fallback response",
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      };
    }),
  };
});

// ---------------------------------------------------------------------------
// Mock response builders
// ---------------------------------------------------------------------------

function buildArchitectResponse(): string {
  return `=== SECTION: story_bible ===
## 01_世界观
灵气复苏的异世界大陆，分五大宗门。

## 02_主角
林风，散修出身，觉醒吞噬金手指，性格果断狠辣。

## 03_势力与人物
五大宗门：天剑宗、炎火宗、寒冰谷、万兽山、天机阁。
陈青——天剑宗天才弟子，嫉妒主角。

## 04_地理与环境
大荒域、灵山、灵石矿脉

## 05_书名与简介
《吞噬万界》
灵气复苏，一个散修少年觉醒了吞噬能力……

=== SECTION: volume_outline ===
## 第一卷 起始（第1-20章）
核心冲突：主角在宗门试炼中崛起。

=== SECTION: book_rules ===
---
version: "1.0"
protagonist:
  name: 林风
  personalityLock: [果断, 狠辣, 重义气]
  behavioralConstraints: [不心软, 利益优先, 保护同伴]
genreLock:
  primary: xuanhuan
  forbidden: [都市腔, 科幻腔]
numericalSystemOverrides:
  hardCap: 9999
  resourceTypes: [灵力, 体力, 金手指能量]
prohibitions:
  - 主角不能无底线善良
  - 不能跳过数值结算
chapterTypesOverride: []
fatigueWordsOverride: []
additionalAuditDimensions: []
enableFullCastTracking: false
---

## 叙事视角
第三人称主视角，紧贴主角。

## 核心冲突驱动
以吞噬进化为核心驱动。

=== SECTION: current_state ===
| 字段 | 值 |
|------|-----|
| 当前章节 | 0 |
| 当前位置 | 大荒域边缘 |
| 主角状态 | 散修，灵力微弱 |
| 当前目标 | 进入宗门获取资源 |

=== SECTION: pending_hooks ===
| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |
|---------|---------|------|------|---------|---------|------|
| H01 | 0 | 伏笔 | 未激活 | 0 | 5 | 吞噬金手指的来源 |`;
}

function buildCreativeResponse(): string {
  const chapterBody = "林风站在悬崖边，看着脚下的云海翻涌。" +
    "灵气如同看不见的潮汐，在他体内激荡。" +
    "他紧握拳头，感受着掌心那股微弱却执拗的热流。" +
    "「这就是……吞噬之力？」他低声自语。" +
    "远处的大荒域一片苍茫，废墟中隐约可见断壁残垣。" +
    "一声兽吼自密林深处传来，震得落叶纷飞。" +
    "林风没有退缩。他知道，退路早就断了。" +
    "散修没有宗门庇护，想活下去，就得比野兽更凶狠。" +
    "他跃下悬崖，在坠落的瞬间，掌心的热流猛地扩散——" +
    "一阵金光闪过，虚空中似有什么东西被他攫取了。";

  return `=== PRE_WRITE_CHECK ===
检查完毕，前章状态卡：大荒域边缘，主角初始状态，无前章冲突遗留。

=== CHAPTER_TITLE ===
悬崖边的觉醒

=== CHAPTER_CONTENT ===
${chapterBody}`;
}

function buildSettlementResponse(): string {
  return `=== POST_SETTLEMENT ===
结算完毕。灵力增量+1（吞噬虚空残渣所得），无消耗。

=== UPDATED_STATE ===
| 字段 | 值 |
|------|-----|
| 当前章节 | 1 |
| 当前位置 | 大荒域悬崖下方 |
| 主角状态 | 首次觉醒吞噬之力 |
| 当前目标 | 寻找安全的修炼地点 |

=== UPDATED_LEDGER ===
| 章节 | 期初值 | 来源 | 完整度 | 增量 | 期末值 | 依据 |
|------|--------|------|--------|------|--------|------|
| 1 | 0 | 吞噬虚空残渣 | - | 1 | 1 | 首次觉醒 |

=== UPDATED_HOOKS ===
| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |
|---------|---------|------|------|---------|---------|------|
| H01 | 0 | 伏笔 | 已激活 | 1 | 5 | 吞噬金手指已觉醒 |

=== CHAPTER_SUMMARY ===
第1章：林风在大荒域悬崖边首次觉醒吞噬之力。

=== UPDATED_SUBPLOTS ===
| 支线ID | 支线名 | 相关角色 | 起始章 | 最近活跃章 | 距今章数 | 状态 | 进度概述 | 回收ETA |
|--------|--------|----------|--------|------------|----------|------|----------|---------|
| S01 | 吞噬觉醒 | 林风 | 1 | 1 | 0 | 进行中 | 刚触发 | TBD |

=== UPDATED_EMOTIONAL_ARCS ===
| 角色 | 章节 | 情绪状态 | 触发事件 | 强度(1-10) | 弧线方向 |
|------|------|----------|----------|------------|----------|
| 林风 | 1 | 决绝 | 跳崖觉醒 | 7 | 上升 |

=== UPDATED_CHARACTER_MATRIX ===
### 角色档案
| 角色 | 核心标签 | 反差细节 | 说话风格 | 性格底色 | 与主角关系 | 核心动机 | 当前目标 |
|------|----------|----------|----------|----------|------------|----------|----------|
| 林风 | 散修/吞噬 | 无背景但果断 | 简洁冷硬 | 狠辣 | 主角 | 变强 | 寻找修炼地 |`;
}

function buildAuditResponse(passed: boolean): string {
  if (passed) {
    return JSON.stringify({
      passed: true,
      issues: [
        {
          severity: "info",
          category: "节奏检查",
          description: "第一章节奏紧凑，开篇直入冲突",
          suggestion: "保持",
        },
      ],
      summary: "第1章通过审查，无critical问题。",
    });
  }
  return JSON.stringify({
    passed: false,
    issues: [
      {
        severity: "critical",
        category: "设定冲突",
        description: "主角能力获取无铺垫",
        suggestion: "增加觉醒前的暗示",
      },
    ],
    summary: "存在critical问题。",
  });
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createMockClient(): LLMClient {
  return {
    provider: "openai",
    apiFormat: "chat",
    stream: false,
    defaults: {
      temperature: 0.7,
      maxTokens: 8192,
      thinkingBudget: 0,
    },
  };
}

const testBook = {
  id: "e2e-test-book",
  title: "吞噬万界",
  platform: "tomato" as const,
  genre: "xuanhuan" as const,
  status: "active" as const,
  targetChapters: 200,
  chapterWordCount: 3000,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

// ---------------------------------------------------------------------------
// E2E Tests
// ---------------------------------------------------------------------------

describe("PipelineRunner E2E (mock LLM)", () => {
  let tempDir: string;
  let runner: PipelineRunner;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "inkos-e2e-"));

    // Copiar el directorio de géneros al tempDir para que readGenreProfile funcione
    const genresSource = join(__dirname, "..", "..", "genres");
    const genresDest = join(tempDir, "genres");
    await cp(genresSource, genresDest, { recursive: true });

    runner = new PipelineRunner({
      client: createMockClient(),
      model: "test-model",
      projectRoot: tempDir,
    });

    chatCallCount = 0;
    chatCallLog = [];
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  // =========================================================================
  // initBook
  // =========================================================================

  describe("initBook — full foundation generation", () => {
    it("creates book config plus all truth files on disk", async () => {
      await runner.initBook(testBook);

      // Verificar que el directorio del libro existe con archivos de verdad
      const bookDir = join(tempDir, "books", testBook.id);
      const storyDir = join(bookDir, "story");
      const storyFiles = await readdir(storyDir);

      expect(storyFiles).toContain("story_bible.md");
      expect(storyFiles).toContain("volume_outline.md");
      expect(storyFiles).toContain("book_rules.md");
      expect(storyFiles).toContain("current_state.md");
      expect(storyFiles).toContain("pending_hooks.md");
      expect(storyFiles).toContain("particle_ledger.md"); // xuanhuan has numericalSystem
      expect(storyFiles).toContain("subplot_board.md");
      expect(storyFiles).toContain("emotional_arcs.md");
      expect(storyFiles).toContain("character_matrix.md");
    });

    it("writes valid content to story_bible.md", async () => {
      await runner.initBook(testBook);

      const storyBible = await readFile(
        join(tempDir, "books", testBook.id, "story", "story_bible.md"),
        "utf-8",
      );
      expect(storyBible).toContain("世界观");
      expect(storyBible).toContain("林风");
    });

    it("initializes chapter index as empty", async () => {
      await runner.initBook(testBook);

      const status = await runner.getBookStatus(testBook.id);
      expect(status.chaptersWritten).toBe(0);
      expect(status.nextChapter).toBe(1);
    });

    it("calls the LLM exactly once for foundation", async () => {
      await runner.initBook(testBook);
      // Architect makes 1 LLM call
      expect(chatCallCount).toBe(1);
    });

    it("creates a snapshot for chapter 0", async () => {
      await runner.initBook(testBook);

      const snapshotDir = join(tempDir, "books", testBook.id, "story", "snapshots", "0");
      const snapshotFiles = await readdir(snapshotDir);
      expect(snapshotFiles).toContain("current_state.md");
    });
  });

  // =========================================================================
  // writeDraft
  // =========================================================================

  describe("writeDraft — single chapter generation", () => {
    beforeEach(async () => {
      await runner.initBook(testBook);
      chatCallCount = 0;
      chatCallLog = [];
    });

    it("produces a DraftResult with valid fields", async () => {
      const result = await runner.writeDraft(testBook.id);

      expect(result.chapterNumber).toBe(1);
      expect(result.title).toBe("悬崖边的觉醒");
      expect(result.wordCount).toBeGreaterThan(0);
      expect(result.filePath).toContain("0001_");
    });

    it("writes the chapter file to disk", async () => {
      const result = await runner.writeDraft(testBook.id);

      const content = await readFile(result.filePath, "utf-8");
      expect(content).toContain("# 第1章");
      expect(content).toContain("林风");
    });

    it("updates truth files on disk", async () => {
      await runner.writeDraft(testBook.id);
      const storyDir = join(tempDir, "books", testBook.id, "story");

      const state = await readFile(join(storyDir, "current_state.md"), "utf-8");
      expect(state).toContain("主角状态");

      const hooks = await readFile(join(storyDir, "pending_hooks.md"), "utf-8");
      expect(hooks).toContain("H01");
    });

    it("updates chapter index with status drafted", async () => {
      await runner.writeDraft(testBook.id);

      const status = await runner.getBookStatus(testBook.id);
      expect(status.chaptersWritten).toBe(1);
      expect(status.nextChapter).toBe(2);
      expect(status.chapters[0]!.status).toBe("drafted");
    });

    it("makes 2 LLM calls (creative + settlement)", async () => {
      await runner.writeDraft(testBook.id);
      // Writer: 1 creative + 1 settlement = 2 calls
      expect(chatCallCount).toBe(2);
    });

    it("creates a snapshot after writing", async () => {
      await runner.writeDraft(testBook.id);

      const snapshotDir = join(tempDir, "books", testBook.id, "story", "snapshots", "1");
      const snapshotFiles = await readdir(snapshotDir);
      expect(snapshotFiles).toContain("current_state.md");
    });
  });

  // =========================================================================
  // auditDraft
  // =========================================================================

  describe("auditDraft — chapter quality audit", () => {
    beforeEach(async () => {
      await runner.initBook(testBook);
      await runner.writeDraft(testBook.id);
      chatCallCount = 0;
      chatCallLog = [];
    });

    it("produces an AuditResult for the latest chapter", async () => {
      const result = await runner.auditDraft(testBook.id);

      expect(result.chapterNumber).toBe(1);
      expect(result.passed).toBe(true);
      expect(result.summary).toContain("通过");
    });

    it("includes rule-based AI-tell analysis alongside LLM audit", async () => {
      const result = await runner.auditDraft(testBook.id);

      // issues should include both LLM audit issues and AI-tell/sensitive checks
      expect(Array.isArray(result.issues)).toBe(true);
    });

    it("updates chapter status in index", async () => {
      await runner.auditDraft(testBook.id);

      const status = await runner.getBookStatus(testBook.id);
      expect(status.chapters[0]!.status).toBe("ready-for-review");
    });

    it("makes 1 LLM call for the audit", async () => {
      await runner.auditDraft(testBook.id);
      expect(chatCallCount).toBe(1);
    });
  });

  // =========================================================================
  // readTruthFiles
  // =========================================================================

  describe("readTruthFiles", () => {
    beforeEach(async () => {
      await runner.initBook(testBook);
    });

    it("returns all truth files with content", async () => {
      const files = await runner.readTruthFiles(testBook.id);

      expect(files.storyBible).toContain("世界观");
      expect(files.volumeOutline).toContain("第一卷");
      expect(files.currentState).toContain("当前章节");
      expect(files.pendingHooks).toContain("H01");
    });
  });

  // =========================================================================
  // getBookStatus
  // =========================================================================

  describe("getBookStatus", () => {
    beforeEach(async () => {
      await runner.initBook(testBook);
    });

    it("returns correct book metadata", async () => {
      const status = await runner.getBookStatus(testBook.id);

      expect(status.bookId).toBe(testBook.id);
      expect(status.title).toBe(testBook.title);
      expect(status.genre).toBe("xuanhuan");
      expect(status.platform).toBe("tomato");
    });

    it("tracks word count across chapters", async () => {
      await runner.writeDraft(testBook.id);

      const status = await runner.getBookStatus(testBook.id);
      expect(status.totalWords).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Full end-to-end flow: initBook → writeDraft → auditDraft → status
  // =========================================================================

  describe("full E2E flow", () => {
    it("completes init → write → audit → status without errors", async () => {
      // 1. Init
      await runner.initBook(testBook);
      expect((await runner.getBookStatus(testBook.id)).chaptersWritten).toBe(0);

      // 2. Write
      const draft = await runner.writeDraft(testBook.id);
      expect(draft.chapterNumber).toBe(1);
      expect(draft.title.length).toBeGreaterThan(0);

      // 3. Audit
      const audit = await runner.auditDraft(testBook.id);
      expect(audit.chapterNumber).toBe(1);
      expect(audit.passed).toBe(true);

      // 4. Status
      const status = await runner.getBookStatus(testBook.id);
      expect(status.chaptersWritten).toBe(1);
      expect(status.nextChapter).toBe(2);
      expect(status.totalWords).toBeGreaterThan(0);
      expect(status.chapters[0]!.status).toBe("ready-for-review");

      // Verify total LLM calls: 1 architect + 2 writer + 1 audit = 4
      expect(chatCallCount).toBe(4);
    });

    it("persists all files to disk correctly", async () => {
      await runner.initBook(testBook);
      await runner.writeDraft(testBook.id);

      const bookDir = join(tempDir, "books", testBook.id);

      // Book config
      const bookJson = JSON.parse(await readFile(join(bookDir, "book.json"), "utf-8"));
      expect(bookJson.id).toBe(testBook.id);

      // Chapter file exists
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const chFile = files.find((f) => f.startsWith("0001") && f.endsWith(".md"));
      expect(chFile).toBeDefined();

      // Chapter content has expected structure
      const chContent = await readFile(join(chaptersDir, chFile!), "utf-8");
      expect(chContent).toMatch(/^# 第1章/);
      expect(chContent).toContain("林风");
    });
  });
});
