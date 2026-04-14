import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "../agent/agent-system-prompt.js";

describe("buildAgentSystemPrompt", () => {
  it("builds Chinese new-book prompt when no bookId", () => {
    const prompt = buildAgentSystemPrompt(null, "zh");
    expect(prompt).toContain("建书助手");
    expect(prompt).toContain("sub_agent");
    expect(prompt).toContain("architect");
    expect(prompt).not.toContain("read");
  });

  it("builds Chinese book prompt with all tools", () => {
    const prompt = buildAgentSystemPrompt("my-book", "zh");
    expect(prompt).toContain("my-book");
    expect(prompt).toContain("sub_agent");
    expect(prompt).toContain("read");
    expect(prompt).toContain("edit");
    expect(prompt).toContain("grep");
    expect(prompt).toContain("ls");
    expect(prompt).toContain("writer");
    expect(prompt).toContain("architect");
    expect(prompt).toContain("auditor");
    expect(prompt).toContain("reviser");
  });

  it("builds English prompt when language is en", () => {
    const prompt = buildAgentSystemPrompt("novel", "en");
    expect(prompt).toContain("novel");
    expect(prompt).toContain("sub_agent");
    expect(prompt).toContain("writing assistant");
  });

  it("new-book English prompt mentions architect", () => {
    const prompt = buildAgentSystemPrompt(null, "en");
    expect(prompt).toContain("architect");
    expect(prompt).toContain("book creation");
  });
});
