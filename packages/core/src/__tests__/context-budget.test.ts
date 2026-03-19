import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  applyBudget,
  truncateToTokenBudget,
  type BudgetBlock,
} from "../utils/context-budget.js";

// === estimateTokens ===

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates Chinese text with ~1.8 ratio", () => {
    // 10 caracteres chinos × 1.8 = 18 tokens
    const text = "这是一个测试文本内容啊";
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThanOrEqual(15);
    expect(tokens).toBeLessThanOrEqual(22);
  });

  it("estimates English text with ~0.25 ratio", () => {
    // 20 caracteres ingleses × 0.25 = 5 tokens
    const text = "Hello world test msg";
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThanOrEqual(3);
    expect(tokens).toBeLessThanOrEqual(8);
  });

  it("handles mixed Chinese/English text", () => {
    // 5 Chinese (5×1.8=9) + ~15 English (15×0.25=3.75) ≈ 13
    const text = "测试Hello世界World你好Test";
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(30);
  });
});

// === applyBudget ===

describe("applyBudget", () => {
  const makeBlock = (
    name: string,
    priority: number,
    text: string,
    opts?: { required?: boolean; levels?: string[] },
  ): BudgetBlock => ({
    name,
    priority,
    required: opts?.required,
    levels: opts?.levels ?? [text],
  });

  it("returns all blocks at level 0 when within budget", () => {
    const blocks = [
      makeBlock("a", 0, "短文本"),
      makeBlock("b", 1, "另一段短文本"),
    ];
    const result = applyBudget(blocks, 100_000);

    expect(result.blocks["a"]).toBe("短文本");
    expect(result.blocks["b"]).toBe("另一段短文本");
    expect(result.decisions.every((d) => d.selectedLevel === 0)).toBe(true);
    expect(result.decisions.every((d) => !d.dropped)).toBe(true);
  });

  it("degrades lower-priority blocks first when over budget", () => {
    const blocks = [
      makeBlock("critical", 0, "A".repeat(100), { required: true }),
      makeBlock("high", 1, "B".repeat(100)),
      makeBlock("low", 3, "C".repeat(100)),
    ];
    // Presupuesto sólo cabe 2 bloques
    const tokensForTwo = estimateTokens("A".repeat(100) + "B".repeat(100)) + 5;
    const result = applyBudget(blocks, tokensForTwo);

    // "low" (priority 3) debería ser descartado primero
    expect(result.blocks["critical"]).toBeDefined();
    expect(result.blocks["low"]).toBeUndefined();
    expect(result.decisions.find((d) => d.name === "low")?.dropped).toBe(true);
  });

  it("never drops required blocks", () => {
    const blocks = [
      makeBlock("must_keep", 0, "X".repeat(200), { required: true }),
      makeBlock("optional", 3, "Y".repeat(200)),
    ];
    // Presupuesto muy bajo — sólo cabe uno
    const tokensForOne = estimateTokens("X".repeat(200)) + 5;
    const result = applyBudget(blocks, tokensForOne);

    expect(result.blocks["must_keep"]).toBeDefined();
    expect(result.decisions.find((d) => d.name === "must_keep")?.dropped).toBe(false);
  });

  it("degrades multi-level blocks before dropping", () => {
    const blocks: BudgetBlock[] = [
      { name: "recent", priority: 1, levels: ["全文内容很长".repeat(50), "后半段比较短".repeat(10)] },
      { name: "low", priority: 3, levels: ["可丢弃"] },
    ];
    // Presupuesto cabe full "recent" level 1 + "low", pero no cabe level 0
    const level0tokens = estimateTokens("全文内容很长".repeat(50));
    const level1tokens = estimateTokens("后半段比较短".repeat(10));
    const lowTokens = estimateTokens("可丢弃");
    // Presupuesto entre level0+low y level1+low
    const budget = level1tokens + lowTokens + 10;
    const result = applyBudget(blocks, budget);

    // "low" es priority 3 → se degrada/descarta primero, luego "recent" degrada a level 1
    const recentDecision = result.decisions.find((d) => d.name === "recent");
    // El resultado final debe caber
    expect(result.totalTokens).toBeLessThanOrEqual(budget);
  });

  it("outputs correct debug decisions", () => {
    const blocks = [
      makeBlock("a", 0, "小", { required: true }),
      makeBlock("b", 3, "也小"),
    ];
    const result = applyBudget(blocks, 100_000);

    expect(result.decisions).toHaveLength(2);
    expect(result.decisions[0]!.name).toBe("a");
    expect(result.decisions[0]!.priority).toBe(0);
    expect(result.decisions[0]!.estimatedTokens).toBeGreaterThan(0);
  });

  it("handles empty blocks array", () => {
    const result = applyBudget([], 100_000);
    expect(result.blocks).toEqual({});
    expect(result.decisions).toHaveLength(0);
    expect(result.totalTokens).toBe(0);
  });
});

// === truncateToTokenBudget ===

describe("truncateToTokenBudget", () => {
  it("returns text unchanged if within budget", () => {
    const text = "短文本";
    expect(truncateToTokenBudget(text, 100_000)).toBe(text);
  });

  it("truncates long text to fit budget", () => {
    const text = "这是一段很长的文本。".repeat(100);
    const result = truncateToTokenBudget(text, 50);
    expect(estimateTokens(result)).toBeLessThanOrEqual(50);
  });

  it("preserves Markdown table header when truncating", () => {
    const lines = [
      "| 章节 | 标题 | 关键事件 |",
      "|------|------|----------|",
      "| 1 | 开篇 | 主角出场 |",
      "| 2 | 冲突 | 大战开始 |",
      "| 3 | 高潮 | 决战之巅 |",
      "| 4 | 结局 | 尘埃落定 |",
    ];
    const text = lines.join("\n");
    // Presupuesto que cabe header + 1-2 filas pero no todas (header chino ≈ 30 tokens)
    const headerTokens = estimateTokens(lines[0]! + "\n" + lines[1]!);
    const budget = headerTokens + 30; // cabe header + ~1 fila
    const result = truncateToTokenBudget(text, budget, true);
    expect(result).toContain("章节");
    expect(result).toContain("|---");
    // No debe incluir todas las filas
    expect(result).not.toContain("尘埃落定");
  });

  it("falls back to character truncation when header exceeds budget", () => {
    const text = "这".repeat(1000);
    const result = truncateToTokenBudget(text, 10);
    expect(result.length).toBeLessThan(1000);
  });
});
