import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WriterAgent } from "../agents/writer.js";
import { buildLengthSpec } from "../utils/length-metrics.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

describe("WriterAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses compact summary context plus selected long-range evidence during governed settlement", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 100\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n\n- Keep the prose restrained.\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), [
        "# Pending Hooks",
        "",
        "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| guild-route | 1 | mystery | open | 2 | 6 | Merchant guild trail |",
        "| mentor-oath | 8 | relationship | open | 99 | 101 | Mentor oath debt with Lin Yue |",
      ].join("\n"), "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), [
        "# Chapter Summaries",
        "",
        "| 1 | Guild Trail | Merchant guild flees west | Route clues only | None | guild-route seeded | tense | action |",
        "| 97 | Shrine Ash | Lin Yue | The old shrine proves empty | Frustration rises | none | bitter | setback |",
        "| 98 | Trial Echo | Lin Yue | Mentor left without explanation | Oath token matters again | mentor-oath advanced | aching | fallout |",
        "| 99 | Locked Gate | Lin Yue | Lin Yue chooses the mentor line over the guild line | Mentor conflict takes priority | mentor-oath advanced | focused | decision |",
      ].join("\n"), "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# 支线进度板\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# 角色交互矩阵\n", "utf-8"),
    ]);

    const agent = new WriterAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "A Decision",
          "",
          "=== CHAPTER_CONTENT ===",
          "Lin Yue turned away from the guild trail and chose the mentor debt.",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "| 伏笔变动 | mentor-oath 推进 | 同步更新伏笔池 |",
          "",
          "=== UPDATED_STATE ===",
          "状态卡",
          "",
          "=== UPDATED_HOOKS ===",
          "伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 100 | A Decision | Lin Yue | Chooses the mentor debt | Focus narrowed | mentor-oath advanced | tense | decision |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "支线板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "角色矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    try {
      await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "xuanhuan",
          status: "active",
          targetChapters: 120,
          chapterWordCount: 2200,
          createdAt: "2026-03-23T00:00:00.000Z",
          updatedAt: "2026-03-23T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 100,
        chapterIntent: "# Chapter Intent\n\n## Goal\nBring the focus back to the mentor oath conflict.\n",
        contextPackage: {
          chapter: 100,
          selectedContext: [
            {
              source: "story/chapter_summaries.md#99",
              reason: "Relevant episodic memory.",
              excerpt: "Locked Gate | Lin Yue chooses the mentor line over the guild line | mentor-oath advanced",
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
      });

      const settlePrompt = (chatSpy.mock.calls[2]?.[0] as ReadonlyArray<{ content: string }> | undefined)?.[1]?.content ?? "";
      expect(settlePrompt).toContain("story/chapter_summaries.md#99");
      expect(settlePrompt).toContain("| 99 | Locked Gate |");
      expect(settlePrompt).not.toContain("| 1 | Guild Trail |");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
