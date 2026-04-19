import { describe, expect, it, vi } from "vitest";
import type { AuditIssue } from "../agents/continuity.js";
import type {
  ValidationResult,
  ValidationWarning,
} from "../agents/state-validator.js";
import type { WriteChapterOutput } from "../agents/writer.js";
import type { BookConfig } from "../models/book.js";
import type { ChapterMeta } from "../models/chapter.js";
import {
  buildStateDegradedPersistenceOutput,
  buildStateDegradedReviewNote,
  parseStateDegradedReviewNote,
  resolveStateDegradedBaseStatus,
  retrySettlementAfterValidationFailure,
} from "../pipeline/chapter-state-recovery.js";

function createBook(): BookConfig {
  return {
    id: "test-book",
    title: "Test Book",
    platform: "tomato",
    genre: "xuanhuan",
    status: "active",
    targetChapters: 10,
    chapterWordCount: 3000,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  };
}

function createValidationWarning(
  overrides: Partial<ValidationWarning> = {},
): ValidationWarning {
  return {
    category: overrides.category ?? "current-state",
    description: overrides.description ?? "铜牌位置与正文矛盾",
  };
}

function createValidationResult(
  overrides: Partial<ValidationResult> = {},
): ValidationResult {
  return {
    passed: overrides.passed ?? false,
    warnings: overrides.warnings ?? [createValidationWarning()],
  };
}

function createWriteChapterOutput(
  overrides: Partial<WriteChapterOutput> = {},
): WriteChapterOutput {
  return {
    chapterNumber: 3,
    title: "第三章",
    content: "铜牌贴在胸口。",
    wordCount: "铜牌贴在胸口。".length,
    preWriteCheck: "ok",
    postSettlement: "ok",
    updatedState: "new state",
    updatedLedger: "new ledger",
    updatedHooks: "new hooks",
    chapterSummary: "| 3 | 第三章 |",
    updatedSubplots: "new subplots",
    updatedEmotionalArcs: "new emotional arcs",
    updatedCharacterMatrix: "new character matrix",
    postWriteErrors: [],
    postWriteWarnings: [],
    ...overrides,
  };
}

function createChapterMeta(
  overrides: Partial<ChapterMeta> = {},
): ChapterMeta {
  return {
    number: 3,
    title: "第三章",
    status: "state-degraded",
    wordCount: 1200,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    auditIssues: [],
    lengthWarnings: [],
    ...overrides,
  };
}

describe("chapter-state-recovery", () => {
  it("retries settlement with localized validation feedback and recovers on a clean retry", async () => {
    let capturedFeedback = "";
    const writer = {
      settleChapterState: vi.fn(async (input: { validationFeedback?: string }) => {
        capturedFeedback = input.validationFeedback ?? "";
        return createWriteChapterOutput({
          updatedState: "fixed state",
          updatedHooks: "fixed hooks",
        });
      }),
    };
    const validator = {
      validate: vi.fn(async () => createValidationResult({
        passed: true,
        warnings: [],
      })),
    };
    const logWarn = vi.fn();
    const warn = vi.fn();

    const result = await retrySettlementAfterValidationFailure({
      writer: writer as never,
      validator: validator as never,
      book: createBook(),
      bookDir: "/tmp/test-book",
      chapterNumber: 3,
      title: "第三章",
      content: "铜牌贴在胸口。",
      oldState: "old state",
      oldHooks: "old hooks",
      originalValidation: createValidationResult(),
      language: "zh",
      logWarn,
      logger: { warn } as never,
    });

    expect(result.kind).toBe("recovered");
    expect(capturedFeedback).toContain("上一次状态结算未通过校验");
    expect(capturedFeedback).toContain("铜牌位置与正文矛盾");
    expect(writer.settleChapterState).toHaveBeenCalledWith(expect.objectContaining({
      allowReapply: true,
    }));
    expect(logWarn).toHaveBeenCalledWith(expect.objectContaining({
      zh: expect.stringContaining("仅重试结算层"),
    }));
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns localized degraded issues when settlement retry still fails", async () => {
    const validatorWarning = createValidationWarning({
      description: "挂坠状态仍与正文冲突",
    });
    const result = await retrySettlementAfterValidationFailure({
      writer: {
        settleChapterState: vi.fn(async () => createWriteChapterOutput()),
      } as never,
      validator: {
        validate: vi.fn(async () => createValidationResult({
          passed: false,
          warnings: [validatorWarning],
        })),
      } as never,
      book: createBook(),
      bookDir: "/tmp/test-book",
      chapterNumber: 3,
      title: "第三章",
      content: "铜牌贴在胸口。",
      oldState: "old state",
      oldHooks: "old hooks",
      originalValidation: createValidationResult({
        warnings: [validatorWarning],
      }),
      language: "zh",
      logWarn: vi.fn(),
      logger: { warn: vi.fn() } as never,
    });

    expect(result.kind).toBe("degraded");
    if (result.kind === "degraded") {
      expect(result.issues).toEqual([
        expect.objectContaining({
          category: "state-validation",
          description: "挂坠状态仍与正文冲突",
          suggestion: "请先基于已保存正文修复本章 state，再继续后续章节。",
        }),
      ]);
    }
  });

  it("freezes truth outputs when degrading persisted settlement", () => {
    const output = createWriteChapterOutput({
      runtimeStateDelta: { chapter: 3 } as never,
      runtimeStateSnapshot: {
        chapter: 3,
        facts: [],
        hooks: [],
        chapterSummary: undefined,
      } as never,
      updatedChapterSummaries: "| 3 | 新摘要 |",
    });

    const degraded = buildStateDegradedPersistenceOutput({
      output,
      oldState: "stable state",
      oldHooks: "stable hooks",
      oldLedger: "stable ledger",
    });

    expect(degraded.updatedState).toBe("stable state");
    expect(degraded.updatedHooks).toBe("stable hooks");
    expect(degraded.updatedLedger).toBe("stable ledger");
    expect(degraded.runtimeStateDelta).toBeUndefined();
    expect(degraded.runtimeStateSnapshot).toBeUndefined();
    expect(degraded.updatedChapterSummaries).toBeUndefined();
  });

  it("round-trips degraded review metadata and resolves fallback base status", () => {
    const issues: AuditIssue[] = [{
      severity: "warning",
      category: "state-validation",
      description: "状态结算重试后仍未通过校验。",
      suggestion: "请先基于已保存正文修复本章 state，再继续后续章节。",
    }];
    const note = buildStateDegradedReviewNote("audit-failed", issues);

    expect(parseStateDegradedReviewNote(note)).toEqual({
      kind: "state-degraded",
      baseStatus: "audit-failed",
      injectedIssues: ["[warning] 状态结算重试后仍未通过校验。"],
    });

    expect(resolveStateDegradedBaseStatus(createChapterMeta({
      reviewNote: note,
    }))).toBe("audit-failed");

    expect(resolveStateDegradedBaseStatus(createChapterMeta({
      reviewNote: "{bad json",
      auditIssues: ["[critical] still broken"],
    }))).toBe("audit-failed");

    expect(resolveStateDegradedBaseStatus(createChapterMeta({
      reviewNote: "{bad json",
      auditIssues: ["[warning] needs review"],
    }))).toBe("ready-for-review");
  });
});
