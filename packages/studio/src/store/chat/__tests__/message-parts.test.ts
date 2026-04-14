import { describe, it, expect } from "vitest";
import { buildPartsFromEvents, type StreamEvent } from "../parts-builder";

describe("buildPartsFromEvents", () => {
  it("produces thinking → text parts from basic conversation", () => {
    const parts = buildPartsFromEvents([
      { type: "thinking:start" },
      { type: "thinking:delta", text: "Let me think..." },
      { type: "thinking:end" },
      { type: "draft:delta", text: "Here is " },
      { type: "draft:delta", text: "the answer." },
    ]);

    expect(parts).toEqual([
      { type: "thinking", content: "Let me think...", streaming: false },
      { type: "text", content: "Here is the answer." },
    ]);
  });

  it("interleaves text and tool calls chronologically", () => {
    const parts = buildPartsFromEvents([
      { type: "draft:delta", text: "Let me read the file..." },
      { type: "tool:start", id: "t1", tool: "read" },
      { type: "tool:end", id: "t1", result: "file content" },
      { type: "draft:delta", text: "Here is the analysis." },
    ]);

    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ type: "text", content: "Let me read the file..." });
    expect(parts[1].type).toBe("tool");
    if (parts[1].type === "tool") {
      expect(parts[1].execution.tool).toBe("read");
      expect(parts[1].execution.status).toBe("completed");
    }
    expect(parts[2]).toEqual({ type: "text", content: "Here is the analysis." });
  });

  it("moves pre-tool text to thinking when tool starts", () => {
    const parts = buildPartsFromEvents([
      { type: "thinking:start" },
      { type: "thinking:delta", text: "Reasoning here" },
      { type: "thinking:end" },
      { type: "draft:delta", text: "I will call writer now" },
      { type: "tool:start", id: "t1", tool: "sub_agent", agent: "writer", stages: ["准备章节输入", "撰写章节草稿"] },
      { type: "log:stage", stageName: "准备章节输入" },
      { type: "log:stage", stageName: "撰写章节草稿" },
      { type: "tool:end", id: "t1" },
      { type: "draft:delta", text: "Chapter written." },
    ]);

    // Pre-tool text "I will call writer now" should become thinking, not a text part
    expect(parts[0].type).toBe("thinking");
    if (parts[0].type === "thinking") {
      expect(parts[0].content).toContain("Reasoning here");
      expect(parts[0].content).toContain("I will call writer now");
    }
    expect(parts[1].type).toBe("tool");
    if (parts[1].type === "tool") {
      expect(parts[1].execution.agent).toBe("writer");
      expect(parts[1].execution.stages).toHaveLength(2);
      expect(parts[1].execution.stages![0].status).toBe("completed");
      expect(parts[1].execution.stages![1].status).toBe("completed");
    }
    expect(parts[2]).toEqual({ type: "text", content: "Chapter written." });
  });

  it("handles multiple tool calls in sequence", () => {
    const parts = buildPartsFromEvents([
      { type: "tool:start", id: "t1", tool: "read" },
      { type: "tool:end", id: "t1" },
      { type: "tool:start", id: "t2", tool: "grep" },
      { type: "tool:end", id: "t2" },
      { type: "tool:start", id: "t3", tool: "sub_agent", agent: "writer", stages: ["准备章节输入"] },
      { type: "tool:end", id: "t3" },
      { type: "draft:delta", text: "Done." },
    ]);

    expect(parts).toHaveLength(4);
    expect(parts[0].type).toBe("tool"); // read
    expect(parts[1].type).toBe("tool"); // grep
    expect(parts[2].type).toBe("tool"); // writer
    expect(parts[3]).toEqual({ type: "text", content: "Done." });
  });

  it("tracks pipeline stages and progress on running tool", () => {
    const parts = buildPartsFromEvents([
      { type: "tool:start", id: "t1", tool: "sub_agent", agent: "writer", stages: ["步骤1", "步骤2"] },
      { type: "log:stage", stageName: "步骤1" },
      { type: "llm:progress", status: "thinking", elapsedMs: 5000, totalChars: 0, chineseChars: 0 },
    ]);

    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe("tool");
    if (parts[0].type === "tool") {
      const exec = parts[0].execution;
      expect(exec.status).toBe("running");
      expect(exec.stages![0].status).toBe("active");
      expect(exec.stages![0].progress?.status).toBe("thinking");
      expect(exec.stages![1].status).toBe("pending");
    }
  });

  it("handles multi-turn thinking (append, not overwrite)", () => {
    const parts = buildPartsFromEvents([
      { type: "thinking:start" },
      { type: "thinking:delta", text: "First thought" },
      { type: "thinking:end" },
      { type: "tool:start", id: "t1", tool: "read" },
      { type: "tool:end", id: "t1" },
      { type: "thinking:start" },
      { type: "thinking:delta", text: "Second thought" },
      { type: "thinking:end" },
      { type: "draft:delta", text: "Final answer" },
    ]);

    // Two thinking parts, tool in between, then text
    const thinkingParts = parts.filter(p => p.type === "thinking");
    expect(thinkingParts).toHaveLength(2);
    expect(thinkingParts[0].type === "thinking" && thinkingParts[0].content).toBe("First thought");
    expect(thinkingParts[1].type === "thinking" && thinkingParts[1].content).toBe("Second thought");
    expect(parts.map(p => p.type)).toEqual(["thinking", "tool", "thinking", "text"]);
  });

  it("marks tool error correctly", () => {
    const parts = buildPartsFromEvents([
      { type: "tool:start", id: "t1", tool: "sub_agent", agent: "writer" },
      { type: "tool:end", id: "t1", isError: true, result: "timeout" },
    ]);

    expect(parts[0].type).toBe("tool");
    if (parts[0].type === "tool") {
      expect(parts[0].execution.status).toBe("error");
      expect(parts[0].execution.error).toBe("timeout");
    }
  });
});
