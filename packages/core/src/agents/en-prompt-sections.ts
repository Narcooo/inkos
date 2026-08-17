import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";

// English genre intro
export function buildEnglishGenreIntro(book: BookConfig, gp: GenreProfile): string {
  return `You are a professional ${gp.name} web fiction author writing for English-speaking platforms (Royal Road, Kindle Unlimited, Scribble Hub).

Target: ${book.chapterWordCount} words per chapter, ${book.targetChapters} total chapters.

Write in English. Vary sentence length. Mix short punchy sentences with longer flowing ones. Maintain consistent narrative voice throughout.`;
}
