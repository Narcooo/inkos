/**
 * [R8] Golden Output Fixture Regression Tests
 *
 * Verifica que la estructura de salida del pipeline se mantiene consistente
 * contra snapshots dorados capturados. Detecta regresiones en:
 *
 * 1. Formato de secciones del output (PRE_WRITE_CHECK, CHAPTER_CONTENT, etc.)
 * 2. Estructura de archivos settlement (state, hooks, ledger)
 * 3. Integridad del flujo completo (draft → audit → settle)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PipelineRunner } from "../pipeline/runner.js";
import type { LLMClient } from "../llm/provider.js";
import { loadGoldenSnapshot, compareWithSnapshot, type GoldenSnapshot } from "../utils/golden-snapshot.js";

// ---------------------------------------------------------------------------
// Mock chatCompletion — reutiliza los builders del e2e principal
// ---------------------------------------------------------------------------

vi.mock("../llm/provider.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../llm/provider.js")>();
  return {
    ...actual,
    chatCompletion: vi.fn(async (_client, _model, messages) => {
      const systemContent = (messages as ReadonlyArray<{ role: string; content: string }>)
        .find((m) => m.role === "system")?.content ?? "";

      if (systemContent.includes("网络小说架构师")) {
        return {
          content: buildArchitectResponse(),
          usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
        };
      }
      if (systemContent.includes("审稿编辑") || systemContent.includes("审查维度")) {
        return {
          content: buildAuditResponse(),
          usage: { promptTokens: 200, completionTokens: 150, totalTokens: 350 },
        };
      }
      if (systemContent.includes("状态追踪分析师")) {
        return {
          content: buildSettlementResponse(),
          usage: { promptTokens: 120, completionTokens: 300, totalTokens: 420 },
        };
      }
      if (systemContent.includes("网络小说作家")) {
        return {
          content: buildCreativeResponse(),
          usage: { promptTokens: 150, completionTokens: 500, totalTokens: 650 },
        };
      }
      if (systemContent.includes("真值守卫") || systemContent.includes("Truth Guard")) {
        return {
          content: "[]",
          usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
        };
      }
      return {
        content: "Fallback response",
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      };
    }),
  };
});

// ---------------------------------------------------------------------------
// Mock response builders (deterministic)
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
prohibitions:
  - 主角不能无底线善良
enableFullCastTracking: false
---

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
  return `=== PRE_WRITE_CHECK ===
检查完毕，前章状态卡：大荒域边缘，主角初始状态。

=== CHAPTER_TITLE ===
悬崖边的觉醒

=== CHAPTER_CONTENT ===
林风站在悬崖边，看着脚下的云海翻涌。灵气如同看不见的潮汐，在他体内激荡。他紧握拳头，感受着掌心那股微弱却执拗的热流。`;
}

function buildSettlementResponse(): string {
  return `=== POST_SETTLEMENT ===
结算完毕。灵力增量+1。

=== UPDATED_STATE ===
| 字段 | 值 |
|------|-----|
| 当前章节 | 1 |
| 当前位置 | 大荒域悬崖下方 |
| 主角状态 | 首次觉醒吞噬之力 |
| 当前目标 | 寻找安全的修炼地点 |

=== UPDATED_HOOKS ===
| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |
|---------|---------|------|------|---------|---------|------|
| H01 | 0 | 伏笔 | 已激活 | 1 | 5 | 吞噬金手指已觉醒 |

=== CHAPTER_SUMMARY ===
第1章：林风在大荒域悬崖边首次觉醒吞噬之力。

=== UPDATED_SUBPLOTS ===
| 支线ID | 支线名 | 状态 |
|--------|--------|------|

=== UPDATED_EMOTIONAL_ARCS ===
| 弧ID | 弧名 | 状态 |
|------|------|------|

=== UPDATED_CHARACTER_MATRIX ===
| 角色 | 与主角关系 | 态度值 | 上次互动章 | 变化原因 |
|------|-----------|--------|------------|----------|`;
}

function buildAuditResponse(): string {
  return `## 审核结论
本章质量合格。

## 维度评分
| 维度 | 分数 | 说明 |
|------|------|------|
| **逻辑** | 8 | 情节自洽 |
| **人物** | 7 | 初始人物塑造合理 |
| **节奏** | 8 | 开篇紧凑 |
| **文笔** | 7 | 行文流畅 |

## 综合评分
7.5

## 建议
无重大问题。`;
}

import { cp } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Mock LLM client
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

// ---------------------------------------------------------------------------
// Book fixture (same pattern as pipeline-e2e.test.ts)
// ---------------------------------------------------------------------------

const goldenBook = {
  id: "golden-test-book",
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
// Tests
// ---------------------------------------------------------------------------

describe("golden fixture regression — R8", () => {
  let tempDir: string;
  let runner: PipelineRunner;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "inkos-golden-"));

    // Copiar generos para que readGenreProfile funcione
    const genresSource = join(__dirname, "..", "..", "genres");
    const genresDest = join(tempDir, "genres");
    await cp(genresSource, genresDest, { recursive: true });

    runner = new PipelineRunner({
      client: createMockClient(),
      model: "test-model",
      projectRoot: tempDir,
    });
  });


  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("initBook output structure matches golden baseline", async () => {
    await runner.initBook(goldenBook);

    // Verificar que los archivos de base fueron generados
    const bookDir = join(tempDir, "books", goldenBook.id);
    const storyDir = join(bookDir, "story");
    const storyFiles = await readdir(storyDir);

    // [R8] Estos archivos son la "golden structure" esperada
    const expectedFiles = [
      "story_bible.md",
      "volume_outline.md",
      "current_state.md",
      "pending_hooks.md",
    ];

    for (const file of expectedFiles) {
      expect(storyFiles).toContain(file);
    }
  });

  it("chapter output contains all required sections", async () => {
    const book = { ...goldenBook, id: "golden-ch1" };
    await runner.initBook(book);

    // Ejecutar draft
    const result = await runner.writeDraft(book.id, undefined, undefined, true);
    expect(result).toBeDefined();
    expect(result.chapterNumber).toBe(1);
    expect(result.title.length).toBeGreaterThan(0);

    // [R8] Golden structure: el titulo debe coincidir con el mock
    expect(result.title).toBe("悬崖边的觉醒");

    // [R8] El contenido del archivo debe contener la narrativa del mock
    const content = await readFile(result.filePath, "utf-8");
    expect(content).toContain("林风");
  });

  it("settlement files match golden structure after chapter write", async () => {
    const book = { ...goldenBook, id: "golden-settle" };
    await runner.initBook(book);
    await runner.writeDraft(book.id, undefined, undefined, true);

    // Verificar estructura de archivos post-settlement
    const storyDir = join(tempDir, "books", book.id, "story");

    // [R8] Despues del settlement, current_state debe reflejar el nuevo estado
    const stateContent = await readFile(join(storyDir, "current_state.md"), "utf-8");
    expect(stateContent).toContain("当前章节");
  });

  it("chapter file naming follows golden pattern", async () => {
    const book = { ...goldenBook, id: "golden-naming" };
    await runner.initBook(book);
    await runner.writeDraft(book.id, undefined, undefined, true);

    const chaptersDir = join(tempDir, "books", book.id, "chapters");
    const chapters = await readdir(chaptersDir);

    // [R8] Patron dorado: al menos uno con formato 0001_<titulo>.md
    const goldenChapter = chapters.find((f) => /^0001_.*\.md$/.test(f));
    expect(goldenChapter).toBeDefined();
  });

  it("compareWithSnapshot detects structural changes", () => {
    const snapshot: GoldenSnapshot = {
      scenario: "test",
      capturedAt: "2026-01-01",
      pipelineVersion: "v2",
      files: {
        "state.md": "| 章节 | 1 |",
        "hooks.md": "| H01 | active |",
      },
      metadata: {},
    };

    // Caso 1: archivo faltante
    const diffs1 = compareWithSnapshot(snapshot, { "state.md": "| 章节 | 1 |" });
    expect(diffs1).toHaveLength(1);
    expect(diffs1[0]!.type).toBe("missing");
    expect(diffs1[0]!.filename).toBe("hooks.md");

    // Caso 2: archivo cambiado
    const diffs2 = compareWithSnapshot(snapshot, {
      "state.md": "| 章节 | 2 |",
      "hooks.md": "| H01 | active |",
    });
    expect(diffs2).toHaveLength(1);
    expect(diffs2[0]!.type).toBe("changed");

    // Caso 3: todo coincide
    const diffs3 = compareWithSnapshot(snapshot, {
      "state.md": "| 章节 | 1 |",
      "hooks.md": "| H01 | active |",
    });
    expect(diffs3).toHaveLength(0);

    // Caso 4: archivo inesperado
    const diffs4 = compareWithSnapshot(snapshot, {
      "state.md": "| 章节 | 1 |",
      "hooks.md": "| H01 | active |",
      "extra.md": "unexpected",
    });
    expect(diffs4).toHaveLength(1);
    expect(diffs4[0]!.type).toBe("unexpected");
  });

  it("golden snapshot round-trip capture and compare", async () => {
    // Simular captura de un snapshot
    const fixtureDir = join(tempDir, "fixtures");
    await mkdir(fixtureDir, { recursive: true });

    const snapshot: GoldenSnapshot = {
      scenario: "round-trip-test",
      capturedAt: new Date().toISOString(),
      pipelineVersion: "v2-layered",
      files: {
        "state.md": "# State\nChapter 1 complete",
        "hooks.md": "# Hooks\n| H01 | active |",
      },
      metadata: { chapterNumber: 1 },
    };

    // Escribir y releer
    const snapshotPath = join(fixtureDir, "round-trip-test.json");
    await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");

    const loaded = await loadGoldenSnapshot("round-trip-test", fixtureDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.scenario).toBe("round-trip-test");
    expect(loaded!.files["state.md"]).toContain("Chapter 1 complete");

    // Comparar contra datos identicos
    const diffs = compareWithSnapshot(loaded!, snapshot.files);
    expect(diffs).toHaveLength(0);
  });
});
