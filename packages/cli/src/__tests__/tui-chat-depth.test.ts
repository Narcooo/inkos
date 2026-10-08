import { describe, expect, it } from "vitest";
import { resolveChatDepthProfile } from "../tui/chat-depth.js";

describe("tui chat depth", () => {
  it("maps light/normal/deep to stable chat options", () => {
    expect(resolveChatDepthProfile("light")).toEqual({
      depth: "light",

      maxTokens: 160,
      label: "light",
    });
    const normal = resolveChatDepthProfile("normal");
    expect(normal).toEqual({
      depth: "normal",

      label: "normal",
    });
    // normal depth must NOT include maxTokens — let the model decide
    expect(normal.maxTokens).toBeUndefined();
    expect(resolveChatDepthProfile("deep")).toEqual({
      depth: "deep",

      maxTokens: 420,
      label: "deep",
    });
  });
});
