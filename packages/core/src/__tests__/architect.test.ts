import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchitectAgent } from "../agents/architect.js";
import type { BookConfig } from "../models/book.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

describe("ArchitectAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses English prompts when generating foundation from imported English chapters", async () => {
    const agent = new ArchitectAgent({
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
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "english-book",
      title: "English Book",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 2200,
      language: "en",
      createdAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
    };

    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# Story Bible",
          "",
          "=== SECTION: volume_outline ===",
          "# Volume Outline",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "# Book Rules",
          "",
          "=== SECTION: current_state ===",
          "# Current State",
          "",
          "=== SECTION: pending_hooks ===",
          "# Pending Hooks",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await agent.generateFoundationFromImport(
      book,
      "Chapter 1: Prelude\n\nA cold wind crossed the harbor.",
    );

    const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("MUST be written in English");
    expect(messages[1]?.content).toContain("Generate the complete foundation");
    expect(messages[1]?.content).not.toContain("请从中反向推导");
  });

  it("does not embed Chinese section headings in imported English foundation prompts", async () => {
    const agent = new ArchitectAgent({
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
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "english-book",
      title: "English Book",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 2200,
      language: "en",
      createdAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
    };

    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# Story Bible",
          "",
          "=== SECTION: volume_outline ===",
          "# Volume Outline",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "# Book Rules",
          "",
          "=== SECTION: current_state ===",
          "# Current State",
          "",
          "=== SECTION: pending_hooks ===",
          "# Pending Hooks",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await agent.generateFoundationFromImport(
      book,
      "Chapter 1: Prelude\n\nA cold wind crossed the harbor.",
    );

    const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("## 01_Worldview");
    expect(messages[0]?.content).toContain("## Narrative Perspective");
    expect(messages[0]?.content).not.toContain("## 01_世界观");
    expect(messages[0]?.content).not.toContain("## 叙事视角");
  });

  it("embeds reviewer feedback into original foundation regeneration prompts", async () => {
    const agent = new ArchitectAgent({
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
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "review-feedback-book",
      title: "雾港回灯",
      platform: "tomato",
      genre: "urban",
      status: "active",
      targetChapters: 60,
      chapterWordCount: 2200,
      language: "zh",
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
    };

    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# 故事圣经",
          "",
          "=== SECTION: volume_outline ===",
          "# 卷纲",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION: current_state ===",
          "# 当前状态",
          "",
          "=== SECTION: pending_hooks ===",
          "# 待回收伏笔",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await agent.generateFoundation(
      book,
      undefined,
      "请把核心冲突收紧，并明确新空间不是旧案重演。",
    );

    const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("上一轮审核反馈");
    expect(messages[0]?.content).toContain("请把核心冲突收紧");
    expect(messages[0]?.content).toContain("明确新空间不是旧案重演");
  });

  it("embeds reviewer feedback into fanfic foundation regeneration prompts", async () => {
    const agent = new ArchitectAgent({
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
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "fanfic-review-feedback-book",
      title: "三体：回声舱",
      platform: "tomato",
      genre: "other",
      status: "active",
      targetChapters: 60,
      chapterWordCount: 2200,
      language: "zh",
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
    };

    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# 故事圣经",
          "",
          "=== SECTION: volume_outline ===",
          "# 卷纲",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION: current_state ===",
          "# 当前状态",
          "",
          "=== SECTION: pending_hooks ===",
          "# 待回收伏笔",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await agent.generateFanficFoundation(
      book,
      "# 原作正典\n- 罗辑在面壁计划中留下了一处空档。",
      "canon",
      "请明确分岔点，并用原创冲突替代原作重走。",
    );

    const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("上一轮审核反馈");
    expect(messages[0]?.content).toContain("请明确分岔点");
    expect(messages[0]?.content).toContain("原创冲突替代原作重走");
  });

  it("strips assistant-style trailing coda from the final pending hooks section", async () => {
    const agent = new ArchitectAgent({
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
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "zh-book",
      title: "雾港回灯",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 50,
      chapterWordCount: 2200,
      language: "zh",
      createdAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
    };

    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# 故事圣经",
          "",
          "=== SECTION: volume_outline ===",
          "# 卷纲",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION: current_state ===",
          "# 当前状态",
          "",
          "=== SECTION: pending_hooks ===",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| H01 | 1 | 主线 | 未开启 | 无 | 10章 | 主线核心钩子 |",
          "",
          "如果你愿意，我下一步可以继续为这本《雾港回灯》输出：",
          "1. 前10章逐章细纲",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    const result = await agent.generateFoundation(book);

    expect(result.pendingHooks).toContain("| H01 | 1 | 主线 | 未开启 | 0 | 10章 | 中程 | 主线核心钩子 |");
    expect(result.pendingHooks).not.toContain("如果你愿意");
    expect(result.pendingHooks).not.toContain("前10章逐章细纲");
  });

  it("normalizes architect pending hooks into runtime-compatible numeric progress columns", async () => {
    const agent = new ArchitectAgent({
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
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "zh-book",
      title: "凌晨三点的证词",
      platform: "tomato",
      genre: "urban",
      status: "active",
      targetChapters: 80,
      chapterWordCount: 2000,
      language: "zh",
      createdAt: "2026-03-25T00:00:00.000Z",
      updatedAt: "2026-03-25T00:00:00.000Z",
    };

    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# 故事圣经",
          "",
          "=== SECTION: volume_outline ===",
          "# 卷纲",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION: current_state ===",
          "# 当前状态",
          "",
          "=== SECTION: pending_hooks ===",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| H13 | 22 | 舆情操盘 | 待推进 | 一家自媒体公司在多个旧案节点同步接单 | 51-60章 | 庄蔓出场后逐步揭露 |",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    const result = await agent.generateFoundation(book);

    expect(result.pendingHooks).toContain("| H13 | 22 | 舆情操盘 | 待推进 | 0 | 51-60章 | 中程 | 庄蔓出场后逐步揭露（初始线索：一家自媒体公司在多个旧案节点同步接单） |");
  });

  it("accepts section labels with spacing and punctuation drift from non-strict models", async () => {
    const agent = new ArchitectAgent({
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
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "format-drift-book",
      title: "格式漂移测试",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 2200,
      language: "zh",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    };

    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== Section：Story Bible ===",
          "# 故事圣经",
          "",
          "=== section: Volume Outline ===",
          "# 卷纲",
          "",
          "=== SECTION: book-rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION : current state ===",
          "# 当前状态",
          "",
          "=== SECTION: pending hooks ===",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| H01 | 1 | mystery | open | 0 | 10章 | 初始钩子 |",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    const result = await agent.generateFoundation(book);

    expect(result.storyBible).toBe("# 故事圣经");
    expect(result.volumeOutline).toBe("# 卷纲");
    expect(result.bookRules).toContain("version: \"1.0\"");
    expect(result.currentState).toBe("# 当前状态");
    expect(result.pendingHooks).toContain("| H01 | 1 | mystery | open | 0 | 10章 | 中程 | 初始钩子 |");
  });

  it("throws when a required foundation section is missing", async () => {
    const agent = new ArchitectAgent({
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
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "broken-book",
      title: "Broken Book",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 2200,
      language: "zh",
      createdAt: "2026-03-29T00:00:00.000Z",
      updatedAt: "2026-03-29T00:00:00.000Z",
    };

    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# 故事圣经",
          "",
          "=== SECTION: volume_outline ===",
          "# 卷纲",
          "",
          "=== SECTION: current_state ===",
          "# 当前状态",
          "",
          "=== SECTION: pending_hooks ===",
          "# 伏笔池",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await expect(agent.generateFoundation(book)).rejects.toThrow(/book_rules/i);
  });

  it("passes maxTokens 16384 when generating foundation", async () => {
    const agent = new ArchitectAgent({
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
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "max-tokens-book",
      title: "Max Tokens Book",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 2200,
      language: "zh",
      createdAt: "2026-03-29T00:00:00.000Z",
      updatedAt: "2026-03-29T00:00:00.000Z",
    };

    const chatSpy = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# 故事圣经",
          "",
          "=== SECTION: volume_outline ===",
          "# 卷纲",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION: current_state ===",
          "# 当前状态",
          "",
          "=== SECTION: pending_hooks ===",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| H01 | 1 | mystery | open | 0 | 10章 | 初始钩子 |",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await agent.generateFoundation(book);

    expect(chatSpy).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ temperature: 0.8, maxTokens: 16384 }),
    );
  });

  it("passes maxTokens 16384 when generating foundation from import", async () => {
    const agent = new ArchitectAgent({
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
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "import-max-tokens-book",
      title: "Import Max Tokens Book",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 2200,
      language: "zh",
      createdAt: "2026-03-29T00:00:00.000Z",
      updatedAt: "2026-03-29T00:00:00.000Z",
    };

    const chatSpy = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# 故事圣经",
          "",
          "=== SECTION: volume_outline ===",
          "# 卷纲",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION: current_state ===",
          "# 当前状态",
          "",
          "=== SECTION: pending_hooks ===",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| H01 | 1 | mystery | open | 0 | 10章 | 初始钩子 |",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await agent.generateFoundationFromImport(book, "第一章正文");

    expect(chatSpy).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ temperature: 0.5, maxTokens: 16384 }),
    );
  });

  it("passes maxTokens 16384 when generating fanfic foundation", async () => {
    const agent = new ArchitectAgent({
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
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "fanfic-max-tokens-book",
      title: "Fanfic Max Tokens Book",
      platform: "other",
      genre: "fanfic",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 2200,
      language: "zh",
      createdAt: "2026-03-29T00:00:00.000Z",
      updatedAt: "2026-03-29T00:00:00.000Z",
    };

    const chatSpy = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# 故事圣经",
          "",
          "=== SECTION: volume_outline ===",
          "# 卷纲",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION: current_state ===",
          "# 当前状态",
          "",
          "=== SECTION: pending_hooks ===",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| H01 | 1 | mystery | open | 0 | 10章 | 初始钩子 |",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await agent.generateFanficFoundation(book, "正典文本", "canon");

    expect(chatSpy).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ temperature: 0.7, maxTokens: 16384 }),
    );
  });
});
