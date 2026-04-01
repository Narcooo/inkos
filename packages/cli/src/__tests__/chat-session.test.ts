import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { rm } from "node:fs/promises";
import { ChatHistoryManager } from "../chat/history.js";
import type { PipelineConfig } from "@actalk/inkos-core";

const runAgentLoopMock = vi.fn();
const resolveBookIdMock = vi.fn(async (bookIdArg: string | undefined) => {
  if (!bookIdArg || bookIdArg === "missing-book") {
    throw new Error('Book "missing-book" not found. Available books: demo-book');
  }

  return bookIdArg;
});

vi.mock("@actalk/inkos-core", () => ({
  runAgentLoop: runAgentLoopMock,
}));

vi.mock("../utils.js", () => ({
  resolveBookId: resolveBookIdMock,
}));

describe("ChatSession", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await rm(".test-chat-session", { recursive: true, force: true });
  });

  afterAll(async () => {
    await rm(".test-chat-session", { recursive: true, force: true });
  });

  test("records invalid slash commands in chat history so the user can see the error", async () => {
    const { ChatSession } = await import("../chat/session.js");
    const historyManager = new ChatHistoryManager({
      historyDir: ".test-chat-session",
      maxMessages: 10,
    });
    const session = new ChatSession({} as PipelineConfig, "demo-book", historyManager);

    await session.initialize();

    const result = await session.processInput("/switch");

    expect(result.success).toBe(false);
    expect(session.getHistory().messages).toHaveLength(2);
    expect(session.getHistory().messages[0]?.content).toBe("/switch");
    expect(session.getHistory().messages[1]?.content).toContain("至少需要");
  });

  test("handles /exit locally without sending it to the agent loop", async () => {
    const { ChatSession } = await import("../chat/session.js");
    const historyManager = new ChatHistoryManager({
      historyDir: ".test-chat-session",
      maxMessages: 10,
    });
    const session = new ChatSession({} as PipelineConfig, "demo-book", historyManager);

    await session.initialize();

    const result = await session.processInput("/exit");

    expect(result).toMatchObject({
      success: true,
      shouldExit: true,
      message: "退出聊天界面",
    });
    expect(runAgentLoopMock).not.toHaveBeenCalled();
    expect(session.getHistory().messages).toHaveLength(0);
  });

  test("handles /clear via processInput without sending it to the agent loop", async () => {
    const { ChatSession } = await import("../chat/session.js");
    const historyManager = new ChatHistoryManager({
      historyDir: ".test-chat-session",
      maxMessages: 10,
    });
    const session = new ChatSession({} as PipelineConfig, "demo-book", historyManager);

    await session.initialize();
    await session.processInput("写下一章");
    expect(session.getHistory().messages.length).toBeGreaterThan(0);

    const result = await session.processInput("/clear");

    expect(result).toMatchObject({
      success: true,
      clearConversation: true,
      message: "对话历史已清空",
    });
    expect(runAgentLoopMock).toHaveBeenCalledTimes(1);
    expect(session.getHistory().messages).toHaveLength(0);
  });

  test("returns help text that matches automatic slash-command suggestions", async () => {
    const { ChatSession } = await import("../chat/session.js");
    const historyManager = new ChatHistoryManager({
      historyDir: ".test-chat-session",
      maxMessages: 10,
    });
    const session = new ChatSession({} as PipelineConfig, "demo-book", historyManager);

    await session.initialize();

    const result = await session.processInput("/help");

    expect(result.success).toBe(true);
    expect(result.message).toContain("输入 `/` 后会自动显示可用命令");
    expect(result.message).toContain("按 **Tab** 可补全当前选中的命令");
    expect(result.message).not.toContain("按 **Tab** 键查看匹配的命令");
    expect(runAgentLoopMock).not.toHaveBeenCalled();
  });

  test("rejects switching to a non-existent book instead of creating a phantom chat session", async () => {
    const { ChatSession } = await import("../chat/session.js");
    const historyManager = new ChatHistoryManager({
      historyDir: ".test-chat-session",
      maxMessages: 10,
    });
    const session = new ChatSession({ projectRoot: "/project" } as PipelineConfig, "demo-book", historyManager);

    await session.initialize();

    const result = await session.processInput("/switch missing-book");

    expect(result.success).toBe(false);
    expect(session.getCurrentBook()).toBe("demo-book");
    expect(session.getHistory().messages.at(-1)?.content).toContain("not found");
    expect(resolveBookIdMock).toHaveBeenCalledWith("missing-book", "/project");
  });

  test("records agent-loop failures in chat history so the error is visible after submission", async () => {
    runAgentLoopMock.mockRejectedValueOnce(new Error("INKOS_LLM_API_KEY not set"));

    const { ChatSession } = await import("../chat/session.js");
    const historyManager = new ChatHistoryManager({
      historyDir: ".test-chat-session",
      maxMessages: 10,
    });
    const session = new ChatSession({} as PipelineConfig, "demo-book", historyManager);

    await session.initialize();

    const result = await session.processInput("写下一章");

    expect(result.success).toBe(false);
    expect(session.getHistory().messages).toHaveLength(2);
    expect(session.getHistory().messages[0]?.content).toBe("写下一章");
    expect(session.getHistory().messages[1]?.content).toContain("API 密钥未设置");
    expect(session.getHistory().messages[1]?.content).toContain("建议:");
  });

  test("reports orchestrator and tool agent model metadata during agent-loop execution", async () => {
    runAgentLoopMock.mockImplementationOnce(async (_config, _instruction, options) => {
      options?.onToolCall?.("plan_chapter", { bookId: "demo-book" });
      options?.onToolResult?.("plan_chapter", JSON.stringify({ ok: true }));
      return "done";
    });

    const metadataChanges: Array<Record<string, unknown> | null> = [];
    const { ChatSession } = await import("../chat/session.js");
    const historyManager = new ChatHistoryManager({
      historyDir: ".test-chat-session",
      maxMessages: 10,
    });
    const session = new ChatSession({
      client: {} as PipelineConfig["client"],
      model: "base-model",
      projectRoot: "/project",
      defaultLLMConfig: {
        provider: "openai",
        baseUrl: "https://example.com",
        apiKey: "test-key",
        model: "base-model",
        temperature: 0.7,
        maxTokens: 4096,
        thinkingBudget: 0,
        apiFormat: "chat",
        stream: true,
      },
      modelOverrides: {
        planner: "planner-model",
      },
    } as PipelineConfig, "demo-book", historyManager);

    await session.initialize();
    await session.processInput("/write", {
      onExecutionMetadataChange: (metadata) => {
        metadataChanges.push(metadata as Record<string, unknown> | null);
      },
    });

    expect(metadataChanges[0]).toMatchObject({
      scope: "orchestrator",
      label: "inkos-agent",
      model: "base-model",
      provider: "openai",
    });
    expect(metadataChanges[1]).toMatchObject({
      scope: "agent",
      label: "planner",
      toolName: "plan_chapter",
      model: "planner-model",
      provider: "openai",
    });
    expect(metadataChanges.at(-1)).toBeNull();
  });

  test("allows chat session creation without requiring an API key during initialization", async () => {
    const historyManager = new ChatHistoryManager({
      historyDir: ".test-chat-session",
      maxMessages: 10,
    });
    const { ChatSession } = await import("../chat/session.js");

    const session = new ChatSession({
      client: {} as PipelineConfig["client"],
      model: "base-model",
      projectRoot: "/project",
    } as PipelineConfig, "demo-book", historyManager);

    await expect(session.initialize()).resolves.toBeUndefined();
  });
});
