import { describe, expect, it } from "vitest";
import { buildStyleStatusNotice } from "./StyleManager";

describe("buildStyleStatusNotice", () => {
  it("surfaces analyze errors even when no profile is available yet", () => {
    expect(buildStyleStatusNotice("Error: analyze failed", "")).toEqual({
      tone: "error",
      message: "Error: analyze failed",
    });
  });

  it("falls back to import status when there is no analyze error", () => {
    expect(buildStyleStatusNotice("", "Style guide imported successfully!")).toEqual({
      tone: "success",
      message: "Style guide imported successfully!",
    });
  });

  it("returns null when there is nothing to show", () => {
    expect(buildStyleStatusNotice("", "")).toBeNull();
  });
});
