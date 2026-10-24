import type {LengthSpec} from '../models/length-governance.js';
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { EPub } from "epub-gen-memory";
import {renderChapterDocument} from '../utils/chapter-document.js';
import {readChapterHeading} from '../utils/chapter-splitter.js';
import {buildLengthSpec, chapterLengthDelivery, countChapterLength, defaultChapterLength} from '../utils/length-metrics.js';

export interface ExportStateLike {
  readonly bookDir: (bookId: string) => string;
  readonly loadBookConfig: (bookId: string) => Promise<{
    readonly title: string; readonly language?: string; readonly chapterWordCount?: number;
    readonly minChapterLength?: number; readonly maxChapterLength?: number;
  }>;
  readonly loadChapterIndex: (bookId: string) => Promise<ReadonlyArray<{
    readonly number: number;
    readonly title?: string;
    readonly wordCount: number;
    readonly lengthSpec?: LengthSpec;
  }>>;
}

export interface ExportArtifact {
  readonly kind: "book_exported";
  readonly workId: string;
  readonly sourceDigest: string;
  readonly exportSourcePaths: readonly string[];
  readonly delivery: Awaited<ReturnType<typeof readBookExportSource>>["delivery"];
  readonly outputPath: string;
  readonly fileName: string;
  readonly chaptersExported: number;
  readonly totalWords: number;
  readonly format: "txt" | "md" | "epub";
  readonly contentType: string;
  readonly payload: string | Buffer;
}

/** Read once: measurements, exported text and the receipt describe the same source. */
export async function readBookExportSource(state: ExportStateLike, bookId: string) {
  const index = await state.loadChapterIndex(bookId);
  const book = await state.loadBookConfig(bookId);
  if (!index.length) throw new Error("No chapters to export.");
  const chaptersDir = join(state.bookDir(bookId), "chapters");
  const files = buildChapterFileLookup(await readdir(chaptersDir), index);
  const chapters = await Promise.all(index.map(async chapter => {
    const file = files.get(chapter.number)!;
    const raw = await readFile(join(chaptersDir, file), "utf-8");
    const heading = readChapterHeading(raw.trimStart().split(/\r?\n/u)[0] ?? "");
    const language = book.language === "en" || book.language === undefined && heading?.language === "en" ? "en" : "zh";
    const title = chapter.title ?? heading?.title ?? file.replace(/^\d+_/u, "").replace(/\.md$/u, "");
    const markdown = renderChapterDocument(chapter.number, title, raw, language);
    const spec = chapter.lengthSpec ?? buildLengthSpec(book.chapterWordCount ?? defaultChapterLength(language), language, book);
    const count = countChapterLength(markdown, spec.countingMode);
    return {number: chapter.number, file, markdown, count, delivery: chapterLengthDelivery(count, spec)};
  }));
  const checks = chapters.flatMap(chapter => chapter.delivery ? [{chapterNumber: chapter.number, ...chapter.delivery}] : []);
  const delivery = {
    status: checks.some(check => check.status === "needs_revision") ? "needs_revision" as const
      : checks.length ? "checks_passed" as const : "unverified" as const,
    chapters: checks,
  };
  const sourceDigest = createHash("sha256").update(JSON.stringify({title: book.title, language: book.language, chapters})).digest("hex");
  return {book, chapters, delivery, sourceDigest, totalWords: chapters.reduce((sum, chapter) => sum + chapter.count, 0)};
}

export class ChapterExportSourceError extends Error {
  readonly code = "CHAPTER_EXPORT_SOURCE_MISMATCH";
  constructor(readonly details: {
    readonly missingChapterNumbers: number[];
    readonly duplicateChapterNumbers: number[];
    readonly duplicateIndexNumbers: number[];
    readonly unindexedFiles: string[];
  }) {
    super(`Chapter index and source files differ: ${JSON.stringify(details)}. Inspect these files and reconcile the chapter index through chapter import before exporting.`);
    this.name = "ChapterExportSourceError";
  }
}

function buildChapterFileLookup(files: ReadonlyArray<string>, chapters: ReadonlyArray<{ readonly number: number }>): ReadonlyMap<number, string> {
  const lookup = new Map<number, string>();
  const indexed = new Set<number>();
  const duplicateIndexNumbers = new Set<number>();
  for (const chapter of chapters) {
    if (indexed.has(chapter.number)) duplicateIndexNumbers.add(chapter.number);
    indexed.add(chapter.number);
  }
  const duplicateChapterNumbers = new Set<number>();
  const unindexedFiles: string[] = [];
  for (const file of [...files].sort()) {
    if (!file.endsWith(".md")) continue;
    const match = /^(\d+)_.*\.md$/u.exec(file);
    const chapterNumber = match ? Number(match[1]) : undefined;
    if (chapterNumber === undefined || !indexed.has(chapterNumber)) {
      unindexedFiles.push(file);
      continue;
    }
    if (lookup.has(chapterNumber)) duplicateChapterNumbers.add(chapterNumber);
    lookup.set(chapterNumber, file);
  }
  const details = {
    missingChapterNumbers: [...indexed].filter(number => !lookup.has(number)).sort((a,b) => a-b),
    duplicateChapterNumbers: [...duplicateChapterNumbers].sort((a,b) => a-b),
    duplicateIndexNumbers: [...duplicateIndexNumbers].sort((a,b) => a-b),
    unindexedFiles,
  };
  if (Object.values(details).some(items => items.length > 0)) throw new ChapterExportSourceError(details);
  return lookup;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function markdownToSimpleHtml(markdown: string): { title: string; html: string } {
  const title = markdown.match(/^#\s+(.+)/m)?.[1]?.trim() ?? "Untitled Chapter";
  const html = markdown
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("\n");
  return { title, html };
}

export async function buildExportArtifact(
  state: ExportStateLike,
  bookId: string,
  options: {
    readonly format?: "txt" | "md" | "epub";
    readonly outputPath?: string;
  },
): Promise<ExportArtifact> {
  const format = options.format ?? "txt";
  const {book, chapters, delivery, sourceDigest, totalWords} = await readBookExportSource(state, bookId);

  const bookDir = state.bookDir(bookId);
  const outputPath = options.outputPath ?? join(bookDir, "exports", `${bookId}.${format}`);
  const receipt = {kind: "book_exported" as const, workId: bookId, sourceDigest, delivery,
    exportSourcePaths: chapters.map(chapter=>`source/chapters/${chapter.file}`)};

  if (format === "epub") {
    const epubChapters: Array<{ title: string; content: string }> = [];
    for (const chapter of chapters) {
      const { title, html } = markdownToSimpleHtml(chapter.markdown);
      epubChapters.push({ title, content: html });
    }
    const epubInstance = new EPub(
      { title: book.title, lang: book.language === "en" ? "en" : "zh-CN" },
      epubChapters,
    );
    return {
      ...receipt,
      outputPath,
      fileName: `${bookId}.epub`,
      chaptersExported: chapters.length,
      totalWords,
      format,
      contentType: "application/epub+zip",
      payload: await epubInstance.genEpub(),
    };
  }

  const parts: string[] = [];
  parts.push(format === "md" ? `# ${book.title}` : book.title);
  for (const chapter of chapters) {
    parts.push(chapter.markdown);
  }

  return {
    ...receipt,
    outputPath,
    fileName: `${bookId}.${format}`,
    chaptersExported: chapters.length,
    totalWords,
    format,
    contentType: format === "md" ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8",
    payload: parts.join("\n\n"),
  };
}

export async function writeExportArtifact(
  state: ExportStateLike,
  bookId: string,
  options: {
    readonly format?: "txt" | "md" | "epub";
    readonly outputPath?: string;
  },
): Promise<Omit<ExportArtifact, "payload" | "contentType" | "fileName">> {
  const artifact = await buildExportArtifact(state, bookId, options);
  await mkdir(dirname(artifact.outputPath), { recursive: true });
  await writeFile(artifact.outputPath, artifact.payload);
  return {
    kind: artifact.kind,
    workId: artifact.workId,
    sourceDigest: artifact.sourceDigest,
    exportSourcePaths: artifact.exportSourcePaths,
    delivery: artifact.delivery,
    outputPath: artifact.outputPath,
    chaptersExported: artifact.chaptersExported,
    totalWords: artifact.totalWords,
    format: artifact.format,
  };
}
