import { describe, it, expect } from "vitest";
import type { ToolExecution } from "../../../store/chat/types";

// Import the grouping logic — we'll extract it as a named export
// For now, inline the function to test the expected behavior
function groupChronologically(executions: ToolExecution[]) {
  type RenderGroup =
    | { type: "pipeline"; exec: ToolExecution }
    | { type: "utilities"; execs: ToolExecution[] };

  const groups: RenderGroup[] = [];
  let utilBuf: ToolExecution[] = [];

  const flushUtils = () => {
    if (utilBuf.length > 0) {
      groups.push({ type: "utilities", execs: utilBuf });
      utilBuf = [];
    }
  };

  for (const exec of executions) {
    if (exec.tool === "sub_agent") {
      flushUtils();
      groups.push({ type: "pipeline", exec });
    } else {
      utilBuf.push(exec);
    }
  }
  flushUtils();
  return groups;
}

const makeExec = (overrides: Partial<ToolExecution> & { id: string; tool: string }): ToolExecution => ({
  label: "test",
  status: "completed",
  startedAt: Date.now(),
  ...overrides,
});

describe("groupChronologically", () => {
  it("keeps read before pipeline when read happened first", () => {
    const execs: ToolExecution[] = [
      makeExec({ id: "1", tool: "read", label: "读取文件" }),
      makeExec({ id: "2", tool: "sub_agent", agent: "writer", label: "写作" }),
    ];

    const groups = groupChronologically(execs);

    expect(groups).toHaveLength(2);
    expect(groups[0].type).toBe("utilities");
    expect(groups[1].type).toBe("pipeline");
  });

  it("groups consecutive utility tools together", () => {
    const execs: ToolExecution[] = [
      makeExec({ id: "1", tool: "read", label: "读取文件" }),
      makeExec({ id: "2", tool: "grep", label: "搜索" }),
      makeExec({ id: "3", tool: "read", label: "读取文件" }),
    ];

    const groups = groupChronologically(execs);

    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe("utilities");
    if (groups[0].type === "utilities") {
      expect(groups[0].execs).toHaveLength(3);
    }
  });

  it("interleaves utility groups around pipeline ops", () => {
    const execs: ToolExecution[] = [
      makeExec({ id: "1", tool: "read", label: "读取文件" }),
      makeExec({ id: "2", tool: "sub_agent", agent: "writer", label: "写作" }),
      makeExec({ id: "3", tool: "read", label: "读取文件" }),
      makeExec({ id: "4", tool: "grep", label: "搜索" }),
    ];

    const groups = groupChronologically(execs);

    expect(groups).toHaveLength(3);
    expect(groups[0].type).toBe("utilities");
    expect(groups[1].type).toBe("pipeline");
    expect(groups[2].type).toBe("utilities");
    if (groups[2].type === "utilities") {
      expect(groups[2].execs).toHaveLength(2);
    }
  });

  it("handles pipeline-only executions", () => {
    const execs: ToolExecution[] = [
      makeExec({ id: "1", tool: "sub_agent", agent: "writer", label: "写作" }),
    ];

    const groups = groupChronologically(execs);

    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe("pipeline");
  });

  it("handles empty array", () => {
    expect(groupChronologically([])).toHaveLength(0);
  });
});
