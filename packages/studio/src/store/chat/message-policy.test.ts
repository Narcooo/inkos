import { describe, expect, it } from "vitest";
import { shouldRefreshSidebarForTool } from "./message-policy";

describe("shouldRefreshSidebarForTool", () => {
  it("does not refresh for read-only tools", () => {
    expect(shouldRefreshSidebarForTool("read")).toBe(false);
    expect(shouldRefreshSidebarForTool("grep")).toBe(false);
    expect(shouldRefreshSidebarForTool("ls")).toBe(false);
  });

  it("refreshes for mutating and unknown tools", () => {
    expect(shouldRefreshSidebarForTool("edit")).toBe(true);
    expect(shouldRefreshSidebarForTool("sub_agent")).toBe(true);
    expect(shouldRefreshSidebarForTool("some_future_tool")).toBe(true);
  });
});
