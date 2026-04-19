import { describe, expect, it } from "vitest";
import { validateRuntimeState } from "../state/state-validator.js";

describe("validateRuntimeState", () => {
  it("rejects hook rows with non-integer numeric fields", () => {
    const issues = validateRuntimeState({
      manifest: {
        schemaVersion: 2,
        language: "en",
        lastAppliedChapter: 12,
        projectionVersion: 1,
        migrationWarnings: [],
      },
      currentState: {
        chapter: 12,
        facts: [],
      },
      hooks: {
        hooks: [
          {
            hookId: "mentor-debt",
            startChapter: 1,
            type: "relationship",
            status: "open",
            lastAdvancedChapter: "chapter twelve",
            expectedPayoff: "Reveal the debt.",
            notes: "Bad numeric field.",
          },
        ],
      },
      chapterSummaries: {
        rows: [],
      },
    });

    expect(issues.map((issue) => issue.code)).toContain("invalid_hooks_state");
  });

  it("rejects duplicate hook ids", () => {
    const issues = validateRuntimeState({
      manifest: {
        schemaVersion: 2,
        language: "en",
        lastAppliedChapter: 12,
        projectionVersion: 1,
        migrationWarnings: [],
      },
      currentState: {
        chapter: 12,
        facts: [],
      },
      hooks: {
        hooks: [
          {
            hookId: "mentor-debt",
            startChapter: 1,
            type: "relationship",
            status: "open",
            lastAdvancedChapter: 10,
            expectedPayoff: "Reveal the debt.",
            notes: "",
          },
          {
            hookId: "mentor-debt",
            startChapter: 4,
            type: "mystery",
            status: "progressing",
            lastAdvancedChapter: 12,
            expectedPayoff: "Identify the courier.",
            notes: "",
          },
        ],
      },
      chapterSummaries: {
        rows: [],
      },
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "duplicate_hook_id",
          path: "hooks.mentor-debt",
        }),
      ]),
    );
  });

  it("accepts stale open hooks as valid runtime state", () => {
    const issues = validateRuntimeState({
      manifest: {
        schemaVersion: 2,
        language: "zh",
        lastAppliedChapter: 30,
        projectionVersion: 1,
        migrationWarnings: [],
      },
      currentState: {
        chapter: 30,
        facts: [],
      },
      hooks: {
        hooks: [
          {
            hookId: "mentor-oath",
            startChapter: 2,
            type: "relationship",
            status: "open",
            lastAdvancedChapter: 8,
            expectedPayoff: "揭开师债真相",
            notes: "已经很多章没推进，但仍然有效。",
          },
        ],
      },
      chapterSummaries: {
        rows: [],
      },
    });

    expect(issues).toEqual([]);
  });
});
