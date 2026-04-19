import { describe, expect, it } from "vitest";
import { inputPromptPrefix } from "../tui/effects.js";
import { stripAnsi } from "../tui/ansi.js";

describe("tui input chrome", () => {
  it("produces a prompt prefix with the › indicator", () => {
    const prefix = stripAnsi(inputPromptPrefix());
    expect(prefix).toContain("›");
  });
});
