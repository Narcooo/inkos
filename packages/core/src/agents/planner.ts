import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BaseAgent } from "./base.js";
import type { BookConfig } from "../models/book.js";
import type { LengthSpec } from "../models/length-governance.js";
import { buildLengthSpec } from "../utils/length-metrics.js";
import {
  ChapterIntentSchema,
  ChapterMemoSchema,
  type ChapterIntent,
  type ChapterMemo,
  type ContextPackage,
} from "../models/input-governance.js";
import { loadPlanningSeedMaterials } from "../utils/planning-materials.js";
import { ChapterMemoToolSchema } from "./planner-tool.js";
import {
  buildPlannerUserMessage,
  getPlannerMemoSystemPrompt,
} from "./planner-prompts.js";
import { ComposerAgent } from "./composer.js";

export interface PlanChapterInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly externalContext?: string;
}

export interface PlanChapterOutput {
  readonly intent: ChapterIntent;
  readonly memo: ChapterMemo;
  readonly intentMarkdown: string;
  readonly plannerInputs: ReadonlyArray<string>;
  readonly runtimePath: string;
}

/**
 * The model submits the semantic plan through a typed Pi tool. The host owns
 * chapter identity and persists a readable projection separately.
 */
export class PlannerAgent extends BaseAgent {
  get name(): string {
    return "planner";
  }

  async planChapter(input: PlanChapterInput): Promise<PlanChapterOutput> {
    const storyDir = join(input.bookDir, "story");
    const runtimeDir = join(storyDir, "runtime");
    await mkdir(runtimeDir, { recursive: true });

    const seedMaterials = await loadPlanningSeedMaterials({
      bookDir: input.bookDir,
      chapterNumber: input.chapterNumber,
    });
    const taskGoal = [
      input.externalContext,
      seedMaterials.currentFocus,
      seedMaterials.authorIntent,
      seedMaterials.brief,
    ].map((value) => value?.trim()).filter(Boolean).join("\n\n")
      || (input.book.language === "en"
        ? `Continue chapter ${input.chapterNumber} from the current Work state.`
        : `根据当前作品状态续写第${input.chapterNumber}章。`);
    const selected = await new ComposerAgent(this.ctx).selectTaskContext({
      bookDir: input.bookDir,
      chapterNumber: input.chapterNumber,
      goal: taskGoal,
      language: input.book.language,
    });
    const contextPackage: ContextPackage = seedMaterials.previousEndingExcerpt
      ? {
          ...selected,
          selectedContext: [
            ...selected.selectedContext,
            {
              source: `runtime/previous_chapter#${input.chapterNumber - 1}`,
              reason: "Previous chapter text required for chapter transition planning.",
              excerpt: seedMaterials.previousEndingExcerpt,
              protection: "protected",
            },
          ],
        }
      : selected;
    const plannerInputs = contextPackage.selectedContext.map((entry) => entry.source);

    const lengthSpec = buildLengthSpec(
      input.book.chapterWordCount,
      input.book.language,
    );
    const memo = await this.planChapterMemo({
      chapterNumber: input.chapterNumber,
      contextPackage,
      currentInstruction: input.externalContext,
      language: input.book.language,
      lengthSpec,
    });

    const intent = ChapterIntentSchema.parse({
      chapter: input.chapterNumber,
      goal: memo.goal,
    });

    const runtimePath = join(runtimeDir, `chapter-${String(input.chapterNumber).padStart(4, "0")}.intent.md`);
    const intentMarkdown = this.renderIntentMarkdown(
      intent,
      memo,
    );
    await writeFile(runtimePath, intentMarkdown, "utf-8");

    return {
      intent,
      memo,
      intentMarkdown,
      plannerInputs,
      runtimePath,
    };
  }

  /** Compile the governed context into a typed semantic chapter memo. */
  async planChapterMemo(input: {
    readonly chapterNumber: number;
    readonly contextPackage: ContextPackage;
    readonly currentInstruction?: string;
    readonly language?: "zh" | "en";
    readonly lengthSpec: LengthSpec;
  }): Promise<ChapterMemo> {
    const language = input.language ?? "zh";

    const userMessage = buildPlannerUserMessage({
      chapterNumber: input.chapterNumber,
      contextPackage: input.contextPackage,
      currentInstruction: input.currentInstruction,
      lengthBudget: {
        target: input.lengthSpec.target,
        unit: input.lengthSpec.countingMode === "en_words" ? "words" : "字",
      },
      language,
    });

    const systemPrompt = getPlannerMemoSystemPrompt(language);

    const { result } = await this.submitStructured(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      {
        name: "submit_chapter_memo",
        label: "Submit chapter memo",
        description: "Submit the complete semantic chapter plan for host persistence.",
        parameters: ChapterMemoToolSchema,
      },
      {  maxTokens: Math.min(8192, this.ctx.client.defaults.maxTokens) },
    );
    return ChapterMemoSchema.parse({
      chapter: input.chapterNumber,
      goal: result.goal,
      body: result.body,
      threadRefs: result.threadRefs,
    });
  }

  private renderIntentMarkdown(
    intent: ChapterIntent,
    memo: ChapterMemo,
  ): string {
    const memoBody = memo.body.trim();
    const threadRefsLine = memo.threadRefs.length > 0
      ? memo.threadRefs.map((id) => `- ${id}`).join("\n")
      : "- (none)";

    return [
      "# Chapter Intent",
      "",
      "## Goal",
      intent.goal,
      "",
      "## Chapter Memo",
      "### Thread Refs",
      threadRefsLine,
      "",
      "### Body",
      memoBody,
    ].join("\n");
  }
}
