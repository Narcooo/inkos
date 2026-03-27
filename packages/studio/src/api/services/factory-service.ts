import { PipelineRunner, StateManager, createLLMClient, loadProjectConfig, type BookConfig, type ChapterPipelineResult, type PlanChapterResult } from "@actalk/inkos-core";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  FactoryGenerateFirstChapterResult,
  FactoryGenerateOutlinePayload,
  FactoryGenerateOutlineResult,
  FactorySetupStoryResult,
} from "../../shared/contracts.js";
import { ApiError } from "../errors.js";
import type { ChapterService } from "./chapter-service.js";
import type { ProjectService } from "./project-service.js";

export interface FactoryStageInput {
  readonly projectRoot: string;
  readonly bookId: string;
}

export interface FactoryOutlineInput extends FactoryStageInput {
  readonly context?: string;
}

export interface FactoryServiceDependencies {
  readonly setupStory?: (input: FactoryStageInput) => Promise<void | FactorySetupStoryResult>;
  readonly generateOutline?: (input: FactoryOutlineInput) => Promise<PlanChapterResult | FactoryGenerateOutlineResult>;
  readonly generateFirstChapter?: (input: FactoryStageInput) => Promise<ChapterPipelineResult | FactoryGenerateFirstChapterResult>;
}

export class FactoryService {
  private readonly state: StateManager;

  constructor(
    private readonly projectRoot: string,
    private readonly projectService: ProjectService,
    private readonly chapterService: ChapterService,
    private readonly dependencies: FactoryServiceDependencies = {},
  ) {
    this.state = new StateManager(projectRoot);
  }

  async setupStory(bookId: string): Promise<FactorySetupStoryResult> {
    await this.ensureBook(bookId);
    const bootstrapContext = await this.loadBootstrapContext(bookId);

    if (this.dependencies.setupStory) {
      const result = await this.dependencies.setupStory({ projectRoot: this.projectRoot, bookId });
      if (result) {
        return result;
      }
    } else {
      const book = await this.loadBookConfig(bookId);
      const pipeline = await this.createPipeline(bootstrapContext);
      await pipeline.initBook(book);
    }

    return {
      book: await this.requireBook(bookId),
    };
  }

  async generateOutline(bookId: string, payload: FactoryGenerateOutlinePayload = {}): Promise<FactoryGenerateOutlineResult> {
    await this.ensureBook(bookId);
    const externalContext = this.mergeContext(await this.loadBootstrapContext(bookId), payload.context);

    if (payload.context !== undefined && typeof payload.context !== "string") {
      throw new ApiError(400, "INVALID_PAYLOAD", "Outline context must be a string when provided.");
    }

    const result = this.dependencies.generateOutline
      ? await this.dependencies.generateOutline({ projectRoot: this.projectRoot, bookId, context: payload.context })
      : await (await this.createPipeline(externalContext)).planChapter(bookId, externalContext);

    return {
      bookId: result.bookId,
      chapterNumber: result.chapterNumber,
      intentPath: result.intentPath,
      goal: result.goal,
      conflicts: result.conflicts,
    };
  }

  async generateFirstChapter(bookId: string): Promise<FactoryGenerateFirstChapterResult> {
    await this.ensureBook(bookId);
    const bootstrapContext = await this.loadBootstrapContext(bookId);

    const result = this.dependencies.generateFirstChapter
      ? await this.dependencies.generateFirstChapter({ projectRoot: this.projectRoot, bookId })
      : await (await this.createPipeline(bootstrapContext)).writeNextChapter(bookId);

    if (this.isFactoryGenerateFirstChapterResult(result)) {
      return result;
    }

    const chapter = await this.chapterService.getChapter(bookId, result.chapterNumber);
    if (!chapter) {
      throw new ApiError(500, "FIRST_CHAPTER_LOAD_FAILED", "The first chapter was generated but Studio could not load it yet.");
    }

    return {
      book: await this.requireBook(bookId),
      chapter,
    };
  }

  private async createPipeline(externalContext?: string): Promise<PipelineRunner> {
    const config = await loadProjectConfig(this.projectRoot);
    return new PipelineRunner({
      client: createLLMClient(config.llm),
      model: config.llm.model,
      projectRoot: this.projectRoot,
      defaultLLMConfig: config.llm,
      notifyChannels: config.notify,
      modelOverrides: config.modelOverrides,
      inputGovernanceMode: config.inputGovernanceMode,
      externalContext,
    });
  }

  private async loadBookConfig(bookId: string): Promise<BookConfig> {
    return this.state.loadBookConfig(bookId);
  }

  private async loadBootstrapContext(bookId: string): Promise<string | undefined> {
    try {
      const raw = await readFile(join(this.projectRoot, "books", bookId, "story", "bootstrap_intake.json"), "utf-8");
      const parsed = JSON.parse(raw) as { prompt?: unknown };
      return typeof parsed.prompt === "string" && parsed.prompt.trim() ? parsed.prompt : undefined;
    } catch {
      return undefined;
    }
  }

  private mergeContext(primary?: string, secondary?: string): string | undefined {
    const parts = [primary, secondary]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim());

    if (parts.length === 0) {
      return undefined;
    }

    return parts.join("\n\n");
  }

  private async ensureBook(bookId: string): Promise<void> {
    const book = await this.projectService.getBook(bookId);
    if (!book) {
      throw new ApiError(404, "BOOK_NOT_FOUND", `Book \"${bookId}\" not found.`);
    }
  }

  private async requireBook(bookId: string) {
    const book = await this.projectService.getBook(bookId);
    if (!book) {
      throw new ApiError(404, "BOOK_NOT_FOUND", `Book \"${bookId}\" not found.`);
    }
    return book;
  }

  private isFactoryGenerateFirstChapterResult(
    value: ChapterPipelineResult | FactoryGenerateFirstChapterResult,
  ): value is FactoryGenerateFirstChapterResult {
    return "chapter" in value && "book" in value;
  }
}
