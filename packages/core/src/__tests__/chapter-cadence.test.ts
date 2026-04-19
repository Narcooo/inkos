import { describe, expect, it } from "vitest";
import { analyzeChapterCadence } from "../utils/chapter-cadence.js";

describe("analyzeChapterCadence", () => {
  it("surfaces stacked scene, mood, and title pressure from recent summary rows", () => {
    const analysis = analyzeChapterCadence({
      language: "zh",
      rows: [
        {
          chapter: 1,
          title: "名单之前",
          mood: "紧张、压抑",
          chapterType: "调查章",
        },
        {
          chapter: 2,
          title: "名单之后",
          mood: "冷硬、逼仄",
          chapterType: "调查章",
        },
        {
          chapter: 3,
          title: "名单还在",
          mood: "压迫、窒息",
          chapterType: "调查章",
        },
        {
          chapter: 4,
          title: "名单未落",
          mood: "肃杀、凝重",
          chapterType: "调查章",
        },
      ],
    });

    expect(analysis.scenePressure).toEqual(expect.objectContaining({
      repeatedType: "调查章",
      pressure: "high",
      streak: 4,
    }));
    expect(analysis.moodPressure).toEqual(expect.objectContaining({
      pressure: "high",
      highTensionStreak: 4,
    }));
    expect(analysis.titlePressure).toEqual(expect.objectContaining({
      repeatedToken: "名单",
      pressure: "high",
      count: 4,
    }));
  });

  it("stays quiet when scene, mood, and title cadence are varied", () => {
    const analysis = analyzeChapterCadence({
      language: "en",
      rows: [
        {
          chapter: 1,
          title: "Morning Harbor",
          mood: "warm, gentle",
          chapterType: "slice-of-life",
        },
        {
          chapter: 2,
          title: "Sudden Rain",
          mood: "tense, ominous",
          chapterType: "tension",
        },
        {
          chapter: 3,
          title: "Open Gate",
          mood: "hopeful, light",
          chapterType: "transition",
        },
        {
          chapter: 4,
          title: "After the Letter",
          mood: "melancholy, reflective",
          chapterType: "introspection",
        },
      ],
    });

    expect(analysis.scenePressure).toBeUndefined();
    expect(analysis.moodPressure).toBeUndefined();
    expect(analysis.titlePressure).toBeUndefined();
  });
});
