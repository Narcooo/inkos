import { readFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BaseAgent } from "./base.js";
import { SemanticContextCompilerAgent } from "./semantic-context-compiler.js";
import type { ContextFragment } from "../harness/context-compiler.js";
import { semanticInputBudget, splitTextByEstimatedTokens } from "../llm/semantic-input.js";
import type { BookConfig } from "../models/book.js";
import {
  ContextPackageSchema,
  type ChapterTrace,
  type ContextPackage,
} from "../models/input-governance.js";
import type { PlanChapterOutput } from "./planner.js";
import {
  retrieveMemorySelection,
  type MemorySelection,
  type MemoryRetrievalTrace,
  type MemorySemanticSelectionRequest,
  type MemorySemanticSelector,
} from "../utils/memory-retrieval.js";
import {
  buildGovernedTrace,
  isProtectedContextSource,
} from "../utils/context-assembly.js";
import { writeGovernedRuntimeArtifacts } from "../utils/runtime-writer.js";
import { estimateTextTokens, type LLMClient } from "../llm/provider.js";
import type { ContextCompressionCallback } from "../models/context-compression.js";
import type {
  BookReferenceContextSelection,
  BookReferenceSelectionTask,
  ReferenceSectionSelectionRequest,
} from "../references/reference-context.js";
import { Type } from "@sinclair/typebox";
import { loadRuntimeStateSnapshot } from "../state/runtime-state-store.js";
import { recordExecutionEvidence } from "../harness/execution-evidence.js";

export interface ComposeChapterInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly plan: PlanChapterOutput;
  readonly contextBudget?: ContextBudget;
  readonly compressibleContextCompiler?: CompressibleContextCompiler;
  readonly outlineSectionSelector?: OutlineSectionSelector;
  readonly referenceContextProvider?: BookReferenceContextProvider;
  readonly memorySemanticSelector?: MemorySemanticSelector;
  readonly onContextCompression?: ContextCompressionCallback;
}

export type BookReferenceContextProvider = (
  request: BookReferenceSelectionTask,
) => Promise<BookReferenceContextSelection>;

export interface ContextBudget {
  readonly contextWindowTokens: number;
  readonly reservedOutputTokens: number;
}

export interface CompressibleContextCompileRequest {
  readonly chapterNumber: number;
  readonly goal: string;
  readonly language: "zh" | "en";
  readonly maxInputTokens: number;
  readonly protectedEntries: ContextPackage["selectedContext"];
  readonly compressibleEntries: ContextPackage["selectedContext"];
}

export type CompressibleContextCompiler = (request: CompressibleContextCompileRequest) => Promise<string>;

export interface OutlineSectionSelectionRequest {
  readonly fileName: string;
  readonly kind: "story-frame" | "volume-map" | "role-card" | "current-state";
  readonly chapterNumber: number;
  readonly goal: string;
  readonly outlineNode: string;
  readonly language: "zh" | "en";
  readonly candidates: ReadonlyArray<{
    readonly source: string;
    readonly heading: string;
    readonly excerpt: string;
  }>;
}

export type OutlineSectionSelector = (request: OutlineSectionSelectionRequest) => Promise<ReadonlyArray<string>>;

export interface ComposeChapterOutput {
  readonly contextPackage: ContextPackage;
  readonly trace: ChapterTrace;
  readonly contextPath: string;
  readonly tracePath: string;
}

export async function composeGovernedChapter(input: ComposeChapterInput): Promise<ComposeChapterOutput> {
  const storyDir = join(input.bookDir, "story");
  const baseContext = await collectSelectedContext(
    storyDir,
    input.plan,
    input.book.language,
    input.outlineSectionSelector,
    input.memorySemanticSelector,
  );
  const referenceContext = await loadReferenceContext(input);
  return persistComposedContext(input, baseContext, referenceContext);
}

async function persistComposedContext(
  input: ComposeChapterInput,
  baseContext: Awaited<ReturnType<typeof collectSelectedContext>>,
  referenceContext: BookReferenceContextSelection,
): Promise<ComposeChapterOutput> {
  const runtimeDir = join(input.bookDir, "story", "runtime");
  await mkdir(runtimeDir, { recursive: true });
  const selectedContext = [...baseContext.entries, ...referenceContext.entries];
  const initialContextPackage = ContextPackageSchema.parse({
    chapter: input.chapterNumber,
    selectedContext,
  });
  const budgeted = await applyContextBudgetIfNeeded({
    contextPackage: initialContextPackage,
    chapterNumber: input.chapterNumber,
    goal: input.plan.intent.goal,
    language: input.book.language,
    contextBudget: input.contextBudget,
    compiler: input.compressibleContextCompiler,
    onContextCompression: input.onContextCompression,
  });
  const contextPackage = budgeted.contextPackage;

  const trace = buildGovernedTrace({
    chapterNumber: input.chapterNumber,
    plan: input.plan,
    contextPackage,
    composerInputs: [input.plan.runtimePath],
    notes: [...referenceContext.notes, ...budgeted.notes],
    compression: budgeted.compression,
    retrieval: {
      engine: baseContext.retrievalTrace.engine,
      query: baseContext.retrievalTrace.query,
      selectionMode: baseContext.retrievalTrace.selectionMode,
      candidates: baseContext.retrievalTrace.candidates.map((candidate) => ({ ...candidate })),
      semanticSelectedIds: [...baseContext.retrievalTrace.semanticSelectedIds],
    },
  });
  const {
    contextPath,
    tracePath,
  } = await writeGovernedRuntimeArtifacts({
    runtimeDir,
    chapterNumber: input.chapterNumber,
    contextPackage,
    trace,
  });

  return {
    contextPackage,
    trace,
    contextPath,
    tracePath,
  };
}

async function applyContextBudgetIfNeeded(params: {
  readonly contextPackage: ContextPackage;
  readonly chapterNumber: number;
  readonly goal: string;
  readonly language: "zh" | "en";
  readonly contextBudget?: ContextBudget;
  readonly compiler?: CompressibleContextCompiler;
  readonly onContextCompression?: ContextCompressionCallback;
}): Promise<{
  readonly contextPackage: ContextPackage;
  readonly notes: string[];
  readonly compression?: ChapterTrace["compression"];
}> {
  const budget = params.contextBudget;
  if (!budget || budget.contextWindowTokens <= 0) {
    return { contextPackage: params.contextPackage, notes: [] };
  }

  const availableInputTokens = budget.contextWindowTokens - Math.max(0, budget.reservedOutputTokens);
  const selectedContext = params.contextPackage.selectedContext;
  const totalTokens = estimateSelectedContextTokens(selectedContext);
  if (totalTokens <= availableInputTokens) {
    return { contextPackage: params.contextPackage, notes: [] };
  }

  const protectedEntries = selectedContext.filter((entry) => isProtectedContextSource(entry));
  const compressibleEntries = selectedContext.filter((entry) => !isProtectedContextSource(entry));
  const protectedTokens = estimateSelectedContextTokens(protectedEntries);
  if (protectedTokens > availableInputTokens) {
    params.onContextCompression?.({
      category: "story_context",
      phase: "error",
      message: "Protected context exceeds available input budget.",
      protectedTokens,
      compressibleTokens: totalTokens - protectedTokens,
      budgetTokens: availableInputTokens,
      sources: protectedEntries.map((entry) => entry.source),
    });
    throw new Error(
      `Protected context exceeds available input budget (${protectedTokens}/${availableInputTokens} tokens). ` +
      "InkOS will not compress protected author intent, current focus, hard state, or active hook evidence.",
    );
  }
  if (compressibleEntries.length === 0) {
    return { contextPackage: params.contextPackage, notes: ["context-over-budget-no-compressible-entries"] };
  }
  if (!params.compiler) {
    params.onContextCompression?.({
      category: "story_context",
      phase: "error",
      message: "Context exceeds available input budget but no compiler was provided.",
      protectedTokens,
      compressibleTokens: estimateSelectedContextTokens(compressibleEntries),
      budgetTokens: availableInputTokens,
      sources: compressibleEntries.map((entry) => entry.source),
    });
    throw new Error(
      `Context exceeds available input budget (${totalTokens}/${availableInputTokens} tokens), ` +
      "but no compressible context compiler was provided.",
    );
  }

  const compileBudget = Math.max(1, availableInputTokens - protectedTokens);
  const compressibleTokens = estimateSelectedContextTokens(compressibleEntries);
  params.onContextCompression?.({
    category: "story_context",
    phase: "start",
    protectedTokens,
    compressibleTokens,
    budgetTokens: compileBudget,
    sources: compressibleEntries.map((entry) => entry.source),
  });
  let compiled: string;
  try {
    compiled = (await params.compiler({
      chapterNumber: params.chapterNumber,
      goal: params.goal,
      language: params.language,
      maxInputTokens: compileBudget,
      protectedEntries,
      compressibleEntries,
    })).trim();
  } catch (error) {
    params.onContextCompression?.({
      category: "story_context",
      phase: "error",
      message: error instanceof Error ? error.message : String(error),
      protectedTokens,
      compressibleTokens,
      budgetTokens: compileBudget,
      sources: compressibleEntries.map((entry) => entry.source),
    });
    throw error;
  }
  if (!compiled) {
    params.onContextCompression?.({
      category: "story_context",
      phase: "error",
      message: "Compressible context compiler returned empty output.",
      protectedTokens,
      compressibleTokens,
      budgetTokens: compileBudget,
      sources: compressibleEntries.map((entry) => entry.source),
    });
    throw new Error("Compressible context compiler returned empty output.");
  }
  params.onContextCompression?.({
    category: "story_context",
    phase: "end",
    protectedTokens,
    compressibleTokens,
    budgetTokens: compileBudget,
    sources: compressibleEntries.map((entry) => entry.source),
  });

  return {
    contextPackage: ContextPackageSchema.parse({
      chapter: params.contextPackage.chapter,
      selectedContext: [
        ...protectedEntries,
        {
          source: "runtime/compiled-compressible-context",
          reason: "Semantic compilation of lower-priority context after protected context exceeded the input budget.",
          excerpt: compiled,
          protection: "compressible",
        },
      ],
    }),
    notes: ["compiled-compressible-context"],
    compression: {
      compiledSource: "runtime/compiled-compressible-context",
      protectedSources: protectedEntries.map((entry) => entry.source),
      compressedSources: compressibleEntries.map((entry) => entry.source),
      protectedTokens,
      compressibleTokens,
      budgetTokens: compileBudget,
    },
  };
}

function estimateSelectedContextTokens(entries: ContextPackage["selectedContext"]): number {
  return entries.reduce((total, entry) => (
    total + estimateTextTokens([entry.source, entry.reason, entry.excerpt].filter(Boolean).join("\n"))
  ), 0);
}

export class ComposerAgent extends BaseAgent {
  get name(): string {
    return "composer";
  }

  async composeChapter(input: ComposeChapterInput): Promise<ComposeChapterOutput> {
    const contextBudget = input.contextBudget ?? contextBudgetFromClient(this.ctx.client);
    const configured: ComposeChapterInput = {
      ...input,
      contextBudget,
      compressibleContextCompiler: input.compressibleContextCompiler
        ?? (contextBudget ? (request) => this.compileCompressibleContext(request) : undefined),
      outlineSectionSelector: input.outlineSectionSelector ?? ((request) => this.selectOutlineSections(request)),
      memorySemanticSelector: input.memorySemanticSelector ?? ((request) => this.selectMemoryCandidates(request)),
    };
    if (contextBudget && !input.outlineSectionSelector && !input.memorySemanticSelector) {
      const reference = await loadReferenceContext(configured);
      const complete = await this.completeContextWithinBudget(input.bookDir, input.plan, input.book.language, contextBudget, reference.entries);
      if (complete) return persistComposedContext(configured, complete, reference);
      const selected = await collectSelectedContext(join(input.bookDir, "story"), input.plan, input.book.language,
        configured.outlineSectionSelector, configured.memorySemanticSelector);
      return persistComposedContext(configured, selected, reference);
    }
    return composeGovernedChapter(configured);
  }

  async selectTaskContext(input: {
    readonly bookDir: string;
    readonly chapterNumber: number;
    readonly goal: string;
    readonly language: "zh" | "en";
    readonly contextBudget?: ContextBudget;
  }): Promise<ContextPackage> {
    const plan: PlanChapterOutput = {
      intent: { chapter: input.chapterNumber, goal: input.goal },
      memo: {
        chapter: input.chapterNumber,
        goal: input.goal,
        body: input.goal,
        threadRefs: [],
      },
      intentMarkdown: input.goal,
      runtimePath: "runtime/task-context",
      plannerInputs: [],
    };
    const budget = input.contextBudget ?? contextBudgetFromClient(this.ctx.client);
    const complete = budget ? await this.completeContextWithinBudget(input.bookDir, plan, input.language, budget) : undefined;
    const selected = complete ?? await collectSelectedContext(
      join(input.bookDir, "story"),
      plan,
      input.language,
      (request) => this.selectOutlineSections(request),
      (request) => this.selectMemoryCandidates(request),
    );
    return ContextPackageSchema.parse({
      chapter: input.chapterNumber,
      selectedContext: selected.entries,
    });
  }

  private async completeContextWithinBudget(
    bookDir: string, plan: PlanChapterOutput, language: "zh" | "en", budget: ContextBudget,
    references: ContextPackage["selectedContext"] = [],
  ): Promise<Awaited<ReturnType<typeof collectSelectedContext>> | undefined> {
    // Reserve the other half for the consumer's instructions, methods, current
    // manuscript and protocol. This is a context allocation, not a prose limit.
    const contextAllowance = Math.floor((budget.contextWindowTokens - Math.max(0, budget.reservedOutputTokens)) / 2);
    if (contextAllowance <= 0) return undefined;
    const complete = await collectSelectedContext(join(bookDir, "story"), plan, language,
      async request => request.candidates.map(candidate => candidate.source),
      async request => request.candidates.map(candidate => candidate.id));
    const tokens = estimateSelectedContextTokens([...complete.entries, ...references]);
    if (tokens > contextAllowance) return undefined;
    recordExecutionEvidence("context-selection", {scope:"story_context",mode:"complete",estimatedTokens:tokens,budgetTokens:contextAllowance,
      sourceCount:complete.entries.length,modelCalls:0});
    return {...complete,retrievalTrace:{...complete.retrievalTrace,selectionMode:"complete",semanticSelectedIds:[]}};
  }

  async selectMemoryCandidates(request: MemorySemanticSelectionRequest): Promise<ReadonlyArray<string>> {
    const budget = semanticInputBudget(this.ctx.client, {
      reservedOutputTokens: 2048,
      promptOverheadTokens: 2048,
    });
    const groups = groupMemoryCandidates(request.candidates, budget);
    const selected = new Set<string>();
    for (const group of groups) {
      const candidates = group.map((entry) => [
        `id: ${entry.selectionId}`,
        `kind: ${entry.candidate.kind}`,
        `source: ${entry.candidate.source}`,
        `title: ${entry.candidate.title}`,
        entry.excerpt,
      ].join("\n")).join("\n\n");
      const ids = await this.submitSelectedSources([
        {
          role: "system",
          content: "Select story-memory candidates that materially help the current chapter task. Understand corrections, causality, aliases, and paraphrases. An empty selection is valid.",
        },
        {
          role: "user",
          content: [`Chapter: ${request.chapterNumber}`, "Current task:", request.query, "", "Candidates:", candidates].join("\n"),
        },
      ], new Set(group.map((entry) => entry.selectionId)), 2048);
      for (const id of ids) {
        const entry = group.find((candidate) => candidate.selectionId === id);
        if (entry) selected.add(entry.candidate.id);
      }
    }
    return [...selected];
  }

  async selectOutlineSections(request: OutlineSectionSelectionRequest): Promise<ReadonlyArray<string>> {
    if (request.candidates.length <= 1) return request.candidates.map((candidate) => candidate.source);
    const candidates = request.candidates.map((candidate) => [
      `source_id: ${candidate.source}`,
      `heading: ${candidate.heading}`,
      candidate.excerpt,
    ].join("\n")).join("\n\n");
    return this.submitSelectedSources([
      {
        role: "system",
        content: request.language === "en"
          ? `Select the ${semanticCandidateLabel(request.kind, "en")} needed for the current chapter.`
          : `选择当前章节需要的${semanticCandidateLabel(request.kind, "zh")}。`,
      },
      {
        role: "user",
        content: [
          `File: ${request.fileName}`,
          `Chapter: ${request.chapterNumber}`,
          `Goal: ${request.goal}`,
          "",
          candidates,
        ].join("\n"),
      },
    ], new Set(request.candidates.map((candidate) => candidate.source)), 1024);
  }

  async selectReferenceSections(request: ReferenceSectionSelectionRequest): Promise<ReadonlyArray<string>> {
    const candidates = request.candidates.map((candidate) => [
      `source_id: ${candidate.source}`,
      `title: ${candidate.title}`,
      `heading: ${candidate.heading}`,
      `user-defined uses: ${candidate.uses.join("; ")}`,
      candidate.note ? `user note: ${candidate.note}` : undefined,
    ].filter(Boolean).join("\n")).join("\n\n");
    return this.submitSelectedSources([
      {
        role: "system",
        content: request.language === "en"
          ? "Select user-bound reference sections useful for the current task. References are guidance, not canon."
          : "选择当前任务需要的用户绑定参考段落。参考资料不是正典。",
      },
      {
        role: "user",
        content: [`Chapter: ${request.chapterNumber}`, `Goal: ${request.goal}`, "", candidates].join("\n"),
      },
    ], new Set(request.candidates.map((candidate) => candidate.source)), 2048);
  }

  private async submitSelectedSources(
    messages: ReadonlyArray<{ readonly role: "system" | "user"; readonly content: string }>,
    allowed: ReadonlySet<string>,
    maxTokens: number,
  ): Promise<ReadonlyArray<string>> {
    const allowedIds = [...allowed];
    if (allowedIds.length === 0) return [];
    const selectedSourcesToolSchema = Type.Object({
      selectedIndices: Type.Array(Type.Integer({minimum:1,maximum:allowedIds.length}), { uniqueItems: true }),
    });
    const { result } = await this.submitStructured(
      [...messages,{role:'user',content:JSON.stringify({candidateIndex:allowedIds.map((sourceId,index)=>({number:index+1,sourceId})),instruction:'Submit the selected candidate numbers in selectedIndices. The host resolves them to exact source identifiers; do not rewrite identifiers or names.'})}],
      {
        name: "submit_selected_sources",
        label: "Submit selected sources",
        description: "Submit the numbers of the selected entries in candidateIndex.",
        parameters: selectedSourcesToolSchema,
      },
      {  maxTokens },
    );
    return result.selectedIndices.map(index=>allowedIds[index-1]!);
  }
  async compileCompressibleContext(request: CompressibleContextCompileRequest): Promise<string> {
    const fragments: ContextFragment[] = request.compressibleEntries.map((entry, index) => ({
      id: `chapter-${request.chapterNumber}-compressible-${index + 1}`,
      source: entry.source,
      content: entry.excerpt ?? entry.reason,
      protection: "compressible",
      priority: 0,
      pointer: entry.source,
    }));
    const result = await new SemanticContextCompilerAgent(this.ctx).compile({
      intent: request.goal,
      maxTokens: request.maxInputTokens,
      fragments,
      language: request.language,
    });
    return result.content;
  }
}

function semanticCandidateLabel(
  kind: OutlineSectionSelectionRequest["kind"],
  language: "zh" | "en",
): string {
  if (language === "en") {
    if (kind === "role-card") return "role cards";
    if (kind === "current-state") return "current-state facts";
    return "outline sections";
  }
  if (kind === "role-card") return "角色卡";
  if (kind === "current-state") return "当前状态事实";
  return "大纲段落";
}

interface MemorySelectionChunk {
  readonly selectionId: string;
  readonly candidate: MemorySemanticSelectionRequest["candidates"][number];
  readonly excerpt: string;
}

function groupMemoryCandidates(
  candidates: MemorySemanticSelectionRequest["candidates"],
  budgetTokens: number | undefined,
): MemorySelectionChunk[][] {
  if (candidates.length === 0) return [];
  const chunks = candidates.flatMap((candidate): MemorySelectionChunk[] => {
    if (budgetTokens === undefined) return [{ selectionId: candidate.id, candidate, excerpt: candidate.excerpt }];
    const metadata = [candidate.id, candidate.kind, candidate.source, candidate.title].join("\n");
    const excerptBudget = Math.max(1, budgetTokens - estimateTextTokens(metadata) - 64);
    const excerpts = splitTextByEstimatedTokens(candidate.excerpt, excerptBudget);
    return excerpts.map((excerpt, index) => ({
      selectionId: excerpts.length === 1 ? candidate.id : `${candidate.id}:part-${index + 1}`,
      candidate,
      excerpt,
    }));
  });
  if (budgetTokens === undefined) return [chunks];
  const groups: MemorySelectionChunk[][] = [];
  let current: MemorySelectionChunk[] = [];
  let currentTokens = 0;
  for (const entry of chunks) {
    const tokens = estimateTextTokens([
      entry.selectionId,
      entry.candidate.kind,
      entry.candidate.source,
      entry.candidate.title,
      entry.excerpt,
    ].join("\n"));
    if (current.length > 0 && currentTokens + tokens > budgetTokens) {
      groups.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(entry);
    currentTokens += tokens;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

async function loadReferenceContext(input: ComposeChapterInput): Promise<BookReferenceContextSelection> {
  if (!input.referenceContextProvider) return { entries: [], notes: [] };
  return input.referenceContextProvider({
    chapterNumber: input.chapterNumber,
    goal: input.plan.intent.goal,
    outlineNode: "",
    mustKeep: [],
    language: input.book.language,
  });
}

export function contextBudgetFromClient(client: LLMClient): ContextBudget | undefined {
  const contextWindowTokens = client._piModel?.contextWindow;
  if (!Number.isFinite(contextWindowTokens) || !contextWindowTokens || contextWindowTokens <= 0) {
    return undefined;
  }
  return {
    contextWindowTokens,
    reservedOutputTokens: Math.max(0, client.defaults.maxTokens),
  };
}

async function collectSelectedContext(
  storyDir: string,
  plan: PlanChapterOutput,
  language: "zh" | "en",
  outlineSectionSelector?: OutlineSectionSelector,
  memorySemanticSelector?: MemorySemanticSelector,
): Promise<{
  readonly entries: ContextPackage["selectedContext"];
  readonly retrievalTrace: MemoryRetrievalTrace;
}> {
    const retrievalHints = deriveRetrievalHints(plan);
    const memoBodyExcerpt = plan.memo.body.trim();
    const chapterMemoEntry = memoBodyExcerpt.length > 0
      ? [{
          source: "runtime/chapter_memo",
          reason: "Carry the planner's chapter memo into governed writing.",
          excerpt: [
            `goal=${plan.memo.goal}`,
            memoBodyExcerpt,
          ].filter(Boolean).join(" | "),
          protection: "protected" as const,
        }]
      : [{
          source: "runtime/chapter_memo",
          reason: "Carry the planner's chapter memo into governed writing.",
          excerpt: `goal=${plan.memo.goal}`,
          protection: "protected" as const,
        }];

    const entries = await Promise.all([
      maybeContextSource(
        storyDir,
        "current_focus.md",
        "Current task focus for this chapter.",
        "protected",
      ),
      maybeContextSource(
        storyDir,
        "author_intent.md",
        "User's long-term authorial intent and direction — binding, overrides model defaults.",
        "protected",
      ),
      maybeContextSource(
        storyDir,
        "style_guide.md",
        "User-approved style guidance for this Work.",
        "protected",
      ),
    ]);
    const currentStateEntries = await selectCurrentStateEntries({
      storyDir,
      plan,
      language,
      selector: outlineSectionSelector,
    });
    const outlineEntries = [
      ...await maybeOutlineSectionSources(
        storyDir,
        "outline/story_frame.md",
      "Preserve canon constraints referenced by the active chapter brief or hard constraints.",
      plan,
      "story-frame",
      language,
      outlineSectionSelector,
    ),
      ...await maybeOutlineSectionSources(
        storyDir,
        "outline/volume_map.md",
      "Anchor the default planning node for this chapter.",
      plan,
      "volume-map",
      language,
      outlineSectionSelector,
    ),
    ];
    const canonEntries = await Promise.all([
      maybeContextSource(
        storyDir,
        "parent_canon.md",
        "Preserve parent canon constraints for governed continuation or fanfic writing.",
        "protected",
      ),
      maybeContextSource(
        storyDir,
        "fanfic_canon.md",
        "Preserve extracted fanfic canon constraints for governed writing.",
        "protected",
      ),
    ]);
    const roleEntries = await selectRoleCardEntries({
      storyDir,
      plan,
      language,
      selector: outlineSectionSelector,
    });
    const memorySelection = await retrieveMemorySelection({
      bookDir: dirname(storyDir),
      chapterNumber: plan.intent.chapter,
      goal: retrievalHints.join("\n"),
      semanticSelector: memorySemanticSelector,
    });
    const referencedHookEntries = await buildReferencedHookEntries(
      plan,
      memorySelection.lookupHooks,
      memorySelection.lookupSummaries,
      language,
    );

    const summaryEntries = memorySelection.summaries.map((summary) => ({
      source: `story/chapter_summaries.md#${summary.chapter}`,
      reason: "Relevant episodic memory retrieved for the current chapter goal.",
      excerpt: [summary.title, summary.events, summary.stateChanges, summary.hookActivity]
        .filter(Boolean)
        .join(" | "),
      protection: "compressible" as const,
    }));
    const hookEntries = memorySelection.hooks.map((hook) => ({
      source: `story/pending_hooks.md#${hook.hookId}`,
      reason: "Carry forward unresolved hooks that match the chapter focus.",
      excerpt: [hook.type, hook.status, hook.expectedPayoff, hook.notes]
        .filter(Boolean)
        .join(" | "),
      protection: "compressible" as const,
    }));
    const volumeSummaryEntries = memorySelection.volumeSummaries.map((summary) => ({
      source: `story/volume_summaries.md#${summary.anchor}`,
      reason: "Carry forward long-span arc memory compressed from earlier volumes.",
      excerpt: `${summary.heading} | ${summary.content}`,
      protection: "compressible" as const,
    }));

    return {
      entries: [
        ...chapterMemoEntry,
        ...entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
        ...currentStateEntries,
        ...outlineEntries,
        ...canonEntries.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
        ...roleEntries,
        ...referencedHookEntries,
        ...summaryEntries,
        ...volumeSummaryEntries,
        ...hookEntries,
      ],
      retrievalTrace: memorySelection.retrievalTrace,
    };
}

async function selectCurrentStateEntries(params: {
  readonly storyDir: string;
  readonly plan: PlanChapterOutput;
  readonly language: "zh" | "en";
  readonly selector?: OutlineSectionSelector;
}): Promise<ContextPackage["selectedContext"]> {
  const snapshot = await loadRuntimeStateSnapshot(dirname(params.storyDir));
  const candidates = snapshot.currentState.facts.map((fact, index) => ({
    source: `runtime/current_state#${index + 1}-${slugifyAnchor(`${fact.subject}-${fact.predicate}`)}`,
    heading: `${fact.subject} / ${fact.predicate}`,
    excerpt: [
      `subject: ${fact.subject}`,
      `predicate: ${fact.predicate}`,
      `object: ${fact.object}`,
      `validFromChapter: ${fact.validFromChapter}`,
      fact.validUntilChapter === null ? "validUntilChapter: current" : `validUntilChapter: ${fact.validUntilChapter}`,
    ].join("\n"),
  }));
  if (candidates.length === 0) return [];
  if (!params.selector) throw new Error("Current-state semantic selector is required.");
  const selected = new Set(await params.selector({
    fileName: "state/current_state.json",
    kind: "current-state",
    chapterNumber: params.plan.intent.chapter,
    goal: [params.plan.intent.goal, params.plan.memo.body].filter(Boolean).join("\n"),
    outlineNode: "",
    language: params.language,
    candidates,
  }));
  const known = new Set(candidates.map((candidate) => candidate.source));
  for (const source of selected) {
    if (!known.has(source)) throw new Error(`Current-state selector returned an unknown source: ${source}`);
  }
  return candidates.filter((candidate) => selected.has(candidate.source)).map((candidate) => ({
    source: candidate.source,
    reason: "Current-state fact selected for the current chapter task.",
    excerpt: candidate.excerpt,
    protection: "protected" as const,
  }));
}

async function selectRoleCardEntries(params: {
  readonly storyDir: string;
  readonly plan: PlanChapterOutput;
  readonly language: "zh" | "en";
  readonly selector?: OutlineSectionSelector;
}): Promise<ContextPackage["selectedContext"]> {
  const candidates: Array<{ source: string; heading: string; excerpt: string }> = [];
  for (const tier of ["主要角色", "次要角色", "major", "minor"]) {
    const directory = join(params.storyDir, "roles", tier);
    let files: string[];
    try {
      files = (await readdir(directory)).filter((file) => file.endsWith(".md")).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const file of files) {
      const source = `story/roles/${tier}/${file}`;
      candidates.push({
        source,
        heading: file.slice(0, -3),
        excerpt: (await readFile(join(directory, file), "utf-8")).trim(),
      });
    }
  }
  if (candidates.length === 0) return [];
  if (!params.selector) throw new Error("Role-card semantic selector is required.");
  const selected = new Set(await params.selector({
    fileName: "roles",
    kind: "role-card",
    chapterNumber: params.plan.intent.chapter,
    goal: [params.plan.intent.goal, params.plan.memo.body].filter(Boolean).join("\n"),
    outlineNode: "",
    language: params.language,
    candidates,
  }));
  const knownSources = new Set(candidates.map((candidate) => candidate.source));
  for (const source of selected) {
    if (!knownSources.has(source)) throw new Error(`Role-card selector returned an unknown source: ${source}`);
  }
  return candidates.filter((candidate) => selected.has(candidate.source)).map((candidate) => ({
    source: candidate.source,
    reason: "Role canon selected for the current chapter task.",
    excerpt: candidate.excerpt,
    protection: "protected" as const,
  }));
}

function deriveRetrievalHints(plan: PlanChapterOutput): string[] {
  return [
    plan.intent.goal,
    plan.memo.body,
    ...plan.memo.threadRefs,
  ].filter((value): value is string => Boolean(value));
}

async function buildReferencedHookEntries(
  plan: PlanChapterOutput,
  lookupHooks: ReadonlyArray<{
      readonly hookId: string;
      readonly startChapter: number;
      readonly type: string;
      readonly status: string;
      readonly lastAdvancedChapter: number;
      readonly expectedPayoff: string;
      readonly notes: string;
    }>,
  summaries: MemorySelection["lookupSummaries"],
  language: "zh" | "en",
): Promise<ContextPackage["selectedContext"]> {
    const targetHookIds = [...new Set(plan.memo.threadRefs)];
    if (targetHookIds.length === 0) {
      return [];
    }

    return targetHookIds.flatMap((hookId) => {
      const hook = lookupHooks.find((entry) => entry.hookId === hookId);
      if (!hook) {
        return [];
      }

      const seedSummary = findHookSummary(summaries, hook.hookId, hook.startChapter, "seed");
      const latestSummary = findHookSummary(summaries, hook.hookId, hook.lastAdvancedChapter, "latest");
      const role = language === "en" ? "memo-referenced hook" : "备忘引用伏笔";
      const promise = hook.expectedPayoff || (language === "en" ? "(unspecified)" : "（未写明）");
      const seedBeat = seedSummary
        ? renderHookTraceBeat(seedSummary)
        : (hook.notes || promise);
      const latestBeat = latestSummary && latestSummary !== seedSummary
        ? renderHookTraceBeat(latestSummary)
        : undefined;

      return [{
        source: `runtime/referenced_hook#${hook.hookId}`,
        reason: language === "en"
          ? "Traceable history for a hook referenced by the chapter memo."
          : "章节备忘引用伏笔的可追溯历史。",
        excerpt: language === "en"
          ? [
              `${hook.hookId} (${hook.type}, ${role}, status=${hook.status})`,
              `reader promise: ${promise}`,
              `original seed (ch${hook.startChapter}): ${seedBeat}`,
              latestBeat ? `latest turn (ch${hook.lastAdvancedChapter}): ${latestBeat}` : undefined,
            ].filter(Boolean).join(" | ")
          : [
              `${hook.hookId}（${hook.type}，${role}，状态=${hook.status}）`,
              `读者承诺：${promise}`,
              `种于第${hook.startChapter}章：${seedBeat}`,
              latestBeat ? `推进于第${hook.lastAdvancedChapter}章：${latestBeat}` : undefined,
            ].filter(Boolean).join(" | "),
        protection: "protected" as const,
      }];
    });
}

async function maybeContextSource(
  storyDir: string,
  fileName: string,
  reason: string,
  protection: "protected" | "compressible",
): Promise<ContextPackage["selectedContext"][number] | null> {
    const path = join(storyDir, fileName);
    const content = await readFileOrDefault(path);

    if (!content) return null;

    return {
      source: `story/${fileName}`,
      reason,
      excerpt: content.trim(),
      protection,
    };
}

async function maybeOutlineSectionSources(
  storyDir: string,
  fileName: "outline/story_frame.md" | "outline/volume_map.md",
  reason: string,
  plan: PlanChapterOutput,
  kind: "story-frame" | "volume-map",
  language: "zh" | "en",
  outlineSectionSelector?: OutlineSectionSelector,
): Promise<ContextPackage["selectedContext"]> {
    const path = join(storyDir, fileName);
    const content = await readFileOrDefault(path);

    if (!content) return [];

    return await selectOutlineSectionEntries({
      fileName,
      content,
      reason,
      plan,
      kind,
      language,
      outlineSectionSelector,
    });
}

async function selectOutlineSectionEntries(params: {
  readonly fileName: string;
  readonly content: string;
  readonly reason: string;
  readonly plan: PlanChapterOutput;
  readonly kind: "story-frame" | "volume-map";
  readonly language: "zh" | "en";
  readonly outlineSectionSelector?: OutlineSectionSelector;
}): Promise<ContextPackage["selectedContext"]> {
  const sections = splitMarkdownSections(params.content);
  const candidates = sections.length > 0
    ? sections.map((section) => ({
      source: `story/${params.fileName}#${slugifyAnchor(section.heading)}`,
      heading: section.heading,
      excerpt: section.raw.trim(),
    }))
    : [{
      source: `story/${params.fileName}#document`,
      heading: params.fileName,
      excerpt: params.content.trim(),
    }];
  if (!params.outlineSectionSelector) throw new Error("Outline semantic selector is required.");
  const selectedSources = await params.outlineSectionSelector({
    fileName: params.fileName,
    kind: params.kind,
    chapterNumber: params.plan.intent.chapter,
    goal: [params.plan.intent.goal, params.plan.memo.body].filter(Boolean).join("\n"),
    outlineNode: "",
    language: params.language,
    candidates,
  });
  const selectedSourceSet = new Set(selectedSources);
  const knownSources = new Set(candidates.map((candidate) => candidate.source));
  for (const source of selectedSourceSet) {
    if (!knownSources.has(source)) throw new Error(`Outline selector returned an unknown source: ${source}`);
  }
  return dedupeBySource(candidates.filter((candidate) => selectedSourceSet.has(candidate.source)).map((candidate) => ({
      source: candidate.source,
      reason: params.reason,
      excerpt: candidate.excerpt,
      protection: "protected" as const,
    })));
}

interface MarkdownSection {
  readonly heading: string;
  readonly raw: string;
}

function splitMarkdownSections(content: string): MarkdownSection[] {
    const sections: Array<{ heading: string; lines: string[] }> = [];
    let current: { heading: string; lines: string[] } | null = null;
    for (const line of content.split(/\r?\n/)) {
      const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
      if (headingMatch) {
        if (current && current.lines.some((entry) => entry.trim().length > 0)) {
          sections.push(current);
        }
        current = {
          heading: headingMatch[2]!.trim(),
          lines: [line],
        };
        continue;
      }
      if (current) {
        current.lines.push(line);
      }
    }
    if (current && current.lines.some((entry) => entry.trim().length > 0)) {
      sections.push(current);
    }
    return sections
      .map((section) => ({
        heading: section.heading,
        raw: section.lines.join("\n").trim(),
      }))
      .filter((section) => section.raw.length > 0);
}

function slugifyAnchor(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "")
      || "section";
}

function dedupeBySource(entries: ContextPackage["selectedContext"]): ContextPackage["selectedContext"] {
    const seen = new Set<string>();
    return entries.filter((entry) => {
      if (seen.has(entry.source)) return false;
      seen.add(entry.source);
      return true;
    });
}

async function readFileOrDefault(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function findHookSummary(
  summaries: MemorySelection["lookupSummaries"],
  hookId: string,
  chapter: number,
  mode: "seed" | "latest",
) {
  const directChapterHit = summaries.find((summary) => summary.chapter === chapter);
  const hookMentions = summaries.filter((summary) => summaryMentionsHook(summary, hookId));
  if (mode === "seed") {
    return hookMentions.find((summary) => summary.chapter === chapter)
      ?? hookMentions.at(0)
      ?? directChapterHit;
  }

  return [...hookMentions].reverse().find((summary) => summary.chapter === chapter)
    ?? hookMentions.at(-1)
    ?? directChapterHit;
}

function summaryMentionsHook(
  summary: MemorySelection["lookupSummaries"][number],
  hookId: string,
): boolean {
  return [
    summary.title,
    summary.events,
    summary.stateChanges,
    summary.hookActivity,
  ].some((text) => text.includes(hookId));
}

function renderHookTraceBeat(
  summary: MemorySelection["lookupSummaries"][number],
): string {
  return `ch${summary.chapter} ${summary.title} - ${summary.events || summary.hookActivity || summary.stateChanges || "(none)"}`;
}
