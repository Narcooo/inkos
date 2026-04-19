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
});
