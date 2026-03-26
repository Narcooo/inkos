import { describe, it, expect } from "vitest";
import { classifyIssues, shouldUseLight, formatIssuesAsInstructions } from "../pipeline/revision-router.js";
import type { AuditIssue } from "../agents/continuity.js";

describe("revision-router", () => {
  // ── classifyIssues ──

  describe("classifyIssues", () => {
    it("should classify stylistic issues correctly", () => {
      const issues: AuditIssue[] = [
        { severity: "warning", category: "词汇疲劳", description: "重复用词", suggestion: "换词" },
        { severity: "critical", category: "段落等长", description: "段落长度一致", suggestion: "增加差异" },
      ];
      const result = classifyIssues(issues);
      expect(result.stylistic).toHaveLength(2);
      expect(result.narrative).toHaveLength(0);
    });

    it("should classify narrative issues correctly", () => {
      const issues: AuditIssue[] = [
        { severity: "critical", category: "OOC检查", description: "角色行为不一致", suggestion: "修改" },
        { severity: "warning", category: "时间线检查", description: "时间错误", suggestion: "核实" },
      ];
      const result = classifyIssues(issues);
      expect(result.stylistic).toHaveLength(0);
      expect(result.narrative).toHaveLength(2);
    });

    it("should classify mixed issues", () => {
      const issues: AuditIssue[] = [
        { severity: "warning", category: "套话密度", description: "套话过多", suggestion: "减少" },
        { severity: "critical", category: "设定冲突", description: "设定矛盾", suggestion: "修正" },
        { severity: "info", category: "节奏检查", description: "节奏偏慢", suggestion: "" },
      ];
      const result = classifyIssues(issues);
      expect(result.stylistic).toHaveLength(1);
      expect(result.narrative).toHaveLength(1);
    });

    it("should skip info-level issues", () => {
      const issues: AuditIssue[] = [
        { severity: "info", category: "OOC检查", description: "轻微OOC", suggestion: "" },
        { severity: "info", category: "词汇疲劳", description: "轻微重复", suggestion: "" },
      ];
      const result = classifyIssues(issues);
      expect(result.stylistic).toHaveLength(0);
      expect(result.narrative).toHaveLength(0);
    });

    it("should handle fuzzy category matching", () => {
      const issues: AuditIssue[] = [
        { severity: "warning", category: "AIGC检测分数过高", description: "AI分数高", suggestion: "改" },
      ];
      const result = classifyIssues(issues);
      expect(result.stylistic).toHaveLength(1);
      expect(result.narrative).toHaveLength(0);
    });
  });

  // ── shouldUseLight ──

  describe("shouldUseLight", () => {
    it("should return true when all actionable issues are stylistic", () => {
      const issues: AuditIssue[] = [
        { severity: "warning", category: "词汇疲劳", description: "desc", suggestion: "" },
        { severity: "critical", category: "流水账", description: "desc", suggestion: "" },
      ];
      expect(shouldUseLight(issues)).toBe(true);
    });

    it("should return false when any actionable issue is narrative", () => {
      const issues: AuditIssue[] = [
        { severity: "warning", category: "词汇疲劳", description: "desc", suggestion: "" },
        { severity: "warning", category: "OOC检查", description: "desc", suggestion: "" },
      ];
      expect(shouldUseLight(issues)).toBe(false);
    });

    it("should return false for empty issues", () => {
      expect(shouldUseLight([])).toBe(false);
    });

    it("should return false when only info issues exist", () => {
      const issues: AuditIssue[] = [
        { severity: "info", category: "词汇疲劳", description: "desc", suggestion: "" },
      ];
      expect(shouldUseLight(issues)).toBe(false);
    });

    it("should return true for ai-tells category", () => {
      const issues: AuditIssue[] = [
        { severity: "warning", category: "ai-tells", description: "AI markers", suggestion: "fix" },
      ];
      expect(shouldUseLight(issues)).toBe(true);
    });
  });

  // ── formatIssuesAsInstructions ──

  describe("formatIssuesAsInstructions", () => {
    it("should format issues as readable instructions", () => {
      const issues: AuditIssue[] = [
        { severity: "warning", category: "词汇疲劳", description: "大量重复\"不禁\"", suggestion: "替换为具体描写" },
        { severity: "critical", category: "段落等长", description: "连续5段等长", suggestion: "增加长短段落交替" },
      ];
      const result = formatIssuesAsInstructions(issues);
      expect(result).toContain("审稿意见");
      expect(result).toContain("[warning] 词汇疲劳");
      expect(result).toContain("[critical] 段落等长");
      expect(result).toContain("替换为具体描写");
    });

    it("should skip info-level issues", () => {
      const issues: AuditIssue[] = [
        { severity: "info", category: "节奏检查", description: "minor", suggestion: "" },
        { severity: "warning", category: "套话密度", description: "too many", suggestion: "reduce" },
      ];
      const result = formatIssuesAsInstructions(issues);
      expect(result).not.toContain("节奏检查");
      expect(result).toContain("套话密度");
    });
  });
});
