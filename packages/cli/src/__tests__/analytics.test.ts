import { describe, it, expect } from "vitest";
import { computeAnalytics } from "@actalk/inkos-core";

describe("computeAnalytics", () => {
  it("returns zeros for empty chapters", () => {
    const result = computeAnalytics("test-book", []);
    expect(result.bookId).toBe("test-book");
    expect(result.totalChapters).toBe(0);
    expect(result.totalWords).toBe(0);
    expect(result.avgWordsPerChapter).toBe(0);
    expect(result.auditPassRate).toBe(100); // no audited chapters = 100%
    expect(result.topIssueCategories).toEqual([]);
    expect(result.chaptersWithMostIssues).toEqual([]);
    expect(result.statusDistribution).toEqual({});
  });

  it("computes basic stats correctly", () => {
    const chapters = [
      { number: 1, status: "approved", wordCount: 3000, auditIssues: [] },
      { number: 2, status: "approved", wordCount: 3200, auditIssues: [] },
      { number: 3, status: "ready-for-review", wordCount: 2800, auditIssues: [] },
    ];
    const result = computeAnalytics("book-a", chapters);
    expect(result.totalChapters).toBe(3);
    expect(result.totalWords).toBe(9000);
    expect(result.avgWordsPerChapter).toBe(3000);
  });

  it("calculates audit pass rate excluding un-audited statuses", () => {
    const chapters = [
      { number: 1, status: "approved", wordCount: 3000, auditIssues: [] },
      { number: 2, status: "audit-failed", wordCount: 3000, auditIssues: ["[critical] 连续性：角色位置矛盾"] },
      { number: 3, status: "drafted", wordCount: 3000, auditIssues: [] }, // not audited
      { number: 4, status: "ready-for-review", wordCount: 3000, auditIssues: [] },
    ];
    const result = computeAnalytics("book-b", chapters);
    // Audited: approved(1), audit-failed(2), ready-for-review(4) = 3
    // Passed (approved + ready-for-review + published): 1 + 4 = 2
    // Pass rate: 2/3 = 67%
    expect(result.auditPassRate).toBe(67);
  });

  it("counts state-degraded chapters as audited but not passed", () => {
    const chapters = [
      { number: 1, status: "approved", wordCount: 3000, auditIssues: [] },
      { number: 2, status: "state-degraded", wordCount: 2800, auditIssues: ["[warning] state validation drift"] },
      { number: 3, status: "drafted", wordCount: 2600, auditIssues: [] },
    ];
    const result = computeAnalytics("book-state-degraded", chapters);
    expect(result.auditPassRate).toBe(50);
    expect(result.statusDistribution).toEqual({
      approved: 1,
      "state-degraded": 1,
      drafted: 1,
    });
  });

  it("extracts issue categories from formatted strings", () => {
    const chapters = [
      {
        number: 1,
        status: "audit-failed",
        wordCount: 3000,
        auditIssues: [
          "[critical] 连续性：角色位置矛盾",
          "[warning] 数值错误：灵石数量不一致",
          "[critical] 连续性：时间线冲突",
        ],
      },
      {
        number: 2,
        status: "audit-failed",
        wordCount: 2900,
        auditIssues: [
          "[warning] 数值错误：修炼速度超标",
        ],
      },
    ];
    const result = computeAnalytics("book-c", chapters);
    expect(result.topIssueCategories).toEqual([
      { category: "连续性", count: 2 },
      { category: "数值错误", count: 2 },
    ]);
  });

  it("falls back to 未分类 for unstructured issues", () => {
    const chapters = [
      {
        number: 1,
        status: "audit-failed",
        wordCount: 3000,
        auditIssues: ["some random issue without format"],
      },
    ];
    const result = computeAnalytics("book-d", chapters);
    expect(result.topIssueCategories).toEqual([
      { category: "未分类", count: 1 },
    ]);
  });

  it("ranks chapters by issue count", () => {
    const chapters = [
      { number: 1, status: "audit-failed", wordCount: 3000, auditIssues: ["a"] },
      { number: 2, status: "audit-failed", wordCount: 3000, auditIssues: ["a", "b", "c"] },
      { number: 3, status: "approved", wordCount: 3000, auditIssues: [] },
      { number: 4, status: "audit-failed", wordCount: 3000, auditIssues: ["a", "b"] },
    ];
    const result = computeAnalytics("book-e", chapters);
    expect(result.chaptersWithMostIssues).toEqual([
      { chapter: 2, issueCount: 3 },
      { chapter: 4, issueCount: 2 },
      { chapter: 1, issueCount: 1 },
    ]);
  });

  it("computes status distribution", () => {
    const chapters = [
      { number: 1, status: "approved", wordCount: 3000, auditIssues: [] },
      { number: 2, status: "approved", wordCount: 3000, auditIssues: [] },
      { number: 3, status: "audit-failed", wordCount: 3000, auditIssues: ["x"] },
      { number: 4, status: "drafted", wordCount: 3000, auditIssues: [] },
    ];
    const result = computeAnalytics("book-f", chapters);
    expect(result.statusDistribution).toEqual({
      approved: 2,
      "audit-failed": 1,
      drafted: 1,
    });
  });

  it("limits topIssueCategories to 10", () => {
    const issues = Array.from({ length: 15 }, (_, i) =>
      `[warning] cat${i}：something`,
    );
    const chapters = [
      { number: 1, status: "audit-failed", wordCount: 3000, auditIssues: issues },
    ];
    const result = computeAnalytics("book-g", chapters);
    expect(result.topIssueCategories.length).toBe(10);
  });

  it("limits chaptersWithMostIssues to 5", () => {
    const chapters = Array.from({ length: 8 }, (_, i) => ({
      number: i + 1,
      status: "audit-failed",
      wordCount: 3000,
      auditIssues: Array.from({ length: i + 1 }, (_, j) => `issue-${j}`),
    }));
    const result = computeAnalytics("book-h", chapters);
    expect(result.chaptersWithMostIssues.length).toBe(5);
    // Sorted descending: ch8(8), ch7(7), ch6(6), ch5(5), ch4(4)
    expect(result.chaptersWithMostIssues[0]!.chapter).toBe(8);
  });
});
