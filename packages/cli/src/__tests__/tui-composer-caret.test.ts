import { describe, expect, it } from "vitest";
import { resolveComposerCaretState } from "../tui/composer-caret.js";

describe("tui composer caret", () => {
  it("keeps the empty composer caret visible without animation", () => {
    expect(resolveComposerCaretState({
      inputValue: "",
      isSubmitting: false,
      blinkTick: 0,
    })).toEqual({
      visible: true,
      shouldAnimate: false,
    });
  });

  it("keeps the typed composer caret visible without animation", () => {
    expect(resolveComposerCaretState({
      inputValue: "continue",
      isSubmitting: false,
      blinkTick: 0,
    })).toEqual({
      visible: true,
      shouldAnimate: false,
    });

    expect(resolveComposerCaretState({
      inputValue: "continue",
      isSubmitting: false,
      blinkTick: 1,
    })).toEqual({
      visible: true,
      shouldAnimate: false,
    });
  });

  it("hides the caret while submitting", () => {
    expect(resolveComposerCaretState({
      inputValue: "continue",
      isSubmitting: true,
      blinkTick: 0,
    })).toEqual({
      visible: false,
      shouldAnimate: false,
    });
  });
});
