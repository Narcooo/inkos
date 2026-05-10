import { describe, expect, it } from "vitest";
import type { SessionRuntime } from "../../types";
import { createSessionRuntime } from "./runtime";
import {
  applyDraftDelta,
  applyLlmProgress,
  applyThinkingDelta,
  applyThinkingEnd,
  applyThinkingStart,
  applyToolEnd,
  applyToolLog,
  applyToolStart,
} from "./stream-reducers";

function applyPatch(runtime: SessionRuntime, patch: Partial<SessionRuntime>): SessionRuntime {
  return { ...runtime, ...patch };
}

describe("stream reducers", () => {
  it("builds thinking and draft text parts", () => {
    let runtime = createSessionRuntime({ sessionId: "s1", bookId: null, title: null });
    runtime = applyPatch(runtime, applyThinkingStart(runtime, 100));
    runtime = applyPatch(runtime, applyThinkingDelta(runtime, 100, "plan"));
    runtime = applyPatch(runtime, applyThinkingEnd(runtime, 100));
    runtime = applyPatch(runtime, applyDraftDelta(runtime, 100, "answer"));

    expect(runtime.messages).toHaveLength(1);
    const message = runtime.messages[0];
    expect(message.content).toBe("answer");
    expect(message.thinking).toBe("plan");
    expect(message.thinkingStreaming).toBeUndefined();
    expect(message.parts).toEqual([
      { type: "thinking", content: "plan", streaming: false },
      { type: "text", content: "answer" },
    ]);
  });

  it("moves sub-agent preamble text into thinking and records tool logs", () => {
    let runtime = createSessionRuntime({ sessionId: "s1", bookId: "book", title: null });
    runtime = applyPatch(runtime, applyDraftDelta(runtime, 100, "I will call writer"));
    runtime = applyPatch(runtime, applyToolStart(runtime, 100, {
      id: "tool-1",
      tool: "sub_agent",
      args: { agent: "writer" },
      stages: ["准备", "写作"],
    }, 123));
    runtime = applyPatch(runtime, applyToolLog(runtime, 100, "started"));

    const parts = runtime.messages[0].parts ?? [];
    expect(parts[0]).toEqual({ type: "thinking", content: "I will call writer", streaming: false });
    expect(parts[1].type).toBe("tool");
    if (parts[1].type === "tool") {
      expect(parts[1].execution.agent).toBe("writer");
      expect(parts[1].execution.label).toBe("写作");
      expect(parts[1].execution.logs).toEqual(["started"]);
      expect(parts[1].execution.stages).toEqual([
        { label: "准备", status: "pending" },
        { label: "写作", status: "pending" },
      ]);
    }
  });

  it("finalizes tool state and localizes known tool errors", () => {
    let runtime = createSessionRuntime({ sessionId: "s1", bookId: null, title: null });
    runtime = applyPatch(runtime, applyToolStart(runtime, 100, {
      id: "tool-1",
      tool: "sub_agent",
      args: { agent: "writer" },
      stages: ["写作"],
    }, 123));
    runtime = applyPatch(runtime, applyToolEnd(runtime, 100, {
      id: "tool-1",
      tool: "sub_agent",
      isError: true,
      result: "Latest chapter 1 is state-degraded. Repair state or rewrite that chapter before continuing.",
    }, 456));

    const part = runtime.messages[0].parts?.[0];
    expect(part?.type).toBe("tool");
    if (part?.type === "tool") {
      expect(part.execution.status).toBe("error");
      expect(part.execution.completedAt).toBe(456);
      expect(part.execution.error).toBe(
        "最新第 1 章处于状态降级（state-degraded）。继续写下一章前，请先修复状态，或重写这一章。",
      );
      expect(part.execution.stages?.[0].status).toBe("completed");
    }
  });

  it("attaches llm progress to the active stage", () => {
    let runtime = createSessionRuntime({ sessionId: "s1", bookId: null, title: null });
    runtime = applyPatch(runtime, applyToolStart(runtime, 100, {
      id: "tool-1",
      tool: "sub_agent",
      args: { agent: "writer" },
      stages: ["写作"],
    }, 123));

    const toolPart = runtime.messages[0].parts?.[0];
    if (toolPart?.type === "tool") {
      toolPart.execution.stages![0].status = "active";
    }
    runtime = applyPatch(runtime, applyLlmProgress(runtime, 100, {
      status: "streaming",
      elapsedMs: 1000,
      totalChars: 20,
      chineseChars: 10,
    }));

    const part = runtime.messages[0].parts?.[0];
    expect(part?.type).toBe("tool");
    if (part?.type === "tool") {
      expect(part.execution.stages?.[0].progress).toEqual({
        status: "streaming",
        elapsedMs: 1000,
        totalChars: 20,
        chineseChars: 10,
      });
    }
  });
});
