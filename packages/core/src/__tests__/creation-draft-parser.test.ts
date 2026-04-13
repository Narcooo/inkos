import { describe, expect, it } from "vitest";

// Test the internal parsing by importing the module and accessing via the tool
// We test extractBalancedJsonObject + parseCreationDraftResult behavior together
// by checking what developBookDraft's parser accepts.

// Since parseCreationDraftResult is not exported, we test extractBalancedJsonObject directly
import { extractBalancedJsonObject } from "../interaction/project-tools.js";

describe("extractBalancedJsonObject", () => {
  it("extracts JSON from clean response", () => {
    const input = '{"assistantReply":"hello","draft":{"concept":"test"}}';
    expect(extractBalancedJsonObject(input)).toBe(input);
  });

  it("extracts JSON preceded by thinking text with curly braces", () => {
    const input = 'Let me think... {the user wants a story} and more thoughts.\n\n{"assistantReply":"hello","draft":{"concept":"test"}}';
    const result = extractBalancedJsonObject(input);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.assistantReply).toBe("hello");
  });

  it("extracts JSON from markdown code block", () => {
    const input = '```json\n{"assistantReply":"hello","draft":{"concept":"test"}}\n```';
    const result = extractBalancedJsonObject(input);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.assistantReply).toBe("hello");
  });

  it("extracts JSON when thinking model prefixes with reasoning", () => {
    const input = '<think>\n用户想写一个港风商战悬疑，我需要 {分析需求} 然后给出建议。\n</think>\n\n{"assistantReply":"好的","draft":{"concept":"港风商战悬疑"}}';
    const result = extractBalancedJsonObject(input);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.assistantReply).toBe("好的");
  });
});
