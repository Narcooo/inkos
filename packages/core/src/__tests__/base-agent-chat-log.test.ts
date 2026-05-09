import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Writable } from "node:stream";
import { BaseAgent, type AgentContext } from "../agents/base.js";
import * as provider from "../llm/provider.js";

class RecordingWritable extends Writable {
  public chunks: string[] = [];

  _write(chunk: any, _encoding: string, callback: () => void) {
    this.chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    callback();
  }

  getWritten(): string {
    return this.chunks.join("");
  }
}

const AGENT_CONTEXT_BASE: AgentContext = {
  client: {
    provider: "openai" as const,
    apiFormat: "chat" as const,
    stream: false,
    defaults: {
      temperature: 0.7,
      maxTokens: 4096,
      thinkingBudget: 0,
      extra: {},
    },
    service: "openai",
    _piModel: { baseUrl: "https://api.openai.com/v1", id: "test-model" },
  } as any,
  model: "test-model",
  projectRoot: "/tmp/test",
};

class TestAgent extends BaseAgent {
  get name() {
    return "test-agent";
  }

  private _writable: Writable | undefined;

  setWritable(writable: Writable | undefined) {
    this._writable = writable;
  }

  protected _createChatLogWriteStream(): Writable | undefined {
    const logDir = this.ctx.chatLogDir;
    if (!logDir) return undefined;
    return this._writable;
  }

  async callChat(messages: ReadonlyArray<{ role: string; content: string }>) {
    return this.chat(messages as never);
  }
}

describe("BaseAgent chat log", () => {
  let agent: TestAgent;

  beforeEach(() => {
    vi.spyOn(provider, "chatCompletion").mockResolvedValue({
      content: "mock response",
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes header line with model and provider info", async () => {
    const recording = new RecordingWritable();
    agent = new TestAgent({
      ...AGENT_CONTEXT_BASE,
      chatLogDir: "/fake/dir",
    });
    agent.setWritable(recording);

    await agent.callChat([{ role: "user", content: "hello" }]);

    const lines = recording.getWritten().split("\n");
    expect(lines[0]).toMatch(/^\[test-agent\] >>> BEGIN >>>/);
    expect(lines[0]).toContain("model=test-model");
    expect(lines[0]).toContain("provider=openai");
    expect(lines[0]).toContain("messageCount=1");
  });

  it("writes prompt messages to chat log", async () => {
    const recording = new RecordingWritable();
    agent = new TestAgent({
      ...AGENT_CONTEXT_BASE,
      chatLogDir: "/fake/dir",
    });
    agent.setWritable(recording);

    await agent.callChat([
      { role: "system", content: "system prompt" },
      { role: "user", content: "user message" },
    ]);

    const written = recording.getWritten();
    expect(written).toContain("PROMPT [system] (13 chars):");
    expect(written).toContain("system prompt");
    expect(written).toContain("PROMPT [user] (12 chars):");
    expect(written).toContain("user message");
  });

  it("writes response with content and token usage", async () => {
    const recording = new RecordingWritable();
    agent = new TestAgent({
      ...AGENT_CONTEXT_BASE,
      chatLogDir: "/fake/dir",
    });
    agent.setWritable(recording);

    await agent.callChat([{ role: "user", content: "hello" }]);

    const written = recording.getWritten();
    expect(written).toContain("<<< RESPONSE <<<");
    expect(written).toContain("mock response");
    expect(written).toContain("prompt=100");
    expect(written).toContain("completion=50");
    expect(written).toContain("total=150");
    expect(written).toContain("=== END ===");
  });

  it("ends stream after successful chat", async () => {
    const recording = new RecordingWritable();
    const endSpy = vi.spyOn(recording, "end");
    agent = new TestAgent({
      ...AGENT_CONTEXT_BASE,
      chatLogDir: "/fake/dir",
    });
    agent.setWritable(recording);

    await agent.callChat([{ role: "user", content: "hello" }]);

    expect(endSpy).toHaveBeenCalledTimes(1);
  });

  it("ends stream when chat throws", async () => {
    vi.spyOn(provider, "chatCompletion").mockRejectedValue(new Error("API error"));

    const recording = new RecordingWritable();
    const endSpy = vi.spyOn(recording, "end");
    agent = new TestAgent({
      ...AGENT_CONTEXT_BASE,
      chatLogDir: "/fake/dir",
    });
    agent.setWritable(recording);

    await expect(
      agent.callChat([{ role: "user", content: "hello" }]),
    ).rejects.toThrow("API error");

    expect(endSpy).toHaveBeenCalledTimes(1);
  });

  it("does not write to stream when chatLogDir is not set", async () => {
    const recording = new RecordingWritable();
    const writeSpy = vi.spyOn(recording, "write");
    agent = new TestAgent({
      ...AGENT_CONTEXT_BASE,
      // chatLogDir intentionally not set
    });
    agent.setWritable(recording);

    const response = await agent.callChat([{ role: "user", content: "hello" }]);

    expect(response.content).toBe("mock response");
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
