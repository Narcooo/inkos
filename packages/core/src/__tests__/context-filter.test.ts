import { describe, expect, it } from "vitest";
import { filterEmotionalArcs, filterSummaries } from "../utils/context-filter.js";

describe("context-filter", () => {
  it("filters old chapter summary rows even when titles start with 'Chapter'", () => {
    const summaries = [
      "# Chapter Summaries",
      "",
      "| 1 | Chapter 1 | Lin Yue | Old event | state-1 | side-quest-1 | tense | drama |",
      "| 97 | Chapter 97 | Lin Yue | Recent event | state-97 | side-quest-97 | tense | drama |",
      "| 98 | Chapter 98 | Lin Yue | New event | state-98 | side-quest-98 | tense | drama |",
      "| 100 | Chapter 100 | Lin Yue | Latest event | state-100 | mentor-oath advanced | tense | drama |",
    ].join("\n");

    const filtered = filterSummaries(summaries, 101);

    expect(filtered).not.toContain("| 1 | Chapter 1 |");
    expect(filtered).not.toContain("| 97 | Chapter 97 |");
    expect(filtered).toContain("| 98 | Chapter 98 |");
    expect(filtered).toContain("| 100 | Chapter 100 |");
  });

  it("keeps only the cadence-sized recent emotional arc rows by default", () => {
    const arcs = [
      "# Emotional Arcs",
      "",
      "| Character | Chapter | Emotional State | Trigger Event | Intensity (1-10) | Arc Direction |",
      "| --- | --- | --- | --- | --- | --- |",
      "| Lin Yue | 97 | guarded | old wound | 4 | holding |",
      "| Lin Yue | 98 | tense | harbor clue | 6 | rising |",
      "| Lin Yue | 99 | strained | mentor echo | 7 | tightening |",
      "| Lin Yue | 100 | brittle | oath pressure | 8 | compressing |",
    ].join("\n");

    const filtered = filterEmotionalArcs(arcs, 101);

    expect(filtered).not.toContain("| Lin Yue | 97 |");
    expect(filtered).toContain("| Lin Yue | 98 |");
    expect(filtered).toContain("| Lin Yue | 100 |");
  });
});
