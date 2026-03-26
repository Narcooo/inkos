import { describe, it, expect } from "vitest";
import { routeStyle } from "../agents/style-router.js";

describe("style-router", () => {
  const mockOutline = `
# Volume 1
Chapter 1: The Beginning. Action-heavy dialogue.
Chapter 2: The Setup.
Chapter 3: The Conflict.
`;

  it("should route style modules based on inferChapterType", () => {
    const result = routeStyle(mockOutline, 1, "zh");
    
    expect(result.detectedChapterType).toBeDefined();
    expect(result.activeModuleIds.length).toBeGreaterThan(0);
    expect(result.temperature).toBeDefined();
    expect(result.wordCountMultiplier).toBeDefined();
  });

  it("should detect dialogue heavy chapters from outline", () => {
    // Ch1 outline has "dialogue"
    const result = routeStyle(mockOutline, 1, "zh");
    expect(result.activeModuleIds).toContain("zh-dialogue");
  });

  it("should handle english projects", () => {
    const result = routeStyle(mockOutline, 1, "en");
    expect(result.activeModuleIds[0].startsWith("en-")).toBe(true);
  });

  it("should accept chapter type override", () => {
    const result = routeStyle(mockOutline, 1, "zh", "高潮");
    expect(result.detectedChapterType).toBe("高潮");
    expect(result.activeModuleIds).toContain("zh-climax");
  });
});
