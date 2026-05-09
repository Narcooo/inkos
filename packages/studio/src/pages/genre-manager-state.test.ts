import { describe, expect, it } from "vitest";
import { isGenreVisibleForLanguage, resolveBookCreateLanguage } from "./genre-language";

describe("isGenreVisibleForLanguage", () => {
  const builtinEnglish = { id: "cozy", name: "Cozy Fantasy", source: "builtin" as const, language: "en" as const };
  const builtinKorean = { id: "ko-cozy", name: "코지 판타지", source: "builtin" as const, language: "ko" as const };
  const builtinChinese = { id: "xuanhuan", name: "玄幻", source: "builtin" as const, language: "zh" as const };
  const projectGenre = { id: "my-genre", name: "내 장르", source: "project" as const, language: "en" as const };

  it("shows only ko-* built-ins for Korean UI", () => {
    expect(isGenreVisibleForLanguage(builtinKorean, "ko")).toBe(true);
    expect(isGenreVisibleForLanguage(builtinEnglish, "ko")).toBe(false);
    expect(isGenreVisibleForLanguage(builtinChinese, "ko")).toBe(false);
  });

  it("keeps Korean built-ins out of the English genre list", () => {
    expect(isGenreVisibleForLanguage(builtinEnglish, "en")).toBe(true);
    expect(isGenreVisibleForLanguage(builtinKorean, "en")).toBe(false);
  });

  it("always shows project-level custom genres", () => {
    expect(isGenreVisibleForLanguage(projectGenre, "ko")).toBe(true);
    expect(isGenreVisibleForLanguage(projectGenre, "en")).toBe(true);
    expect(isGenreVisibleForLanguage(projectGenre, "zh")).toBe(true);
  });

  it("routes ko-* creation through the Korean language path", () => {
    expect(resolveBookCreateLanguage("zh", "ko-cozy")).toBe("ko");
    expect(resolveBookCreateLanguage("ko", "ko-cozy")).toBe("ko");
    expect(resolveBookCreateLanguage("zh", "xuanhuan")).toBe("zh");
    expect(resolveBookCreateLanguage("en", "cozy")).toBe("en");
  });
});
