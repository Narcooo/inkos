import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Type } from "@sinclair/typebox";
import { runWorkerAgent, runWorkerAgentTool } from "../agent/worker-agent.js";
import { BaseAgent, type AgentContext } from "../agents/base.js";

const chatCompletionMock = vi.hoisted(() => vi.fn());
const guardedPiStreamMock = vi.hoisted(() => vi.fn());

vi.mock("../llm/provider.js", () => ({
  chatCompletion: chatCompletionMock,
}));

vi.mock("../agent/pi-stream.js", async () => {
  const actual = await vi.importActual<typeof import("../agent/pi-stream.js")>("../agent/pi-stream.js");
  return { ...actual, guardedPiStream: guardedPiStreamMock };
});

function client(): AgentContext["client"] {
  return {
    provider: "openai",
    service: "kkaiapi",
    apiFormat: "chat",
    stream: true,
    defaults: {
      temperature: 0.7,
      maxTokens: 4096,
      thinkingBudget: 0,
      extra: {},
    },
    _piModel: {
      id: "deepseek-v4-flash",
      name: "deepseek-v4-flash",
      api: "openai-completions",
      provider: "openai",
      baseUrl: "https://api.kkaiapi.com/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 32_768,
    },
  };
}

class TwoStepWorker extends BaseAgent {
  get name(): string { return "two-step"; }

  async run(): Promise<void> {
    await this.chat([{ role: "user", content: "第一步" }]);
    await this.chat([{ role: "user", content: "第二步" }]);
  }
}

describe("Pi worker harness", () => {
  beforeEach(() => {
    chatCompletionMock.mockReset();
    guardedPiStreamMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs worker messages through the InkOS provider boundary", async () => {
    chatCompletionMock.mockResolvedValue({
      content: "完成",
      usage: { promptTokens: 12, completionTokens: 3, totalTokens: 15 },
    });

    const result = await runWorkerAgent(client(), "deepseek-v4-pro", [
      { role: "system", content: "你是审稿员" },
      { role: "user", content: "检查第一章" },
    ], { temperature: 0.2, maxTokens: 8000 });

    expect(result).toEqual({
      content: "完成",
      usage: { promptTokens: 12, completionTokens: 3, totalTokens: 15 },
    });
    expect(chatCompletionMock).toHaveBeenCalledTimes(1);
    expect(chatCompletionMock.mock.calls[0]?.[1]).toBe("deepseek-v4-pro");
    expect(chatCompletionMock.mock.calls[0]?.[2]).toEqual([
      { role: "system", content: "你是审稿员" },
      { role: "user", content: "检查第一章" },
    ]);
    expect(chatCompletionMock.mock.calls[0]?.[3]).toMatchObject({
      temperature: 0.2,
      maxTokens: 8000,
    });
  });

  it("preserves provider failures instead of turning them into successful prose", async () => {
    chatCompletionMock.mockRejectedValue(new Error("upstream unavailable"));

    await expect(runWorkerAgent(client(), "deepseek-v4-flash", [
      { role: "user", content: "写作" },
    ])).rejects.toThrow("upstream unavailable");
  });

  it("keeps provider defaults implicit and tolerates missing usage telemetry", async () => {
    chatCompletionMock.mockResolvedValue({ content: "完成" });

    const result = await runWorkerAgent(client(), "deepseek-v4-flash", [
      { role: "user", content: "写作" },
    ]);

    expect(result).toEqual({
      content: "完成",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
    expect(chatCompletionMock.mock.calls[0]?.[3]).not.toHaveProperty("maxTokens");
    expect(chatCompletionMock.mock.calls[0]?.[3]).not.toHaveProperty("temperature");
  });

  it("aborts the current worker and never starts the next serial step", async () => {
    const controller = new AbortController();
    chatCompletionMock.mockImplementationOnce(async (
      _client,
      _model,
      _messages,
      options: { signal?: AbortSignal },
    ) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    }));
    const worker = new TwoStepWorker({
      client: client(),
      model: "deepseek-v4-flash",
      projectRoot: "/tmp/inkos-worker-test",
      signal: controller.signal,
    });

    const running = worker.run();
    await vi.waitFor(() => expect(chatCompletionMock).toHaveBeenCalledTimes(1));
    controller.abort(new DOMException("user stopped", "AbortError"));

    await expect(running).rejects.toThrow("user stopped");
    expect(chatCompletionMock).toHaveBeenCalledTimes(1);
  });

  it("submits host-consumed state through one typed Pi tool call", async () => {
    const { createAssistantMessageEventStream } = await import("@mariozechner/pi-ai");
    guardedPiStreamMock.mockImplementation((model: AgentContext["client"]["_piModel"]) => {
      const stream = createAssistantMessageEventStream();
      const message = {
        role: "assistant" as const,
        content: [{
          type: "toolCall" as const,
          id: "state-1",
          name: "submit_state",
          arguments: { label: "母亲", status: "等待退烧药" },
        }],
        api: model?.api ?? "openai-completions",
        provider: model?.provider ?? "openai",
        model: model?.id ?? "deepseek-v4-flash",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse" as const,
        timestamp: Date.now(),
      };
      stream.push({ type: "done", reason: "toolUse", message });
      stream.end(message);
      return stream;
    });

    const result = await runWorkerAgentTool(
      client(),
      "deepseek-v4-flash",
      [{ role: "user", content: "登记当前角色状态" }],
      {
        name: "submit_state",
        label: "提交状态",
        description: "提交角色状态。",
        parameters: Type.Object({
          label: Type.String(),
          status: Type.String(),
        }),
      },
    );

    expect(result).toEqual({ label: "母亲", status: "等待退烧药" });
    expect(guardedPiStreamMock).toHaveBeenCalledTimes(1);
  });
});
