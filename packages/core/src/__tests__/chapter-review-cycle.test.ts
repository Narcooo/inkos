import { describe, expect, it, vi } from "vitest";
import { runChapterReviewCycle } from "../pipeline/chapter-review-cycle.js";
import type { AuditResult, AuditIssue } from "../agents/continuity.js";
import type { LengthSpec } from "../models/length-governance.js";

const LENGTH_SPEC: LengthSpec = {
  target: 220,
  softMin: 190,
  softMax: 250,
  hardMin: 160,
  hardMax: 280,
  countingMode: "zh_chars",
  normalizeMode: "none",
};

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
    ...overrides,
  };
}

describe("runChapterReviewCycle", () => {
  it("applies post-write spot-fix before the first audit pass", async () => {
    const auditChapter = vi.fn()
      .mockResolvedValue(createAuditResult());
    const reviseChapter = vi.fn().mockResolvedValue({
      revisedContent: "fixed draft",
      wordCount: 10,
      fixedIssues: ["fixed"],
      updatedState: "",
      updatedLedger: "",
      updatedHooks: "",
      tokenUsage: ZERO_USAGE,
    });
    const normalizeDraftLengthIfNeeded = vi.fn()
      .mockResolvedValue({
        content: "fixed draft",
        wordCount: 10,
        applied: false,
        tokenUsage: ZERO_USAGE,
      });

    const result = await runChapterReviewCycle({
      book: { genre: "xuanhuan" },
      bookDir: "/tmp/book",
      chapterNumber: 1,
      initialOutput: {
        content: "raw draft",
        wordCount: 9,
        postWriteErrors: [{
          rule: "paragraph-shape",
          description: "too fragmented",
          suggestion: "merge short fragments",
          severity: "error",
        }],
      },
      lengthSpec: LENGTH_SPEC,
      reducedControlInput: undefined,
      initialUsage: ZERO_USAGE,
      createReviser: () => ({ reviseChapter }),
      auditor: { auditChapter },
      normalizeDraftLengthIfNeeded,
      assertChapterContentNotEmpty: () => undefined,
      addUsage: (left, right) => ({
        promptTokens: left.promptTokens + (right?.promptTokens ?? 0),
        completionTokens: left.completionTokens + (right?.completionTokens ?? 0),
        totalTokens: left.totalTokens + (right?.totalTokens ?? 0),
      }),
      restoreLostAuditIssues: (_previous, next) => next,
      analyzeAITells: () => ({ issues: [] as AuditIssue[] }),
      analyzeSensitiveWords: () => ({ found: [] as Array<{ severity: "warn" | "block" }>, issues: [] as AuditIssue[] }),
      logWarn: () => undefined,
      logStage: () => undefined,
    });

    expect(reviseChapter).toHaveBeenCalledTimes(1);
    expect(auditChapter).toHaveBeenCalledTimes(1);
    expect(auditChapter).toHaveBeenCalledWith(
      "/tmp/book",
      "fixed draft",
      1,
      "xuanhuan",
      undefined,
    );
    expect(result.finalContent).toBe("fixed draft");
    expect(result.revised).toBe(true);
  });

  it("drops auto-revision when it increases AI tells and re-audits the original draft", async () => {
    const failingAudit = createAuditResult({
      passed: false,
      issues: [{
        severity: "critical",
        category: "continuity",
        description: "broken continuity",
        suggestion: "fix it",
      }],
      summary: "bad",
    });
    const auditChapter = vi.fn()
      .mockResolvedValueOnce(failingAudit)
      .mockResolvedValueOnce(createAuditResult());
    const reviseChapter = vi.fn().mockResolvedValue({
      revisedContent: "rewritten draft",
      wordCount: 15,
      fixedIssues: ["fixed"],
      updatedState: "",
      updatedLedger: "",
      updatedHooks: "",
      tokenUsage: ZERO_USAGE,
    });
    const normalizeDraftLengthIfNeeded = vi.fn()
      .mockResolvedValueOnce({
        content: "original draft",
        wordCount: 13,
        applied: false,
        tokenUsage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "rewritten draft",
        wordCount: 15,
        applied: false,
        tokenUsage: ZERO_USAGE,
      });
    const analyzeAITells = vi.fn((content: string) => ({
      issues: content === "rewritten draft"
        ? [{ severity: "warning", category: "ai", description: "more ai", suggestion: "reduce" } satisfies AuditIssue]
        : [],
    }));

    const result = await runChapterReviewCycle({
      book: { genre: "xuanhuan" },
      bookDir: "/tmp/book",
      chapterNumber: 1,
      initialOutput: {
        content: "original draft",
        wordCount: 13,
        postWriteErrors: [],
      },
      lengthSpec: LENGTH_SPEC,
      reducedControlInput: undefined,
      initialUsage: ZERO_USAGE,
      createReviser: () => ({ reviseChapter }),
      auditor: { auditChapter },
      normalizeDraftLengthIfNeeded,
      assertChapterContentNotEmpty: () => undefined,
      addUsage: (left, right) => ({
        promptTokens: left.promptTokens + (right?.promptTokens ?? 0),
        completionTokens: left.completionTokens + (right?.completionTokens ?? 0),
        totalTokens: left.totalTokens + (right?.totalTokens ?? 0),
      }),
      restoreLostAuditIssues: (_previous, next) => next,
      analyzeAITells,
      analyzeSensitiveWords: () => ({ found: [] as Array<{ severity: "warn" | "block" }>, issues: [] as AuditIssue[] }),
      logWarn: () => undefined,
      logStage: () => undefined,
    });

    expect(reviseChapter).toHaveBeenCalledTimes(1);
    expect(auditChapter).toHaveBeenNthCalledWith(1, "/tmp/book", "original draft", 1, "xuanhuan", undefined);
    expect(auditChapter).toHaveBeenNthCalledWith(2, "/tmp/book", "original draft", 1, "xuanhuan", { temperature: 0 });
    expect(result.finalContent).toBe("original draft");
    expect(result.revised).toBe(false);
  });
});
