import { describe, expect, it } from "vitest";
import { buildWriteNextParameters } from "../commands/write.js";

describe("write next parameters", () => {
  it("passes the next unwritten chapter to the required capability schema", () => {
    expect(buildWriteNextParameters({
      bookId: "night-harbor",
      startChapterNumber: 4,
      chapterCount: 2,
      chapterWordCount: 1800,
      instruction: "Continue the investigation.",
    })).toEqual({
      instruction: "Continue the investigation.",
      bookId: "night-harbor",
      startChapterNumber: 4,
      chapterCount: 2,
      chapterWordCount: 1800,
    });
  });
});
