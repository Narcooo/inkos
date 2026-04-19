import { describe, expect, it } from "vitest";
import { getTimeBasedThemeForHour, readStoredTheme, resolveThemePreference } from "./use-theme";

describe("resolveThemePreference", () => {
  it("keeps a stored manual light theme during night hours", () => {
    expect(resolveThemePreference({ hour: 23, storedTheme: "light" })).toBe("light");
  });

  it("falls back to the clock when no manual theme is stored", () => {
    expect(resolveThemePreference({ hour: 23, storedTheme: null })).toBe("dark");
    expect(resolveThemePreference({ hour: 9, storedTheme: null })).toBe("light");
  });
});

describe("getTimeBasedThemeForHour", () => {
  it("switches at 6:00 and 18:00", () => {
    expect(getTimeBasedThemeForHour(5)).toBe("dark");
    expect(getTimeBasedThemeForHour(6)).toBe("light");
    expect(getTimeBasedThemeForHour(17)).toBe("light");
    expect(getTimeBasedThemeForHour(18)).toBe("dark");
  });
});

describe("readStoredTheme", () => {
  it("accepts only light and dark values from storage", () => {
    expect(readStoredTheme({ getItem: () => "light" })).toBe("light");
    expect(readStoredTheme({ getItem: () => "dark" })).toBe("dark");
    expect(readStoredTheme({ getItem: () => "auto" })).toBeNull();
    expect(readStoredTheme({ getItem: () => null })).toBeNull();
  });
});
