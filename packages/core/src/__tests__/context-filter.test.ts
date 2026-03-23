import { describe, expect, it } from "vitest";
import { filterSummaries } from "../utils/context-filter.js";

describe("context-filter", () => {
  it("filters old chapter summary rows even when titles start with 'Chapter'", () => {
    const summaries = [
      "# Chapter Summaries",
      "",
      "| 1 | Chapter 1 | Lin Yue | Old event | state-1 | side-quest-1 | tense | drama |",
      "| 97 | Chapter 97 | Lin Yue | Recent event | state-97 | side-quest-97 | tense | drama |",
      "| 100 | Chapter 100 | Lin Yue | Latest event | state-100 | mentor-oath advanced | tense | drama |",
    ].join("\n");

    const filtered = filterSummaries(summaries, 101);

    expect(filtered).not.toContain("| 1 | Chapter 1 |");
    expect(filtered).toContain("| 97 | Chapter 97 |");
    expect(filtered).toContain("| 100 | Chapter 100 |");
  });
});
