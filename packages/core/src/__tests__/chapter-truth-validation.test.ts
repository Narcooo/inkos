import { describe, expect, it, vi } from "vitest";
import type { AuditIssue, AuditResult } from "../agents/continuity.js";
import type { ValidationResult } from "../agents/state-validator.js";
import type { WriteChapterOutput } from "../agents/writer.js";
import type { BookConfig } from "../models/book.js";
import { validateChapterTruthPersistence } from "../pipeline/chapter-truth-validation.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

function createAuditResult(overrides?: Partial<AuditResult>): AuditResult {
  return {
    passed: true,
    issues: [],
    summary: "clean",
    tokenUsage: ZERO_USAGE,
    ...overrides,
  };
}

function createValidationResult(overrides?: Partial<ValidationResult>): ValidationResult {
  return {
    passed: true,
    warnings: [],
    ...overrides,
  };
}

function createWriterOutput(overrides: Partial<WriteChapterOutput> = {}): WriteChapterOutput {
  return {
    chapterNumber: 1,
    title: "Test Chapter",
    content: "Healthy chapter body with the copper token in his coat.",
    wordCount: "Healthy chapter body with the copper token in his coat.".length,
    preWriteCheck: "check",
    postSettlement: "settled",
    updatedState: "writer state",
    updatedLedger: "writer ledger",
    updatedHooks: "writer hooks",
    chapterSummary: "| 1 | Original summary |",
    updatedSubplots: "writer subplots",
    updatedEmotionalArcs: "writer emotions",
    updatedCharacterMatrix: "writer matrix",
    postWriteErrors: [],
    postWriteWarnings: [],
    tokenUsage: ZERO_USAGE,
    ...overrides,
  };
}

const BOOK: BookConfig = {
  id: "book-1",
  title: "Book",
  platform: "other",
  genre: "xuanhuan",
  status: "active",
  targetChapters: 10,
  chapterWordCount: 2000,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
};

describe("validateChapterTruthPersistence", () => {
  it("uses recovered settlement output when retry succeeds", async () => {
    const validator = {
      validate: vi.fn()
        .mockResolvedValueOnce(createValidationResult({
          passed: false,
          warnings: [{
            category: "unsupported_change",
            description: "正文写铜牌在怀里，但 state 说未携带。",
          }],
        }))
        .mockResolvedValueOnce(createValidationResult()),
    };
    const writer = {
      settleChapterState: vi.fn().mockResolvedValue(
        createWriterOutput({
          updatedState: "fixed state",
          updatedHooks: "fixed hooks",
          updatedLedger: "fixed ledger",
        }),
      ),
    };
    const logWarn = vi.fn();
    const logger = { warn: vi.fn() };

    const result = await validateChapterTruthPersistence({
      writer,
      validator,
      book: BOOK,
      bookDir: "/tmp/book",
      chapterNumber: 3,
      title: "Test Chapter",
      content: "Healthy chapter body with the copper token in his coat.",
      persistenceOutput: createWriterOutput({
        updatedState: "broken state",
        updatedHooks: "broken hooks",
        updatedLedger: "broken ledger",
      }),
      auditResult: createAuditResult(),
      previousTruth: {
        oldState: "stable state",
        oldHooks: "stable hooks",
        oldLedger: "stable ledger",
      },
      language: "zh",
      logWarn,
      logger,
    });

    expect(writer.settleChapterState).toHaveBeenCalledTimes(1);
    expect(writer.settleChapterState).toHaveBeenCalledWith(expect.objectContaining({
      chapterNumber: 3,
      title: "Test Chapter",
      validationFeedback: expect.stringContaining("铜牌在怀里"),
    }));
    expect(result.chapterStatus).toBeNull();
    expect(result.persistenceOutput.updatedState).toBe("fixed state");
    expect(result.persistenceOutput.updatedHooks).toBe("fixed hooks");
    expect(result.auditResult.issues).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith("  [unsupported_change] 正文写铜牌在怀里，但 state 说未携带。");
  });

  it("degrades gracefully when validator throws (e.g. LLM returned empty response)", async () => {
    const validator = {
      validate: vi.fn().mockRejectedValue(new Error("LLM returned empty response")),
    };
    const writer = {
      settleChapterState: vi.fn(),
    };
    const logWarn = vi.fn();
    const logger = { warn: vi.fn() };

    const result = await validateChapterTruthPersistence({
      writer,
      validator,
      book: BOOK,
      bookDir: "/tmp/book",
      chapterNumber: 1,
      title: "Test Chapter",
      content: "Chapter content.",
      persistenceOutput: createWriterOutput({
        updatedState: "new state",
        updatedHooks: "new hooks",
        updatedLedger: "new ledger",
      }),
      auditResult: createAuditResult(),
      previousTruth: {
        oldState: "old state",
        oldHooks: "old hooks",
        oldLedger: "old ledger",
      },
      language: "zh",
      logWarn,
      logger,
    });

    expect(result.chapterStatus).toBe("state-degraded");
    expect(result.persistenceOutput.updatedState).toBe("old state");
    expect(result.persistenceOutput.updatedHooks).toBe("old hooks");
    expect(result.persistenceOutput.updatedLedger).toBe("old ledger");
    expect(result.degradedIssues).toEqual([
      expect.objectContaining({
        severity: "warning",
        category: "state-validation",
      }),
    ]);
    // Should NOT have attempted settlement retry
    expect(writer.settleChapterState).not.toHaveBeenCalled();
  });

  it("degrades persistence output and appends audit issues when retry still fails", async () => {
    const validator = {
      validate: vi.fn()
        .mockResolvedValueOnce(createValidationResult({
          passed: false,
          warnings: [{
            category: "unsupported_change",
            description: "第一次校验失败。",
          }],
        }))
        .mockResolvedValueOnce(createValidationResult({
          passed: false,
          warnings: [{
            category: "unsupported_change",
            description: "重试后仍然失败。",
          }],
        })),
    };
    const writer = {
      settleChapterState: vi.fn().mockResolvedValue(
        createWriterOutput({
          updatedState: "still broken state",
          updatedHooks: "still broken hooks",
          updatedLedger: "still broken ledger",
        }),
      ),
    };
    const baseIssue: AuditIssue = {
      severity: "warning",
      category: "title-dedup",
      description: "title adjusted",
      suggestion: "check title",
    };

    const result = await validateChapterTruthPersistence({
      writer,
      validator,
      book: BOOK,
      bookDir: "/tmp/book",
      chapterNumber: 4,
      title: "Test Chapter",
      content: "Healthy chapter body with the copper token in his coat.",
      persistenceOutput: createWriterOutput({
        updatedState: "broken state",
        updatedHooks: "broken hooks",
        updatedLedger: "broken ledger",
      }),
      auditResult: createAuditResult({ issues: [baseIssue] }),
      previousTruth: {
        oldState: "stable state",
        oldHooks: "stable hooks",
        oldLedger: "stable ledger",
      },
      language: "zh",
      logWarn: vi.fn(),
      logger: { warn: vi.fn() },
    });

    expect(result.chapterStatus).toBe("state-degraded");
    expect(result.degradedIssues).toEqual([
      expect.objectContaining({
        severity: "warning",
        category: "state-validation",
        description: "重试后仍然失败。",
      }),
    ]);
    expect(result.persistenceOutput.updatedState).toBe("stable state");
    expect(result.persistenceOutput.updatedHooks).toBe("stable hooks");
    expect(result.persistenceOutput.updatedLedger).toBe("stable ledger");
    expect(result.auditResult.issues).toEqual([
      baseIssue,
      expect.objectContaining({
        category: "state-validation",
        description: "重试后仍然失败。",
      }),
    ]);
  });
});
