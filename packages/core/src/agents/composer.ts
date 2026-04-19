import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
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
import {
  parseChapterSummariesMarkdown,
  retrieveMemorySelection,
} from "../utils/memory-retrieval.js";

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

    const selectedContext = await this.collectSelectedContext(
      storyDir,
      input.plan,
      input.book.language ?? "zh",
    );
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

  private async collectSelectedContext(
    storyDir: string,
    plan: PlanChapterOutput,
    language: "zh" | "en",
  ): Promise<ContextPackage["selectedContext"]> {
    const entries = await Promise.all([
      this.maybeContextSource(storyDir, "current_focus.md", "Current task focus for this chapter."),
      this.maybeContextSource(
        storyDir,
        "audit_drift.md",
        "Carry forward audit drift guidance from the previous chapter without polluting hard state facts.",
      ),
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
      this.maybeContextSource(
        storyDir,
        "parent_canon.md",
        "Preserve parent canon constraints for governed continuation or fanfic writing.",
      ),
      this.maybeContextSource(
        storyDir,
        "fanfic_canon.md",
        "Preserve extracted fanfic canon constraints for governed writing.",
      ),
    ]);
    const trailEntries = await this.buildRecentChapterTrailEntries(storyDir, plan.intent.chapter);

    const planningAnchor = plan.intent.conflicts.length > 0 ? undefined : plan.intent.outlineNode;
    const memorySelection = await retrieveMemorySelection({
      bookDir: dirname(storyDir),
      chapterNumber: plan.intent.chapter,
      goal: plan.intent.goal,
      outlineNode: planningAnchor,
      mustKeep: plan.intent.mustKeep,
    });
    const hookDebtEntries = await this.buildHookDebtEntries(
      storyDir,
      plan,
      memorySelection.activeHooks,
      language,
    );

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
      excerpt: [hook.type, hook.status, hook.expectedPayoff, hook.payoffTiming, hook.notes]
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
      ...trailEntries,
      ...hookDebtEntries,
      ...factEntries,
      ...summaryEntries,
      ...volumeSummaryEntries,
      ...hookEntries,
    ];
  }

  private async buildRecentChapterTrailEntries(
    storyDir: string,
    chapterNumber: number,
  ): Promise<ContextPackage["selectedContext"]> {
    const content = await this.readFileOrDefault(join(storyDir, "chapter_summaries.md"));
    if (!content || content === "(文件尚未创建)") {
      return [];
    }

    const recentSummaries = parseChapterSummariesMarkdown(content)
      .filter((summary) => summary.chapter < chapterNumber)
      .sort((left, right) => right.chapter - left.chapter)
      .slice(0, 5);
    if (recentSummaries.length === 0) {
      return [];
    }

    const entries: ContextPackage["selectedContext"] = [];
    const recentTitles = recentSummaries
      .map((summary) => [summary.chapter, summary.title].filter(Boolean).join(": "))
      .filter(Boolean)
      .join(" | ");
    if (recentTitles) {
      entries.push({
        source: "story/chapter_summaries.md#recent_titles",
        reason: "Keep recent title history visible to avoid repetitive chapter naming.",
        excerpt: recentTitles,
      });
    }

    const moodTrail = recentSummaries
      .filter((summary) => summary.mood || summary.chapterType)
      .map((summary) => `${summary.chapter}: ${summary.mood || "(none)"} / ${summary.chapterType || "(none)"}`)
      .join(" | ");
    if (moodTrail) {
      entries.push({
        source: "story/chapter_summaries.md#recent_mood_type_trail",
        reason: "Keep recent mood and chapter-type cadence visible before writing the next chapter.",
        excerpt: moodTrail,
      });
    }

    const endingTrail = await this.buildRecentEndingTrail(storyDir, chapterNumber);
    if (endingTrail) {
      entries.push({
        source: "story/chapters#recent_endings",
        reason: "Show how recent chapters ended so the writer avoids structural repetition (e.g. 3 consecutive collapse endings).",
        excerpt: endingTrail,
      });
    }

    return entries;
  }

  private async buildRecentEndingTrail(
    storyDir: string,
    chapterNumber: number,
  ): Promise<string | undefined> {
    const chaptersDir = join(dirname(storyDir), "chapters");
    try {
      const files = await readdir(chaptersDir);
      const chapterFiles = files
        .filter((file) => file.endsWith(".md"))
        .map((file) => ({ file, num: parseInt(file.slice(0, 4), 10) }))
        .filter((entry) => Number.isFinite(entry.num) && entry.num < chapterNumber)
        .sort((a, b) => b.num - a.num)
        .slice(0, 3);

      const endings: string[] = [];
      for (const entry of chapterFiles.reverse()) {
        const content = await readFile(join(chaptersDir, entry.file), "utf-8");
        const lastLine = this.extractLastMeaningfulSentence(content);
        if (lastLine) {
          endings.push(`ch${entry.num}: ${lastLine}`);
        }
      }
      return endings.length >= 2 ? endings.join(" | ") : undefined;
    } catch {
      return undefined;
    }
  }

  private extractLastMeaningfulSentence(content: string): string | undefined {
    const lines = content.split("\n").map((line) => line.trim()).filter((line) =>
      line.length > 5 && !line.startsWith("#") && !line.startsWith("|") && !line.startsWith("==="),
    );
    const last = lines.at(-1);
    if (!last) return undefined;
    return last.length > 60 ? last.slice(0, 57) + "..." : last;
  }

  private async buildHookDebtEntries(
    storyDir: string,
    plan: PlanChapterOutput,
    activeHooks: ReadonlyArray<{
      readonly hookId: string;
      readonly startChapter: number;
      readonly type: string;
      readonly status: string;
      readonly lastAdvancedChapter: number;
      readonly expectedPayoff: string;
      readonly payoffTiming?: string;
      readonly notes: string;
    }>,
    language: "zh" | "en",
  ): Promise<ContextPackage["selectedContext"]> {
    const targetHookIds = [
      ...new Set([
        ...plan.intent.hookAgenda.pressureMap.map((entry) => entry.hookId),
        ...plan.intent.hookAgenda.eligibleResolve,
        ...plan.intent.hookAgenda.mustAdvance,
        ...plan.intent.hookAgenda.staleDebt,
      ]),
    ];
    if (targetHookIds.length === 0) {
      return [];
    }

    const summaries = parseChapterSummariesMarkdown(
      await this.readFileOrDefault(join(storyDir, "chapter_summaries.md")),
    );

    return targetHookIds.flatMap((hookId) => {
      const hook = activeHooks.find((entry) => entry.hookId === hookId);
      if (!hook) {
        return [];
      }

      const seedSummary = this.findHookSummary(summaries, hook.hookId, hook.startChapter, "seed");
      const latestSummary = this.findHookSummary(summaries, hook.hookId, hook.lastAdvancedChapter, "latest");
      const role = this.describeHookAgendaRole(plan, hook.hookId, language);
      const promise = hook.expectedPayoff || (language === "en" ? "(unspecified)" : "（未写明）");
      const seedBeat = seedSummary
        ? this.renderHookDebtBeat(seedSummary)
        : (hook.notes || promise);
      const latestBeat = latestSummary && latestSummary !== seedSummary
        ? this.renderHookDebtBeat(latestSummary)
        : undefined;
      const age = Math.max(0, plan.intent.chapter - Math.max(1, hook.startChapter));

      return [{
        source: `runtime/hook_debt#${hook.hookId}`,
        reason: language === "en"
          ? "Narrative debt brief with original seed text for this hook agenda target."
          : "含原始种子文本的叙事债务简报。",
        excerpt: language === "en"
          ? [
              `${hook.hookId} (${hook.type}, ${role}, open ${age} chapters)`,
              `reader promise: ${promise}`,
              `original seed (ch${hook.startChapter}): ${seedBeat}`,
              latestBeat ? `latest turn (ch${hook.lastAdvancedChapter}): ${latestBeat}` : undefined,
            ].filter(Boolean).join(" | ")
          : [
              `${hook.hookId}（${hook.type}，${role}，已开${age}章）`,
              `读者承诺：${promise}`,
              `种于第${hook.startChapter}章：${seedBeat}`,
              latestBeat ? `推进于第${hook.lastAdvancedChapter}章：${latestBeat}` : undefined,
            ].filter(Boolean).join(" | "),
      }];
    });
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

  private describeHookAgendaRole(
    plan: PlanChapterOutput,
    hookId: string,
    language: "zh" | "en",
  ): string {
    if (plan.intent.hookAgenda.eligibleResolve.includes(hookId)) {
      return language === "en" ? "payoff-ready debt" : "可兑现旧债";
    }
    if (plan.intent.hookAgenda.staleDebt.includes(hookId)) {
      return language === "en" ? "high-pressure debt" : "高压旧债";
    }
    return language === "en" ? "mainline debt" : "主要旧债";
  }

  private findHookSummary(
    summaries: ReadonlyArray<ReturnType<typeof parseChapterSummariesMarkdown>[number]>,
    hookId: string,
    chapter: number,
    mode: "seed" | "latest",
  ) {
    const directChapterHit = summaries.find((summary) => summary.chapter === chapter);
    const hookMentions = summaries.filter((summary) => this.summaryMentionsHook(summary, hookId));
    if (mode === "seed") {
      return hookMentions.find((summary) => summary.chapter === chapter)
        ?? hookMentions.at(0)
        ?? directChapterHit;
    }

    return [...hookMentions].reverse().find((summary) => summary.chapter === chapter)
      ?? hookMentions.at(-1)
      ?? directChapterHit;
  }

  private summaryMentionsHook(
    summary: ReturnType<typeof parseChapterSummariesMarkdown>[number],
    hookId: string,
  ): boolean {
    return [
      summary.title,
      summary.events,
      summary.stateChanges,
      summary.hookActivity,
    ].some((text) => text.includes(hookId));
  }

  private renderHookDebtBeat(
    summary: ReturnType<typeof parseChapterSummariesMarkdown>[number],
  ): string {
    return `ch${summary.chapter} ${summary.title} - ${summary.events || summary.hookActivity || summary.stateChanges || "(none)"}`;
  }
}
