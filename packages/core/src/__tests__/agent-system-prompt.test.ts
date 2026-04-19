import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "../agent/agent-system-prompt.js";

describe("buildAgentSystemPrompt", () => {
  describe("no book (creation flow)", () => {
    it("Chinese prompt includes info collection workflow", () => {
      const prompt = buildAgentSystemPrompt(null, "zh");
      expect(prompt).toContain("建书助手");
      expect(prompt).toContain("收集信息");
      expect(prompt).toContain("题材");
      expect(prompt).toContain("世界观");
      expect(prompt).toContain("主角");
      expect(prompt).toContain("核心冲突");
      expect(prompt).toContain("architect");
      expect(prompt).toContain("sub_agent");
      expect(prompt).toContain("title");
    });

    it("English prompt includes info collection workflow", () => {
      const prompt = buildAgentSystemPrompt(null, "en");
      expect(prompt).toContain("book creation");
      expect(prompt).toContain("architect");
      expect(prompt).toContain("Genre");
      expect(prompt).toContain("Protagonist");
      expect(prompt).toContain("Core conflict");
      expect(prompt).toContain("title");
    });

    it("Chinese prompt forbids emoji", () => {
      const prompt = buildAgentSystemPrompt(null, "zh");
      expect(prompt).toContain("不要在回复中添加表情符号");
    });

    it("English prompt forbids emoji", () => {
      const prompt = buildAgentSystemPrompt(null, "en");
      expect(prompt).toContain("Do NOT use emoji");
    });

    it("no-book prompt does NOT mention read/edit/grep/ls", () => {
      const prompt = buildAgentSystemPrompt(null, "zh");
      expect(prompt).not.toMatch(/\bread\b.*读取/);
      expect(prompt).not.toContain("edit");
    });
  });

  describe("with book (writing flow)", () => {
    it("Chinese prompt includes deterministic writing tools except architect", () => {
      const prompt = buildAgentSystemPrompt("my-book", "zh");
      expect(prompt).toContain("my-book");
      expect(prompt).toContain("sub_agent");
      expect(prompt).toContain("writer");
      expect(prompt).toContain("auditor");
      expect(prompt).toContain("reviser");
      expect(prompt).toContain("chapterWordCount");
      expect(prompt).toContain("mode");
      expect(prompt).toContain("approvedOnly");
      expect(prompt).toContain("read");
      expect(prompt).toContain("write_truth_file");
      expect(prompt).toContain("rename_entity");
      expect(prompt).toContain("patch_chapter_text");
      expect(prompt).toContain("edit");
      expect(prompt).toContain("write");
      expect(prompt).toContain("grep");
      expect(prompt).toContain("ls");
    });

    it("Chinese prompt does NOT mention revise_chapter (merged into sub_agent reviser)", () => {
      const prompt = buildAgentSystemPrompt("my-book", "zh");
      expect(prompt).not.toContain("revise_chapter");
    });

    it("English prompt does NOT mention revise_chapter (merged into sub_agent reviser)", () => {
      const prompt = buildAgentSystemPrompt("novel", "en");
      expect(prompt).not.toContain("revise_chapter");
    });

    it("with-book prompt steers chapter rewrites to sub_agent reviser, not a separate tool", () => {
      const prompt = buildAgentSystemPrompt("my-book", "zh");
      expect(prompt).toContain("改设定/改真相文件");
      expect(prompt).toContain("write_truth_file");
      expect(prompt).toContain("用户要求重写/精修已有章节");
      expect(prompt).toContain("reviser");
      expect(prompt).toContain("也可以直接使用 edit / write");
    });

    it("Chinese prompt warns NOT to call architect", () => {
      const prompt = buildAgentSystemPrompt("my-book", "zh");
      expect(prompt).toContain("不要调用 architect");
    });

    it("English prompt warns NOT to call architect", () => {
      const prompt = buildAgentSystemPrompt("novel", "en");
      expect(prompt).toContain("Do NOT call architect");
    });

    it("Chinese with-book prompt forbids emoji", () => {
      const prompt = buildAgentSystemPrompt("my-book", "zh");
      expect(prompt).toContain("不要在回复中添加表情符号");
    });

    it("English with-book prompt forbids emoji", () => {
      const prompt = buildAgentSystemPrompt("novel", "en");
      expect(prompt).toContain("Do NOT use emoji");
    });

    it("with-book prompt does NOT list architect as available", () => {
      const prompt = buildAgentSystemPrompt("my-book", "zh");
      // architect 不在可用工具列表里
      expect(prompt).not.toMatch(/agent="architect"/);
    });

    it("book-mode prompt documents all sub_agent params", () => {
      const prompt = buildAgentSystemPrompt("test-book", "zh");
      expect(prompt).toContain("chapterWordCount");
      expect(prompt).toContain("chapterNumber");
      expect(prompt).toContain("mode");
      expect(prompt).toContain("anti-detect");
      expect(prompt).toContain("format");
      expect(prompt).toContain("approvedOnly");
    });
  });
});
