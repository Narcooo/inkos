import { describe, it, expect } from "vitest";
import {
  buildTaskLayer,
  buildRiskLayer,
  buildContinuityLayer,
  buildTruthSliceLayer,
  type ChapterTaskCard,
} from "../agents/context-layers.js";
import type { BookRules } from "../models/book-rules.js";
import type { GenreProfile } from "../models/genre-profile.js";

describe("context-layers", () => {
  const mockTaskCard: ChapterTaskCard = {
    chapterGoal: "Test Goal",
    activeLines: ["Line A"],
    corePressure: "High Tension",
    forbiddenMoves: ["No Info Dump"],
    hookType: "Cliffhanger",
  };

  describe("buildTaskLayer", () => {
    it("should build task layer from task card", () => {
      const layer = buildTaskLayer(mockTaskCard, 5, 2000, "conflict");
      expect(layer.taskCard.chapterGoal).toBe("Test Goal");
      expect(layer.taskCard.forbiddenMoves).toContain("No Info Dump");
      expect(layer.chapterNumber).toBe(5);
    });
  });

  describe("buildRiskLayer", () => {
    it("should include audit and post-write violations", () => {
      const bookRules: BookRules = {
        prohibitions: ["word1"],
        genreLock: { forbidden: ["theme1"] },
        fatigueWordsOverride: ["word1"],
      } as any;
      const genreProfile: GenreProfile = {
        name: "Test Genre",
        pacingRule: "Fast",
        fatigueWords: [],
      } as any;

      const layer = buildRiskLayer(bookRules, genreProfile, "Fix drift", ["Violation 1"]);
      expect(layer.auditDriftCorrection).toBe("Fix drift");
      expect(layer.recentViolations).toContain("Violation 1");
      expect(layer.fatigueWordBudget).toContain("word1");
    });
  });

  describe("buildContinuityLayer", () => {
    it("should filter relevant hooks and previous tail", () => {
      const currentState = "Current State Info";
      const pendingHooks = "| ID | Ch | Status | Hook |\n| H01 | 5 | open | Test |\n";
      const layer = buildContinuityLayer(currentState, pendingHooks, "Previous content tail here", "(Summaries)", 5);

      expect(layer.currentAnchor).toBe("Current State Info");
      expect(layer.previousChapterTail).toBe("Previous content tail here");
      expect(layer.relevantHooks).toContain("Test");
    });

    it("should recall distant hooks semantically if TaskCard mentions keywords", () => {
      const pendingHooks = [
        "| ID | Ch | Status | Hook |",
        "| H01 | 1 | open | Alice lost her key |",
        "| H02 | 2 | open | Bob found a map |",
      ].join("\n");
      
      const aliceTask: ChapterTaskCard = {
        chapterGoal: "Find Alice's key",
        activeLines: ["Alice"],
        corePressure: "High",
        forbiddenMoves: [],
        hookType: "Success"
      };

      // ch=20, window=3 (core=17-20). H01 is ch=1 (distant).
      const layer = buildContinuityLayer("State", pendingHooks, "Tail", "Summ", 20, aliceTask);
      
      expect(layer.relevantHooks).toContain("Alice lost her key");
      expect(layer.relevantHooks).not.toContain("Bob found a map");
    });

    it("should handle empty content for cold start (ch1)", () => {
      const layer = buildContinuityLayer("", "", "", "", 1);
      expect(layer.previousChapterTail).toBe("");
    });
  });

  describe("buildTruthSliceLayer", () => {
    it("should build truth slice from multiple sources", () => {
      const storyBible = "### Alice\nProtagonist: Alice\nWorld: Wonderland";
      const matrix = "Alice vs Bob";
      const subplot = "Subplot X leads to Y";
      const outline = "Ch4: Start\nCh5: Middle\nCh6: End";
      
      const aliceTask: ChapterTaskCard = { ...mockTaskCard, chapterGoal: "Alice goes home" };

      const layer = buildTruthSliceLayer(aliceTask, storyBible, matrix, subplot, outline, 5);
      expect(layer.relevantCharacterSettings).toContain("Alice");
      expect(layer.relevantOutlineSlice).toContain("Ch5: Middle");
    });
  });
});
