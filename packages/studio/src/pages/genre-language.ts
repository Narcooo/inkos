export type GenreUiLanguage = "zh" | "en" | "ko";

export interface GenreListItem {
  readonly id: string;
  readonly name: string;
  readonly source: "project" | "builtin";
  readonly language: "zh" | "en" | "ko";
}

export function isKoreanGenreId(genreId: string): boolean {
  return genreId.startsWith("ko-");
}

export function isGenreVisibleForLanguage(
  genre: GenreListItem,
  language: GenreUiLanguage,
): boolean {
  if (genre.source === "project") {
    return true;
  }
  if (language === "ko") {
    return genre.language === "ko" || isKoreanGenreId(genre.id);
  }
  if (language === "en") {
    return genre.language === "en" && !isKoreanGenreId(genre.id);
  }
  return genre.language === "zh";
}

export function filterGenresForLanguage(
  genres: ReadonlyArray<GenreListItem>,
  language: GenreUiLanguage,
): ReadonlyArray<GenreListItem> {
  return genres.filter((genre) => isGenreVisibleForLanguage(genre, language));
}

export function resolveBookCreateLanguage(
  projectLanguage: "zh" | "en" | "ko",
  genreId: string,
): "zh" | "en" | "ko" {
  return projectLanguage === "ko" || isKoreanGenreId(genreId.trim()) ? "ko" : projectLanguage;
}
