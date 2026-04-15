import { describe, it, expect } from "vitest";

/**
 * Replicate the READ_ONLY_TOOLS logic from message/action.ts.
 * Sidebar should only refresh for tools that may modify book data.
 */
const READ_ONLY_TOOLS = new Set(["read", "grep", "ls"]);

function shouldRefreshSidebar(toolName: string): boolean {
  return !READ_ONLY_TOOLS.has(toolName);
}

describe("sidebar refresh logic", () => {
  it("does not refresh for read-only tools", () => {
    expect(shouldRefreshSidebar("read")).toBe(false);
    expect(shouldRefreshSidebar("grep")).toBe(false);
    expect(shouldRefreshSidebar("ls")).toBe(false);
  });

  it("refreshes for write tools", () => {
    expect(shouldRefreshSidebar("edit")).toBe(true);
    expect(shouldRefreshSidebar("sub_agent")).toBe(true);
  });

  it("refreshes for unknown tools (safe default)", () => {
    expect(shouldRefreshSidebar("some_new_tool")).toBe(true);
  });
});
