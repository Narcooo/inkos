import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  TranslationChapterFile,
  TranslationGlossaryTerm,
  TranslationProjectManifest,
} from "./types.js";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";

export function translationProjectDir(projectRoot: string, projectId: string): string {
  return join(projectRoot, "translations", projectId);
}

export function translationManifestPath(projectRoot: string, projectId: string): string {
  return join(translationProjectDir(projectRoot, projectId), "manifest.json");
}

export async function loadTranslationManifest(
  projectRoot: string,
  projectId: string,
): Promise<TranslationProjectManifest> {
  return JSON.parse(await readFile(translationManifestPath(projectRoot, projectId), "utf-8")) as TranslationProjectManifest;
}

export async function saveTranslationManifest(
  projectRoot: string,
  manifest: TranslationProjectManifest,
): Promise<void> {
  await writeFile(translationManifestPath(projectRoot, manifest.id), JSON.stringify(manifest, null, 2), "utf-8");
}

export async function loadTranslationChapter(
  projectRoot: string,
  chapterPath: string,
): Promise<TranslationChapterFile> {
  return JSON.parse(await readFile(join(projectRoot, chapterPath), "utf-8")) as TranslationChapterFile;
}

export async function saveTranslationChapter(
  projectRoot: string,
  chapterPath: string,
  chapter: TranslationChapterFile,
): Promise<void> {
  await writeFile(join(projectRoot, chapterPath), JSON.stringify(chapter, null, 2), "utf-8");
}

export async function loadTranslationGlossary(
  projectRoot: string,
  projectId: string,
): Promise<ReadonlyArray<TranslationGlossaryTerm>> {
  try {
    const raw = JSON.parse(await readFile(join(translationProjectDir(projectRoot, projectId), "glossary.json"), "utf-8")) as {
      terms?: unknown;
    };
    return Array.isArray(raw.terms) ? raw.terms.filter(isGlossaryTerm) : [];
  } catch {
    return [];
  }
}

export async function saveTranslationGlossary(
  projectRoot: string,
  projectId: string,
  terms: ReadonlyArray<TranslationGlossaryTerm>,
): Promise<void> {
  await writeFile(
    join(translationProjectDir(projectRoot, projectId), "glossary.json"),
    JSON.stringify({ terms: mergeGlossaryTerms(terms) }, null, 2),
    "utf-8",
  );
}

export async function saveTranslationProgress(
  projectRoot: string,
  projectId: string,
  chapterPath: string,
  chapter: TranslationChapterFile,
  terms: ReadonlyArray<TranslationGlossaryTerm>,
): Promise<void> {
  await commitAtomicFileSet({
    rootDir: projectRoot,
    writes: [
      {
        relativePath: chapterPath,
        content: `${JSON.stringify(chapter, null, 2)}\n`,
      },
      {
        relativePath: join("translations", projectId, "glossary.json"),
        content: `${JSON.stringify({ terms: mergeGlossaryTerms(terms) }, null, 2)}\n`,
      },
    ],
  });
}

export function mergeGlossaryTerms(terms: ReadonlyArray<TranslationGlossaryTerm>): ReadonlyArray<TranslationGlossaryTerm> {
  const map = new Map<string, TranslationGlossaryTerm>();
  for (const term of terms) {
    const key = term.source.trim().toLowerCase();
    if (!key) continue;
    map.set(key, {
      source: term.source.trim(),
      target: term.target.trim(),
      ...(term.note?.trim() ? { note: term.note.trim() } : {}),
    });
  }
  return [...map.values()];
}

function isGlossaryTerm(value: unknown): value is TranslationGlossaryTerm {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.source === "string" && typeof record.target === "string";
}
