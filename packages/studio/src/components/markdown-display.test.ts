import { describe, expect, it } from "vitest";
import { normalizeMarkdownForDisplay } from "./markdown-display";

describe("normalizeMarkdownForDisplay", () => {
  it("wraps embedded YAML blocks so markdown renderers preserve line breaks", () => {
    const input = [
      "## story_frame 발췌",
      "",
      "---",
      'version: "1.0"',
      "protagonist:",
      "  name: 루안",
      "prohibitions:",
      "  - 지나치게 화려한 마법 연출",
      "---",
      "",
      "## 01_주제",
      "본문",
    ].join("\n");

    expect(normalizeMarkdownForDisplay(input)).toBe([
      "## story_frame 발췌",
      "",
      "```yaml",
      'version: "1.0"',
      "protagonist:",
      "  name: 루안",
      "prohibitions:",
      "  - 지나치게 화려한 마법 연출",
      "```",
      "",
      "## 01_주제",
      "본문",
    ].join("\n"));
  });
});
