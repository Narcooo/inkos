import { describe, expect, it } from "vitest";
import { describeActivityState } from "../tui/activity-state.js";
import { getTuiCopy } from "../tui/i18n.js";
import { WARM_ACCENT } from "../tui/theme.js";

describe("tui activity state", () => {
  it("maps chat-like intents to thinking", () => {
    const copy = getTuiCopy("en");
    expect(describeActivityState("chat", copy)).toMatchObject({ label: "thinking", accent: WARM_ACCENT });
    expect(describeActivityState("explain_status", copy)).toMatchObject({ label: "checking", accent: WARM_ACCENT });
  });

  it("maps writing and review intents to task-specific labels", () => {
    const zhCopy = getTuiCopy("zh-CN");
    expect(describeActivityState("write_next", zhCopy)).toMatchObject({ label: "写作中", accent: WARM_ACCENT });
    expect(describeActivityState("revise_chapter", zhCopy)).toMatchObject({ label: "审阅中", accent: WARM_ACCENT });
    expect(describeActivityState("rewrite_chapter", zhCopy)).toMatchObject({ label: "审阅中", accent: WARM_ACCENT });
    expect(describeActivityState("chat", zhCopy).intervalMs).toBeGreaterThanOrEqual(180);
  });
});
