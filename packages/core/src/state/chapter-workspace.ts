import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ChapterVersionSource =
  | "manual"
  | "agent"
  | "revision"
  | "regeneration"
  | "restore";

export interface ChapterVersion {
  readonly id: string;
  readonly chapterNumber: number;
  readonly source: ChapterVersionSource;
  readonly createdAt: string;
  readonly characterCount: number;
}

const VERSION_ID_PATTERN = /^(\d{13})_(manual|agent|revision|regeneration|restore)_([0-9a-f-]{36})$/;

export async function readChapterUserBrief(
  bookDir: string,
  chapterNumber: number,
): Promise<string> {
  try {
    return (await readFile(userBriefPath(bookDir, chapterNumber), "utf-8")).trim();
  } catch (error) {
    if (isMissingFile(error)) return "";
    throw error;
  }
}

export async function saveChapterUserBrief(
  bookDir: string,
  chapterNumber: number,
  brief: string,
): Promise<void> {
  const path = userBriefPath(bookDir, chapterNumber);
  const normalized = brief.trim();
  if (!normalized) {
    await rm(path, { force: true });
    return;
  }
  await mkdir(join(bookDir, "story", "runtime"), { recursive: true });
  await writeFile(path, `${normalized}\n`, "utf-8");
}

export async function readChapterPlanDocument(
  bookDir: string,
  chapterNumber: number,
): Promise<string | null> {
  try {
    return await readFile(planPath(bookDir, chapterNumber), "utf-8");
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

export async function archiveChapterVersion(
  bookDir: string,
  chapterNumber: number,
  content: string,
  source: ChapterVersionSource,
  now = new Date(),
): Promise<ChapterVersion> {
  assertChapterNumber(chapterNumber);
  const id = `${now.getTime()}_${source}_${randomUUID()}`;
  const dir = versionsDir(bookDir, chapterNumber);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.md`), content, "utf-8");
  return {
    id,
    chapterNumber,
    source,
    createdAt: now.toISOString(),
    characterCount: content.length,
  };
}

export async function listChapterVersions(
  bookDir: string,
  chapterNumber: number,
): Promise<ReadonlyArray<ChapterVersion>> {
  assertChapterNumber(chapterNumber);
  let files: string[];
  try {
    files = await readdir(versionsDir(bookDir, chapterNumber));
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }

  const versions = await Promise.all(files.flatMap((file) => {
    if (!file.endsWith(".md")) return [];
    const id = file.slice(0, -3);
    const parsed = parseVersionId(id);
    if (!parsed) return [];
    return [readFile(join(versionsDir(bookDir, chapterNumber), file), "utf-8").then((content) => ({
      id,
      chapterNumber,
      source: parsed.source,
      createdAt: new Date(parsed.timestamp).toISOString(),
      characterCount: content.length,
    }))];
  }));

  return versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readChapterVersion(
  bookDir: string,
  chapterNumber: number,
  versionId: string,
): Promise<string> {
  assertChapterNumber(chapterNumber);
  if (!parseVersionId(versionId)) {
    throw new Error(`Invalid chapter version id: ${versionId}`);
  }
  return readFile(join(versionsDir(bookDir, chapterNumber), `${versionId}.md`), "utf-8");
}

function userBriefPath(bookDir: string, chapterNumber: number): string {
  assertChapterNumber(chapterNumber);
  return join(bookDir, "story", "runtime", `chapter-${padChapter(chapterNumber)}.user-brief.md`);
}

function planPath(bookDir: string, chapterNumber: number): string {
  assertChapterNumber(chapterNumber);
  return join(bookDir, "story", "runtime", `chapter-${padChapter(chapterNumber)}.plan.md`);
}

function versionsDir(bookDir: string, chapterNumber: number): string {
  return join(bookDir, "chapters", ".versions", padChapter(chapterNumber));
}

function padChapter(chapterNumber: number): string {
  return String(chapterNumber).padStart(4, "0");
}

function assertChapterNumber(chapterNumber: number): void {
  if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
    throw new Error(`Invalid chapter number: ${chapterNumber}`);
  }
}

function parseVersionId(
  versionId: string,
): { readonly timestamp: number; readonly source: ChapterVersionSource } | null {
  const match = versionId.match(VERSION_ID_PATTERN);
  if (!match) return null;
  const timestamp = Number.parseInt(match[1]!, 10);
  if (!Number.isFinite(timestamp)) return null;
  return {
    timestamp,
    source: match[2] as ChapterVersionSource,
  };
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
