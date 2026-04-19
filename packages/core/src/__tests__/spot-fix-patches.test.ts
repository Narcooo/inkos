import { describe, expect, it } from "vitest";
import {
  applySpotFixPatches,
  parseSpotFixPatches,
  type SpotFixPatch,
} from "../utils/spot-fix-patches.js";

describe("spot-fix patches", () => {
  it("parses patch blocks from the PATCHES section", () => {
    const patches = parseSpotFixPatches([
      "=== PATCHES ===",
      "--- PATCH 1 ---",
      "TARGET_TEXT:",
      "原句一。",
      "REPLACEMENT_TEXT:",
      "新句一。",
      "--- END PATCH ---",
      "--- PATCH 2 ---",
      "TARGET_TEXT:",
      "原句二。",
      "REPLACEMENT_TEXT:",
      "新句二。",
      "--- END PATCH ---",
    ].join("\n"));

    expect(patches).toEqual<SpotFixPatch[]>([
      { targetText: "原句一。", replacementText: "新句一。" },
      { targetText: "原句二。", replacementText: "新句二。" },
    ]);
  });

  it("applies a uniquely targeted patch while preserving untouched text", () => {
    const original = [
      "门轴轻轻响了一下。",
      "林越没有立刻进去。",
      "",
      "巷子尽头的风还在吹。",
      "他把手按在潮冷的门框上，没有出声。",
      "更远处传来极轻的脚步回响，又很快断掉。",
    ].join("\n");

    const result = applySpotFixPatches(original, [
      {
        targetText: "林越没有立刻进去。",
        replacementText: "林越先停在门槛外，侧耳听了一息。",
      },
    ]);

    expect(result.applied).toBe(true);
    expect(result.revisedContent).toBe([
      "门轴轻轻响了一下。",
      "林越先停在门槛外，侧耳听了一息。",
      "",
      "巷子尽头的风还在吹。",
      "他把手按在潮冷的门框上，没有出声。",
      "更远处传来极轻的脚步回响，又很快断掉。",
    ].join("\n"));
  });

  it("rejects patches whose target text is not unique", () => {
    const original = "他停了一下。\n门里的人也停了一下。";

    const result = applySpotFixPatches(original, [
      {
        targetText: "停了一下",
        replacementText: "顿了顿",
      },
    ]);

    expect(result.applied).toBe(false);
    expect(result.revisedContent).toBe(original);
    expect(result.rejectedReason).toContain("exactly once");
  });

  it("rejects oversized patch sets that touch too much of the chapter", () => {
    const original = [
      "第一段很长，需要保留原样。",
      "第二段也很长，需要保留原样。",
      "第三段也很长，需要保留原样。",
      "第四段也很长，需要保留原样。",
    ].join("\n");

    const result = applySpotFixPatches(original, [
      {
        targetText: [
          "第一段很长，需要保留原样。",
          "第二段也很长，需要保留原样。",
          "第三段也很长，需要保留原样。",
        ].join("\n"),
        replacementText: "这里被大段重写了。",
      },
    ]);

    expect(result.applied).toBe(false);
    expect(result.revisedContent).toBe(original);
    expect(result.rejectedReason).toContain("touch");
  });
});
