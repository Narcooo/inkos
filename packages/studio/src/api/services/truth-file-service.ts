import { StateManager } from "@actalk/inkos-core";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isMissingFileError, isSafeBookId } from "../errors.js";
import type { TruthFileDetail, TruthFileSummary } from "../../shared/contracts.js";

const REQUIRED_TRUTH_FILES = new Set(["current_state.md", "pending_hooks.md"]);

export const SUPPORTED_TRUTH_FILES = [
  "current_state.md",
  "particle_ledger.md",
  "pending_hooks.md",
  "chapter_summaries.md",
  "subplot_board.md",
  "emotional_arcs.md",
  "character_matrix.md",
] as const;

const TRUTH_FILE_LABELS: Record<(typeof SUPPORTED_TRUTH_FILES)[number], string> = {
  "current_state.md": "Current State",
  "particle_ledger.md": "Particle Ledger",
  "pending_hooks.md": "Pending Hooks",
  "chapter_summaries.md": "Chapter Summaries",
  "subplot_board.md": "Subplot Board",
  "emotional_arcs.md": "Emotional Arcs",
  "character_matrix.md": "Character Matrix",
};

export class TruthFileService {
  private readonly state: StateManager;

  constructor(private readonly projectRoot: string) {
    this.state = new StateManager(projectRoot);
  }

  async listTruthFiles(bookId: string): Promise<ReadonlyArray<TruthFileSummary> | null> {
    if (!(await this.hasBook(bookId))) {
      return null;
    }

    return Promise.all(SUPPORTED_TRUTH_FILES.map(async (name) => this.buildSummary(bookId, name)));
  }

  async getTruthFile(bookId: string, name: string): Promise<TruthFileDetail | null> {
    if (!(await this.hasBook(bookId))) {
      return null;
    }

    if (!this.isSupported(name)) {
      return null;
    }

    const supportedName = name as (typeof SUPPORTED_TRUTH_FILES)[number];
    const summary = await this.buildSummary(bookId, supportedName);
    if (!summary.available && !summary.optional) {
      return null;
    }

    const content = summary.available
      ? await readFile(join(this.state.bookDir(bookId), summary.path), "utf-8")
      : null;

    return {
      ...summary,
      content,
    };
  }

  isSupported(name: string): boolean {
    return SUPPORTED_TRUTH_FILES.includes(name as (typeof SUPPORTED_TRUTH_FILES)[number]);
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

  private async buildSummary(bookId: string, name: (typeof SUPPORTED_TRUTH_FILES)[number]): Promise<TruthFileSummary> {
    const relativePath = join("story", name).replaceAll("\\", "/");
    const absolutePath = join(this.state.bookDir(bookId), relativePath);

    let available = true;
    try {
      await access(absolutePath);
    } catch {
      available = false;
    }

    return {
      name,
      label: TRUTH_FILE_LABELS[name],
      exists: available,
      path: relativePath,
      optional: !REQUIRED_TRUTH_FILES.has(name),
      available,
    };
  }
}
