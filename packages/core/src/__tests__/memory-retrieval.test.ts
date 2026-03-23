import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { retrieveMemorySelection } from "../utils/memory-retrieval.js";

describe("retrieveMemorySelection", () => {
  let root = "";

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("indexes current state facts into sqlite-backed memory selection", async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-memory-retrieval-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "# Current State",
          "",
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 9 |",
          "| Current Location | Ashen ferry crossing |",
          "| Protagonist State | Lin Yue hides the broken oath token and the old wound has reopened. |",
          "| Current Goal | Find the vanished mentor before the guild covers its tracks. |",
          "| Current Conflict | Mentor debt with the vanished teacher blocks every choice. |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
    ]);

    const result = await retrieveMemorySelection({
      bookDir,
      chapterNumber: 10,
      goal: "Bring the focus back to the vanished mentor conflict.",
      mustKeep: ["Lin Yue hides the broken oath token and the old wound has reopened."],
    });

    expect(result.facts.length).toBeGreaterThan(0);
    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          predicate: "Current Conflict",
          object: "Mentor debt with the vanished teacher blocks every choice.",
          validFromChapter: 9,
          sourceChapter: 9,
        }),
      ]),
    );
    expect(result.dbPath).toContain("memory.db");
  });
});
