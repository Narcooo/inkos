import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChapterAnalyzerAgent } from "../agents/chapter-analyzer.js";
import type { BookConfig } from "../models/book.js";
import { countChapterLength } from "../utils/length-metrics.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

describe("ChapterAnalyzerAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("counts English chapter content using words instead of characters", async () => {
    const bookDir = await mkdtemp(join(tmpdir(), "inkos-chapter-analyzer-"));
    const englishContent = "He looked at the sky and waited.";
    const agent = new ChapterAnalyzerAgent({
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
      targetChapters: 10,
      chapterWordCount: 2200,
      language: "en",
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    };

    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== CHAPTER_TITLE ===",
          "A Quiet Sky",
          "",
          "=== CHAPTER_CONTENT ===",
          englishContent,
          "",
          "=== PRE_WRITE_CHECK ===",
          "",
          "=== POST_SETTLEMENT ===",
          "",
          "=== UPDATED_STATE ===",
          "| Field | Value |",
          "| --- | --- |",
          "| Chapter | 1 |",
          "",
          "=== UPDATED_LEDGER ===",
          "",
          "=== UPDATED_HOOKS ===",
          "| hook_id | status |",
          "| --- | --- |",
          "| h1 | open |",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 1 | A Quiet Sky |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    try {
      const output = await agent.analyzeChapter({
        book,
        bookDir,
        chapterNumber: 1,
        chapterContent: englishContent,
      });

      expect(output.wordCount).toBe(countChapterLength(englishContent, "en_words"));
      expect(output.wordCount).toBe(7);
    } finally {
      await rm(bookDir, { recursive: true, force: true });
    }
  });

  it("uses English prompts when analyzing imported English chapters", async () => {
    const bookDir = await mkdtemp(join(tmpdir(), "inkos-chapter-analyzer-en-"));
    const englishContent = "He looked at the sky and waited.";
    const agent = new ChapterAnalyzerAgent({
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
      targetChapters: 10,
      chapterWordCount: 2200,
      language: "en",
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    };

    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== CHAPTER_TITLE ===",
          "A Quiet Sky",
          "",
          "=== CHAPTER_CONTENT ===",
          englishContent,
          "",
          "=== PRE_WRITE_CHECK ===",
          "",
          "=== POST_SETTLEMENT ===",
          "",
          "=== UPDATED_STATE ===",
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 1 |",
          "",
          "=== UPDATED_LEDGER ===",
          "",
          "=== UPDATED_HOOKS ===",
          "| hook_id | status |",
          "| --- | --- |",
          "| h1 | open |",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 1 | A Quiet Sky |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    try {
      await agent.analyzeChapter({
        book,
        bookDir,
        chapterNumber: 1,
        chapterContent: englishContent,
        chapterTitle: "A Quiet Sky",
      });

      const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
      expect(messages[0]?.content).toContain("ALL output MUST be in English");
      expect(messages[1]?.content).toContain("Analyze chapter 1");
      expect(messages[1]?.content).toContain("## Chapter Content");
      expect(messages[1]?.content).toContain("## Current State");
      expect(messages[1]?.content).not.toContain("请分析第1章正文");
    } finally {
      await rm(bookDir, { recursive: true, force: true });
    }
  });

  it("uses a retrieved summary snapshot instead of full long-history chapter summaries", async () => {
    const bookDir = await mkdtemp(join(tmpdir(), "inkos-chapter-analyzer-memory-"));
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| Chapter | Title | Characters | Key Events | State Changes | Hook Activity | Mood | Chapter Type |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 1 | Guild Trail | Lin Yue | Merchant guild flees west | Route clues only | guild-route seeded | tense | action |",
          "| 99 | Mentor Oath | Lin Yue, Mentor Shen | Mentor left without explanation | Oath token matters again | mentor-oath advanced | aching | fallout |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "# Pending Hooks",
          "",
          "| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| guild-route | 1 | mystery | open | 2 | 6 | Merchant guild trail |",
          "| mentor-oath | 8 | relationship | open | 99 | 101 | Mentor oath debt |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Lin Yue still carries the oath token.\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 100\nReturn to the mentor oath conflict.\n", "utf-8"),
    ]);

    const agent = new ChapterAnalyzerAgent({
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

    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== CHAPTER_TITLE ===",
          "Mentor Oath Returns",
          "",
          "=== CHAPTER_CONTENT ===",
          "Lin Yue returned to the mentor oath and the missing explanation.",
          "",
          "=== PRE_WRITE_CHECK ===",
          "",
          "=== POST_SETTLEMENT ===",
          "",
          "=== UPDATED_STATE ===",
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 100 |",
          "",
          "=== UPDATED_LEDGER ===",
          "",
          "=== UPDATED_HOOKS ===",
          "| hook_id | status |",
          "| --- | --- |",
          "| h1 | open |",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 100 | Mentor Oath Returns |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    const book: BookConfig = {
      id: "english-book",
      title: "English Book",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 120,
      chapterWordCount: 2200,
      language: "en",
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    };

    try {
      await agent.analyzeChapter({
        book,
        bookDir,
        chapterNumber: 100,
        chapterTitle: "Mentor Oath Returns",
        chapterContent: "Lin Yue returned to the mentor oath and the missing explanation.",
      });

      const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
      const userPrompt = messages[1]?.content ?? "";

      expect(userPrompt).toContain("| 99 | Mentor Oath |");
      expect(userPrompt).not.toContain("| 1 | Guild Trail |");
    } finally {
      await rm(bookDir, { recursive: true, force: true });
    }
  });
});
