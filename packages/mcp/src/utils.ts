import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import {
  countChapterLength,
  assertSafeBookId,
  resolveLengthCountingMode,
  safeChildPath,
  StateManager,
  type ChapterMeta,
} from "@actalk/inkos-core";
import type { BookResource, Budget } from "./types.js";

export function createBudget(max: number): Budget {
  return {
    max,
    used: 0,
    get remaining() {
      return Math.max(0, max - this.used);
    },
    take(text: string, limit?: number) {
      const allowed = Math.min(this.remaining, limit ?? this.remaining);
      if (allowed <= 0) return "";
      const value = text.slice(0, allowed);
      this.used += value.length;
      return value;
    },
  };
}

export function safeProjectPath(projectRoot: string, requestedPath: string): string {
  if (isAbsolute(requestedPath)) {
    const rel = relative(resolve(projectRoot), resolve(requestedPath));
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return resolve(requestedPath);
    throw new Error(`Path traversal blocked: ${requestedPath}`);
  }
  return safeChildPath(projectRoot, requestedPath);
}

export function nextIndexNumber(index: ReadonlyArray<ChapterMeta>): number {
  return index.reduce((max, chapter) => Math.max(max, chapter.number), 0) + 1;
}

export function upsertIndex(index: ReadonlyArray<ChapterMeta>, entry: ChapterMeta): ReadonlyArray<ChapterMeta> {
  const found = index.find((chapter) => chapter.number === entry.number);
  const next = found
    ? index.map((chapter) => chapter.number === entry.number ? { ...entry, createdAt: chapter.createdAt } : chapter)
    : [...index, entry];
  return next.sort((a, b) => a.number - b.number);
}

export function countWords(content: string, language: "zh" | "en"): number {
  return countChapterLength(content, resolveLengthCountingMode(language));
}

export function inferLanguage(content: string): "zh" | "en" {
  return /[\u4e00-\u9fff]/u.test(content) ? "zh" : "en";
}

export function sanitizeTitle(title: string): string {
  return (title || "untitled")
    .replace(/[/\\?%*:|"<>]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 50) || "untitled";
}

export function titleFromFile(file: string): string {
  return basename(file, extname(file)).replace(/^\d+[_\-\s]*/, "").trim() || "Untitled";
}

export function titleFromMarkdown(markdown: string): string {
  return markdown.match(/^#\s+(?:第\d+章\s+|Chapter\s+\d+:\s*)?(.+)$/m)?.[1]?.trim() ?? "";
}

export function stripMarkdownHeading(markdown: string): string {
  return markdown.replace(/^#\s+.+\n+/, "").trim();
}

export function findDuplicates(values: ReadonlyArray<string>): ReadonlyArray<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
}

export async function removeChapterMarkdown(chaptersDir: string): Promise<void> {
  const files = await readdir(chaptersDir).catch(() => [] as string[]);
  await Promise.all(files.filter((file) => /^\d{4}_.*\.md$/.test(file)).map((file) => rm(join(chaptersDir, file), { force: true })));
}

export async function appendImportReport(projectRoot: string, bookId: string, lines: ReadonlyArray<string>): Promise<string> {
  const reportPath = join(projectRoot, "books", bookId, "story", "import-report.md");
  await mkdir(dirname(reportPath), { recursive: true });
  const existing = await readFile(reportPath, "utf-8").catch(() => "# Import Report\n");
  await writeFile(reportPath, `${existing.trimEnd()}\n\n${lines.join("\n")}\n`, "utf-8");
  return relative(projectRoot, reportPath);
}

export async function writeIfMissing(path: string, content: string): Promise<void> {
  if (!await exists(path)) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf-8");
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function parseBookResource(uri: string): BookResource {
  const match = uri.match(/^inkos:\/\/book\/([^/]+)\/(manifest|chapters|context\/continue|chapter\/(\d+))$/);
  if (!match) throw new Error(`Unsupported InkOS MCP resource: ${uri}`);
  const kindRaw = match[2]!;
  return {
    bookId: decodeURIComponent(match[1]!),
    kind: kindRaw === "context/continue" ? "context" : kindRaw.startsWith("chapter/") ? "chapter" : kindRaw as "manifest" | "chapters",
    chapterNumber: match[3] ? Number.parseInt(match[3], 10) : 0,
  };
}

export function jsonResource(text: string): { readonly mimeType: string; readonly text: string } {
  return { mimeType: "application/json", text };
}

export async function resolveBookId(projectRoot: string, bookId?: string): Promise<string> {
  const state = new StateManager(projectRoot);
  const books = await state.listBooks();
  if (bookId) {
    assertSafeBookId(bookId);
    if (!books.includes(bookId)) throw new Error(`Book "${bookId}" not found.`);
    return bookId;
  }
  if (books.length === 1) return books[0]!;
  if (books.length === 0) throw new Error("No books found.");
  throw new Error(`Multiple books found: ${books.join(", ")}. Specify bookId.`);
}
