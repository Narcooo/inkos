import { describe, it, expect } from "vitest";
import { evaluateTruthCandidates } from "../agents/truth-guard.js";
import type { TruthCandidate } from "../agents/reviser.js";

describe("truth-guard", () => {
  const mockCandidate: TruthCandidate = {
    file: "story_bible.md",
    field: "protagonist",
    currentValue: "Alice",
    proposedValue: "Bob",
    changeType: "MODIFY",
    reason: "New protag"
  };

  it("should approve simple field changes", () => {
    const result = evaluateTruthCandidates([mockCandidate]);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it("should reject emptying protected fields", () => {
    const candidate: TruthCandidate = {
      ...mockCandidate,
      proposedValue: "" // Emptying protag
    };
    const result = evaluateTruthCandidates([candidate]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.decisions[0]?.reason).toContain("cannot be emptied");
  });

  it("should reject changing immutable character fields", () => {
    const candidate: TruthCandidate = {
      file: "characters.md",
      field: "name",
      currentValue: "Alice",
      proposedValue: "Malice",
      changeType: "MODIFY",
      reason: "Name change"
    };
    const result = evaluateTruthCandidates([candidate]);
    expect(result.rejected).toHaveLength(1);
    expect(result.decisions[0]?.reason).toContain("Immutable field");
  });

  it("should reject aggressive hook deletions", () => {
    const candidate: TruthCandidate = {
      file: "pending_hooks.md",
      field: "full_table",
      currentValue: "| ID | H |\n| 1 | X |\n| 2 | Y |\n| 3 | Z |\n| 4 | W |\n",
      proposedValue: "| ID | H |\n| 1 | X |\n", // Deleted 50% (> 30%)
      changeType: "MODIFY",
      reason: "Cleanup"
    };
    const result = evaluateTruthCandidates([candidate]);
    expect(result.rejected).toHaveLength(1);
    expect(result.decisions[0]?.reason).toContain("too aggressive");
  });

  it("should reject numerical balance violations", () => {
    const candidate: TruthCandidate = {
      file: "ledger.md",
      field: "table",
      currentValue: "| Item | Start | Delta | End |\n| Gold | 100 | +50 | 150 |",
      proposedValue: "| Item | Start | Delta | End |\n| Gold | 100 | +50 | 200 |", // 100+50 != 200
      changeType: "MODIFY",
      reason: "Cheat"
    };
    const result = evaluateTruthCandidates([candidate]);
    expect(result.rejected).toHaveLength(1);
    expect(result.decisions[0]?.reason).toContain("Numerical balance violation");
  });

  it("should auto-approve everything in import mode", () => {
    const candidate: TruthCandidate = {
      ...mockCandidate,
      proposedValue: "" // Forbidden in normal mode
    };
    const result = evaluateTruthCandidates([candidate], "import");
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });
});
