import { BaseAgent } from "./base.js";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";
import { buildWriterSystemPrompt, type FanficContext } from "./writer-prompts.js";
import { buildSettlerSystemPrompt, buildSettlerUserPrompt } from "./settler-prompts.js";
import { buildObserverSystemPrompt, buildObserverUserPrompt } from "./observer-prompts.js";
import { parseSettlerDeltaOutput } from "./settler-delta-parser.js";
import { parseSettlementOutput } from "./settler-parser.js";
import { readGenreProfile, readBookRules } from "./rules-reader.js";
import {
  detectCrossChapterRepetition,
  detectParagraphLengthDrift,
  normalizePostWriteSurface,
  validatePostWrite,
  type PostWriteViolation,
} from "./post-write-validator.js";
import { analyzeAITells } from "./ai-tells.js";
import type { ChapterIntent, ChapterMemo, ContextPackage, RuleStack } from "../models/input-governance.js";
import type { LengthSpec } from "../models/length-governance.js";
import type { RuntimeStateDelta } from "../models/runtime-state.js";
import { buildLengthSpec, countChapterLength } from "../utils/length-metrics.js";
import {
  filterSummaries,
  filterSubplots,
  filterEmotionalArcs,
} from "../utils/context-filter.js";
import { buildGovernedMemoryEvidenceBlocks } from "../utils/governed-context.js";
import {
  buildGovernedCharacterMatrixWorkingSet,
  buildGovernedHookWorkingSet,
  mergeCharacterMatrixMarkdown,
  mergeTableMarkdownByKey,
} from "../utils/governed-working-set.js";
import { parseCreativeOutput } from "./writer-parser.js";
import {
  buildRuntimeStateArtifacts,
  buildRuntimeStateArtifactsFromSnapshot,
  loadRuntimeStateSnapshotAtChapter,
  type RuntimeStateArtifacts,
} from "../state/runtime-state-store.js";
import type { RuntimeStateSnapshot } from "../state/state-reducer.js";
import { parsePendingHooksMarkdown } from "../utils/memory-retrieval.js";
import { analyzeHookHealth } from "../utils/hook-health.js";
import { buildEnglishVarianceBrief } from "../utils/long-span-fatigue.js";
import {
  buildNarrativeIntentBrief,
  renderMemoAsNarrativeBlock,
  renderNarrativeSelectedContext,
  sanitizeNarrativeEvidenceBlock,
} from "../utils/narrative-control.js";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { commitAtomicFileSet, type AtomicFileWrite } from "../utils/atomic-file-set.js";

import {
  readVolumeMap,
  readCharacterContext,
  readCurrentStateWithFallback,
} from "../utils/outline-paths.js";

export interface WriteChapterInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly externalContext?: string;
  readonly chapterIntent: string;
  readonly chapterMemo: ChapterMemo;
  readonly chapterIntentData?: ChapterIntent;
  readonly contextPackage: ContextPackage;
  readonly ruleStack: RuleStack;
  readonly lengthSpec?: LengthSpec;
  readonly wordCountOverride?: number;
  readonly temperatureOverride?: number;
}

export interface SettleChapterStateInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly allowReapply?: boolean;
  readonly allowNewHooks?: boolean;
  readonly baselineChapter?: number;
  readonly chapterIntent?: string;
  readonly contextPackage?: ContextPackage;
  readonly ruleStack?: RuleStack;
  readonly validationFeedback?: string;
}

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface WriteChapterOutput {
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly wordCount: number;
  readonly preWriteCheck: string;
  readonly postSettlement: string;
  readonly runtimeStateDelta?: RuntimeStateDelta;
  readonly runtimeStateSnapshot?: RuntimeStateSnapshot;
  readonly updatedState: string;
  readonly updatedLedger: string;
  readonly updatedHooks: string;
  readonly chapterSummary: string;
  readonly updatedChapterSummaries?: string;
  readonly updatedSubplots: string;
  readonly updatedEmotionalArcs: string;
  readonly updatedCharacterMatrix: string;
  readonly postWriteErrors: ReadonlyArray<PostWriteViolation>;
  readonly postWriteWarnings: ReadonlyArray<PostWriteViolation>;
  readonly hookHealthIssues?: ReadonlyArray<{
    readonly severity: "critical" | "warning" | "info";
    readonly category: string;
    readonly description: string;
    readonly suggestion: string;
  }>;
  readonly tokenUsage?: TokenUsage;
}

export class WriterAgent extends BaseAgent {
  get name(): string {
    return "writer";
  }

  private localize(language: "zh" | "en", messages: { zh: string; en: string }): string {
    return language === "en" ? messages.en : messages.zh;
  }

  private logInfo(language: "zh" | "en", messages: { zh: string; en: string }): void {
    this.ctx.logger?.info(this.localize(language, messages));
  }

  private logWarn(language: "zh" | "en", messages: { zh: string; en: string }): void {
    this.ctx.logger?.warn(this.localize(language, messages));
  }

  async writeChapter(input: WriteChapterInput): Promise<WriteChapterOutput> {
    const { book, bookDir, chapterNumber } = input;

    const placeholder = "(文件尚未创建)";
    const [
      volumeOutline, styleGuide, currentState, ledger, hooks,
      chapterSummaries, subplotBoard, emotionalArcs, characterMatrix, styleProfileRaw,
      fanficCanonRaw,
    ] = await Promise.all([
        readVolumeMap(bookDir, placeholder),
        this.readFileOrDefault(join(bookDir, "story/style_guide.md")),
        // Phase 5 consolidation: architect no longer emits an initial current_state
        // section. When the file is only a seed placeholder, derive initial state
        // from roles/*.Current_State + pending_hooks startChapter=0 rows so the
        // writer still sees substantive content instead of a runtime-append note.
        readCurrentStateWithFallback(bookDir, placeholder),
        this.readFileOrDefault(join(bookDir, "story/particle_ledger.md")),
        this.readFileOrDefault(join(bookDir, "story/pending_hooks.md")),
        this.readFileOrDefault(join(bookDir, "story/chapter_summaries.md")),
        this.readFileOrDefault(join(bookDir, "story/subplot_board.md")),
        this.readFileOrDefault(join(bookDir, "story/emotional_arcs.md")),
        readCharacterContext(bookDir, placeholder),
        this.readFileOrDefault(join(bookDir, "story/style_profile.json")),
        this.readFileOrDefault(join(bookDir, "story/fanfic_canon.md")),
      ]);

    const fingerprintChapters = await this.loadRecentChapters(bookDir, chapterNumber, 5);

    // Load genre profile + book rules
    const { profile: genreProfile, body: genreBody } =
      await readGenreProfile(this.ctx.projectRoot, book.genre);
    const parsedBookRules = await readBookRules(bookDir);
    const bookRules = parsedBookRules?.rules ?? null;
    const bookRulesBody = parsedBookRules?.body ?? "";

    const styleFingerprint = this.buildStyleFingerprint(styleProfileRaw);

    const hasFanficCanon = fanficCanonRaw !== "(文件尚未创建)";
    const resolvedLanguage = book.language ?? genreProfile.language;
    const targetWords = input.lengthSpec?.target ?? input.wordCountOverride ?? book.chapterWordCount;
    const resolvedLengthSpec = input.lengthSpec ?? buildLengthSpec(targetWords, resolvedLanguage);
    if (!input.chapterIntent || !input.chapterMemo || !input.contextPackage || !input.ruleStack) {
      throw new Error("Writer requires governed chapter intent, memo, context package, and rule stack.");
    }
    const governedMemoryBlocks = buildGovernedMemoryEvidenceBlocks(input.contextPackage, resolvedLanguage);
    const englishVarianceBrief = resolvedLanguage === "en"
      ? await buildEnglishVarianceBrief({
          bookDir,
          chapterNumber,
        })
      : null;

    // Build fanfic context if fanfic_canon.md exists
    const fanficContext: FanficContext | undefined = hasFanficCanon && bookRules?.fanficMode
      ? {
          fanficCanon: fanficCanonRaw,
          fanficMode: bookRules.fanficMode,
          allowedDeviations: bookRules.allowedDeviations ?? [],
        }
      : undefined;

    // ── Phase 1: Creative writing (temperature 0.7) ──
    const creativeSystemPrompt = await this.withPromptPackGuidance(buildWriterSystemPrompt(
      book, genreProfile, bookRules, bookRulesBody, genreBody, styleGuide, styleFingerprint,
      chapterNumber, "creative", fanficContext, resolvedLanguage,
      "governed",
      resolvedLengthSpec,
    ), "longform.writer");

    const creativeUserPrompt = this.buildGovernedUserPrompt({
      chapterNumber,
      chapterMemo: input.chapterMemo,
      chapterIntentData: input.chapterIntentData,
      contextPackage: input.contextPackage,
      ruleStack: input.ruleStack,
      externalContext: input.externalContext,
      lengthSpec: resolvedLengthSpec,
      language: book.language ?? genreProfile.language,
      varianceBrief: englishVarianceBrief?.text,
      selectedEvidenceBlock: this.joinGovernedEvidenceBlocks(governedMemoryBlocks),
    });

    const creativeTemperature = input.temperatureOverride ?? 0.7;

    this.logInfo(resolvedLanguage, {
      zh: `阶段 1：创作正文（第${chapterNumber}章）`,
      en: `Phase 1: creative writing for chapter ${chapterNumber}`,
    });

    const creativeResponse = await this.chat(
      [
        { role: "system", content: creativeSystemPrompt },
        { role: "user", content: creativeUserPrompt },
      ],
      { temperature: creativeTemperature },
    );
    const creativeUsage = creativeResponse.usage;

    const creative = parseCreativeOutput(chapterNumber, creativeResponse.content, resolvedLengthSpec.countingMode);

    // Phase 4: soft-check that PRE_WRITE_CHECK aligns with the chapter memo.
    // Memo was already parse-validated in the planner, so this only warns —
    // the LLM self-check may have skipped or abbreviated a row.
    if (input.chapterMemo) {
      this.verifyPreWriteCheckAlignsWithMemo(creative.preWriteCheck, chapterNumber, resolvedLanguage);
    }

    // ── Phase 2: State settlement (temperature 0.3) ──
    this.logInfo(resolvedLanguage, {
      zh: `阶段 2：状态结算（第${chapterNumber}章，${creative.wordCount}字）`,
      en: `Phase 2: state settlement for chapter ${chapterNumber} (${creative.wordCount} words)`,
    });
    const filteredHooksForSettlement = buildGovernedHookWorkingSet({
      hooksMarkdown: hooks,
      contextPackage: input.contextPackage,
      chapterIntent: input.chapterIntent,
      chapterNumber,
      language: resolvedLanguage,
    });
    const filteredSubplotsForSettlement = filterSubplots(subplotBoard);
    const filteredArcsForSettlement = filterEmotionalArcs(emotionalArcs, chapterNumber);
    const filteredMatrixForSettlement = buildGovernedCharacterMatrixWorkingSet({
      matrixMarkdown: characterMatrix,
      chapterIntent: input.chapterIntent,
      contextPackage: input.contextPackage,
      protagonistName: bookRules?.protagonist?.name,
    });

    const settleResult = await this.settle({
      book,
      genreProfile,
      bookRules,
      chapterNumber,
      title: creative.title,
      content: creative.content,
      currentState,
      ledger: genreProfile.numericalSystem ? ledger : "",
      hooks: filteredHooksForSettlement,
      chapterSummaries: filterSummaries(chapterSummaries, chapterNumber),
      subplotBoard: filteredSubplotsForSettlement,
      emotionalArcs: filteredArcsForSettlement,
      characterMatrix: filteredMatrixForSettlement,
      volumeOutline,
      selectedEvidenceBlock: this.joinGovernedEvidenceBlocks(governedMemoryBlocks),
      chapterIntent: input.chapterIntent,
      contextPackage: input.contextPackage,
      ruleStack: input.ruleStack,
      validationFeedback: undefined,
      originalHooks: hooks,
      originalSubplots: subplotBoard,
      originalEmotionalArcs: emotionalArcs,
      originalCharacterMatrix: characterMatrix,
    });
    const settlement = settleResult.settlement;
    const settleUsage = settleResult.usage;
    const runtimeStateArtifacts = await this.buildRuntimeStateArtifactsIfPresent(
      bookDir,
      settlement.runtimeStateDelta,
      resolvedLanguage,
      chapterNumber,
    );
    const resolvedRuntimeStateDelta = runtimeStateArtifacts?.resolvedDelta ?? settlement.runtimeStateDelta;
    const priorHookIds = new Set(parsePendingHooksMarkdown(hooks).map((hook) => hook.hookId));
    const hookHealthIssues = resolvedRuntimeStateDelta
      && (runtimeStateArtifacts?.snapshot ?? settlement.runtimeStateSnapshot)
      ? analyzeHookHealth({
          language: resolvedLanguage,
          chapterNumber,
          targetChapters: book.targetChapters,
          hooks: (runtimeStateArtifacts?.snapshot ?? settlement.runtimeStateSnapshot)!.hooks.hooks,
          delta: resolvedRuntimeStateDelta,
          existingHookIds: [...priorHookIds],
        })
      : [];

    // ── Post-write validation (regex + rule-based, zero LLM cost) ──
    const surfaceNormalizedContent = normalizePostWriteSurface(creative.content, resolvedLanguage);
    const surfaceNormalizedWordCount = countChapterLength(surfaceNormalizedContent, resolvedLengthSpec.countingMode);
    const ruleViolations = [
      ...validatePostWrite(surfaceNormalizedContent, genreProfile, bookRules, resolvedLanguage),
      ...detectCrossChapterRepetition(surfaceNormalizedContent, fingerprintChapters, resolvedLanguage),
      ...detectParagraphLengthDrift(surfaceNormalizedContent, fingerprintChapters, resolvedLanguage),
    ];
    const aiTellIssues = analyzeAITells(surfaceNormalizedContent, resolvedLanguage).issues;

    const postWriteErrors = ruleViolations.filter(v => v.severity === "error");
    const postWriteWarnings = ruleViolations.filter(v => v.severity === "warning");

    if (ruleViolations.length > 0) {
      this.logWarn(resolvedLanguage, {
        zh: `后写校验：第${chapterNumber}章 ${postWriteErrors.length} 个错误，${postWriteWarnings.length} 个警告`,
        en: `Post-write: ${postWriteErrors.length} errors, ${postWriteWarnings.length} warnings in chapter ${chapterNumber}`,
      });
      for (const v of ruleViolations) {
        this.ctx.logger?.warn(`[${v.severity}] ${v.rule}: ${v.description}`);
      }
    }
    if (aiTellIssues.length > 0) {
      this.logWarn(resolvedLanguage, {
        zh: `AI 味检查：第${chapterNumber}章发现 ${aiTellIssues.length} 个问题`,
        en: `AI-tell check: ${aiTellIssues.length} issues in chapter ${chapterNumber}`,
      });
      for (const issue of aiTellIssues) {
        this.ctx.logger?.warn(`[${issue.severity}] ${issue.category}: ${issue.description}`);
      }
    }
    if (hookHealthIssues.length > 0) {
      this.logWarn(resolvedLanguage, {
        zh: `伏笔健康：第${chapterNumber}章发现 ${hookHealthIssues.length} 条警告`,
        en: `Hook health: ${hookHealthIssues.length} warning(s) in chapter ${chapterNumber}`,
      });
      for (const issue of hookHealthIssues) {
        this.ctx.logger?.warn(`[${issue.severity}] ${issue.category}: ${issue.description}`);
      }
    }

    // ── Merge into WriteChapterOutput ──
    const tokenUsage: TokenUsage = {
      promptTokens: creativeUsage.promptTokens + settleUsage.promptTokens,
      completionTokens: creativeUsage.completionTokens + settleUsage.completionTokens,
      totalTokens: creativeUsage.totalTokens + settleUsage.totalTokens,
    };

    return {
      chapterNumber,
      title: creative.title,
      content: surfaceNormalizedContent,
      wordCount: surfaceNormalizedWordCount,
      preWriteCheck: creative.preWriteCheck,
      postSettlement: settlement.postSettlement,
      runtimeStateDelta: resolvedRuntimeStateDelta,
      runtimeStateSnapshot: runtimeStateArtifacts?.snapshot ?? settlement.runtimeStateSnapshot,
      updatedState: runtimeStateArtifacts?.currentStateMarkdown ?? settlement.updatedState,
      updatedLedger: settlement.updatedLedger,
      updatedHooks: runtimeStateArtifacts?.hooksMarkdown ?? settlement.updatedHooks,
      chapterSummary: resolvedRuntimeStateDelta
        ? this.renderDeltaSummaryRow(resolvedRuntimeStateDelta)
        : settlement.chapterSummary,
      updatedChapterSummaries: runtimeStateArtifacts?.chapterSummariesMarkdown,
      updatedSubplots: settlement.updatedSubplots,
      updatedEmotionalArcs: settlement.updatedEmotionalArcs,
      updatedCharacterMatrix: settlement.updatedCharacterMatrix,
      postWriteErrors,
      postWriteWarnings,
      hookHealthIssues,
      tokenUsage,
    };
  }

  async settleChapterState(input: SettleChapterStateInput): Promise<WriteChapterOutput> {
    const baselineStoryDir = input.baselineChapter === undefined
      ? join(input.bookDir, "story")
      : join(input.bookDir, "story", "snapshots", String(input.baselineChapter));
    const [
      currentState,
      ledger,
      hooks,
      chapterSummaries,
      subplotBoard,
      emotionalArcs,
      characterMatrix,
      volumeOutline,
    ] = await Promise.all([
      input.baselineChapter === undefined
        ? readCurrentStateWithFallback(input.bookDir, "(文件尚未创建)")
        : this.readFileOrDefault(join(baselineStoryDir, "current_state.md")),
      this.readFileOrDefault(join(baselineStoryDir, "particle_ledger.md")),
      this.readFileOrDefault(join(baselineStoryDir, "pending_hooks.md")),
      this.readFileOrDefault(join(baselineStoryDir, "chapter_summaries.md")),
      this.readFileOrDefault(join(baselineStoryDir, "subplot_board.md")),
      this.readFileOrDefault(join(baselineStoryDir, "emotional_arcs.md")),
      input.baselineChapter === undefined
        ? readCharacterContext(input.bookDir, "(文件尚未创建)")
        : this.readSnapshotCharacterContext(input.bookDir, baselineStoryDir),
      readVolumeMap(input.bookDir, "(文件尚未创建)"),
    ]);

    const { profile: genreProfile } = await readGenreProfile(this.ctx.projectRoot, input.book.genre);
    const parsedBookRules = await readBookRules(input.bookDir);
    const bookRules = parsedBookRules?.rules ?? null;
    const resolvedLanguage = input.book.language ?? genreProfile.language;
    const governedMemoryBlocks = input.contextPackage
      ? buildGovernedMemoryEvidenceBlocks(input.contextPackage, resolvedLanguage)
      : undefined;

    const settleResult = await this.settle({
      book: input.book,
      genreProfile,
      bookRules,
      chapterNumber: input.chapterNumber,
      title: input.title,
      content: input.content,
      currentState,
      ledger: genreProfile.numericalSystem ? ledger : "",
      hooks,
      chapterSummaries,
      subplotBoard,
      emotionalArcs,
      characterMatrix,
      volumeOutline,
      selectedEvidenceBlock: governedMemoryBlocks
        ? this.joinGovernedEvidenceBlocks(governedMemoryBlocks)
        : undefined,
      chapterIntent: input.chapterIntent,
      contextPackage: input.contextPackage,
      ruleStack: input.ruleStack,
      validationFeedback: input.validationFeedback,
      originalHooks: hooks,
      originalSubplots: subplotBoard,
      originalEmotionalArcs: emotionalArcs,
      originalCharacterMatrix: characterMatrix,
    });
    const settlement = settleResult.settlement;
    const runtimeStateArtifacts = await this.buildRuntimeStateArtifactsIfPresent(
      input.bookDir,
      settlement.runtimeStateDelta,
      resolvedLanguage,
      input.chapterNumber,
      input.allowReapply,
      input.baselineChapter,
      input.allowNewHooks,
    );

    return {
      chapterNumber: input.chapterNumber,
      title: input.title,
      content: input.content,
      wordCount: countChapterLength(
        input.content,
        resolvedLanguage === "en" ? "en_words" : "zh_chars",
      ),
      preWriteCheck: "",
      postSettlement: settlement.postSettlement,
      runtimeStateDelta: runtimeStateArtifacts?.resolvedDelta ?? settlement.runtimeStateDelta,
      runtimeStateSnapshot: runtimeStateArtifacts?.snapshot ?? settlement.runtimeStateSnapshot,
      updatedState: runtimeStateArtifacts?.currentStateMarkdown ?? settlement.updatedState,
      updatedLedger: settlement.updatedLedger,
      updatedHooks: runtimeStateArtifacts?.hooksMarkdown ?? settlement.updatedHooks,
      chapterSummary: settlement.runtimeStateDelta
        ? this.renderDeltaSummaryRow(settlement.runtimeStateDelta)
        : settlement.chapterSummary,
      updatedChapterSummaries: runtimeStateArtifacts?.chapterSummariesMarkdown,
      updatedSubplots: settlement.updatedSubplots,
      updatedEmotionalArcs: settlement.updatedEmotionalArcs,
      updatedCharacterMatrix: settlement.updatedCharacterMatrix,
      postWriteErrors: [],
      postWriteWarnings: [],
      tokenUsage: settleResult.usage,
    };
  }

  private async settle(params: {
    readonly book: BookConfig;
    readonly genreProfile: GenreProfile;
    readonly bookRules: BookRules | null;
    readonly chapterNumber: number;
    readonly title: string;
    readonly content: string;
    readonly currentState: string;
    readonly ledger: string;
    readonly hooks: string;
    readonly chapterSummaries: string;
    readonly subplotBoard: string;
    readonly emotionalArcs: string;
    readonly characterMatrix: string;
    readonly volumeOutline: string;
    readonly selectedEvidenceBlock?: string;
    readonly chapterIntent?: string;
    readonly contextPackage?: ContextPackage;
    readonly ruleStack?: RuleStack;
    readonly validationFeedback?: string;
    readonly originalHooks: string;
    readonly originalSubplots: string;
    readonly originalEmotionalArcs: string;
    readonly originalCharacterMatrix: string;
  }): Promise<{
    settlement: ReturnType<typeof parseSettlementOutput> & {
      runtimeStateDelta?: RuntimeStateDelta;
      runtimeStateSnapshot?: RuntimeStateSnapshot;
    };
    usage: TokenUsage;
  }> {
    // Phase 2a: Observer — extract all facts from the chapter
    const resolvedLang = params.book.language ?? params.genreProfile.language;
    const observerSystem = buildObserverSystemPrompt(params.book, params.genreProfile, resolvedLang);
    const observerUser = buildObserverUserPrompt(params.chapterNumber, params.title, params.content, resolvedLang);

    this.logInfo(resolvedLang, {
      zh: `阶段 2a：提取第${params.chapterNumber}章事实`,
      en: `Phase 2a: observing facts for chapter ${params.chapterNumber}`,
    });
    const observerResponse = await this.chat(
      [
        { role: "system", content: observerSystem },
        { role: "user", content: observerUser },
      ],
      { temperature: 0.5 },
    );
    const observations = observerResponse.content;

    // Phase 2b: Reflector — merge observations into truth files
    this.logInfo(resolvedLang, {
      zh: "阶段 2b：把观察结果回写到真相文件",
      en: "Phase 2b: reflecting observations into truth files",
    });
    const settlerSystem = buildSettlerSystemPrompt(
      params.book, params.genreProfile, params.bookRules, resolvedLang,
    );
    const governedControlBlock = params.chapterIntent && params.contextPackage && params.ruleStack
      ? this.buildSettlerGovernedControlBlock(
          params.chapterIntent,
          params.contextPackage,
          params.ruleStack,
          resolvedLang,
        )
      : undefined;

    const settlerUser = buildSettlerUserPrompt({
      chapterNumber: params.chapterNumber,
      title: params.title,
      content: params.content,
      currentState: params.currentState,
      ledger: params.ledger,
      hooks: params.hooks,
      chapterSummaries: params.chapterSummaries,
      subplotBoard: params.subplotBoard,
      emotionalArcs: params.emotionalArcs,
      characterMatrix: params.characterMatrix,
      volumeOutline: params.volumeOutline,
      observations,
      selectedEvidenceBlock: params.selectedEvidenceBlock,
      governedControlBlock,
      validationFeedback: params.validationFeedback,
    });

    const response = await this.chat(
      [
        { role: "system", content: settlerSystem },
        { role: "user", content: settlerUser },
      ],
      { temperature: 0.3 },
    );

    let mergedSettlement: ReturnType<typeof parseSettlementOutput> & {
      runtimeStateDelta?: RuntimeStateDelta;
      runtimeStateSnapshot?: RuntimeStateSnapshot;
    };
    try {
      const deltaOutput = parseSettlerDeltaOutput(response.content);
      mergedSettlement = {
        postSettlement: deltaOutput.postSettlement,
        runtimeStateDelta: deltaOutput.runtimeStateDelta,
        updatedState: "",
        updatedLedger: "",
        updatedHooks: "",
        chapterSummary: "",
        updatedSubplots: "",
        updatedEmotionalArcs: "",
        updatedCharacterMatrix: "",
      };
    } catch {
      const settlement = parseSettlementOutput(response.content, params.genreProfile);
      mergedSettlement = governedControlBlock
        ? {
            ...settlement,
            updatedHooks: mergeTableMarkdownByKey(params.originalHooks, settlement.updatedHooks, [0]),
            updatedSubplots: settlement.updatedSubplots
              ? mergeTableMarkdownByKey(params.originalSubplots, settlement.updatedSubplots, [0])
              : settlement.updatedSubplots,
            updatedEmotionalArcs: settlement.updatedEmotionalArcs
              ? mergeTableMarkdownByKey(params.originalEmotionalArcs, settlement.updatedEmotionalArcs, [0, 1])
              : settlement.updatedEmotionalArcs,
            updatedCharacterMatrix: settlement.updatedCharacterMatrix
              ? mergeCharacterMatrixMarkdown(params.originalCharacterMatrix, settlement.updatedCharacterMatrix)
              : settlement.updatedCharacterMatrix,
          }
        : settlement;
    }

    return {
      settlement: mergedSettlement,
      usage: response.usage,
    };
  }

  async saveChapter(
    bookDir: string,
    output: WriteChapterOutput,
    numericalSystem: boolean = true,
    language: "zh" | "en" = "zh",
  ): Promise<void> {
    const chaptersDir = join(bookDir, "chapters");
    await mkdir(chaptersDir, { recursive: true });

    const paddedNum = String(output.chapterNumber).padStart(4, "0");
    const filename = `${paddedNum}_${this.sanitizeFilename(output.title)}.md`;
    const existingChapterFiles = await readdir(chaptersDir).catch(() => []);
    const supersededChapterFiles = existingChapterFiles
      .filter((file) => file.startsWith(`${paddedNum}_`) && file.endsWith(".md") && file !== filename);

    const heading = language === "en"
      ? `# Chapter ${output.chapterNumber}: ${output.title}`
      : `# 第${output.chapterNumber}章 ${output.title}`;
    const chapterContent = [
      heading,
      "",
      output.content,
    ].join("\n");
    const runtimeStateArtifacts = await this.resolveRuntimeStateArtifactsForOutput(
      bookDir,
      output,
      language,
    );
    const chapterSummariesMarkdown = runtimeStateArtifacts?.chapterSummariesMarkdown
      ?? (!output.runtimeStateDelta && output.updatedChapterSummaries
        ? output.updatedChapterSummaries
        : !output.runtimeStateDelta && output.chapterSummary
          ? await this.renderAppendedChapterSummary(bookDir, output.chapterSummary, language)
          : undefined);

    const writes: AtomicFileWrite[] = [
      { relativePath: join("chapters", filename), content: chapterContent },
      {
        relativePath: join("story", "current_state.md"),
        content: runtimeStateArtifacts?.currentStateMarkdown ?? output.updatedState,
      },
      {
        relativePath: join("story", "pending_hooks.md"),
        content: runtimeStateArtifacts?.hooksMarkdown ?? output.updatedHooks,
      },
    ];

    if (chapterSummariesMarkdown) {
      writes.push({
        relativePath: join("story", "chapter_summaries.md"),
        content: chapterSummariesMarkdown,
      });
    }

    if (output.updatedSubplots) {
      writes.push({ relativePath: join("story", "subplot_board.md"), content: output.updatedSubplots });
    }
    if (output.updatedEmotionalArcs) {
      writes.push({ relativePath: join("story", "emotional_arcs.md"), content: output.updatedEmotionalArcs });
    }
    if (output.updatedCharacterMatrix) {
      writes.push({ relativePath: join("story", "character_matrix.md"), content: output.updatedCharacterMatrix });
    }

    const runtimeStateSnapshot = runtimeStateArtifacts?.snapshot ?? output.runtimeStateSnapshot;
    if (runtimeStateSnapshot) {
      writes.push(
        {
          relativePath: join("story", "state", "manifest.json"),
          content: JSON.stringify(runtimeStateSnapshot.manifest, null, 2),
        },
        {
          relativePath: join("story", "state", "current_state.json"),
          content: JSON.stringify(runtimeStateSnapshot.currentState, null, 2),
        },
        {
          relativePath: join("story", "state", "hooks.json"),
          content: JSON.stringify(runtimeStateSnapshot.hooks, null, 2),
        },
        {
          relativePath: join("story", "state", "chapter_summaries.json"),
          content: JSON.stringify(runtimeStateSnapshot.chapterSummaries, null, 2),
        },
      );
    }

    if (numericalSystem) {
      writes.push({ relativePath: join("story", "particle_ledger.md"), content: output.updatedLedger });
    }

    await commitAtomicFileSet({
      rootDir: bookDir,
      writes,
      deletes: supersededChapterFiles.map((file) => join("chapters", file)),
    });
  }

  private buildGovernedUserPrompt(params: {
    readonly chapterNumber: number;
    readonly chapterMemo: ChapterMemo;
    readonly chapterIntentData?: ChapterIntent;
    readonly contextPackage: ContextPackage;
    readonly ruleStack: RuleStack;
    readonly externalContext?: string;
    readonly lengthSpec: LengthSpec;
    readonly language?: "zh" | "en";
    readonly varianceBrief?: string;
    readonly selectedEvidenceBlock?: string;
  }): string {
    const language = params.language ?? "zh";
    // The user's steering docs (author_intent = long-term direction, current_focus =
    // short-term focus) must land as a prominent, binding block near the top — not
    // buried among generic "evidence" entries where the model treats them as optional.
    const DIRECTION_SOURCES = new Set(["story/author_intent.md", "story/current_focus.md"]);
    const directionEntries = params.contextPackage.selectedContext.filter((entry) =>
      DIRECTION_SOURCES.has(entry.source),
    );
    const otherEntries = params.contextPackage.selectedContext.filter((entry) =>
      !DIRECTION_SOURCES.has(entry.source),
    );
    const contextSections = renderNarrativeSelectedContext(otherEntries, language);
    const userDirectionBlock = directionEntries.length > 0
      ? (language === "en"
          ? `## User direction (overrides model defaults — must follow)\n${renderNarrativeSelectedContext(directionEntries, language)}\n`
          : `## 用户方向（优先于模型默认，必须遵循）\n${renderNarrativeSelectedContext(directionEntries, language)}\n`)
      : "";

    const diagnosticLines = params.ruleStack.sections.diagnostic.length > 0
      ? params.ruleStack.sections.diagnostic.join(", ")
      : "none";

    const lengthRequirementBlock = this.buildLengthRequirementBlock(params.lengthSpec, params.language ?? "zh");
    const varianceBlock = params.varianceBrief
      ? `\n${params.varianceBrief}\n`
      : "";
    const selectedEvidenceBlock = params.selectedEvidenceBlock
      ? `\n${sanitizeNarrativeEvidenceBlock(params.selectedEvidenceBlock, language)}\n`
      : "";
    const chapterContextBlock = this.buildChapterContextBlock(params.externalContext, language);
    const briefNarrative = renderMemoAsNarrativeBlock(params.chapterMemo, params.chapterIntentData, language);

    if (params.language === "en") {
      return `Write chapter ${params.chapterNumber}.

${chapterContextBlock}

${userDirectionBlock}
${briefNarrative}

## Selected Context
${contextSections || "(none)"}
${selectedEvidenceBlock}

## Rule Stack
- Hard: ${params.ruleStack.sections.hard.join(", ") || "(none)"}
- Soft: ${params.ruleStack.sections.soft.join(", ") || "(none)"}
- Diagnostic: ${diagnosticLines}

${varianceBlock}
${lengthRequirementBlock}
- Output PRE_WRITE_CHECK first, then the chapter
- Output only PRE_WRITE_CHECK, CHAPTER_TITLE, and CHAPTER_CONTENT blocks`;
    }

    return `请续写第${params.chapterNumber}章。

${chapterContextBlock}

${userDirectionBlock}
${briefNarrative}

## 已选上下文
${contextSections || "(无)"}
${selectedEvidenceBlock}

## 规则栈
- 硬护栏：${params.ruleStack.sections.hard.join("、") || "(无)"}
- 软约束：${params.ruleStack.sections.soft.join("、") || "(无)"}
- 诊断规则：${diagnosticLines}

${varianceBlock}
${lengthRequirementBlock}
- 先输出写作自检表，再写正文
- 只需输出 PRE_WRITE_CHECK、CHAPTER_TITLE、CHAPTER_CONTENT 三个区块`;
  }

  private buildChapterContextBlock(externalContext: string | undefined, language: "zh" | "en"): string {
    const trimmed = externalContext?.trim();
    if (!trimmed) return "";
    if (language === "en") {
      return `## Per-chapter user instruction (highest priority)
${trimmed}

Obey this direct instruction for the current chapter. If it specifies a chapter title, use that title exactly in CHAPTER_TITLE. Keep continuity, but do not replace this instruction with the outline fallback.`;
    }
    return `## 本章用户指令（最高优先级）
${trimmed}

这是用户对当前章节的直接指令。若其中指定章节标题，CHAPTER_TITLE 必须原样使用该标题。保持连续性，但不要用卷纲兜底替换这条指令。`;
  }

  private joinGovernedEvidenceBlocks(blocks: ReturnType<typeof buildGovernedMemoryEvidenceBlocks> | undefined): string | undefined {
    if (!blocks) {
      return undefined;
    }

    const joined = [
      blocks.titleHistoryBlock,
      blocks.moodTrailBlock,
      blocks.canonBlock,
      blocks.hookDebtBlock,
      blocks.hooksBlock,
      blocks.summariesBlock,
      blocks.volumeSummariesBlock,
    ]
      .filter((block): block is string => Boolean(block))
      .join("\n");

    return joined || undefined;
  }

  private buildSettlerGovernedControlBlock(
    chapterIntent: string,
    contextPackage: ContextPackage,
    ruleStack: RuleStack,
    language: "zh" | "en",
  ): string {
    const selectedContext = renderNarrativeSelectedContext(contextPackage.selectedContext, language)
      .replace(/^### /gm, "- ");
    const overrides = ruleStack.activeOverrides.length > 0
      ? ruleStack.activeOverrides
        .map((override) => `- ${override.from} -> ${override.to}: ${override.reason} (${override.target})`)
        .join("\n")
      : "- none";
    const narrativeIntent = buildNarrativeIntentBrief(chapterIntent, language);

    if (language === "en") {
      return `\n## Chapter Control Inputs
${narrativeIntent || "(none)"}

### Selected Context
${selectedContext || "- none"}

### Rule Stack
- Hard guardrails: ${ruleStack.sections.hard.join(", ") || "(none)"}
- Soft constraints: ${ruleStack.sections.soft.join(", ") || "(none)"}
- Diagnostic rules: ${ruleStack.sections.diagnostic.join(", ") || "(none)"}

### Active Overrides
${overrides}\n`;
    }

    return `\n## 本章控制输入
${narrativeIntent || "(无)"}

### 已选上下文
${selectedContext || "- none"}

### 规则栈
- 硬护栏：${ruleStack.sections.hard.join("、") || "(无)"}
- 软约束：${ruleStack.sections.soft.join("、") || "(无)"}
- 诊断规则：${ruleStack.sections.diagnostic.join("、") || "(无)"}

### 当前覆盖
${overrides}\n`;
  }

  /**
   * Soft-check that the LLM's PRE_WRITE_CHECK output references the three
   * non-negotiable memo sections: 当前任务, 不要做, 章尾必须发生的改变.
   *
   * This is NOT a hard gate — the memo was already parse-validated in the
   * planner, and the writer prompt already tells the LLM to align to memo.
   * We only warn when the LLM skipped a section, so the chapter still ships.
   */
  private verifyPreWriteCheckAlignsWithMemo(
    preWriteCheck: string,
    chapterNumber: number,
    language: "zh" | "en",
  ): void {
    if (!preWriteCheck || preWriteCheck.trim().length === 0) {
      this.logWarn(language, {
        zh: `第${chapterNumber}章 PRE_WRITE_CHECK 为空，无法对齐 chapter_memo`,
        en: `Chapter ${chapterNumber} PRE_WRITE_CHECK is empty; cannot verify memo alignment`,
      });
      return;
    }

    const required = language === "en"
      ? [
          { needle: "Current task", label: "Current task" },
          { needle: "Do not", label: "Do not" },
          { needle: "end-of-chapter", label: "Required end-of-chapter change" },
        ]
      : [
          { needle: "当前任务", label: "当前任务" },
          { needle: "不要做", label: "不要做" },
          { needle: "章尾", label: "章尾必须发生的改变" },
        ];
    const missing = required.filter((r) => !preWriteCheck.includes(r.needle)).map((r) => r.label);

    if (missing.length > 0) {
      this.logWarn(language, {
        zh: `第${chapterNumber}章 PRE_WRITE_CHECK 缺少 memo 章节检查：${missing.join("、")}`,
        en: `Chapter ${chapterNumber} PRE_WRITE_CHECK missing memo sections: ${missing.join(", ")}`,
      });
    }
  }

  private buildLengthRequirementBlock(lengthSpec: LengthSpec, language: "zh" | "en"): string {
    if (language === "en") {
      return `Requirements:
- Target length: ${lengthSpec.target} words
- Acceptable range: ${lengthSpec.softMin}-${lengthSpec.softMax} words`;
    }

    return `要求：
- 目标字数：${lengthSpec.target}字
- 允许区间：${lengthSpec.softMin}-${lengthSpec.softMax}字`;
  }

  private async loadRecentChapters(
    bookDir: string,
    currentChapter: number,
    count = 1,
  ): Promise<string> {
    const chaptersDir = join(bookDir, "chapters");
    try {
      const files = await readdir(chaptersDir);
      const mdFiles = files
        .filter((f) => f.endsWith(".md") && !f.startsWith("index"))
        .sort()
        .slice(-count);

      if (mdFiles.length === 0) return "";

      const contents = await Promise.all(
        mdFiles.map(async (f) => {
          const content = await readFile(join(chaptersDir, f), "utf-8");
          return content;
        }),
      );

      return contents.join("\n\n---\n\n");
    } catch {
      return "";
    }
  }

  private async readFileOrDefault(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return "(文件尚未创建)";
    }
  }

  private async readSnapshotCharacterContext(
    bookDir: string,
    snapshotStoryDir: string,
  ): Promise<string> {
    const snapshotMatrix = await this.readFileOrDefault(join(snapshotStoryDir, "character_matrix.md"));
    if (snapshotMatrix !== "(文件尚未创建)") return snapshotMatrix;
    return readCharacterContext(bookDir, "(文件尚未创建)");
  }

  private renderDeltaSummaryRow(delta: RuntimeStateDelta): string {
    if (!delta.chapterSummary) return "";
    const summary = delta.chapterSummary;
    const row = [
      summary.chapter,
      summary.title,
      summary.characters,
      summary.events,
      summary.stateChanges,
      summary.hookActivity,
      summary.mood,
      summary.chapterType,
    ].map((value) => String(value).replace(/\|/g, "\\|").trim()).join(" | ");

    return `| ${row} |`;
  }

  private normalizeRuntimeStateDeltaChapter(
    delta: RuntimeStateDelta,
    authoritativeChapterNumber: number,
  ): RuntimeStateDelta {
    const hookOps = delta.hookOps ?? {
      upsert: [],
      mention: [],
      resolve: [],
      defer: [],
    };
    let changed = delta.chapter !== authoritativeChapterNumber;
    const normalizedUpserts = hookOps.upsert.map((hook) => {
      const startChapter = Math.min(hook.startChapter, authoritativeChapterNumber);
      const lastAdvancedChapter = Math.min(hook.lastAdvancedChapter, authoritativeChapterNumber);
      if (startChapter !== hook.startChapter || lastAdvancedChapter !== hook.lastAdvancedChapter) {
        changed = true;
      }
      if (startChapter === hook.startChapter && lastAdvancedChapter === hook.lastAdvancedChapter) {
        return hook;
      }
      return {
        ...hook,
        startChapter,
        lastAdvancedChapter,
      };
    });

    if (delta.chapterSummary?.chapter !== undefined && delta.chapterSummary.chapter !== authoritativeChapterNumber) {
      changed = true;
    }
    if (!changed) {
      return delta;
    }

    return {
      ...delta,
      chapter: authoritativeChapterNumber,
      hookOps: {
        ...hookOps,
        upsert: normalizedUpserts,
      },
      chapterSummary: delta.chapterSummary
        ? {
            ...delta.chapterSummary,
            chapter: authoritativeChapterNumber,
          }
        : undefined,
    };
  }

  private async buildRuntimeStateArtifactsIfPresent(
    bookDir: string,
    delta: RuntimeStateDelta | undefined,
    language: "zh" | "en",
    authoritativeChapterNumber?: number,
    allowReapply?: boolean,
    baselineChapter?: number,
    allowNewHooks?: boolean,
  ): Promise<RuntimeStateArtifacts | null> {
    if (!delta) return null;
    const safeDelta = authoritativeChapterNumber === undefined
      ? delta
      : this.normalizeRuntimeStateDeltaChapter(delta, authoritativeChapterNumber);
    if (baselineChapter === undefined) {
      return buildRuntimeStateArtifacts({
        bookDir,
        delta: safeDelta,
        language,
        allowReapply,
        allowNewHooks,
      });
    }
    const snapshot = await loadRuntimeStateSnapshotAtChapter({
      bookDir,
      chapterNumber: baselineChapter,
      language,
    });
    return buildRuntimeStateArtifactsFromSnapshot({
      snapshot,
      delta: safeDelta,
      language,
      allowReapply,
      allowNewHooks,
    });
  }

  private async resolveRuntimeStateArtifactsForOutput(
    bookDir: string,
    output: WriteChapterOutput,
    language: "zh" | "en",
  ): Promise<RuntimeStateArtifacts | null> {
    if (!output.runtimeStateDelta) return null;
    const safeDelta = this.normalizeRuntimeStateDeltaChapter(
      output.runtimeStateDelta,
      output.chapterNumber,
    );
    if (
      safeDelta === output.runtimeStateDelta
      && output.runtimeStateSnapshot
      && output.updatedChapterSummaries
      && output.updatedState
      && output.updatedHooks
    ) {
      return {
        snapshot: output.runtimeStateSnapshot,
        resolvedDelta: safeDelta,
        currentStateMarkdown: output.updatedState,
        hooksMarkdown: output.updatedHooks,
        chapterSummariesMarkdown: output.updatedChapterSummaries,
      };
    }

    return buildRuntimeStateArtifacts({
      bookDir,
      delta: safeDelta,
      language,
    });
  }

  private async renderAppendedChapterSummary(
    bookDir: string,
    summary: string,
    language: "zh" | "en",
  ): Promise<string | undefined> {
    const summaryPath = join(bookDir, "story", "chapter_summaries.md");
    let existing = "";
    try {
      existing = await readFile(summaryPath, "utf-8");
    } catch {
      // File doesn't exist yet — start with header
      existing = language === "en"
        ? "# Chapter Summaries\n\n| Chapter | Title | Characters | Key Events | State Changes | Hook Activity | Mood | Chapter Type |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n"
        : "# 章节摘要\n\n| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |\n|------|------|----------|----------|----------|----------|----------|----------|\n";
    }

    // Extract only the data row(s) from the summary (skip header lines)
    const dataRows = summary
      .split("\n")
      .filter((line) =>
        line.startsWith("|")
        && !line.startsWith("| 章节")
        && !line.startsWith("| Chapter")
        && !line.startsWith("|--")
        && !line.startsWith("| ---"),
      )
      .join("\n");

    if (dataRows) {
      // Deduplicate: remove existing rows with the same chapter number before appending
      const newChapterNums = new Set(
        dataRows.split("\n")
          .map((line) => line.split("|")[1]?.trim())
          .filter((ch) => ch && /^\d+$/.test(ch)),
      );
      const deduped = existing
        .split("\n")
        .filter((line) => {
          if (!line.startsWith("|")) return true;
          const chNum = line.split("|")[1]?.trim();
          return !chNum || !newChapterNums.has(chNum);
        })
        .join("\n");
      return `${deduped.trimEnd()}\n${dataRows}\n`;
    }
    return undefined;
  }

  private buildStyleFingerprint(styleProfileRaw: string): string | undefined {
    if (!styleProfileRaw || styleProfileRaw === "(文件尚未创建)") return undefined;
    try {
      const profile = JSON.parse(styleProfileRaw);
      const lines: string[] = [];
      if (profile.avgSentenceLength) lines.push(`- 平均句长：${profile.avgSentenceLength}字`);
      if (profile.sentenceLengthStdDev) lines.push(`- 句长标准差：${profile.sentenceLengthStdDev}`);
      if (profile.avgParagraphLength) lines.push(`- 平均段落长度：${profile.avgParagraphLength}字`);
      if (profile.paragraphLengthRange) lines.push(`- 段落长度范围：${profile.paragraphLengthRange.min}-${profile.paragraphLengthRange.max}字`);
      if (profile.vocabularyDiversity) lines.push(`- 词汇多样性(TTR)：${profile.vocabularyDiversity}`);
      if (profile.topPatterns?.length > 0) lines.push(`- 高频句式：${profile.topPatterns.join("、")}`);
      if (profile.rhetoricalFeatures?.length > 0) lines.push(`- 修辞特征：${profile.rhetoricalFeatures.join("、")}`);
      return lines.length > 0 ? lines.join("\n") : undefined;
    } catch {
      return undefined;
    }
  }
  private sanitizeFilename(title: string): string {
    return title
      .replace(/[/\\?%*:|"<>]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 50);
  }
}
