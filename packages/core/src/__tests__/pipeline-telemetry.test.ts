import { describe, it, expect, vi } from "vitest";
import {
  PipelineTelemetry,
  aggregateAgentCosts,
  analyzeDimensionTrends,
  analyzeContextBudgetTrends,
  type ChapterTelemetry,
} from "../pipeline/pipeline-telemetry.js";
import { createLogger, nullSink } from "../utils/logger.js";

function makeLogger() {
  return createLogger({ tag: "test", sinks: [nullSink] });
}

describe("PipelineTelemetry", () => {
  it("should record agent tokens and emit finalize summary", () => {
    const log = makeLogger();
    const tel = new PipelineTelemetry(log, "book1", 3);

    tel.recordAgentTokens("writer", { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 });
    tel.recordAgentTokens("auditor", { promptTokens: 800, completionTokens: 200, totalTokens: 1000 });

    const result = tel.finalize();
    expect(result.bookId).toBe("book1");
    expect(result.chapterNumber).toBe(3);
    expect(result.agentTokens).toHaveLength(2);
    expect(result.agentTokens[0]!.agent).toBe("writer");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("should skip undefined usage without error", () => {
    const log = makeLogger();
    const tel = new PipelineTelemetry(log, "book1", 1);
    tel.recordAgentTokens("writer", undefined);
    const result = tel.finalize();
    expect(result.agentTokens).toHaveLength(0);
  });

  it("should record context budget decisions", () => {
    const log = makeLogger();
    const tel = new PipelineTelemetry(log, "book1", 1);

    tel.recordContextBudget(
      {
        blocks: { story_bible: "...", pending_hooks: "..." },
        decisions: [
          { name: "story_bible", priority: 1, selectedLevel: 0, estimatedTokens: 5000, dropped: false },
          { name: "dialogue_fingerprints", priority: 3, selectedLevel: 1, estimatedTokens: 200, dropped: false },
          { name: "style_fingerprint", priority: 3, selectedLevel: 2, estimatedTokens: 0, dropped: true },
        ],
        totalTokens: 5200,
      },
      100000,
    );

    const result = tel.finalize();
    expect(result.contextBudget).toBeDefined();
    expect(result.contextBudget!.blocksIncluded).toBe(2);
    expect(result.contextBudget!.blocksDropped).toBe(1);
    expect(result.contextBudget!.blocksDegraded).toBe(1);
    expect(result.contextBudget!.degradedBlocks).toHaveLength(2);
  });

  it("should record audit dimensions and aggregate by category", () => {
    const log = makeLogger();
    const tel = new PipelineTelemetry(log, "book1", 1);

    tel.recordAuditDimensions([
      { severity: "critical", category: "OOC检查" },
      { severity: "warning", category: "词汇疲劳" },
      { severity: "warning", category: "OOC检查" },
    ]);

    const result = tel.finalize();
    expect(result.auditDimensions).toHaveLength(2);
    const ooc = result.auditDimensions!.find((d) => d.dimension === "OOC检查");
    expect(ooc!.count).toBe(2);
    expect(ooc!.severity).toBe("critical");
  });

  it("should record revision route and detection", () => {
    const log = makeLogger();
    const tel = new PipelineTelemetry(log, "book1", 1);

    tel.recordRevisionRoute("light");
    tel.recordDetection(0.7, false, 2);

    const result = tel.finalize();
    expect(result.revisionRoute).toBe("light");
    expect(result.detection?.score).toBe(0.7);
    expect(result.detection?.rewriteAttempts).toBe(2);
  });
});

describe("aggregateAgentCosts", () => {
  it("should aggregate costs across chapters", () => {
    const records: ChapterTelemetry[] = [
      {
        bookId: "b1", chapterNumber: 1, timestamp: "", durationMs: 100,
        agentTokens: [
          { agent: "writer", promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
          { agent: "auditor", promptTokens: 800, completionTokens: 200, totalTokens: 1000 },
        ],
      },
      {
        bookId: "b1", chapterNumber: 2, timestamp: "", durationMs: 100,
        agentTokens: [
          { agent: "writer", promptTokens: 1200, completionTokens: 600, totalTokens: 1800 },
          { agent: "reviser", promptTokens: 500, completionTokens: 300, totalTokens: 800 },
        ],
      },
    ];

    const result = aggregateAgentCosts(records);
    expect(result).toHaveLength(3);
    expect(result[0]!.agent).toBe("writer");
    expect(result[0]!.totalTokens).toBe(3300);
    expect(result[0]!.percentage).toBeGreaterThan(0);
  });
});

describe("analyzeDimensionTrends", () => {
  it("should detect worsening dimensions", () => {
    const records: ChapterTelemetry[] = [];
    // 5 old chapters: no OOC issues
    for (let i = 1; i <= 5; i++) {
      records.push({
        bookId: "b1", chapterNumber: i, timestamp: "", durationMs: 100,
        agentTokens: [],
        auditDimensions: [],
      });
    }
    // 5 recent chapters: OOC in every one
    for (let i = 6; i <= 10; i++) {
      records.push({
        bookId: "b1", chapterNumber: i, timestamp: "", durationMs: 100,
        agentTokens: [],
        auditDimensions: [{ dimension: "OOC检查", severity: "critical", count: 1 }],
      });
    }

    const result = analyzeDimensionTrends(records, 5);
    const ooc = result.find((d) => d.dimension === "OOC检查");
    expect(ooc).toBeDefined();
    expect(ooc!.trend).toBe("worsening");
  });

  it("should detect improving dimensions", () => {
    const records: ChapterTelemetry[] = [];
    // 5 old chapters: lots of issues
    for (let i = 1; i <= 5; i++) {
      records.push({
        bookId: "b1", chapterNumber: i, timestamp: "", durationMs: 100,
        agentTokens: [],
        auditDimensions: [{ dimension: "词汇疲劳", severity: "warning", count: 2 }],
      });
    }
    // 5 recent chapters: no issues
    for (let i = 6; i <= 10; i++) {
      records.push({
        bookId: "b1", chapterNumber: i, timestamp: "", durationMs: 100,
        agentTokens: [],
        auditDimensions: [],
      });
    }

    const result = analyzeDimensionTrends(records, 5);
    const fatigue = result.find((d) => d.dimension === "词汇疲劳");
    expect(fatigue).toBeDefined();
    expect(fatigue!.trend).toBe("improving");
  });
});

describe("analyzeContextBudgetTrends", () => {
  it("should aggregate budget degradation across chapters", () => {
    const records: ChapterTelemetry[] = [
      {
        bookId: "b1", chapterNumber: 1, timestamp: "", durationMs: 100,
        agentTokens: [],
        contextBudget: {
          totalTokens: 80000, budgetLimit: 100000,
          blocksIncluded: 10, blocksDegraded: 1, blocksDropped: 1,
          degradedBlocks: [
            { name: "style_fingerprint", level: 2, dropped: true },
            { name: "dialogue_fingerprints", level: 1, dropped: false },
          ],
        },
      },
      {
        bookId: "b1", chapterNumber: 2, timestamp: "", durationMs: 100,
        agentTokens: [],
        contextBudget: {
          totalTokens: 90000, budgetLimit: 100000,
          blocksIncluded: 10, blocksDegraded: 0, blocksDropped: 1,
          degradedBlocks: [
            { name: "style_fingerprint", level: 2, dropped: true },
          ],
        },
      },
    ];

    const result = analyzeContextBudgetTrends(records);
    const style = result.find((r) => r.block === "style_fingerprint");
    expect(style!.droppedCount).toBe(2);
    expect(style!.totalChapters).toBe(2);
  });
});
