import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTuiFrame } from "../tui/app.js";
import { drawInputHint } from "../tui/effects.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tui layout", () => {
  it("renders a codex-like single-column workspace preview", () => {
    const frame = renderTuiFrame({
      locale: "zh-CN",
      projectName: "inkos-demo",
      activeBookTitle: undefined,
      automationMode: "semi",
      status: "idle",
    });

    expect(frame).toContain("项目 inkos-demo");
    expect(frame).toContain("阶段 就绪");
    expect(frame).toContain("模式 半自动");
    expect(frame).not.toContain("Header");
    expect(frame).not.toContain("Conversation");
    expect(frame).not.toContain("Status");
    expect(frame).not.toContain("Composer");
    expect(frame).toContain("告诉 InkOS");
  });

  it("keeps the two-line status strip above the composer preview", () => {
    const frame = renderTuiFrame({
      locale: "en",
      projectName: "inkos-demo",
      activeBookTitle: "Night Harbor Echo",
      automationMode: "auto",
      status: "writing",
      messages: ["user: continue", "assistant: Completed write_next for harbor."],
      events: ["task.completed: Completed write_next for harbor."],
    });

    expect(frame).toContain("Night Harbor Echo");
    expect(frame).toContain("writing");
    expect(frame).toContain("user: continue");
    expect(frame).toContain("task.completed: Completed write_next for harbor.");
    expect(frame.indexOf("task.completed: Completed write_next for harbor.")).toBeLessThan(frame.indexOf("Ask InkOS"));
    expect(frame.indexOf("Mode auto")).toBeLessThan(frame.indexOf("Ask InkOS"));
  });

  it("does not add blank lines before the readline prompt", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    drawInputHint();

    expect(logSpy).not.toHaveBeenCalled();
  });
});
