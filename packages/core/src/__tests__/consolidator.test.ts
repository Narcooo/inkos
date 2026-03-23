import { describe, expect, it } from "vitest";
import { ConsolidatorAgent } from "../agents/consolidator.js";

describe("ConsolidatorAgent", () => {
  it("parses Chinese volume boundaries with full-width parentheses and chapter ranges", () => {
    const agent = new ConsolidatorAgent({
      client: {} as ConstructorParameters<typeof ConsolidatorAgent>[0]["client"],
      model: "test-model",
      projectRoot: "/tmp",
    });

    const outline = [
      "# Volume Outline",
      "",
      "### 第一卷：死而复生的实习期（1-20章）",
      "- 主角重返公司，卷入第一起异常事故",
      "",
      "### 第二卷：时间线上的猎手（21-60章）",
      "- 追查时间裂隙背后的操控者",
      "",
    ].join("\n");

    const boundaries = (agent as unknown as {
      parseVolumeBoundaries: (input: string) => Array<{ name: string; startCh: number; endCh: number }>;
    }).parseVolumeBoundaries(outline);

    expect(boundaries).toEqual([
      { name: "第一卷：死而复生的实习期", startCh: 1, endCh: 20 },
      { name: "第二卷：时间线上的猎手", startCh: 21, endCh: 60 },
    ]);
  });
});
