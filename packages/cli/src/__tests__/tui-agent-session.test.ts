import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProjectSession, loadProjectSession } from "../tui/session-store.js";

const {
  runAgentSessionMock,
  loadConfigMock,
  buildPipelineConfigMock,
} = vi.hoisted(() => ({
  runAgentSessionMock: vi.fn(),
  loadConfigMock: vi.fn(),
  buildPipelineConfigMock: vi.fn(),
}));

vi.mock("@actalk/inkos-core", async () => {
  const actual = await vi.importActual<typeof import("@actalk/inkos-core")>("@actalk/inkos-core");
  class PipelineRunnerMock {
    constructor(_config: unknown) {}
    async initBook(_book: unknown, _options?: unknown) {}
    async writeNextChapter(_bookId: string) {
      return {
        chapterNumber: 1,
        title: "雨夜",
        wordCount: 1200,
        status: "ready-for-review",
      };
    }
  }
  return {
    ...actual,
    createLLMClient: vi.fn(() => ({
      _piModel: {
        id: "gpt-5.4",
        name: "gpt-5.4",
        api: "openai-completions",
        provider: "openai",
        baseUrl: "https://right.codes/codex/v1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
      },
      _apiKey: "secret",
    })),
    PipelineRunner: PipelineRunnerMock as any,
    runAgentSession: runAgentSessionMock,
  };
});

vi.mock("../utils.js", () => ({
  loadConfig: loadConfigMock,
  buildPipelineConfig: buildPipelineConfigMock,
}));

describe("tui agent session bridge", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "inkos-tui-agent-"));
    vi.clearAllMocks();
    loadConfigMock.mockResolvedValue({
      llm: {
        provider: "openai",
        model: "gpt-5.4",
        baseUrl: "https://right.codes/codex/v1",
        apiFormat: "chat",
        stream: false,
      },
      language: "zh",
    });
    buildPipelineConfigMock.mockReturnValue({});
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("runs agent chat and persists raw assistant output into the tui session", async () => {
    runAgentSessionMock.mockResolvedValue({
      responseText: "这是 agent 直接返回的回复。",
      messages: [
        { role: "user", content: "帮我整理这一章" },
        { role: "assistant", content: "这是 agent 直接返回的回复。", thinking: "internal" },
      ],
    });

    const { processTuiAgentInput } = await import("../tui/agent-input.js");
    const session = {
      ...createProjectSession(projectRoot),
      activeBookId: "harbor",
      messages: [
        { role: "user" as const, content: "旧问题", timestamp: 1 },
        { role: "assistant" as const, content: "旧回答", timestamp: 2 },
      ],
    };

    const result = await processTuiAgentInput({
      projectRoot,
      input: "帮我整理这一章",
      session,
      activeBookId: "harbor",
    });

    expect(runAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.sessionId,
        bookId: "harbor",
        projectRoot,
      }),
      "帮我整理这一章",
      [
        { role: "user", content: "旧问题" },
        { role: "assistant", content: "旧回答" },
      ],
    );
    expect(result.responseText).toBe("这是 agent 直接返回的回复。");
    expect(result.session.messages.at(-1)).toEqual(expect.objectContaining({
      role: "assistant",
      content: "这是 agent 直接返回的回复。",
      thinking: "internal",
    }));

    const persisted = await loadProjectSession(projectRoot);
    expect(persisted.messages.at(-1)).toEqual(expect.objectContaining({
      role: "assistant",
      content: "这是 agent 直接返回的回复。",
    }));
  });

  it("stores the created book from architect tool results as the active TUI book", async () => {
    runAgentSessionMock.mockResolvedValue({
      responseText: "《夜港》已创建成功。",
      messages: [
        {
          role: "toolResult",
          details: { kind: "book_created", bookId: "night-harbor", title: "夜港" },
        },
        { role: "assistant", content: "《夜港》已创建成功。" },
      ],
    });

    const { processTuiAgentInput } = await import("../tui/agent-input.js");
    const session = createProjectSession(projectRoot);

    const result = await processTuiAgentInput({
      projectRoot,
      input: "创建《夜港》",
      session,
    });

    expect(result.session.activeBookId).toBe("night-harbor");
    const persisted = await loadProjectSession(projectRoot);
    expect(persisted.activeBookId).toBe("night-harbor");
  });

  it("keeps ordinary creation language in chat so the agent can propose a confirmed action", async () => {
    runAgentSessionMock.mockResolvedValue({
      responseText: "我理解你想创建《雾灯小巷》，请确认后我再建书。",
      messages: [
        { role: "assistant", content: "我理解你想创建《雾灯小巷》，请确认后我再建书。" },
      ],
    });
    const { processTuiAgentInput } = await import("../tui/agent-input.js");
    const session = createProjectSession(projectRoot);

    const result = await processTuiAgentInput({
      projectRoot,
      input: "创建一本10章中文都市悬疑短篇，标题《雾灯小巷》，目标平台番茄，每章约1200字。信息足够，请直接建书。",
      session,
    });

    expect(runAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKind: "chat",
        actionSource: "free-text",
      }),
      expect.stringContaining("雾灯小巷"),
      [],
    );
    expect(result.session.activeBookId).toBeUndefined();
    expect(result.responseText).toContain("请确认");
    const persisted = await loadProjectSession(projectRoot);
    expect(persisted.activeBookId).toBeUndefined();
  });

  it("uses explicit slash entries to select book, short, and play surfaces without parsing free text", async () => {
    runAgentSessionMock.mockResolvedValue({
      responseText: "先讨论并确认方向。",
      messages: [{ role: "assistant", content: "先讨论并确认方向。" }],
    });
    const { processTuiAgentInput } = await import("../tui/agent-input.js");

    const withBook = { ...createProjectSession(projectRoot), activeBookId: "old-book" };
    const newBook = await processTuiAgentInput({
      projectRoot,
      input: "/new 一部海港悬疑长篇",
      session: withBook,
      activeBookId: "old-book",
    });
    expect(runAgentSessionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ bookId: null, sessionKind: "book-create", actionSource: "slash" }),
      "一部海港悬疑长篇",
      [],
    );
    expect(newBook.session.activeBookId).toBeUndefined();

    await processTuiAgentInput({
      projectRoot,
      input: "/short 婚姻背叛后的证据反杀",
      session: createProjectSession(projectRoot),
    });
    expect(runAgentSessionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ bookId: null, sessionKind: "short", actionSource: "slash" }),
      "婚姻背叛后的证据反杀",
      [],
    );

    await processTuiAgentInput({
      projectRoot,
      input: "/play open 雨夜便利店里时间停止",
      session: createProjectSession(projectRoot),
    });
    expect(runAgentSessionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ bookId: null, sessionKind: "play", playMode: "open" }),
      "雨夜便利店里时间停止",
      [],
    );
  });

  it("persists a structured proposal and replays its payload and skills only after confirmation", async () => {
    runAgentSessionMock.mockResolvedValueOnce({
      responseText: "",
      messages: [{
        role: "toolResult",
        details: {
          kind: "proposed_action",
          action: "interactive_film_create",
          targetSessionKind: "interactive-film",
          title: "创建互动影游",
          summary: "确认后生成项目。",
          instruction: "把上传的故事改成三幕互动影游",
          requestedSkills: ["interactive-film-authoring"],
          actionPayload: {
            interactiveFilmCreate: {
              title: "回声航线",
              sourcePath: ".inkos/uploads/echo.md",
              episodeCount: 3,
            },
          },
        },
      }],
    });
    runAgentSessionMock.mockResolvedValueOnce({
      responseText: "互动影游项目已生成。",
      messages: [{ role: "assistant", content: "互动影游项目已生成。" }],
    });
    const { processTuiAgentInput } = await import("../tui/agent-input.js");

    const proposed = await processTuiAgentInput({
      projectRoot,
      input: "把这个故事做成互动影游",
      session: createProjectSession(projectRoot),
    });
    expect(proposed.responseText).toContain("输入 /confirm");
    expect(proposed.session.pendingProposedAction).toEqual(expect.objectContaining({
      action: "interactive_film_create",
      targetSessionKind: "interactive-film",
      requestedSkills: ["interactive-film-authoring"],
      actionPayload: expect.objectContaining({
        interactiveFilmCreate: expect.objectContaining({ title: "回声航线" }),
      }),
    }));

    const confirmed = await processTuiAgentInput({
      projectRoot,
      input: "/confirm",
      session: proposed.session,
    });
    expect(runAgentSessionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bookId: null,
        sessionKind: "interactive-film",
        actionSource: "slash",
        requestedIntent: "interactive_film_create",
        requestedSkills: ["interactive-film-authoring"],
        actionPayload: {
          interactiveFilmCreate: {
            title: "回声航线",
            sourcePath: ".inkos/uploads/echo.md",
            episodeCount: 3,
          },
        },
      }),
      "把上传的故事改成三幕互动影游",
      expect.any(Array),
    );
    expect(confirmed.session.pendingProposedAction).toBeUndefined();
  });

  it("uses the per-session model override when resolving the model client", async () => {
    runAgentSessionMock.mockResolvedValue({
      responseText: "已按当前模型回复。",
      messages: [{ role: "assistant", content: "已按当前模型回复。" }],
    });
    const { processTuiAgentInput } = await import("../tui/agent-input.js");
    await processTuiAgentInput({
      projectRoot,
      input: "概括当前进度",
      session: { ...createProjectSession(projectRoot), modelOverride: "deepseek-v4-pro" },
    });

    expect(loadConfigMock).toHaveBeenCalledWith(expect.objectContaining({
      requireApiKey: false,
      projectRoot,
      cli: { model: "deepseek-v4-pro" },
    }));
  });

  it("passes explicit slash write-next as a requested intent to the unified agent session", async () => {
    runAgentSessionMock.mockResolvedValue({
      responseText: "已为 night-harbor 完成下一章。",
      messages: [
        { role: "assistant", content: "已为 night-harbor 完成下一章。" },
      ],
    });
    const { processTuiAgentInput } = await import("../tui/agent-input.js");
    const session = {
      ...createProjectSession(projectRoot),
      activeBookId: "night-harbor",
    };

    const result = await processTuiAgentInput({
      projectRoot,
      input: "/write",
      session,
    });

    expect(runAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId: "night-harbor",
        sessionKind: "book",
        actionSource: "slash",
        requestedIntent: "write_next",
      }),
      "写下一章",
      [],
    );
    expect(result.responseText).toContain("完成下一章");
    const persisted = await loadProjectSession(projectRoot);
    expect(persisted.activeBookId).toBe("night-harbor");
  });
});
