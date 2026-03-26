import { describe, it, expect, vi } from "vitest";
import { CorrectionAgent } from "../agents/correction-agent.js";

describe("correction-agent", () => {
  const mockContext: any = {
    client: {} as any,
    model: "test-model",
    logger: { info: vi.fn() },
  };

  it("should correctly handle S4A light correction", async () => {
    const agent = new CorrectionAgent(mockContext);
    const spy = vi.spyOn(agent as any, "chat").mockResolvedValue({
      content: "Corrected Content",
    });

    const result = await agent.correctLight(
      "Original",
      ["Rules"],
      { auditDriftCorrection: "", recentViolations: [], fatigueWordBudget: "", blacklistTerms: [], forbiddenDirections: [] } as any,
      "zh"
    );

    expect(result.correctedContent).toBe("Corrected Content");
    expect(spy).toHaveBeenCalled();
  });
});
