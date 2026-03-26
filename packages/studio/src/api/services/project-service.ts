import { GLOBAL_ENV_PATH, StateManager, loadProjectConfig, type BookConfig, type ChapterMeta } from "@actalk/inkos-core";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isMissingFileError, isSafeBookId } from "../errors.js";
import type { BookDetail, BookSummary, HealthStatus } from "../../shared/contracts.js";

export class ProjectService {
  private readonly state: StateManager;

  constructor(private readonly projectRoot: string) {
    this.state = new StateManager(projectRoot);
  }

  async getHealthStatus(): Promise<HealthStatus> {
    const books = await this.state.listBooks();
    const projectConfigFound = await this.pathExists(join(this.projectRoot, "inkos.json"));
    const projectEnvFound = await this.pathExists(join(this.projectRoot, ".env"));
    const globalConfigFound = await this.pathExists(GLOBAL_ENV_PATH);

    let llmProvider: string | null = null;
    let llmModel: string | null = null;

    if (projectConfigFound) {
      try {
        const config = await loadProjectConfig(this.projectRoot, { requireApiKey: false });
        llmProvider = config.llm.provider;
        llmModel = config.llm.model;
      } catch {
        // Leave null when config cannot be parsed yet.
      }
    }

    return {
      status: "ok",
      projectRoot: this.projectRoot,
      projectConfigFound,
      envFound: projectEnvFound || globalConfigFound,
      projectEnvFound,
      globalConfigFound,
      bookCount: books.length,
      provider: llmProvider,
      model: llmModel,
    };
  }

  async listBooks(): Promise<ReadonlyArray<BookSummary>> {
    const bookIds = await this.state.listBooks();
    return Promise.all(bookIds.map(async (bookId) => this.buildBookSummary(bookId)));
  }

  async getBook(bookId: string): Promise<BookDetail | null> {
    if (!(await this.hasBook(bookId))) {
      return null;
    }

    const book = await this.state.loadBookConfig(bookId);
    const index = await this.loadChapterIndexStrict(bookId);
    const summary = this.toBookSummary(book, index);

    return {
      ...summary,
      createdAt: book.createdAt,
      chapterWordCount: book.chapterWordCount,
      language: book.language ?? null,
    };
  }

  async hasBook(bookId: string): Promise<boolean> {
    if (!isSafeBookId(bookId)) {
      return false;
    }

    try {
      await access(join(this.state.bookDir(bookId), "book.json"));
      return true;
    } catch (error) {
      if (isMissingFileError(error)) {
        return false;
      }

      throw error;
    }
  }

  private async buildBookSummary(bookId: string): Promise<BookSummary> {
    const book = await this.state.loadBookConfig(bookId);
    const index = await this.loadChapterIndexStrict(bookId);
    return this.toBookSummary(book, index);
  }

  private toBookSummary(book: BookConfig, index: ReadonlyArray<ChapterMeta>): BookSummary {
    const totalWords = index.reduce((sum, chapter) => sum + chapter.wordCount, 0);
    const approvedChapters = index.filter((chapter) => chapter.status === "approved").length;
    const pendingReviewChapters = index.filter((chapter) => chapter.status === "ready-for-review").length;
    const failedChapters = index.filter((chapter) => chapter.status === "audit-failed").length;

    return {
      id: book.id,
      title: book.title,
      status: book.status,
      platform: book.platform,
      genre: book.genre,
      targetChapters: book.targetChapters,
      chapters: index.length,
      chapterCount: index.length,
      lastChapterNumber: index.reduce((max, chapter) => Math.max(max, chapter.number), 0),
      totalWords,
      approvedChapters,
      pendingReview: pendingReviewChapters,
      pendingReviewChapters,
      failedReview: failedChapters,
      failedChapters,
      recentRunStatus: null,
      updatedAt: book.updatedAt,
    };
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
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
