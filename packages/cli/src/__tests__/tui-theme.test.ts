import { describe, expect, it } from "vitest";
import { detectTerminalBackground, resolveTuiTheme } from "../tui/theme.js";

describe("tui theme", () => {
  it("detects terminal backgrounds from COLORFGBG", () => {
    expect(detectTerminalBackground({ COLORFGBG: "15;0" })).toBe("dark");
    expect(detectTerminalBackground({ COLORFGBG: "0;15" })).toBe("light");
    expect(detectTerminalBackground({ COLORFGBG: "15;8" })).toBe("dark");
  });

  it("allows an explicit theme override", () => {
    expect(resolveTuiTheme({ INKOS_TUI_THEME: "light" }).reply).toBe("#1f1711");
    expect(resolveTuiTheme({ INKOS_TUI_THEME: "dark" }).reply).toBe("#f7efe3");
  });
});
