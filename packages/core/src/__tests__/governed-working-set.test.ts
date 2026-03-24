import { describe, expect, it } from "vitest";
import { buildGovernedCharacterMatrixWorkingSet } from "../utils/governed-working-set.js";

describe("governed-working-set", () => {
  it("filters character matrix by exact governed character mentions instead of broad capitalized tokens", () => {
    const matrix = [
      "# Character Matrix",
      "",
      "### Character Profiles",
      "| Character | Core Tags | Contrast Detail | Speech Style | Personality Core | Relationship to Protagonist | Core Motivation | Current Goal |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| Lin Yue | oath | restraint | clipped | stubborn | self | repay debt | find mentor |",
      "| Guildmaster Ren | guild | swagger | loud | opportunistic | rival | stall Mara | seize seal |",
      "",
      "### Encounter Log",
      "| Character A | Character B | First Meeting Chapter | Latest Interaction Chapter | Relationship Type | Relationship Change |",
      "| --- | --- | --- | --- | --- | --- |",
      "| Lin Yue | Guildmaster Ren | 1 | 5 | rivalry | strained |",
      "",
      "### Information Boundaries",
      "| Character | Known Information | Unknown Information | Source Chapter |",
      "| --- | --- | --- | --- |",
      "| Lin Yue | Mentor left without explanation | Why the oath was broken | 99 |",
      "| Guildmaster Ren | Harbor roster | Mentor oath debt | 12 |",
    ].join("\n");

    const filtered = buildGovernedCharacterMatrixWorkingSet({
      matrixMarkdown: matrix,
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
    });

    expect(filtered).toContain("| Lin Yue | oath | restraint | clipped | stubborn | self | repay debt | find mentor |");
    expect(filtered).not.toContain("| Guildmaster Ren | guild | swagger | loud | opportunistic | rival | stall Mara | seize seal |");
    expect(filtered).not.toContain("| Lin Yue | Guildmaster Ren | 1 | 5 | rivalry | strained |");
    expect(filtered).not.toContain("| Guildmaster Ren | Harbor roster | Mentor oath debt | 12 |");
  });
});
