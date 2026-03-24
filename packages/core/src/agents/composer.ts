import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import yaml from "js-yaml";
import { BaseAgent } from "./base.js";
import type { BookConfig } from "../models/book.js";
import {
  ChapterTraceSchema,
  ContextPackageSchema,
  RuleStackSchema,
  type ChapterTrace,
  type ContextPackage,
  type RuleStack,
} from "../models/input-governance.js";
import type { PlanChapterOutput } from "./planner.js";
import { retrieveMemorySelection } from "../utils/memory-retrieval.js";

export interface ComposeChapterInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly plan: PlanChapterOutput;
}

export interface ComposeChapterOutput {
  readonly contextPackage: ContextPackage;
  readonly ruleStack: RuleStack;
  readonly trace: ChapterTrace;
  readonly contextPath: string;
  readonly ruleStackPath: string;
  readonly tracePath: string;
}

export class ComposerAgent extends BaseAgent {
  get name(): string {
    return "composer";
  }

  async composeChapter(input: ComposeChapterInput): Promise<ComposeChapterOutput> {
    const storyDir = join(input.bookDir, "story");
    const runtimeDir = join(storyDir, "runtime");
    await mkdir(runtimeDir, { recursive: true });

    const selectedContext = await this.collectSelectedContext(storyDir, input.plan);
    const contextPackage = ContextPackageSchema.parse({
      chapter: input.chapterNumber,
      selectedContext,
    });

    const ruleStack = RuleStackSchema.parse({
      layers: [
        { id: "L1", name: "hard_facts", precedence: 100, scope: "global" },
        { id: "L2", name: "author_intent", precedence: 80, scope: "book" },
        { id: "L3", name: "planning", precedence: 60, scope: "arc" },
        { id: "L4", name: "current_task", precedence: 70, scope: "local" },
      ],
      sections: {
        hard: ["story_bible", "current_state", "book_rules"],
        soft: ["author_intent", "current_focus", "volume_outline"],
        diagnostic: ["anti_ai_checks", "continuity_audit", "style_regression_checks"],
      },
      overrideEdges: [
        { from: "L4", to: "L3", allowed: true, scope: "current_chapter" },
        { from: "L4", to: "L2", allowed: false, scope: "current_chapter" },
        { from: "L4", to: "L1", allowed: false, scope: "current_chapter" },
      ],
      activeOverrides: input.plan.intent.conflicts.map((conflict) => ({
        from: "L4",
        to: "L3",
        target: input.plan.intent.outlineNode ?? `chapter_${input.chapterNumber}`,
        reason: conflict.resolution,
      })),
    });

    const trace = ChapterTraceSchema.parse({
      chapter: input.chapterNumber,
      plannerInputs: input.plan.plannerInputs,
      composerInputs: [input.plan.runtimePath],
      selectedSources: contextPackage.selectedContext.map((entry) => entry.source),
      notes: input.plan.intent.conflicts.map((conflict) => conflict.resolution),
    });

    const chapterSlug = `chapter-${String(input.chapterNumber).padStart(4, "0")}`;
    const contextPath = join(runtimeDir, `${chapterSlug}.context.json`);
    const ruleStackPath = join(runtimeDir, `${chapterSlug}.rule-stack.yaml`);
    const tracePath = join(runtimeDir, `${chapterSlug}.trace.json`);

    await Promise.all([
      writeFile(contextPath, JSON.stringify(contextPackage, null, 2), "utf-8"),
      writeFile(ruleStackPath, yaml.dump(ruleStack, { lineWidth: 120 }), "utf-8"),
      writeFile(tracePath, JSON.stringify(trace, null, 2), "utf-8"),
    ]);

    return {
      contextPackage,
      ruleStack,
      trace,
      contextPath,
      ruleStackPath,
      tracePath,
    };
  }

  private async collectSelectedContext(storyDir: string, plan: PlanChapterOutput): Promise<ContextPackage["selectedContext"]> {
    const entries = await Promise.all([
      this.maybeContextSource(storyDir, "current_focus.md", "Current task focus for this chapter."),
      this.maybeContextSource(
        storyDir,
        "current_state.md",
        "Preserve hard state facts referenced by mustKeep.",
        plan.intent.mustKeep,
      ),
      this.maybeContextSource(
        storyDir,
        "story_bible.md",
        "Preserve canon constraints referenced by mustKeep.",
        plan.intent.mustKeep,
      ),
      this.maybeContextSource(
        storyDir,
        "volume_outline.md",
        "Anchor the default planning node for this chapter.",
        plan.intent.outlineNode ? [plan.intent.outlineNode] : [],
      ),
    ]);

    const planningAnchor = plan.intent.conflicts.length > 0 ? undefined : plan.intent.outlineNode;
    const memorySelection = await retrieveMemorySelection({
      bookDir: dirname(storyDir),
      chapterNumber: plan.intent.chapter,
      goal: plan.intent.goal,
      outlineNode: planningAnchor,
      mustKeep: plan.intent.mustKeep,
    });

    const summaryEntries = memorySelection.summaries.map((summary) => ({
      source: `story/chapter_summaries.md#${summary.chapter}`,
      reason: "Relevant episodic memory retrieved for the current chapter goal.",
      excerpt: [summary.title, summary.events, summary.stateChanges, summary.hookActivity]
        .filter(Boolean)
        .join(" | "),
    }));
    const factEntries = memorySelection.facts.map((fact) => ({
      source: `story/current_state.md#${this.toFactAnchor(fact.predicate)}`,
      reason: "Relevant current-state fact retrieved for the current chapter goal.",
      excerpt: `${fact.predicate} | ${fact.object}`,
    }));
    const hookEntries = memorySelection.hooks.map((hook) => ({
      source: `story/pending_hooks.md#${hook.hookId}`,
      reason: "Carry forward unresolved hooks that match the chapter focus.",
      excerpt: [hook.type, hook.status, hook.expectedPayoff, hook.notes]
        .filter(Boolean)
        .join(" | "),
    }));
    const volumeSummaryEntries = memorySelection.volumeSummaries.map((summary) => ({
      source: `story/volume_summaries.md#${summary.anchor}`,
      reason: "Carry forward long-span arc memory compressed from earlier volumes.",
      excerpt: `${summary.heading} | ${summary.content}`,
    }));

    return [
      ...entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
      ...factEntries,
      ...summaryEntries,
      ...volumeSummaryEntries,
      ...hookEntries,
    ];
  }

  private async maybeContextSource(
    storyDir: string,
    fileName: string,
    reason: string,
    preferredExcerpts: ReadonlyArray<string> = [],
  ): Promise<ContextPackage["selectedContext"][number] | null> {
    const path = join(storyDir, fileName);
    const content = await this.readFileOrDefault(path);
    if (!content || content === "(文件尚未创建)") return null;

    return {
      source: `story/${fileName}`,
      reason,
      excerpt: this.pickExcerpt(content, preferredExcerpts),
    };
  }

  private pickExcerpt(content: string, preferredExcerpts: ReadonlyArray<string>): string | undefined {
    for (const preferred of preferredExcerpts) {
      if (preferred && content.includes(preferred)) return preferred;
    }

    return content
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("#"));
  }

  private toFactAnchor(predicate: string): string {
    return predicate
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "")
      || "fact";
  }

  private async readFileOrDefault(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return "(文件尚未创建)";
    }
  }
}
