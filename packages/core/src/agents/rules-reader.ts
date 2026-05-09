import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGenreProfile, type ParsedGenreProfile } from "../models/genre-profile.js";
import { parseBookRules, tryParseBookRulesFrontmatter, type ParsedBookRules } from "../models/book-rules.js";
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
 * Load the structured book rules (YAML frontmatter).
 *
 * Phase 5 cleanup #3: the YAML frontmatter now lives at the top of
 * outline/story_frame.md. For books initialized before that cleanup it may
 * still live in book_rules.md instead, so we fall back to that legacy path
 * when story_frame.md has no frontmatter (or no file at all).
 *
 * Phase 5 hotfix 2: when the source is story_frame.md, the prose body
 * underneath the frontmatter is NOT semantic "book rules" text — it is the
 * 5-section outline essay. We therefore slice out ONLY the frontmatter block
 * for parseBookRules, so ParsedBookRules.body ends up empty for new-layout
 * books. Legacy book_rules.md still carries narrow narrative rules in its
 * body, so we pass it through verbatim.
 *
 * Returns null only if NEITHER source yields parseable rules.
 */
export async function readBookRules(bookDir: string): Promise<ParsedBookRules | null> {
  const storyFrameRaw = await tryReadFile(join(bookDir, "story/outline/story_frame.md"));
  if (storyFrameRaw) {
    // Extract just the leading `---\n...\n---` block. Anything after it is
    // outline prose and must NOT leak into ParsedBookRules.body.
    const frontmatterMatch = storyFrameRaw.match(/^\s*(---\s*\n[\s\S]*?\n---\s*)(?:\n|$)/);
    if (frontmatterMatch) {
      // Phase 5 hotfix 3: use the strict parser so a broken YAML block does
      // NOT silently zero out protagonist / prohibitions / genreLock. If the
      // frontmatter is malformed we log and fall through to legacy.
      const parsed = tryParseBookRulesFrontmatter(frontmatterMatch[1], (err) => {
        // eslint-disable-next-line no-console
        console.warn(
          `[rules-reader] story_frame.md frontmatter is malformed at ${bookDir}/story/outline/story_frame.md — falling back to legacy book_rules.md. Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
      if (parsed) return parsed;
      // fall through to legacy fallback below
    }
  }

  const legacyRaw = await tryReadFile(join(bookDir, "story/book_rules.md"));
  if (!legacyRaw) return null;
  // Legacy file: body intentionally preserved (narrow narrative rules).
  //
  // Phase hotfix 1: parseBookRules now returns null if the file is a Phase 5
  // compat shim (no YAML, only the architect-emitted pointer prose). In that
  // case we surface a warning so callers don't silently fall back to default
  // empty rules — the common new-book path where story_frame.md frontmatter
  // is broken AND no legacy rules ever existed.
  const parsed = parseBookRules(legacyRaw);
  if (parsed === null) {
    // eslint-disable-next-line no-console
    console.warn(
      `[rules-reader] book_rules.md at ${bookDir}/story/book_rules.md is a Phase 5 compat shim with no authoritative rules — returning null instead of silently zeroing out rules. Fix the YAML frontmatter on outline/story_frame.md.`,
    );
  }
  return parsed;
}

export function normalizePromptLanguage(language: "zh" | "en" | "ko" | undefined): "zh" | "en" | undefined {
  if (!language) return undefined;
  return language === "zh" ? "zh" : "en";
}

export async function readBookLanguage(bookDir: string): Promise<"zh" | "en" | undefined> {
  const raw = await tryReadFile(join(bookDir, "book.json"));
  if (!raw) return undefined;

  try {
    const parsed = BookConfigSchema.pick({ language: true }).safeParse(JSON.parse(raw));
    return parsed.success ? normalizePromptLanguage(parsed.data.language) : undefined;
  } catch {
    return undefined;
  }
}
