import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BaseAgent } from "./base.js";
import type { BookConfig } from "../models/book.js";
import { parseBookRules } from "../models/book-rules.js";
import { ChapterIntentSchema, type ChapterConflict, type ChapterIntent } from "../models/input-governance.js";

export interface PlanChapterInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly externalContext?: string;
}

export interface PlanChapterOutput {
  readonly intent: ChapterIntent;
  readonly intentMarkdown: string;
  readonly plannerInputs: ReadonlyArray<string>;
  readonly runtimePath: string;
}

export class PlannerAgent extends BaseAgent {
  get name(): string {
    return "planner";
  }

  async planChapter(input: PlanChapterInput): Promise<PlanChapterOutput> {
    const storyDir = join(input.bookDir, "story");
    const runtimeDir = join(storyDir, "runtime");
    await mkdir(runtimeDir, { recursive: true });

    const sourcePaths = {
      authorIntent: join(storyDir, "author_intent.md"),
      currentFocus: join(storyDir, "current_focus.md"),
      storyBible: join(storyDir, "story_bible.md"),
      volumeOutline: join(storyDir, "volume_outline.md"),
      bookRules: join(storyDir, "book_rules.md"),
      currentState: join(storyDir, "current_state.md"),
      pendingHooks: join(storyDir, "pending_hooks.md"),
      chapterSummaries: join(storyDir, "chapter_summaries.md"),
    } as const;

    const [
      authorIntent,
      currentFocus,
      storyBible,
      volumeOutline,
      bookRulesRaw,
      currentState,
      pendingHooks,
      chapterSummaries,
    ] = await Promise.all([
      this.readFileOrDefault(sourcePaths.authorIntent),
      this.readFileOrDefault(sourcePaths.currentFocus),
      this.readFileOrDefault(sourcePaths.storyBible),
      this.readFileOrDefault(sourcePaths.volumeOutline),
      this.readFileOrDefault(sourcePaths.bookRules),
      this.readFileOrDefault(sourcePaths.currentState),
      this.readFileOrDefault(sourcePaths.pendingHooks),
      this.readFileOrDefault(sourcePaths.chapterSummaries),
    ]);

    const goal = this.deriveGoal(input.externalContext, currentFocus, authorIntent, input.chapterNumber);
    const outlineNode = this.findOutlineNode(volumeOutline, input.chapterNumber);
    const parsedRules = parseBookRules(bookRulesRaw);
    const mustKeep = this.collectMustKeep(currentState, storyBible);
    const mustAvoid = this.collectMustAvoid(currentFocus, parsedRules.rules.prohibitions);
    const styleEmphasis = this.collectStyleEmphasis(authorIntent, currentFocus);
    const conflicts = this.collectConflicts(input.externalContext, outlineNode, volumeOutline);

    const intent = ChapterIntentSchema.parse({
      chapter: input.chapterNumber,
      goal,
      outlineNode,
      mustKeep,
      mustAvoid,
      styleEmphasis,
      conflicts,
    });

    const runtimePath = join(runtimeDir, `chapter-${String(input.chapterNumber).padStart(4, "0")}.intent.md`);
    const intentMarkdown = this.renderIntentMarkdown(intent, pendingHooks, chapterSummaries);
    await writeFile(runtimePath, intentMarkdown, "utf-8");

    return {
      intent,
      intentMarkdown,
      plannerInputs: Object.values(sourcePaths),
      runtimePath,
    };
  }

  private deriveGoal(
    externalContext: string | undefined,
    currentFocus: string,
    authorIntent: string,
    chapterNumber: number,
  ): string {
    const first = this.extractFirstDirective(externalContext);
    if (first) return first;
    const focus = this.extractFirstDirective(currentFocus);
    if (focus) return focus;
    const author = this.extractFirstDirective(authorIntent);
    if (author) return author;
    return `Advance chapter ${chapterNumber} with clear narrative focus.`;
  }

  private collectMustKeep(currentState: string, storyBible: string): string[] {
    return this.unique([
      ...this.extractListItems(currentState, 2),
      ...this.extractListItems(storyBible, 2),
    ]).slice(0, 4);
  }

  private collectMustAvoid(currentFocus: string, prohibitions: ReadonlyArray<string>): string[] {
    const focusAvoids = currentFocus
      .split("\n")
      .map((line) => line.trim())
      .filter((line) =>
        line.startsWith("-") &&
        /avoid|don't|do not|不要|别|禁止/i.test(line),
      )
      .map((line) => line.replace(/^-\s*/, ""));

    return this.unique([...focusAvoids, ...prohibitions]).slice(0, 6);
  }

  private collectStyleEmphasis(authorIntent: string, currentFocus: string): string[] {
    return this.unique([
      ...this.extractListItems(currentFocus, 2),
      ...this.extractListItems(authorIntent, 2),
    ]).slice(0, 4);
  }

  private collectConflicts(
    externalContext: string | undefined,
    outlineNode: string | undefined,
    volumeOutline: string,
  ): ChapterConflict[] {
    if (!externalContext) return [];
    const outlineText = outlineNode ?? volumeOutline;
    if (!outlineText || outlineText === "(文件尚未创建)") return [];
    const indicatesOverride = /ignore|skip|defer|instead|不要|别|先别|暂停/i.test(externalContext);
    if (!indicatesOverride && this.hasKeywordOverlap(externalContext, outlineText)) return [];

    return [
      {
        type: "outline_vs_request",
        resolution: "allow local outline deferral",
      },
    ];
  }

  private extractFirstDirective(content?: string): string | undefined {
    if (!content) return undefined;
    return content
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("-"));
  }

  private extractListItems(content: string, limit: number): string[] {
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .map((line) => line.replace(/^-\s*/, ""))
      .slice(0, limit);
  }

  private findOutlineNode(volumeOutline: string, chapterNumber: number): string | undefined {
    const lines = volumeOutline.split("\n").map((line) => line.trim()).filter(Boolean);
    const chapterPatterns = [
      new RegExp(`^#+\\s*Chapter\\s*${chapterNumber}\\b`, "i"),
      new RegExp(`^#+\\s*第\\s*${chapterNumber}\\s*章`),
    ];

    const heading = lines.find((line) => chapterPatterns.some((pattern) => pattern.test(line)));
    if (!heading) return this.extractFirstDirective(volumeOutline);

    const headingIndex = lines.indexOf(heading);
    const nextLine = lines[headingIndex + 1];
    return nextLine && !nextLine.startsWith("#") ? nextLine : heading.replace(/^#+\s*/, "");
  }

  private hasKeywordOverlap(left: string, right: string): boolean {
    const keywords = this.extractKeywords(left);
    if (keywords.length === 0) return false;
    const normalizedRight = right.toLowerCase();
    return keywords.some((keyword) => normalizedRight.includes(keyword.toLowerCase()));
  }

  private extractKeywords(content: string): string[] {
    const english = content.match(/[a-z]{4,}/gi) ?? [];
    const chinese = content.match(/[\u4e00-\u9fff]{2,4}/g) ?? [];
    return this.unique([...english, ...chinese]);
  }

  private renderIntentMarkdown(
    intent: ChapterIntent,
    pendingHooks: string,
    chapterSummaries: string,
  ): string {
    const conflictLines = intent.conflicts.length > 0
      ? intent.conflicts.map((conflict) => `- ${conflict.type}: ${conflict.resolution}`).join("\n")
      : "- none";

    const mustKeep = intent.mustKeep.length > 0
      ? intent.mustKeep.map((item) => `- ${item}`).join("\n")
      : "- none";

    const mustAvoid = intent.mustAvoid.length > 0
      ? intent.mustAvoid.map((item) => `- ${item}`).join("\n")
      : "- none";

    const styleEmphasis = intent.styleEmphasis.length > 0
      ? intent.styleEmphasis.map((item) => `- ${item}`).join("\n")
      : "- none";

    return [
      "# Chapter Intent",
      "",
      "## Goal",
      intent.goal,
      "",
      "## Outline Node",
      intent.outlineNode ?? "(not found)",
      "",
      "## Must Keep",
      mustKeep,
      "",
      "## Must Avoid",
      mustAvoid,
      "",
      "## Style Emphasis",
      styleEmphasis,
      "",
      "## Conflicts",
      conflictLines,
      "",
      "## Pending Hooks Snapshot",
      pendingHooks,
      "",
      "## Chapter Summaries Snapshot",
      chapterSummaries,
      "",
    ].join("\n");
  }

  private unique(values: ReadonlyArray<string>): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }

  private async readFileOrDefault(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return "(文件尚未创建)";
    }
  }
}
