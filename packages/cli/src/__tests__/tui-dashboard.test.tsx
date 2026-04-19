import React from "react";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import type { InteractionSession } from "@actalk/inkos-core";

function createSession(): InteractionSession {
  return {
    sessionId: "session-1",
    projectRoot: "/tmp/inkos-demo",
    activeBookId: "harbor",
    activeChapterNumber: 12,
    automationMode: "semi",
    currentExecution: {
      status: "writing",
      bookId: "harbor",
      chapterNumber: 12,
      stageLabel: "writing chapter",
    },
    pendingDecision: {
      kind: "review",
      bookId: "harbor",
      chapterNumber: 12,
      summary: "Review chapter 12 before publishing.",
    },
    messages: [
      { role: "user", content: "continue current book", timestamp: 1 },
      { role: "assistant", content: "Working on chapter 12.", timestamp: 2 },
    ],
    events: [
      {
        kind: "task.started",
        timestamp: 3,
        status: "writing",
        bookId: "harbor",
        chapterNumber: 12,
        detail: "Preparing chapter 12.",
      },
    ],
    draftRounds: [],
  };
}

describe("ink dashboard", () => {
  it("renders a codex-like single column with compact status and composer", async () => {
    const mod = await import("../tui/dashboard.js");

    const { lastFrame } = render(
      <mod.InkTuiDashboard
        locale="en"
        projectName="inkos-demo"
        activeBookTitle="Night Harbor Echo"
        modelLabel="gpt-5.4 (openai)"
        session={createSession()}
        inputValue=""
        isSubmitting={false}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("inkos-demo");
    expect(frame).toContain("Night Harbor Echo");
    expect(frame).toContain("gpt-5.4 (openai)");
    expect(frame).toContain("writing chapter");
    expect(frame).toContain("│");
    expect(frame).toContain("continue current book");
    expect(frame).not.toContain("You  continue current book");
    expect(frame).not.toContain("Header");
    expect(frame).not.toContain("Conversation");
    expect(frame).not.toContain("Status");
    expect(frame).not.toContain("Composer");
  });

  it("places the initial caret before the placeholder text", async () => {
    const mod = await import("../tui/dashboard.js");

    const { lastFrame } = render(
      <mod.InkTuiDashboard
        locale="en"
        projectName="inkos-demo"
        activeBookTitle="Night Harbor Echo"
        modelLabel="gpt-5.4 (openai)"
        session={createSession()}
        inputValue=""
        isSubmitting={false}
        showComposerCursor
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("│");
  });

  it("renders the compact status strip directly above the composer", async () => {
    const mod = await import("../tui/dashboard.js");

    const { lastFrame } = render(
      <mod.InkTuiDashboard
        locale="en"
        projectName="inkos-demo"
        activeBookTitle="Night Harbor Echo"
        modelLabel="gpt-5.4 (openai)"
        session={createSession()}
        inputValue="continue"
        isSubmitting
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("writing chapter");
    expect(frame).toContain("continue");
  });

  it("renders a slash autocomplete dropdown under the composer", async () => {
    const mod = await import("../tui/dashboard.js");

    const { lastFrame } = render(
      <mod.InkTuiDashboard
        locale="en"
        projectName="inkos-demo"
        activeBookTitle="Night Harbor Echo"
        modelLabel="gpt-5.4 (openai)"
        session={createSession()}
        inputValue="/c"
        isSubmitting={false}
        slashSuggestions={["/clear", "/config"]}
        selectedSlashIndex={1}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("/clear");
    expect(frame).toContain("/config");
    expect(frame.indexOf("/clear")).toBeGreaterThan(frame.indexOf("› /c"));
  });

  it("renders a low-frequency bar cursor in the active composer", async () => {
    const mod = await import("../tui/dashboard.js");

    const { lastFrame } = render(
      <mod.InkTuiDashboard
        locale="en"
        projectName="inkos-demo"
        activeBookTitle="Night Harbor Echo"
        modelLabel="gpt-5.4 (openai)"
        session={createSession()}
        inputValue="continue"
        isSubmitting={false}
        showComposerCursor
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("continue");
    expect(frame).toContain("│");
  });

  it("defaults dashboard chrome to Chinese when locale is zh-CN", async () => {
    const mod = await import("../tui/dashboard.js");

    const { lastFrame } = render(
      <mod.InkTuiDashboard
        locale="zh-CN"
        projectName="inkos-demo"
        activeBookTitle="夜港回声"
        modelLabel="gpt-5.4 (openai)"
        session={createSession()}
        inputValue=""
        isSubmitting={false}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("项目 inkos-demo");
    expect(frame).toContain("作品 夜港回声");
    expect(frame).toContain("深度 标准");
    expect(frame).toContain("项目");
  });

  it("surfaces the shared creation draft when no active book exists yet", async () => {
    const mod = await import("../tui/dashboard.js");

    const draftSession: InteractionSession = {
      ...createSession(),
      activeBookId: undefined,
      activeChapterNumber: undefined,
      currentExecution: {
        status: "planning",
        stageLabel: "developing book draft",
      },
      pendingDecision: undefined,
      creationDraft: {
        concept: "港风商战悬疑，主角从灰产洗白。",
        title: "夜港账本",
        nextQuestion: "你更想写长篇连载，还是十来章能收住？",
        missingFields: ["targetChapters"],
        readyToCreate: false,
      },
      messages: [
        { role: "user", content: "我想写个港风商战悬疑。", timestamp: 1 },
        { role: "assistant", content: "先把这本书的大概方向收住。", timestamp: 2 },
      ],
      events: [],
    };

    const { lastFrame } = render(
      <mod.InkTuiDashboard
        locale="zh-CN"
        projectName="inkos-demo"
        modelLabel="gpt-5.4 (openai)"
        session={draftSession}
        inputValue=""
        isSubmitting={false}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("草稿 夜港账本");
  });
});
