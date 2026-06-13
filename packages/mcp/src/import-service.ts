import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  splitChapters,
  type BookConfig,
  type ChapterMeta,
} from "@actalk/inkos-core";
import {
  appendImportReport,
  countWords,
  exists,
  inferLanguage,
  naturalCompare,
  removeChapterMarkdown,
  safeProjectPath,
  sanitizeTitle,
  stripMarkdownHeading,
  titleFromFile,
  writeIfMissing,
} from "./utils.js";
import type {
  ImportMode,
  ImportPreviewInput,
  ParsedChapter,
  PreviewChapter,
} from "./types.js";

export async function parseImportSource(
  sourcePath: string,
  projectRoot: string,
  input: ImportPreviewInput,
): Promise<{ readonly sourceKind: "file" | "directory"; readonly chapters: ReadonlyArray<ParsedChapter> }> {
  const info = await stat(sourcePath);
  if (info.isDirectory()) {
    return { sourceKind: "directory", chapters: await parseDirectorySource(sourcePath, projectRoot, input) };
  }
  const text = await readFile(sourcePath, input.encoding ?? "utf-8");
  return { sourceKind: "file", chapters: parseTextFile(text, input.splitPattern) };
}

export function toPreviewChapter(chapter: ParsedChapter, number: number): PreviewChapter {
  const wordCount = countWords(chapter.content, inferLanguage(chapter.content));
  return {
    number,
    title: chapter.title,
    wordCount,
    charCount: chapter.content.length,
    sourceFile: chapter.sourceFile,
    tooShort: wordCount < 50,
  };
}

export async function writeImportedBook(input: {
  readonly projectRoot: string;
  readonly bookId: string;
  readonly bookDir: string;
  readonly title: string;
  readonly mode: ImportMode;
  readonly chapters: ReadonlyArray<ParsedChapter>;
  readonly startNumber: number;
  readonly existingIndex: ReadonlyArray<ChapterMeta>;
  readonly sourcePath: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const chaptersDir = join(input.bookDir, "chapters");
  await mkdir(chaptersDir, { recursive: true });
  await ensureBookConfig(input.bookDir, input.bookId, input.title, now);
  await ensureBasicStoryFiles(input.bookDir);
  if (input.mode === "replace") {
    await removeChapterMarkdown(chaptersDir);
  }
  const entries = await writeChapterFiles(input.bookDir, input.chapters, input.startNumber);
  const updatedIndex = input.mode === "append"
    ? [...input.existingIndex, ...entries]
    : entries;
  await writeFile(join(chaptersDir, "index.json"), JSON.stringify(updatedIndex, null, 2), "utf-8");
  await appendImportReport(input.projectRoot, input.bookId, [
    "## Deterministic Import",
    "",
    `- source: ${relative(input.projectRoot, input.sourcePath)}`,
    `- mode: ${input.mode}`,
    `- imported_chapters: ${input.chapters.length}`,
    "- no_llm: true",
    "- needs_agent_settlement: true",
  ]);
}

export function plannedImportFiles(bookId: string, count: number, startNumber: number): ReadonlyArray<string> {
  const files = [
    `books/${bookId}/book.json`,
    `books/${bookId}/chapters/index.json`,
    `books/${bookId}/story/author_intent.md`,
    `books/${bookId}/story/current_focus.md`,
    `books/${bookId}/story/import-report.md`,
  ];
  for (let i = 0; i < count; i++) {
    files.push(`books/${bookId}/chapters/${String(startNumber + i).padStart(4, "0")}_*.md`);
  }
  return files;
}

async function parseDirectorySource(
  sourcePath: string,
  projectRoot: string,
  input: ImportPreviewInput,
): Promise<ReadonlyArray<ParsedChapter>> {
  const entries = (await readdir(sourcePath))
    .filter((file) => file.endsWith(".txt") || file.endsWith(".md"))
    .sort(naturalCompare);
  const chapters: ParsedChapter[] = [];
  for (const entry of entries) {
    const fullPath = safeProjectPath(projectRoot, join(sourcePath, entry));
    const text = await readFile(fullPath, input.encoding ?? "utf-8");
    const split = parseTextFile(text, input.splitPattern);
    if (split.length > 0) {
      chapters.push(...split.map((chapter) => ({ ...chapter, sourceFile: entry })));
    } else {
      chapters.push({ title: titleFromFile(entry), content: stripMarkdownHeading(text), sourceFile: entry });
    }
  }
  return chapters;
}

function parseTextFile(text: string, splitPattern?: string): ReadonlyArray<ParsedChapter> {
  return splitChapters(text, splitPattern)
    .map((chapter) => ({ title: chapter.title, content: chapter.content }))
    .filter((chapter) => chapter.content.trim().length > 0);
}

async function ensureBookConfig(bookDir: string, bookId: string, title: string, now: string): Promise<void> {
  const path = join(bookDir, "book.json");
  if (await exists(path)) return;
  await mkdir(bookDir, { recursive: true });
  const book: BookConfig = {
    id: bookId,
    title,
    platform: "other",
    genre: "other",
    status: "active",
    targetChapters: 200,
    chapterWordCount: 3000,
    language: "zh",
    createdAt: now,
    updatedAt: now,
  };
  await writeFile(path, JSON.stringify(book, null, 2), "utf-8");
}

async function ensureBasicStoryFiles(bookDir: string): Promise<void> {
  const storyDir = join(bookDir, "story");
  await mkdir(join(storyDir, "state"), { recursive: true });
  await mkdir(join(storyDir, "runtime"), { recursive: true });
  await mkdir(join(storyDir, "outline"), { recursive: true });
  await writeIfMissing(join(storyDir, "author_intent.md"), "# 作者意图\n\n（由外部 agent 或用户补充。）\n");
  await writeIfMissing(join(storyDir, "current_focus.md"), "# 当前聚焦\n\n（导入后请补充接下来 1-3 章重点。）\n");
  await writeIfMissing(join(storyDir, "notes.md"), "# Notes\n\n");
  await writeIfMissing(join(storyDir, "state", "manifest.json"), JSON.stringify({ noLlmImport: true, needsAgentSettlement: true }, null, 2));
}

async function writeChapterFiles(
  bookDir: string,
  chapters: ReadonlyArray<ParsedChapter>,
  startNumber: number,
): Promise<ReadonlyArray<ChapterMeta>> {
  const now = new Date().toISOString();
  const chaptersDir = join(bookDir, "chapters");
  const entries: ChapterMeta[] = [];
  for (let index = 0; index < chapters.length; index++) {
    const chapter = chapters[index]!;
    const number = startNumber + index;
    const filePath = join(chaptersDir, `${String(number).padStart(4, "0")}_${sanitizeTitle(chapter.title)}.md`);
    await writeFile(filePath, `# 第${number}章 ${chapter.title}\n\n${chapter.content.trimEnd()}\n`, "utf-8");
    entries.push({
      number,
      title: chapter.title,
      status: "imported",
      wordCount: countWords(chapter.content, inferLanguage(chapter.content)),
      createdAt: now,
      updatedAt: now,
      auditIssues: [],
      lengthWarnings: [],
      reviewNote: "deterministic no-LLM import; needs_agent_settlement=true",
    });
  }
  return entries;
}
