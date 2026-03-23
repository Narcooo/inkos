import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
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
          thinkingBudget: 0,
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
});
