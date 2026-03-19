import { describe, it, expect } from "vitest";
import {
  compressSummaries,
  buildSlidingWindowSummaries,
} from "../utils/summary-compressor.js";

// === Helper: construye una tabla de resúmenes de prueba ===

function buildTestSummaries(chapterCount: number): string {
  const header = [
    "# 章节摘要",
    "",
    "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
    "|------|------|----------|----------|----------|----------|----------|----------|",
  ];

  const rows = Array.from({ length: chapterCount }, (_, i) => {
    const n = i + 1;
    return `| ${n} | 第${n}章标题 | 角色A、角色B | 事件${n}发生 | 状态变化${n} | H0${n}埋设 | 紧张 | 冲突 |`;
  });

  return [...header, ...rows].join("\n");
}

// === compressSummaries ===

describe("compressSummaries", () => {
  it("returns unchanged when chapters <= windowSize", () => {
    const input = buildTestSummaries(15);
    const result = compressSummaries(input, 20);

    expect(result.stats.totalRows).toBe(15);
    expect(result.stats.recentRows).toBe(15);
    expect(result.stats.compressedGroups).toBe(0);
    expect(result.compressed).toBe("");
    expect(result.recent).toBe(input);
  });

  it("compresses old chapters when > windowSize", () => {
    const input = buildTestSummaries(50);
    const result = compressSummaries(input, 20, 10);

    // 50 capítulos: 30 viejos (3 grupos de 10) + 20 recientes
    expect(result.stats.totalRows).toBe(50);
    expect(result.stats.recentRows).toBe(20);
    expect(result.stats.compressedGroups).toBe(3);

    // Los recientes deben contener los capítulos 31-50
    expect(result.recent).toContain("| 31 |");
    expect(result.recent).toContain("| 50 |");
    // Los recientes NO deben contener capítulos viejos
    expect(result.recent).not.toContain("| 1 |");
    expect(result.recent).not.toContain("| 30 |");

    // La sección comprimida debe contener rangos de etapa
    expect(result.compressed).toContain("第1-10章");
    expect(result.compressed).toContain("第11-20章");
    expect(result.compressed).toContain("第21-30章");
  });

  it("handles empty input", () => {
    const result = compressSummaries("");
    expect(result.recent).toBe("");
    expect(result.compressed).toBe("");
    expect(result.stats.totalRows).toBe(0);
  });

  it("handles '(文件尚未创建)' marker", () => {
    const result = compressSummaries("(文件尚未创建)");
    expect(result.recent).toBe("");
    expect(result.compressed).toBe("");
  });

  it("preserves table header in recent section", () => {
    const input = buildTestSummaries(30);
    const result = compressSummaries(input, 20, 10);

    expect(result.recent).toContain("章节");
    expect(result.recent).toContain("|---");
  });

  it("extracts characters and events in compressed groups", () => {
    const input = buildTestSummaries(30);
    const result = compressSummaries(input, 20, 10);

    // Los grupos comprimidos deben incluir personajes y eventos
    expect(result.compressed).toContain("角色A");
    expect(result.compressed).toContain("事件");
  });

  it("handles exactly windowSize chapters", () => {
    const input = buildTestSummaries(20);
    const result = compressSummaries(input, 20);

    expect(result.stats.recentRows).toBe(20);
    expect(result.stats.compressedGroups).toBe(0);
  });

  it("handles 100 chapters correctly", () => {
    const input = buildTestSummaries(100);
    const result = compressSummaries(input, 20, 10);

    expect(result.stats.totalRows).toBe(100);
    expect(result.stats.recentRows).toBe(20);
    // 80 capítulos viejos / 10 por grupo = 8 grupos
    expect(result.stats.compressedGroups).toBe(8);
  });
});

// === buildSlidingWindowSummaries ===

describe("buildSlidingWindowSummaries", () => {
  it("returns empty for empty input", () => {
    expect(buildSlidingWindowSummaries("")).toBe("");
  });

  it("returns combined compressed + recent for large input", () => {
    const input = buildTestSummaries(40);
    const output = buildSlidingWindowSummaries(input, 20);

    // Debe contener tanto la historia comprimida como los recientes
    expect(output).toContain("历史阶段概述");
    expect(output).toContain("| 21 |");
  });

  it("returns just the table for small input", () => {
    const input = buildTestSummaries(10);
    const output = buildSlidingWindowSummaries(input, 20);

    // Sin compresión, devuelve la tabla completa
    expect(output).toBe(input);
  });
});
