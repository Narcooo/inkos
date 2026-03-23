import { describe, expect, it } from "vitest";
import { buildWriterSystemPrompt } from "../agents/writer-prompts.js";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";

const book: BookConfig = {
  id: "prompt-book",
  title: "Prompt Book",
  platform: "tomato",
  genre: "xuanhuan",
  status: "active",
  targetChapters: 100,
  chapterWordCount: 3000,
  createdAt: "2026-03-19T00:00:00.000Z",
  updatedAt: "2026-03-19T00:00:00.000Z",
};

const genreProfile: GenreProfile = {
  id: "xuanhuan",
  name: "玄幻",
  language: "zh",
  chapterTypes: ["推进", "冲突"],
  fatigueWords: [],
  pacingRule: "控制推进速度。",
  numericalSystem: false,
  powerScaling: false,
  eraResearch: false,
  auditDimensions: [],
  satisfactionTypes: [],
};

describe("buildWriterSystemPrompt", () => {
  it("uses the override target instead of the book default chapter length", () => {
    const prompt = buildWriterSystemPrompt(
      book,
      genreProfile,
      null,
      "",
      "",
      "",
      undefined,
      1,
      "creative",
      undefined,
      "zh",
      1500,
    );

    expect(prompt).toContain("目标1500字，允许区间1300-1700字");
    expect(prompt).not.toContain("每章3000字左右");
    expect(prompt).not.toContain("正文内容，3000字左右");
  });
});
