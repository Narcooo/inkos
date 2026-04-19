import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReviserAgent } from "../agents/reviser.js";
import { buildLengthSpec } from "../utils/length-metrics.js";
import type { AuditIssue } from "../agents/continuity.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

const CRITICAL_ISSUE: AuditIssue = {
  severity: "critical",
  category: "continuity",
  description: "Fix the broken continuity",
  suggestion: "Repair the contradiction",
};

describe("ReviserAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers book language override when building revision prompts", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-reviser-lang-test-"));
    const bookDir = join(root, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });

    await writeFile(
      join(bookDir, "book.json"),
      JSON.stringify({
        id: "english-book",
        title: "English Book",
        genre: "xuanhuan",
        platform: "royalroad",
        chapterWordCount: 800,
        targetChapters: 60,
        status: "active",
        language: "en",
        createdAt: "2026-03-23T00:00:00.000Z",
        updatedAt: "2026-03-23T00:00:00.000Z",
      }, null, 2),
      "utf-8",
    );

    const agent = new ReviserAgent({
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
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- repaired",
        "",
        "=== REVISED_CONTENT ===",
        "Revised chapter content.",
        "",
        "=== UPDATED_STATE ===",
        "State card",
        "",
        "=== UPDATED_HOOKS ===",
        "Hooks board",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    try {
      await agent.reviseChapter(bookDir, "Original chapter content.", 1, [CRITICAL_ISSUE], "rewrite", "xuanhuan");

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const systemPrompt = messages?.[0]?.content ?? "";

      expect(systemPrompt).toContain("MUST be in English");
      expect(systemPrompt).toContain("written entirely in English");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps rewrite mode local-first instead of encouraging full-chapter replacement", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-reviser-rewrite-guardrail-test-"));
    const bookDir = join(root, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });

    const agent = new ReviserAgent({
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
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- repaired",
        "",
        "=== PATCHES ===",
        "--- PATCH 1 ---",
        "TARGET_TEXT:",
        "原始正文。",
        "REPLACEMENT_TEXT:",
        "修订后的正文。",
        "--- END PATCH ---",
        "",
        "=== UPDATED_STATE ===",
        "状态卡",
        "",
        "=== UPDATED_HOOKS ===",
        "伏笔池",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    try {
      await agent.reviseChapter(bookDir, "原始正文。", 1, [CRITICAL_ISSUE], "rewrite", "xuanhuan");

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const systemPrompt = messages?.[0]?.content ?? "";

      expect(systemPrompt).toContain("优先保留原文的绝大部分句段");
      expect(systemPrompt).toContain("除非问题跨越整章");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("tells the model to preserve the target range when a length spec is provided", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-reviser-test-"));
    const bookDir = join(root, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });

    const agent = new ReviserAgent({
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
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- repaired",
        "",
        "=== PATCHES ===",
        "--- PATCH 1 ---",
        "TARGET_TEXT:",
        "原始正文。",
        "REPLACEMENT_TEXT:",
        "修订后的正文。",
        "--- END PATCH ---",
        "",
        "=== UPDATED_STATE ===",
        "状态卡",
        "",
        "=== UPDATED_HOOKS ===",
        "伏笔池",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    try {
      await agent.reviseChapter(
        bookDir,
        "原始正文。",
        1,
        [CRITICAL_ISSUE],
        "spot-fix",
        "xuanhuan",
        {
          lengthSpec: buildLengthSpec(220, "zh"),
        },
      );

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const systemPrompt = messages?.[0]?.content ?? "";
      const userPrompt = messages?.[1]?.content ?? "";

      expect(systemPrompt).toContain("保持章节字数在目标区间内");
      expect(systemPrompt).toContain("=== PATCHES ===");
      expect(systemPrompt).not.toContain("=== REVISED_CONTENT ===");
      expect(userPrompt).toContain("目标字数：220");
      expect(userPrompt).toContain("允许区间：190-250");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reconstructs revised content from spot-fix patches and preserves untouched text", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-reviser-spotfix-patch-test-"));
    const bookDir = join(root, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });

    const agent = new ReviserAgent({
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
      projectRoot: root,
    });

    vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- 收紧了开头动作句。",
        "",
        "=== PATCHES ===",
        "--- PATCH 1 ---",
        "TARGET_TEXT:",
        "林越没有立刻进去。",
        "REPLACEMENT_TEXT:",
        "林越先停在门槛外，侧耳听了一息。",
        "--- END PATCH ---",
        "",
        "=== UPDATED_STATE ===",
        "状态卡",
        "",
        "=== UPDATED_HOOKS ===",
        "伏笔池",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    const original = [
      "门轴轻轻响了一下。",
      "林越没有立刻进去。",
      "",
      "巷子尽头的风还在吹。",
      "他把手按在潮冷的门框上，没有出声。",
      "更远处传来极轻的脚步回响，又很快断掉。",
    ].join("\n");

    try {
      const result = await agent.reviseChapter(
        bookDir,
        original,
        1,
        [CRITICAL_ISSUE],
        "spot-fix",
        "xuanhuan",
      );

      expect(result.revisedContent).toBe([
        "门轴轻轻响了一下。",
        "林越先停在门槛外，侧耳听了一息。",
        "",
        "巷子尽头的风还在吹。",
        "他把手按在潮冷的门框上，没有出声。",
        "更远处传来极轻的脚步回响，又很快断掉。",
      ].join("\n"));
      expect(result.fixedIssues).toEqual(["- 收紧了开头动作句。"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses selected summary and hook evidence instead of full long-history markdown in governed mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-reviser-governed-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "# Pending Hooks",
          "",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| guild-route | 1 | mystery | open | 2 | 6 | Merchant guild trail |",
          "| mentor-oath | 8 | relationship | open | 99 | 101 | Mentor oath debt with Lin Yue |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| 1 | Guild Trail | Merchant guild flees west | Route clues only | None | guild-route seeded | tense | action |",
          "| 99 | Trial Echo | Lin Yue | Mentor left without explanation | Oath token matters again | mentor-oath advanced | aching | fallout |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 100\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(
        join(storyDir, "story_bible.md"),
        [
          "# Story Bible",
          "",
          "- The jade seal cannot be destroyed.",
          "- Guildmaster Ren secretly forged the harbor roster in chapter 140.",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "character_matrix.md"),
        [
          "# 角色交互矩阵",
          "",
          "### 角色档案",
          "| 角色 | 核心标签 | 反差细节 | 说话风格 | 性格底色 | 与主角关系 | 核心动机 | 当前目标 |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| Lin Yue | oath | restraint | clipped | stubborn | self | repay debt | find mentor |",
          "| Guildmaster Ren | guild | swagger | loud | opportunistic | rival | stall Mara | seize seal |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n\n- Keep the prose restrained.\n", "utf-8"),
    ]);

    const agent = new ReviserAgent({
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
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- repaired",
        "",
        "=== PATCHES ===",
        "--- PATCH 1 ---",
        "TARGET_TEXT:",
        "原始正文。",
        "REPLACEMENT_TEXT:",
        "修订后的正文。",
        "--- END PATCH ---",
        "",
        "=== UPDATED_STATE ===",
        "状态卡",
        "",
        "=== UPDATED_HOOKS ===",
        "伏笔池",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    try {
      await agent.reviseChapter(
        bookDir,
        "原始正文。",
        100,
        [CRITICAL_ISSUE],
        "spot-fix",
        "xuanhuan",
        {
          chapterIntent: "# Chapter Intent\n\n## Goal\nBring the focus back to the mentor oath conflict.\n",
          contextPackage: {
            chapter: 100,
            selectedContext: [
              {
                source: "story/story_bible.md",
                reason: "Preserve canon constraints referenced by mustKeep.",
                excerpt: "The jade seal cannot be destroyed.",
              },
              {
                source: "story/volume_outline.md",
                reason: "Anchor the default planning node for this chapter.",
                excerpt: "Track the mentor oath fallout.",
              },
              {
                source: "story/chapter_summaries.md#99",
                reason: "Relevant episodic memory.",
                excerpt: "Trial Echo | Mentor left without explanation | mentor-oath advanced",
              },
              {
                source: "story/pending_hooks.md#mentor-oath",
                reason: "Carry forward unresolved hook.",
                excerpt: "relationship | open | 101 | Mentor oath debt with Lin Yue",
              },
            ],
          },
          ruleStack: {
            layers: [{ id: "L4", name: "current_task", precedence: 70, scope: "local" }],
            sections: {
              hard: ["current_state"],
              soft: ["current_focus"],
              diagnostic: ["continuity_audit"],
            },
            overrideEdges: [],
            activeOverrides: [],
          },
          lengthSpec: buildLengthSpec(220, "zh"),
        },
      );

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const userPrompt = messages?.[1]?.content ?? "";

      expect(userPrompt).toContain("story/chapter_summaries.md#99");
      expect(userPrompt).toContain("story/pending_hooks.md#mentor-oath");
      expect(userPrompt).toContain("story/story_bible.md");
      expect(userPrompt).toContain("story/volume_outline.md");
      expect(userPrompt).not.toContain("| 1 | Guild Trail |");
      expect(userPrompt).not.toContain("guild-route | 1 | mystery");
      expect(userPrompt).not.toContain("Guildmaster Ren secretly forged the harbor roster in chapter 140.");
      expect(userPrompt).not.toContain("| Guildmaster Ren | guild | swagger | loud | opportunistic | rival | stall Mara | seize seal |");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
