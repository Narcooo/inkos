import { StateManager, countChapterLength, readGenreProfile, resolveLengthCountingMode, type ChapterMeta } from "@actalk/inkos-core";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ApiError, isMissingFileError, isSafeBookId } from "../errors.js";
import type { ChapterDetail, ChapterSummary } from "../../shared/contracts.js";

export class ChapterService {
  private readonly state: StateManager;

  constructor(private readonly projectRoot: string) {
    this.state = new StateManager(projectRoot);
  }

  async listChapters(bookId: string): Promise<ReadonlyArray<ChapterSummary> | null> {
    if (!(await this.hasBook(bookId))) {
      return null;
    }

    const index = await this.loadChapterIndexStrict(bookId);
    const chapterFiles = await this.resolveChapterFiles(bookId);
    return index.map((chapter) => this.toChapterSummary(chapter, chapterFiles));
  }

  async getChapter(bookId: string, chapterNumber: number): Promise<ChapterDetail | null> {
    if (!(await this.hasBook(bookId))) {
      return null;
    }

    const index = await this.loadChapterIndexStrict(bookId);
    const chapter = index.find((entry) => entry.number === chapterNumber);
    if (!chapter) {
      return null;
    }

    const chapterFiles = await this.resolveChapterFiles(bookId);
    const fileName = chapterFiles.get(chapter.number) ?? null;
    if (!fileName) {
      return null;
    }

    const content = await readFile(join(this.state.bookDir(bookId), "chapters", fileName), "utf-8");

    return {
      ...this.toChapterSummary(chapter, chapterFiles),
      auditIssues: chapter.auditIssues,
      ...(chapter.reviewNote ? { reviewNote: chapter.reviewNote } : {}),
      content,
    };
  }

  async hasBook(bookId: string): Promise<boolean> {
    if (!isSafeBookId(bookId)) {
      return false;
    }

    try {
      await this.state.loadBookConfig(bookId);
      return true;
    } catch (error) {
      if (isMissingFileError(error)) {
        return false;
      }

      throw error;
    }
  }

  async saveChapter(bookId: string, chapterNumber: number, content: string): Promise<ChapterDetail | null> {
    const chapterState = await this.resolveChapterState(bookId, chapterNumber);
    if (!chapterState) {
      return null;
    }

    const chapterPath = join(this.state.bookDir(bookId), "chapters", chapterState.fileName);
    const previousContent = await readFile(chapterPath, "utf-8");

    const updatedAt = new Date().toISOString();
    const nextTitle = extractChapterTitle(content) ?? chapterState.chapter.title;
    const wordCount = await this.countChapterWords(bookId, content);
    const nextIndex = chapterState.index.map((entry) =>
      entry.number === chapterNumber
        ? {
            ...entry,
            title: nextTitle,
            wordCount,
            updatedAt,
          }
        : entry,
    );

    await writeFile(chapterPath, content, "utf-8");

    try {
      await this.state.saveChapterIndex(bookId, nextIndex);
    } catch (error) {
      await writeFile(chapterPath, previousContent, "utf-8");
      throw error;
    }

    return this.getChapter(bookId, chapterNumber);
  }

  async approveChapter(bookId: string, chapterNumber: number): Promise<ChapterDetail | null> {
    return this.applyReviewAction(bookId, chapterNumber, (chapter) => ({
      ...chapter,
      status: "approved",
      updatedAt: new Date().toISOString(),
    }));
  }

  async rejectChapter(bookId: string, chapterNumber: number, reason?: string): Promise<ChapterDetail | null> {
    return this.applyReviewAction(bookId, chapterNumber, (chapter) => ({
      ...chapter,
      status: "rejected",
      reviewNote: reason ?? "Rejected without reason",
      updatedAt: new Date().toISOString(),
    }));
  }

  private toChapterSummary(chapter: ChapterMeta, chapterFiles: Map<number, string>): ChapterSummary {
    return {
      number: chapter.number,
      title: chapter.title,
      status: chapter.status,
      wordCount: chapter.wordCount,
      auditIssueCount: chapter.auditIssues.length,
      updatedAt: chapter.updatedAt,
      fileName: chapterFiles.get(chapter.number) ?? null,
    };
  }

  private async applyReviewAction(
    bookId: string,
    chapterNumber: number,
    mutate: (chapter: ChapterMeta) => ChapterMeta,
  ): Promise<ChapterDetail | null> {
    const chapterState = await this.resolveChapterState(bookId, chapterNumber);
    if (!chapterState) {
      return null;
    }

    const nextIndex = [...chapterState.index];
    nextIndex[chapterState.chapterIndex] = mutate(chapterState.chapter);
    await this.state.saveChapterIndex(bookId, nextIndex);
    return this.getChapter(bookId, chapterNumber);
  }

  private async resolveChapterState(bookId: string, chapterNumber: number): Promise<{
    index: ReadonlyArray<ChapterMeta>;
    chapterIndex: number;
    chapter: ChapterMeta;
    fileName: string;
  } | null> {
    if (!(await this.hasBook(bookId))) {
      return null;
    }

    const index = await this.loadChapterIndexStrict(bookId);
    const chapterIndex = index.findIndex((entry) => entry.number === chapterNumber);
    if (chapterIndex === -1) {
      return null;
    }

    const chapterFiles = await this.resolveChapterFiles(bookId);
    const fileName = chapterFiles.get(chapterNumber) ?? null;
    if (!fileName) {
      return null;
    }

    return {
      index,
      chapterIndex,
      chapter: index[chapterIndex]!,
      fileName,
    };
  }

  private async countChapterWords(bookId: string, content: string): Promise<number> {
    const book = await this.state.loadBookConfig(bookId);
    const language = book.language ?? (await readGenreProfile(this.projectRoot, book.genre)).profile.language;
    return countChapterLength(content, resolveLengthCountingMode(language));
  }

  private async resolveChapterFiles(bookId: string): Promise<Map<number, string>> {
    const chaptersDir = join(this.state.bookDir(bookId), "chapters");

    try {
      const files = (await readdir(chaptersDir)).filter((file) => file.endsWith(".md")).sort();
      const chapterFiles = new Map<number, string>();

      for (const file of files) {
        const match = file.match(/^(\d{4})(?!\d)/);
        if (!match) {
          continue;
        }

        const chapterNumber = Number.parseInt(match[1], 10);
        if (chapterFiles.has(chapterNumber)) {
          throw new ApiError(
            409,
            "CHAPTER_FILE_CONFLICT",
            `Multiple chapter files match chapter ${chapterNumber} in book "${bookId}".`,
          );
        }

        chapterFiles.set(chapterNumber, file);
      }

      return chapterFiles;
    } catch (error) {
      if (isMissingFileError(error)) {
        return new Map();
      }

      throw error;
    }
  }

  private async loadChapterIndexStrict(bookId: string): Promise<ReadonlyArray<ChapterMeta>> {
    const indexPath = join(this.state.bookDir(bookId), "chapters", "index.json");

    try {
      const raw = await readFile(indexPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error(`Chapter index for book "${bookId}" is not an array.`);
      }
      return parsed as ReadonlyArray<ChapterMeta>;
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }

      throw error;
    }
  }
}

function extractChapterTitle(content: string): string | null {
  const match = content.replace(/\r\n/g, "\n").match(/^#\s+(.+)$/m);
  const title = match?.[1]
    ?.trim()
    .replace(/^Chapter\s+\d+\s*:\s*/i, "")
    .replace(/^第\s*\d+\s*章\s*/, "");
  return title ? title : null;
}
