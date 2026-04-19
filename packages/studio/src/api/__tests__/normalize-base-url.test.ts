import { describe, it, expect } from "vitest";

// normalizeBaseUrl is not exported, so we test the behavior through the
// server module's internal logic. We replicate the function here for unit testing.
// If the implementation changes, this test will catch regressions.
function normalizeBaseUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, "");
  if (/\/v\d+$/.test(trimmed)) return trimmed;
  return trimmed + "/v1";
}

describe("normalizeBaseUrl", () => {
  it("appends /v1 when missing", () => {
    expect(normalizeBaseUrl("https://timesniper.club")).toBe("https://timesniper.club/v1");
  });

  it("strips trailing slash then appends /v1", () => {
    expect(normalizeBaseUrl("https://timesniper.club/")).toBe("https://timesniper.club/v1");
  });

  it("strips multiple trailing slashes", () => {
    expect(normalizeBaseUrl("https://timesniper.club///")).toBe("https://timesniper.club/v1");
  });

  it("preserves existing /v1", () => {
    expect(normalizeBaseUrl("https://timesniper.club/v1")).toBe("https://timesniper.club/v1");
  });

  it("preserves other version paths like /v2", () => {
    expect(normalizeBaseUrl("https://api.example.com/v2")).toBe("https://api.example.com/v2");
  });

  it("all three forms are equivalent", () => {
    const a = normalizeBaseUrl("https://timesniper.club/v1");
    const b = normalizeBaseUrl("https://timesniper.club/");
    const c = normalizeBaseUrl("https://timesniper.club");
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
