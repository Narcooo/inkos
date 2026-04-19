import { describe, expect, it } from "vitest";
import { stripAnsi } from "../tui/ansi.js";
import { buildStyledHelpSections, formatStyledStatusLines, intentToBadge } from "../tui/effects.js";

describe("tui effects i18n", () => {
  it("builds localized help sections", () => {
    const zhSections = buildStyledHelpSections("zh-CN");
    const enSections = buildStyledHelpSections("en");

    expect(zhSections[0]?.title).toBe("写作");
    expect(zhSections[1]?.commands[0]?.[1]).toContain("列出");
    expect(enSections[0]?.title).toBe("Writing");
  });

  it("localizes intent badges and status labels", () => {
    expect(stripAnsi(intentToBadge("write_next", "zh-CN"))).toContain("写作");

    const zhLines = formatStyledStatusLines("zh-CN", {
      mode: "semi",
      bookId: "harbor",
      status: "writing",
      events: [{ kind: "task.started", detail: "Preparing chapter 3.", status: "running" }],
    });

    expect(zhLines.join("\n")).toContain("模式");
    expect(zhLines.join("\n")).toContain("半自动");
    expect(zhLines.join("\n")).toContain("作品");
  });
});
