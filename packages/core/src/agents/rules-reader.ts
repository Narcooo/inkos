import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGenreProfile, type ParsedGenreProfile } from "../models/genre-profile.js";
import { parseBookRules, type ParsedBookRules } from "../models/book-rules.js";
import { BookConfigSchema } from "../models/book.js";

const BUILTIN_GENRES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../genres");

async function tryReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Load genre profile. Lookup order:
 * 1. Project-level: {projectRoot}/genres/{genreId}.md
 * 2. Built-in:     packages/core/genres/{genreId}.md
 * 3. Fallback:     built-in other.md
 */
export async function readGenreProfile(
  projectRoot: string,
  genreId: string,
): Promise<ParsedGenreProfile> {
  const projectPath = join(projectRoot, "genres", `${genreId}.md`);
  const builtinPath = join(BUILTIN_GENRES_DIR, `${genreId}.md`);
  const fallbackPath = join(BUILTIN_GENRES_DIR, "other.md");

  const raw =
    (await tryReadFile(projectPath)) ??
    (await tryReadFile(builtinPath)) ??
    (await tryReadFile(fallbackPath));

  if (!raw) {
    throw new Error(`Genre profile not found for "${genreId}" and fallback "other.md" is missing`);
  }

  return parseGenreProfile(raw);
}

/**
 * List all available genre profiles (project-level + built-in, deduped).
 * Returns array of { id, name, source }.
 */
export async function listAvailableGenres(
  projectRoot: string,
): Promise<ReadonlyArray<{ readonly id: string; readonly name: string; readonly source: "project" | "builtin" }>> {
  const results = new Map<string, { id: string; name: string; source: "project" | "builtin" }>();

  // Built-in genres first
  try {
    const builtinFiles = await readdir(BUILTIN_GENRES_DIR);
    for (const file of builtinFiles) {
      if (!file.endsWith(".md")) continue;
      const id = file.replace(/\.md$/, "");
      const raw = await tryReadFile(join(BUILTIN_GENRES_DIR, file));
      if (!raw) continue;
      const parsed = parseGenreProfile(raw);
      results.set(id, { id, name: parsed.profile.name, source: "builtin" });
    }
  } catch { /* no builtin dir */ }

  // Project-level genres override
  const projectDir = join(projectRoot, "genres");
  try {
    const projectFiles = await readdir(projectDir);
    for (const file of projectFiles) {
      if (!file.endsWith(".md")) continue;
      const id = file.replace(/\.md$/, "");
      const raw = await tryReadFile(join(projectDir, file));
      if (!raw) continue;
      const parsed = parseGenreProfile(raw);
      results.set(id, { id, name: parsed.profile.name, source: "project" });
    }
  } catch { /* no project genres dir */ }

  return [...results.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Return the path to the built-in genres directory. */
export function getBuiltinGenresDir(): string {
  return BUILTIN_GENRES_DIR;
}

/**
 * Load book_rules.md from the book's story directory.
 * Returns null if the file doesn't exist.
 */
export async function readBookRules(bookDir: string): Promise<ParsedBookRules | null> {
  const raw = await tryReadFile(join(bookDir, "story/book_rules.md"));
  if (!raw) return null;
  return parseBookRules(raw);
}

export async function readBookLanguage(bookDir: string): Promise<"zh" | "en" | undefined> {
  const raw = await tryReadFile(join(bookDir, "book.json"));
  if (!raw) return undefined;

  try {
    const parsed = BookConfigSchema.pick({ language: true }).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.language : undefined;
  } catch {
    return undefined;
  }
}
