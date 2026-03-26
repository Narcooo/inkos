import { describe, it, expect } from "vitest";
import {
  routeForCreativeWrite,
  validateCreativeWriteContext,
} from "../agents/context-router.js";
import type { ChapterTaskCard, TruthFiles, StateFiles, ViewFiles, RoutedContext } from "../agents/context-layers.js";

describe("context-router", () => {
  const mockTask: ChapterTaskCard = {
    chapterGoal: "Goal", activeLines: [], corePressure: "", forbiddenMoves: [], hookType: "",
  };
  const mockTruth: TruthFiles = { storyBible: "Bible", volumeOutline: "Outline", styleGuide: "", bookRules: "", parentCanon: "", fanficCanon: "" };
  const mockState: StateFiles = { currentState: "State", pendingHooks: "Hooks", particleLedger: "", emotionalArcs: "" };
  const mockView: ViewFiles = { chapterSummaries: "Summaries", subplotBoard: "Subplots", characterMatrix: "Matrix", styleProfile: "" };

  it("should route context for creative write with five layers", () => {
    const routed = routeForCreativeWrite(
      mockTask, mockTruth, mockState, mockView, null, { fatigueWords: [] } as any, 5, "conflict", 2000
    );

    expect(routed.task).toBeDefined();
    expect(routed.risk).toBeDefined();
    expect(routed.continuity).toBeDefined();
    expect(routed.style).toBeDefined();
    expect(routed.truthSlice).toBeDefined();
    
    // Check isolation (L3 should not be full state)
    expect(routed.continuity.currentAnchor).toBe("State");
  });

  describe("validateCreativeWriteContext", () => {
    it("should pass for small slices", () => {
      const routed: RoutedContext = {
        task: {} as any,
        risk: {} as any,
        continuity: { currentAnchor: "Small", relevantHooks: "", recentSummaryLines: "", previousChapterTail: "", relationTensions: "" },
        style: {} as any,
        truthSlice: { relevantCharacterSettings: "Small", relevantWorldRules: "", relevantOutlineSlice: "", relevantLongTermHooks: "" }
      };
      const result = validateCreativeWriteContext(routed);
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("should return violations for oversized slices (prohibition list heuristic)", () => {
      const longString = "A".repeat(4000);
      const routed: RoutedContext = {
        task: {} as any,
        risk: {} as any,
        continuity: { currentAnchor: longString, relevantHooks: "", recentSummaryLines: "", previousChapterTail: "", relationTensions: "" },
        style: {} as any,
        truthSlice: { relevantCharacterSettings: "Small", relevantWorldRules: "", relevantOutlineSlice: "", relevantLongTermHooks: "" }
      };
      const result = validateCreativeWriteContext(routed);
      expect(result.valid).toBe(false);
      expect(result.violations[0]).toContain("exceeds max slice size");
    });
  });
});
