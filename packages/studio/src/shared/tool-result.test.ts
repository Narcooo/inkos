import { describe, expect, it } from "vitest";
import { summarizeToolResult } from "./tool-result";

describe("summarizeToolResult", () => {
  it("reads Pi text content blocks", () => {
    expect(summarizeToolResult({ content: [{ type: "text", text: "This operation was aborted" }] }))
      .toBe("This operation was aborted");
  });

  it("falls back to JSON for structured results", () => {
    expect(summarizeToolResult({ status: "cancelled", resumeCursor: "2" }))
      .toBe('{"status":"cancelled","resumeCursor":"2"}');
  });

  it("respects the caller's display limit", () => {
    expect(summarizeToolResult("abcdef", 3)).toBe("abc");
  });
});
