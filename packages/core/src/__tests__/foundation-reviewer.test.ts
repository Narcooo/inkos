import { describe, expect, it, vi } from "vitest";
import {
  FoundationReviewerAgent,
  FoundationReviewParseError,
} from "../agents/foundation-reviewer.js";
import type { LLMClient } from "../llm/provider.js";

const TEST_CLIENT: LLMClient = {
  provider: "openai",
  apiFormat: "chat",
  stream: false,
} as unknown as LLMClient;

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

describe("FoundationReviewerAgent", () => {
  it("reviews original foundations against the requested chapter count", async () => {
    const agent = new FoundationReviewerAgent({
      client: TEST_CLIENT,
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const chatSpy = vi.spyOn(
      agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> },
      "chat",
    ).mockResolvedValue({
      content: [
        "=== DIMENSION: 1 ===",
        "分数：80",
        "意见：可用",
        "=== DIMENSION: 2 ===",
        "分数：80",
        "意见：可用",
        "=== DIMENSION: 3 ===",
        "分数：80",
        "意见：可用",
        "=== DIMENSION: 4 ===",
        "分数：80",
        "意见：可用",
        "=== DIMENSION: 5 ===",
        "分数：80",
        "意见：可用",
        "=== OVERALL ===",
        "总分：80",
        "通过：是",
        "总评：可开写。",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    await agent.review({
      language: "zh",
      mode: "original",
      targetChapters: 8,
      foundation: {
        storyBible: "故事框架",
        volumeOutline: "8章大纲",
        bookRules: "规则",
        currentState: "状态",
        pendingHooks: "伏笔",
      },
    });

    const messages = chatSpy.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("用户要求的8章");
    expect(messages[0]?.content).toContain("前5章");
    expect(messages[0]?.content).toContain("连续8章");
    expect(messages[0]?.content).not.toContain("支撑40章");
    expect(messages[0]?.content).not.toContain("连续10章");
  });

  it("does not silently truncate foundation, canon, or style inputs before review", async () => {
    const agent = new FoundationReviewerAgent({
      client: TEST_CLIENT,
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const chatSpy = vi.spyOn(
      agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> },
      "chat",
    ).mockResolvedValue({
      content: [
        "=== DIMENSION: 1 ===",
        "分数：80",
        "意见：可用",
        "=== DIMENSION: 2 ===",
        "分数：80",
        "意见：可用",
        "=== DIMENSION: 3 ===",
        "分数：80",
        "意见：可用",
        "=== DIMENSION: 4 ===",
        "分数：80",
        "意见：可用",
        "=== DIMENSION: 5 ===",
        "分数：80",
        "意见：可用",
        "=== OVERALL ===",
        "总分：80",
        "通过：是",
        "总评：可开写。",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    await agent.review({
      language: "zh",
      mode: "fanfic",
      sourceCanon: `${"正典".repeat(9000)}\nSOURCE_CANON_TAIL_MARKER`,
      styleGuide: `${"文风".repeat(3000)}\nSTYLE_GUIDE_TAIL_MARKER`,
      foundation: {
        storyBible: `${"世界".repeat(5000)}\nSTORY_BIBLE_TAIL_MARKER`,
        volumeOutline: `${"卷纲".repeat(5000)}\nVOLUME_OUTLINE_TAIL_MARKER`,
        bookRules: `${"规则".repeat(3000)}\nBOOK_RULES_TAIL_MARKER`,
        currentState: `${"状态".repeat(2000)}\nCURRENT_STATE_TAIL_MARKER`,
        pendingHooks: `${"伏笔".repeat(2000)}\nPENDING_HOOKS_TAIL_MARKER`,
      },
    });

    const messages = chatSpy.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("SOURCE_CANON_TAIL_MARKER");
    expect(messages[0]?.content).toContain("STYLE_GUIDE_TAIL_MARKER");
    expect(messages[1]?.content).toContain("STORY_BIBLE_TAIL_MARKER");
    expect(messages[1]?.content).toContain("VOLUME_OUTLINE_TAIL_MARKER");
    expect(messages[1]?.content).toContain("BOOK_RULES_TAIL_MARKER");
    expect(messages[1]?.content).toContain("CURRENT_STATE_TAIL_MARKER");
    expect(messages[1]?.content).toContain("PENDING_HOOKS_TAIL_MARKER");
  });

  it("does not turn a malformed review into fake 50-point quality scores", async () => {
    const agent = new FoundationReviewerAgent({
      client: TEST_CLIENT,
      model: "test-model",
      projectRoot: process.cwd(),
    });

    vi.spyOn(
      agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> },
      "chat",
    ).mockResolvedValue({
      content: [
        "### 核心冲突",
        "分数：82",
        "意见：主线清楚，但模型没有遵守约定的分项边界。",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    await expect(agent.review({
      language: "zh",
      mode: "original",
      targetChapters: 60,
      foundation: {
        storyBible: "故事框架",
        volumeOutline: "60章大纲",
        bookRules: "规则",
        currentState: "状态",
        pendingHooks: "伏笔",
      },
    })).rejects.toEqual(expect.objectContaining<Partial<FoundationReviewParseError>>({
      name: "FoundationReviewParseError",
      missingDimensions: [1, 2, 3, 4, 5],
    }));
  });
});
