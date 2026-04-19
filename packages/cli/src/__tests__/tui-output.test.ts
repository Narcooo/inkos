import { describe, expect, it } from "vitest";
import { formatTuiResult } from "../tui/output.js";

describe("tui output", () => {
  it("summarizes a completed write flow", () => {
    expect(formatTuiResult({
      intent: "write_next",
      status: "completed",
      bookId: "harbor",
    })).toContain("harbor");
  });

  it("summarizes a mode switch", () => {
    expect(formatTuiResult({
      intent: "switch_mode",
      status: "completed",
      mode: "auto",
      locale: "en",
    })).toContain("auto");
  });

  it("prefers explicit response text when provided", () => {
    expect(formatTuiResult({
      intent: "explain_status",
      status: "completed",
      responseText: "Current status: harbor is at repairing chapter 3.",
    })).toBe("Current status: harbor is at repairing chapter 3.");
  });

  it("renders Chinese summaries when locale is zh-CN", () => {
    expect(formatTuiResult({
      intent: "select_book",
      status: "completed",
      bookId: "harbor",
      locale: "zh-CN",
    })).toBe("当前作品：harbor");
  });
});
