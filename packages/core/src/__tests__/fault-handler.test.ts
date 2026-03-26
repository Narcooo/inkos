import { describe, it, expect } from "vitest";
import { detectFaults, decideCorrectionPath, detectStateContamination } from "../agents/fault-handler.js";

describe("fault-handler", () => {
  describe("detectFaults", () => {
    it("should detect abstraction resurgence in Chinese", () => {
      const content = "这篇文章本质上映射了某种深层次的逻辑，意味着体现了揭示了。";
      const faults = detectFaults(content, [], [], "zh");
      
      const abstraction = faults.find((f) => f.type === "abstraction-resurgence");
      expect(abstraction).toBeDefined();
      expect(abstraction?.severity).toBe("critical");
      expect(abstraction?.suggestedResponse.action).toBe("4A");
    });

    it("should detect high concept misfire in English", () => {
      const content = "The world's will and the cosmic law of causality reincarnation supreme fate!";
      const faults = detectFaults(content, [], [], "en");
      
      const highConcept = faults.find((f) => f.type === "high-concept-misfire");
      expect(highConcept).toBeDefined();
      expect(highConcept?.severity).toBe("critical");
      expect(highConcept?.suggestedResponse.action).toBe("4B");
    });

    it("should return empty if no markers found", () => {
      const content = "He walked to the store and bought an apple. It was red.";
      const faults = detectFaults(content, [], [], "en");
      expect(faults).toHaveLength(0);
    });
  });

  describe("decideCorrectionPath", () => {
    it("should choose 4B for critical faults", () => {
      const faults: any[] = [{ severity: "critical" }];
      expect(decideCorrectionPath(faults)).toBe("4B");
    });

    it("should choose 4A for warning faults", () => {
      const faults: any[] = [{ severity: "warning" }];
      expect(decideCorrectionPath(faults)).toBe("4A");
    });

    it("should pass if no faults", () => {
      expect(decideCorrectionPath([])).toBe("pass");
    });
  });

  describe("detectStateContamination", () => {
    it("should detect evaluative language from LLM", () => {
      const state = "值得注意的是，这段剧情非常精彩的表现，我们可以看到，显然这很出色。";
      const signal = detectStateContamination(state, "zh");
      expect(signal).toBeDefined();
      expect(signal?.type).toBe("state-contamination");
    });
  });
});
