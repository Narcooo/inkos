import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseAgent } from "../agents/base.js";
import { LengthNormalizerAgent } from "../agents/length-normalizer.js";
import { LengthSpecSchema } from "../models/length-governance.js";
import { countChapterLength } from "../utils/length-metrics.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

const AGENT_CONTEXT = {
  client: {
    provider: "openai",
    apiFormat: "chat",
    stream: false,
    defaults: {
      temperature: 0.7,
      maxTokens: 4096,
      thinkingBudget: 0, maxTokensCap: null,
      extra: {},
    },
  } as const,
  model: "test-model",
  projectRoot: "/tmp/inkos-length-normalizer-test",
};

function createAgent(): LengthNormalizerAgent {
  return new LengthNormalizerAgent(AGENT_CONTEXT as never);
}

describe("LengthNormalizerAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("compresses a long draft while preserving required markers", async () => {
    const agent = createAgent();
    const chatSpy = vi.spyOn(BaseAgent.prototype as never, "chat").mockResolvedValue({
      content: "压缩后的正文。".repeat(8) + "[[KEEP_ME]]",
      usage: ZERO_USAGE,
    });
    const lengthSpec = LengthSpecSchema.parse({
      target: 220,
      softMin: 190,
      softMax: 250,
      hardMin: 160,
      hardMax: 280,
      countingMode: "zh_chars",
      normalizeMode: "compress",
    });
    const draft = "开头。" + "多余句子。".repeat(80) + "[[KEEP_ME]]";

    const result = await agent.normalizeChapter({
      chapterContent: draft,
      lengthSpec,
      chapterIntent: "Preserve [[KEEP_ME]] and remove redundancy.",
      reducedControlBlock: "Avoid [[FORBIDDEN]] and keep the scene on target.",
    });

    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(result.applied).toBe(true);
    expect(result.mode).toBe("compress");
    expect(result.normalizedContent).toContain("[[KEEP_ME]]");
    expect(result.normalizedContent).not.toContain("[[FORBIDDEN]]");
    expect(result.finalCount).toBe(countChapterLength(result.normalizedContent, "zh_chars"));
    expect(result.finalCount).toBeLessThan(countChapterLength(draft, "zh_chars"));
  });

  it("expands a short draft without inserting forbidden markers", async () => {
    const agent = createAgent();
    const chatSpy = vi.spyOn(BaseAgent.prototype as never, "chat").mockResolvedValue({
      content: "扩写后的正文，补足细节和过渡，但不引入禁词。",
      usage: ZERO_USAGE,
    });
    const lengthSpec = LengthSpecSchema.parse({
      target: 220,
      softMin: 190,
      softMax: 250,
      hardMin: 160,
      hardMax: 280,
      countingMode: "zh_chars",
      normalizeMode: "expand",
    });
    const draft = "开头太短。";

    const result = await agent.normalizeChapter({
      chapterContent: draft,
      lengthSpec,
      chapterIntent: "Keep the chapter focused on the mentor conflict.",
      reducedControlBlock: "Forbidden marker: [[FORBIDDEN]].",
    });

    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(result.applied).toBe(true);
    expect(result.mode).toBe("expand");
    expect(result.normalizedContent).not.toContain("[[FORBIDDEN]]");
    expect(result.finalCount).toBe(countChapterLength(result.normalizedContent, "zh_chars"));
    expect(result.finalCount).toBeGreaterThan(countChapterLength(draft, "zh_chars"));
  });

  it("never retries normalization in the same pass", async () => {
    const agent = createAgent();
    const chatSpy = vi.spyOn(BaseAgent.prototype as never, "chat").mockResolvedValue({
      content: "仍然过长的正文。".repeat(60),
      usage: ZERO_USAGE,
    });
    const lengthSpec = LengthSpecSchema.parse({
      target: 220,
      softMin: 190,
      softMax: 250,
      hardMin: 160,
      hardMax: 280,
      countingMode: "zh_chars",
      normalizeMode: "compress",
    });
    const draft = "开头。" + "冗余句子。".repeat(100);

    const result = await agent.normalizeChapter({
      chapterContent: draft,
      lengthSpec,
      chapterIntent: "Preserve the scene marker [[KEEP_ME]].",
      reducedControlBlock: "Do not invent new subplots.",
    });

    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(result.applied).toBe(true);
    expect(result.mode).toBe("compress");
    expect(result.warning).toContain("outside");
  });

  it("strips explanatory wrappers from malformed normalizer output", async () => {
    const agent = createAgent();
    const chatSpy = vi.spyOn(BaseAgent.prototype as never, "chat").mockResolvedValue({
      content: [
        "我先压缩一下正文。",
        "",
        "```markdown",
        "压缩后的正文。[[KEEP_ME]]",
        "```",
      ].join("\n"),
      usage: ZERO_USAGE,
    });
    const lengthSpec = LengthSpecSchema.parse({
      target: 220,
      softMin: 190,
      softMax: 250,
      hardMin: 160,
      hardMax: 280,
      countingMode: "zh_chars",
      normalizeMode: "compress",
    });
    const draft = "开头。" + "冗余句子。".repeat(50) + "[[KEEP_ME]]";

    const result = await agent.normalizeChapter({
      chapterContent: draft,
      lengthSpec,
      chapterIntent: "Preserve [[KEEP_ME]] only.",
      reducedControlBlock: "No extra commentary.",
    });

    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(result.normalizedContent).toBe("压缩后的正文。[[KEEP_ME]]");
    expect(result.normalizedContent).not.toContain("我先压缩一下正文");
    expect(result.normalizedContent).not.toContain("```");
  });

  it("falls back to the original chapter when the response contains only wrappers", async () => {
    const agent = createAgent();
    const chatSpy = vi.spyOn(BaseAgent.prototype as never, "chat").mockResolvedValue({
      content: "我先压缩一下正文。",
      usage: ZERO_USAGE,
    });
    const lengthSpec = LengthSpecSchema.parse({
      target: 220,
      softMin: 190,
      softMax: 250,
      hardMin: 160,
      hardMax: 280,
      countingMode: "zh_chars",
      normalizeMode: "compress",
    });
    const draft = "开头。" + "冗余句子。".repeat(40) + "[[KEEP_ME]]";

    const result = await agent.normalizeChapter({
      chapterContent: draft,
      lengthSpec,
      chapterIntent: "Preserve [[KEEP_ME]] only.",
      reducedControlBlock: "No extra commentary.",
    });

    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(result.normalizedContent).toBe(draft);
    expect(result.finalCount).toBe(countChapterLength(draft, "zh_chars"));
  });

  it("preserves legitimate Chinese prose that starts with '我先'", async () => {
    const agent = createAgent();
    const prose = "我先回去了，明天再说。\n风从窗缝里灌进来。";
    const chatSpy = vi.spyOn(BaseAgent.prototype as never, "chat").mockResolvedValue({
      content: prose,
      usage: ZERO_USAGE,
    });
    const lengthSpec = LengthSpecSchema.parse({
      target: 220,
      softMin: 190,
      softMax: 250,
      hardMin: 160,
      hardMax: 280,
      countingMode: "zh_chars",
      normalizeMode: "compress",
    });
    const draft = "原文。".repeat(80);

    const result = await agent.normalizeChapter({
      chapterContent: draft,
      lengthSpec,
    });

    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(result.normalizedContent).toBe(prose);
  });

  it("preserves legitimate English prose that starts with 'I will'", async () => {
    const agent = createAgent();
    const prose = "I will wait here until dawn.\nThe shutters rattled in the wind.";
    const chatSpy = vi.spyOn(BaseAgent.prototype as never, "chat").mockResolvedValue({
      content: prose,
      usage: ZERO_USAGE,
    });
    const lengthSpec = LengthSpecSchema.parse({
      target: 220,
      softMin: 190,
      softMax: 250,
      hardMin: 160,
      hardMax: 280,
      countingMode: "en_words",
      normalizeMode: "compress",
    });
    const draft = "Original text. ".repeat(80);

    const result = await agent.normalizeChapter({
      chapterContent: draft,
      lengthSpec,
    });

    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(result.normalizedContent).toBe(prose);
  });
});
