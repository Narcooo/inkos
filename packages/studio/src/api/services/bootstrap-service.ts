import {
  initializeProject,
  StateManager,
  type BookConfig,
} from "@actalk/inkos-core";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  BootstrapBookResult,
  BootstrapProjectResult,
  BootstrapStatus,
  CreateBootstrapBookPayload,
  CreateBootstrapProjectPayload,
} from "../../shared/contracts.js";
import { ApiError, isSafeBookId } from "../errors.js";
import type { ProjectService } from "./project-service.js";

export class BootstrapService {
  private readonly state: StateManager;

  constructor(
    private readonly projectRoot: string,
    private readonly projectService: ProjectService,
  ) {
    this.state = new StateManager(projectRoot);
  }

  async getStatus(): Promise<BootstrapStatus> {
    const health = await this.projectService.getHealthStatus();
    const bookIds = await this.projectService.listBooks();
    const project = health.projectConfigFound
      ? await this.projectService.loadProjectSummary()
      : null;

    if (!health.projectConfigFound) {
      return {
        health,
        project: {
          initialized: false,
          name: null,
          bookCount: 0,
          firstBookId: null,
        },
        readiness: {
          ready: false,
          code: "PROJECT_NOT_INITIALIZED",
          title: "Create your local studio project",
          message: "Start by creating a project for this workspace.",
          action: "Create project",
        },
      };
    }

    if (!health.configReady) {
      return {
        health,
        project: {
          initialized: true,
          name: project?.name ?? null,
          bookCount: bookIds.length,
          firstBookId: bookIds[0]?.id ?? null,
        },
        readiness: {
          ready: false,
          code: "CONFIG_NOT_READY",
          title: "Finish model setup",
          message: "Add your model connection details to start generation.",
          action: "Open setup",
        },
      };
    }

    return {
      health,
      project: {
        initialized: true,
        name: project?.name ?? null,
        bookCount: bookIds.length,
        firstBookId: bookIds[0]?.id ?? null,
      },
      readiness: {
        ready: true,
        code: "READY",
        title: "Studio is ready",
        message: "Your project is ready for the next setup step.",
        action: "Continue",
      },
    };
  }

  async createProject(payload: CreateBootstrapProjectPayload): Promise<BootstrapProjectResult> {
    if (typeof payload.name !== "string" || !payload.name.trim() || !this.isLanguage(payload.language)) {
      throw new ApiError(400, "INVALID_PAYLOAD", "Enter a project name and choose a language to continue.");
    }

    try {
      const result = await initializeProject({
        projectDir: this.projectRoot,
        projectName: payload.name.trim(),
        language: payload.language,
      });

      return {
        projectRoot: result.projectDir,
        project: {
          initialized: true,
          name: result.projectName,
          language: result.language,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("inkos.json already exists")) {
        throw new ApiError(409, "PROJECT_ALREADY_INITIALIZED", "This workspace already has a project.");
      }
      throw error;
    }
  }

  async createBook(payload: CreateBootstrapBookPayload): Promise<BootstrapBookResult> {
    if (!(await this.projectService.isProjectInitialized())) {
      throw new ApiError(409, "PROJECT_NOT_INITIALIZED", "Create your project before adding the first book.");
    }

    if (
      typeof payload.title !== "string" ||
      !payload.title.trim() ||
      typeof payload.genre !== "string" ||
      !payload.genre.trim() ||
      typeof payload.platform !== "string" ||
      !payload.platform.trim() ||
      !this.isLanguage(payload.language) ||
      !payload.intake ||
      (payload.intake.type !== "idea" && payload.intake.type !== "upload")
    ) {
      throw new ApiError(400, "INVALID_PAYLOAD", "Complete the book setup details before continuing.");
    }

    const bookId = this.toBookId(payload.title);
    if (!isSafeBookId(bookId)) {
      throw new ApiError(400, "INVALID_PAYLOAD", "Choose a title that can be saved locally.");
    }
    if (await this.projectService.hasBook(bookId)) {
      throw new ApiError(409, "BOOK_ALREADY_EXISTS", "A book with this title already exists in the project.");
    }

    const now = new Date().toISOString();
    const book: BookConfig = {
      id: bookId,
      title: payload.title.trim(),
      genre: payload.genre.trim(),
      platform: payload.platform.trim() as BookConfig["platform"],
      status: "outlining",
      targetChapters: payload.targetChapters ?? 12,
      chapterWordCount: payload.chapterWordCount ?? 2500,
      language: payload.language,
      createdAt: now,
      updatedAt: now,
    };

    await this.state.saveBookConfig(bookId, book);
    await this.state.saveChapterIndex(bookId, []);
    await mkdir(join(this.projectRoot, "books", bookId, "story"), { recursive: true });

    await writeFile(
      join(this.projectRoot, "books", bookId, "story", "bootstrap_intake.json"),
      JSON.stringify(payload.intake, null, 2),
      "utf-8",
    );

    const detail = await this.projectService.getBook(bookId);
    if (!detail) {
      throw new ApiError(500, "BOOK_BOOTSTRAP_FAILED", "The book was created but Studio could not load it yet.");
    }

    return {
      book: detail,
      intake: payload.intake,
    };
  }
  private isLanguage(value: unknown): value is "zh" | "en" {
    return value === "zh" || value === "en";
  }

  private toBookId(title: string): string {
    return title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30);
  }
}
