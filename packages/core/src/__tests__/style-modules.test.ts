import { describe, it, expect } from "vitest";
import {
  listModules,
  getStyleModule,
  selectModulesForChapterType,
  combineModuleContent,
  combineRevisionChecks,
} from "../agents/style-modules.js";

describe("style-modules", () => {
  describe("listModules", () => {
    it("should list modules for specific language", () => {
      const zhModules = listModules("zh");
      expect(zhModules.length).toBeGreaterThan(0);
      expect(zhModules[0]?.language).toBe("zh");
    });
  });

  describe("getStyleModule", () => {
    it("should return module by ID", () => {
      const mod = getStyleModule("zh-tension");
      expect(mod).toBeDefined();
      expect(mod?.name).toContain("张力");
    });
  });

  describe("selectModulesForChapterType", () => {
    it("should select conflict modules for conflict type", () => {
      const ids = selectModulesForChapterType("冲突", "zh");
      expect(ids).toContain("zh-tension");
    });

    it("should include dialogue module if requested", () => {
      const ids = selectModulesForChapterType("冲突", "zh", true);
      expect(ids).toContain("zh-dialogue");
    });
  });

  describe("combineModuleContent", () => {
    it("should combine content of multiple modules", () => {
      const content = combineModuleContent(["zh-tension", "zh-pacing"]);
      expect(content).toContain("张力");
      expect(content).toContain("节奏");
    });
  });

  describe("combineRevisionChecks", () => {
    it("should combine revision checks of multiple modules", () => {
      const checks = combineRevisionChecks(["zh-tension"]);
      expect(checks).toContain("不可逆变化");
    });
  });
});
