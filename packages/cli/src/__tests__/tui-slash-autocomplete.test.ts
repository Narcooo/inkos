import { describe, expect, it } from "vitest";
import {
  applySlashSuggestion,
  getSlashSuggestions,
  getNextSlashSelection,
  SLASH_COMMANDS,
} from "../tui/slash-autocomplete.js";

describe("tui slash autocomplete", () => {
  it("filters slash commands by prefix", () => {
    expect(getSlashSuggestions("/st", SLASH_COMMANDS)).toEqual(["/status"]);
    expect(getSlashSuggestions("/w", SLASH_COMMANDS)).toEqual(["/write"]);
    expect(getSlashSuggestions("/o", SLASH_COMMANDS)).toEqual(["/open <book>"]);
    expect(getSlashSuggestions("/d", SLASH_COMMANDS)).toEqual(["/draft", "/discard", "/depth <light|normal|deep>"]);
    expect(getSlashSuggestions("/cr", SLASH_COMMANDS)).toEqual(["/create"]);
  });

  it("does not suggest anything for non-slash input", () => {
    expect(getSlashSuggestions("status", SLASH_COMMANDS)).toEqual([]);
    expect(getSlashSuggestions("", SLASH_COMMANDS)).toEqual([]);
  });

  it("cycles the active suggestion index", () => {
    expect(getNextSlashSelection(0, 3, "down")).toBe(1);
    expect(getNextSlashSelection(2, 3, "down")).toBe(0);
    expect(getNextSlashSelection(0, 3, "up")).toBe(2);
  });

  it("applies the selected suggestion to the composer input", () => {
    expect(applySlashSuggestion("/st", ["/status"], 0)).toBe("/status");
    expect(applySlashSuggestion("/o", ["/open <book>"], 0)).toBe("/open ");
    expect(applySlashSuggestion("/d", ["/depth <light|normal|deep>"], 0)).toBe("/depth ");
    expect(applySlashSuggestion("/dr", ["/draft"], 0)).toBe("/draft");
    expect(applySlashSuggestion("/cr", ["/create"], 0)).toBe("/create");
  });
});
