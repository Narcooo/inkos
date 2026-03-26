import type { LLMClient, OnStreamProgress } from "../llm/provider.js";
import { chatCompletion, createLLMClient } from "../llm/provider.js";
import type { Logger } from "../utils/logger.js";
import type { BookConfig } from "../models/book.js";
import type { ChapterMeta } from "../models/chapter.js";
import type { NotifyChannel, LLMConfig, AgentLLMOverride } from "../models/project.js";
import type { GenreProfile } from "../models/genre-profile.js";
import { ArchitectAgent } from "../agents/architect.js";
import { WriterAgent } from "../agents/writer.js";
import { ChapterAnalyzerAgent } from "../agents/chapter-analyzer.js";
import { ContinuityAuditor } from "../agents/continuity.js";
import { ReviserAgent, type ReviseMode } from "../agents/reviser.js";
import { RadarAgent } from "../agents/radar.js";
import type { RadarSource } from "../agents/radar-source.js";
import { readGenreProfile } from "../agents/rules-reader.js";
import { analyzeAITells } from "../agents/ai-tells.js";
import { analyzeSensitiveWords } from "../agents/sensitive-words.js";
import type { PostWriteViolation } from "../agents/post-write-validator.js";
import { StateManager } from "../state/manager.js";
import { dispatchNotification, dispatchWebhookEvent } from "../notify/dispatcher.js";
import type { WebhookEvent } from "../notify/webhook.js";
import type { AgentContext } from "../agents/base.js";
import { AgentError } from "../agents/agent-error.js";
import type { AuditResult, AuditIssue } from "../agents/continuity.js";
import type { RadarResult } from "../agents/radar.js";
import { PipelineContext } from "./pipeline-context.js";
import { ImportPipeline } from "./import-pipeline.js";
import { LayeredPipelineRunner, type LayeredChapterResult } from "./layered-runner.js";
import { readFileSafe } from "../utils/read-file-safe.js";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface PipelineConfig {
  readonly client: LLMClient;
  readonly model: string;
  readonly projectRoot: string;
  readonly defaultLLMConfig?: LLMConfig;
  readonly notifyChannels?: ReadonlyArray<NotifyChannel>;
  readonly radarSources?: ReadonlyArray<RadarSource>;
  readonly externalContext?: string;
  readonly modelOverrides?: Record<string, string | AgentLLMOverride>;
  readonly logger?: Logger;
  readonly onStreamProgress?: OnStreamProgress;
}

export interface TokenUsageSummary {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface ChapterPipelineResult {
  readonly chapterNumber: number;
  readonly title: string;
  readonly wordCount: number;
  readonly auditResult: AuditResult;
  readonly revised: boolean;
  readonly status: "ready-for-review" | "audit-failed" | "audit-skipped";
  readonly tokenUsage?: TokenUsageSummary;
}

// Atomic operation results
export interface DraftResult {
  readonly chapterNumber: number;
  readonly title: string;
  readonly wordCount: number;
  readonly filePath: string;
  readonly tokenUsage?: TokenUsageSummary;
}

export interface ReviseResult {
  readonly chapterNumber: number;
  readonly wordCount: number;
  readonly fixedIssues: ReadonlyArray<string>;
}

export interface TruthFiles {
  readonly currentState: string;
  readonly particleLedger: string;
  readonly pendingHooks: string;
  readonly storyBible: string;
  readonly volumeOutline: string;
  readonly bookRules: string;
}

export interface BookStatusInfo {
  readonly bookId: string;
  readonly title: string;
  readonly genre: string;
  readonly platform: string;
  readonly status: string;
  readonly chaptersWritten: number;
  readonly totalWords: number;
  readonly nextChapter: number;
  readonly chapters: ReadonlyArray<ChapterMeta>;
}

export interface ImportChaptersInput {
  readonly bookId: string;
  readonly chapters: ReadonlyArray<{ readonly title: string; readonly content: string }>;
  readonly resumeFrom?: number;
}

export interface ImportChaptersResult {
  readonly bookId: string;
  readonly importedCount: number;
  readonly totalWords: number;
  readonly nextChapter: number;
}

export class PipelineRunner {
  private readonly state: StateManager;
  private readonly config: PipelineConfig;
  private readonly pctx: PipelineContext;
  private readonly importPipeline: ImportPipeline;

  constructor(config: PipelineConfig) {
    // Fail-fast: validar configuración crítica antes de cualquier llamada
    if (!config.model) {
      throw new Error("PipelineConfig.model is required — specify an LLM model name");
    }
    if (!config.projectRoot) {
      throw new Error("PipelineConfig.projectRoot is required — specify the project directory");
    }
    if (!config.client) {
      throw new Error("PipelineConfig.client is required — provide an LLM client instance");
    }

    this.config = config;
    this.state = new StateManager(config.projectRoot);
    this.pctx = new PipelineContext(config);
    this.importPipeline = new ImportPipeline(config);
  }

  private agentCtxFor(agent: string, bookId?: string): AgentContext {
    return this.pctx.agentCtxFor(agent, bookId);
  }

  private async loadGenreProfile(genre: string): Promise<{ profile: GenreProfile }> {
    const parsed = await readGenreProfile(this.config.projectRoot, genre);
    return { profile: parsed.profile };
  }

  // ---------------------------------------------------------------------------
  // Atomic operations (composable by OpenClaw or agent mode)
  // ---------------------------------------------------------------------------

  async runRadar(): Promise<RadarResult> {
    const radar = new RadarAgent(this.agentCtxFor("radar"), this.config.radarSources);
    return radar.scan();
  }

  async initBook(book: BookConfig): Promise<void> {
    const architect = new ArchitectAgent(this.agentCtxFor("architect", book.id));
    const bookDir = this.state.bookDir(book.id);

    await this.state.saveBookConfig(book.id, book);

    const { profile: gp } = await this.loadGenreProfile(book.genre);
    const foundation = await architect.generateFoundation(book, this.config.externalContext);
    await architect.writeFoundationFiles(bookDir, foundation, gp.numericalSystem);

    // Ensure chapters directory exists (prevents ENOENT if init was previously interrupted)
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await this.state.saveChapterIndex(book.id, []);

    // Snapshot initial state so rewrite of chapter 1 can restore to pre-chapter state
    await this.state.snapshotState(book.id, 0);
  }

  /** Write a single draft chapter. Saves chapter file + truth files + index + snapshot.
   *  Defaults to the Layered 6-step pipeline. Pass `useLegacy: true` to use pre-v1.6 path. */
  async writeDraft(bookId: string, context?: string, wordCount?: number, useLegacy = false): Promise<DraftResult> {
    if (!useLegacy) {
      // Layered path: run full pipeline, return only draft-relevant fields
      const releaseLock = await this.state.acquireBookLock(bookId);
      try {
        const loadedBook = await this.state.loadBookConfig(bookId);
        const book = wordCount ? { ...loadedBook, chapterWordCount: wordCount } : loadedBook;

        // Inyectar contexto externo a través de la configuración del layered runner
        const layeredConfig = context
          ? { ...this.config, externalContext: context }
          : this.config;
        const layered = new LayeredPipelineRunner(layeredConfig);

        const chapterNumber = await this.state.getNextChapterNumber(bookId);
        const layeredResult = await layered.run(book, chapterNumber);

        // Build file path from chapter number + title
        const bookDir = this.state.bookDir(bookId);
        const chaptersDir = join(bookDir, 'chapters');
        const paddedNum = String(layeredResult.chapterNumber).padStart(4, '0');
        const sanitized = layeredResult.title.replace(/[/\\?%*:|"<>]/g, '').replace(/\s+/g, '_').slice(0, 50);
        const filePath = join(chaptersDir, `${paddedNum}_${sanitized}.md`);

        // Save chapter file
        await mkdir(chaptersDir, { recursive: true });
        await writeFile(filePath, `# 第${chapterNumber}章 ${layeredResult.title}\n\n${layeredResult.content}`, "utf-8");

        // Update chapter index
        const existingIndex = await this.state.loadChapterIndex(bookId);
        const now = new Date().toISOString();
        const newEntry: ChapterMeta = {
          number: chapterNumber,
          title: layeredResult.title,
          status: "drafted",
          wordCount: layeredResult.wordCount,
          createdAt: now,
          updatedAt: now,
          auditIssues: [],
          ...(layeredResult.telemetry ? { tokenUsage: PipelineRunner.telemetryToUsage(layeredResult.telemetry) } : {}),
        };
        await this.state.saveChapterIndex(bookId, [...existingIndex, newEntry]);

        // Snapshot
        await this.state.snapshotState(bookId, chapterNumber);

        await this.emitWebhook("chapter-complete", bookId, chapterNumber, {
          title: layeredResult.title,
          wordCount: layeredResult.wordCount,
        });

        return {
          chapterNumber: layeredResult.chapterNumber,
          title: layeredResult.title,
          wordCount: layeredResult.wordCount,
          filePath,
          tokenUsage: layeredResult.telemetry
            ? PipelineRunner.telemetryToUsage(layeredResult.telemetry)
            : undefined,
        };
      } finally {
        await releaseLock();
      }
    }

    // Legacy path
    this.config.logger?.info('Using legacy pipeline path (explicitly requested)');
    const releaseLock = await this.state.acquireBookLock(bookId);
    try {
      const book = await this.state.loadBookConfig(bookId);
      const bookDir = this.state.bookDir(bookId);
      const chapterNumber = await this.state.getNextChapterNumber(bookId);

      const { profile: gp } = await this.loadGenreProfile(book.genre);

      const writer = new WriterAgent(this.agentCtxFor("writer", bookId));
      const output = await writer.writeChapter({
        book,
        bookDir,
        chapterNumber,
        externalContext: context ?? this.config.externalContext,
        ...(wordCount ? { wordCountOverride: wordCount } : {}),
      });

      // Save chapter file
      const chaptersDir = join(bookDir, "chapters");
      const paddedNum = String(chapterNumber).padStart(4, "0");
      const sanitized = output.title.replace(/[/\\?%*:|"<>]/g, "").replace(/\s+/g, "_").slice(0, 50);
      const filename = `${paddedNum}_${sanitized}.md`;
      const filePath = join(chaptersDir, filename);

      await writeFile(filePath, `# 第${chapterNumber}章 ${output.title}\n\n${output.content}`, "utf-8");

      // Save truth files
      await writer.saveChapter(bookDir, output, gp.numericalSystem);
      await writer.saveNewTruthFiles(bookDir, output);

      // Update index
      const existingIndex = await this.state.loadChapterIndex(bookId);
      const now = new Date().toISOString();
      const newEntry: ChapterMeta = {
        number: chapterNumber,
        title: output.title,
        status: "drafted",
        wordCount: output.wordCount,
        createdAt: now,
        updatedAt: now,
        auditIssues: [],
        ...(output.tokenUsage ? { tokenUsage: output.tokenUsage } : {}),
      };
      await this.state.saveChapterIndex(bookId, [...existingIndex, newEntry]);

      // Snapshot
      await this.state.snapshotState(bookId, chapterNumber);

      await this.emitWebhook("chapter-complete", bookId, chapterNumber, {
        title: output.title,
        wordCount: output.wordCount,
      });

      return { chapterNumber, title: output.title, wordCount: output.wordCount, filePath, tokenUsage: output.tokenUsage };
    } finally {
      await releaseLock();
    }
  }

  /** Audit the latest (or specified) chapter. Read-only, no lock needed. */
  async auditDraft(bookId: string, chapterNumber?: number): Promise<AuditResult & { readonly chapterNumber: number }> {
    const book = await this.state.loadBookConfig(bookId);
    const bookDir = this.state.bookDir(bookId);
    const targetChapter = chapterNumber ?? (await this.state.getNextChapterNumber(bookId)) - 1;
    if (targetChapter < 1) {
      throw new Error(`No chapters to audit for "${bookId}"`);
    }

    const content = await this.readChapterContent(bookDir, targetChapter);
    const auditor = new ContinuityAuditor(this.agentCtxFor("auditor", bookId));
    const llmResult = await auditor.auditChapter(bookDir, content, targetChapter, book.genre);

    // Merge rule-based AI-tell detection
    const aiTells = analyzeAITells(content);
    // Merge sensitive word detection
    const sensitiveResult = analyzeSensitiveWords(content);
    const hasBlockedWords = sensitiveResult.found.some((f) => f.severity === "block");
    const mergedIssues: ReadonlyArray<AuditIssue> = [
      ...llmResult.issues,
      ...aiTells.issues,
      ...sensitiveResult.issues,
    ];
    const result: AuditResult = {
      passed: hasBlockedWords ? false : llmResult.passed,
      issues: mergedIssues,
      summary: llmResult.summary,
    };

    // Update index with audit result
    const index = await this.state.loadChapterIndex(bookId);
    const updated = index.map((ch) =>
      ch.number === targetChapter
        ? {
            ...ch,
            status: (result.passed ? "ready-for-review" : "audit-failed") as ChapterMeta["status"],
            updatedAt: new Date().toISOString(),
            auditIssues: result.issues.map((i) => `[${i.severity}] ${i.description}`),
          }
        : ch,
    );
    await this.state.saveChapterIndex(bookId, updated);

    await this.emitWebhook(
      result.passed ? "audit-passed" : "audit-failed",
      bookId,
      targetChapter,
      { summary: result.summary, issueCount: result.issues.length },
    );

    return { ...result, chapterNumber: targetChapter };
  }

  /** Revise the latest (or specified) chapter based on audit issues. */
  async reviseDraft(bookId: string, chapterNumber?: number, mode: ReviseMode = "rewrite", extraContext?: string): Promise<ReviseResult> {
    const releaseLock = await this.state.acquireBookLock(bookId);
    try {
      const book = await this.state.loadBookConfig(bookId);
      const bookDir = this.state.bookDir(bookId);
      const targetChapter = chapterNumber ?? (await this.state.getNextChapterNumber(bookId)) - 1;
      if (targetChapter < 1) {
        throw new Error(`No chapters to revise for "${bookId}"`);
      }

      // Read the current audit issues from index
      const index = await this.state.loadChapterIndex(bookId);
      const chapterMeta = index.find((ch) => ch.number === targetChapter);
      if (!chapterMeta) {
        throw new Error(`Chapter ${targetChapter} not found in index`);
      }

      // Re-audit to get structured issues (index only stores strings)
      const content = await this.readChapterContent(bookDir, targetChapter);
      const auditor = new ContinuityAuditor(this.agentCtxFor("auditor", bookId));
      const auditResult = await auditor.auditChapter(bookDir, content, targetChapter, book.genre);

      if (auditResult.passed && auditResult.issues.filter(i => i.severity === "warning" || i.severity === "critical").length === 0) {
        return { chapterNumber: targetChapter, wordCount: content.length, fixedIssues: [] };
      }

      const { profile: gp } = await this.loadGenreProfile(book.genre);

      const reviser = new ReviserAgent(this.agentCtxFor("reviser", bookId));
      const reviseOutput = await reviser.reviseChapter(
        bookDir, content, targetChapter, auditResult.issues, mode, book.genre, extraContext,
      );

      if (reviseOutput.revisedContent.length === 0) {
        throw new Error("Reviser returned empty content");
      }

      // Save revised chapter file
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(targetChapter).padStart(4, "0");
      const existingFile = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!existingFile) {
        throw new Error(`Chapter ${targetChapter} file not found in ${chaptersDir} (expected filename starting with ${paddedNum})`);
      }
      await writeFile(
        join(chaptersDir, existingFile),
        `# 第${targetChapter}章 ${chapterMeta.title}\n\n${reviseOutput.revisedContent}`,
        "utf-8",
      );

      // Update truth files
      const storyDir = join(bookDir, "story");
      if (reviseOutput.updatedState !== "(状态卡未更新)") {
        await writeFile(join(storyDir, "current_state.md"), reviseOutput.updatedState, "utf-8");
      }
      if (gp.numericalSystem && reviseOutput.updatedLedger && reviseOutput.updatedLedger !== "(账本未更新)") {
        await writeFile(join(storyDir, "particle_ledger.md"), reviseOutput.updatedLedger, "utf-8");
      }
      if (reviseOutput.updatedHooks !== "(伏笔池未更新)") {
        await writeFile(join(storyDir, "pending_hooks.md"), reviseOutput.updatedHooks, "utf-8");
      }

      // Update index
      const updatedIndex = index.map((ch) =>
        ch.number === targetChapter
          ? {
              ...ch,
              status: "ready-for-review" as ChapterMeta["status"],
              wordCount: reviseOutput.wordCount,
              updatedAt: new Date().toISOString(),
            }
          : ch,
      );
      await this.state.saveChapterIndex(bookId, updatedIndex);

      // Re-snapshot
      await this.state.snapshotState(bookId, targetChapter);

      await this.emitWebhook("revision-complete", bookId, targetChapter, {
        wordCount: reviseOutput.wordCount,
        fixedCount: reviseOutput.fixedIssues.length,
      });

      return {
        chapterNumber: targetChapter,
        wordCount: reviseOutput.wordCount,
        fixedIssues: reviseOutput.fixedIssues,
      };
    } finally {
      await releaseLock();
    }
  }

  /** Read all truth files for a book. */
  async readTruthFiles(bookId: string): Promise<TruthFiles> {
    const bookDir = this.state.bookDir(bookId);
    const storyDir = join(bookDir, "story");

    const [currentState, particleLedger, pendingHooks, storyBible, volumeOutline, bookRules] =
      await Promise.all([
        readFileSafe(join(storyDir, "current_state.md")),
        readFileSafe(join(storyDir, "particle_ledger.md")),
        readFileSafe(join(storyDir, "pending_hooks.md")),
        readFileSafe(join(storyDir, "story_bible.md")),
        readFileSafe(join(storyDir, "volume_outline.md")),
        readFileSafe(join(storyDir, "book_rules.md")),
      ]);

    return { currentState, particleLedger, pendingHooks, storyBible, volumeOutline, bookRules };
  }

  /** Get book status overview. */
  async getBookStatus(bookId: string): Promise<BookStatusInfo> {
    const book = await this.state.loadBookConfig(bookId);
    const chapters = await this.state.loadChapterIndex(bookId);
    const nextChapter = await this.state.getNextChapterNumber(bookId);
    const totalWords = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);

    return {
      bookId,
      title: book.title,
      genre: book.genre,
      platform: book.platform,
      status: book.status,
      chaptersWritten: chapters.length,
      totalWords,
      nextChapter,
      chapters: [...chapters],
    };
  }

  // ---------------------------------------------------------------------------
  // Full pipeline (convenience — runs draft + audit + revise in one shot)
  // ---------------------------------------------------------------------------

  /**
   * Full pipeline: write + audit + revise.
   * Defaults to the Layered 6-step pipeline (S0→S5).
   * Pass `useLegacy: true` to fall back to the pre-v1.6 single-agent path.
   */
  async writeNextChapter(bookId: string, wordCount?: number, temperatureOverride?: number, useLegacy = false): Promise<ChapterPipelineResult> {
    if (useLegacy) {
      this.config.logger?.info('Using legacy pipeline path (explicitly requested)');
      const releaseLock = await this.state.acquireBookLock(bookId);
      try {
        return await this._writeNextChapterLocked(bookId, wordCount, temperatureOverride);
      } finally {
        await releaseLock();
      }
    }

    // Default: Layered pipeline
    const releaseLock = await this.state.acquireBookLock(bookId);
    try {
      const loadedBook = await this.state.loadBookConfig(bookId);
      const book = wordCount ? { ...loadedBook, chapterWordCount: wordCount } : loadedBook;

      const chapterNumber = await this.state.getNextChapterNumber(bookId);
      const layeredResult = await this.runLayeredChapter(book, chapterNumber);

      // Adapt LayeredChapterResult → ChapterPipelineResult
      const auditResult: AuditResult = {
        passed: layeredResult.postWriteErrors.length === 0,
        issues: [
          ...layeredResult.postWriteErrors.map((e: PostWriteViolation) => ({ severity: 'critical' as const, category: e.rule, description: e.description, suggestion: e.suggestion })),
          ...layeredResult.postWriteWarnings.map((w: PostWriteViolation) => ({ severity: 'warning' as const, category: w.rule, description: w.description, suggestion: w.suggestion })),
        ],
        summary: layeredResult.postWriteErrors.length === 0 ? 'All checks passed.' : `${layeredResult.postWriteErrors.length} errors found.`,
      };

      return {
        chapterNumber: layeredResult.chapterNumber,
        title: layeredResult.title,
        wordCount: layeredResult.wordCount,
        auditResult,
        revised: layeredResult.correctionApplied,
        status: auditResult.passed ? 'ready-for-review' : 'audit-failed',
        tokenUsage: layeredResult.telemetry
          ? PipelineRunner.telemetryToUsage(layeredResult.telemetry)
          : undefined,
      };
    } finally {
      await releaseLock();
    }
  }

  /** @deprecated Internal method of the legacy pipeline. */
  private async _writeNextChapterLocked(bookId: string, wordCount?: number, temperatureOverride?: number): Promise<ChapterPipelineResult> {
    const book = await this.state.loadBookConfig(bookId);
    const bookDir = this.state.bookDir(bookId);
    const chapterNumber = await this.state.getNextChapterNumber(bookId);
    const { profile: gp } = await this.loadGenreProfile(book.genre);

    // 1. Write chapter
    const writer = new WriterAgent(this.agentCtxFor("writer", bookId));
    const output = await writer.writeChapter({
      book,
      bookDir,
      chapterNumber,
      externalContext: this.config.externalContext,
      ...(wordCount ? { wordCountOverride: wordCount } : {}),
      ...(temperatureOverride ? { temperatureOverride } : {}),
    });

    // Token usage accumulator
    let totalUsage: TokenUsageSummary = output.tokenUsage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    // 2a. Post-write error gate: if deterministic rules found errors, auto-fix before LLM audit
    let finalContent = output.content;
    let finalWordCount = output.wordCount;
    let revised = false;

    if (output.postWriteErrors.length > 0) {
      try {
        this.config.logger?.warn(
          `${output.postWriteErrors.length} post-write errors detected, triggering spot-fix before audit`,
        );
        const reviser = new ReviserAgent(this.agentCtxFor("reviser", bookId));
        const spotFixIssues = output.postWriteErrors.map((v) => ({
          severity: "critical" as const,
          category: v.rule,
          description: v.description,
          suggestion: v.suggestion,
        }));
        const fixResult = await reviser.reviseChapter(
          bookDir,
          finalContent,
          chapterNumber,
          spotFixIssues,
          "spot-fix",
          book.genre,
        );
        totalUsage = PipelineRunner.addUsage(totalUsage, fixResult.tokenUsage);
        if (fixResult.revisedContent.length > 0) {
          finalContent = fixResult.revisedContent;
          finalWordCount = fixResult.wordCount;
          revised = true;
        }
      } catch (spotFixError) {
        // Spot-fix falló — continuar con el contenido original
        this.config.logger?.warn(
          `Spot-fix failed for ${bookId} ch${chapterNumber}, proceeding with original: ${String(spotFixError).slice(0, 120)}`,
        );
      }
    }

    // 2b. LLM audit — aislado para que un fallo del auditor no pierda el borrador
    let auditResult: AuditResult = {
      passed: true,
      issues: [],
      summary: "(审计被跳过：审计Agent出错)",
    };
    let auditSkipped = false;

    try {
      const auditor = new ContinuityAuditor(this.agentCtxFor("auditor", bookId));
      const llmAudit = await auditor.auditChapter(
        bookDir,
        finalContent,
        chapterNumber,
        book.genre,
      );
      totalUsage = PipelineRunner.addUsage(totalUsage, llmAudit.tokenUsage);
      const aiTellsResult = analyzeAITells(finalContent);
      const sensitiveWriteResult = analyzeSensitiveWords(finalContent);
      const hasBlockedWriteWords = sensitiveWriteResult.found.some((f) => f.severity === "block");
      auditResult = {
        passed: hasBlockedWriteWords ? false : llmAudit.passed,
        issues: [...llmAudit.issues, ...aiTellsResult.issues, ...sensitiveWriteResult.issues],
        summary: llmAudit.summary,
      };

      // 3. If audit fails, try auto-revise once
      if (!auditResult.passed) {
        const criticalIssues = auditResult.issues.filter(
          (i) => i.severity === "critical",
        );
        if (criticalIssues.length > 0) {
          try {
            const reviser = new ReviserAgent(this.agentCtxFor("reviser", bookId));
            const reviseOutput = await reviser.reviseChapter(
              bookDir,
              output.content,
              chapterNumber,
              auditResult.issues,
              "spot-fix",
              book.genre,
            );
            totalUsage = PipelineRunner.addUsage(totalUsage, reviseOutput.tokenUsage);

            if (reviseOutput.revisedContent.length > 0) {
              // Guard: reject revision if AI markers increased
              const preMarkers = analyzeAITells(output.content);
              const postMarkers = analyzeAITells(reviseOutput.revisedContent);
              const preCount = preMarkers.issues.length;
              const postCount = postMarkers.issues.length;

              if (postCount > preCount) {
                // Revision made text MORE AI-like — discard it, keep original
              } else {
                finalContent = reviseOutput.revisedContent;
                finalWordCount = reviseOutput.wordCount;
                revised = true;
              }

              // Re-audit the (possibly revised) content
              const reAudit = await auditor.auditChapter(
                bookDir,
                finalContent,
                chapterNumber,
                book.genre,
                { temperature: 0 },
              );
              totalUsage = PipelineRunner.addUsage(totalUsage, reAudit.tokenUsage);
              const reAITells = analyzeAITells(finalContent);
              const reSensitive = analyzeSensitiveWords(finalContent);
              const reHasBlocked = reSensitive.found.some((f) => f.severity === "block");
              auditResult = {
                passed: reHasBlocked ? false : reAudit.passed,
                issues: [...reAudit.issues, ...reAITells.issues, ...reSensitive.issues],
                summary: reAudit.summary,
              };

              // Update state files from revision
              const storyDir = join(bookDir, "story");
              if (reviseOutput.updatedState !== "(状态卡未更新)") {
                await writeFile(join(storyDir, "current_state.md"), reviseOutput.updatedState, "utf-8");
              }
              if (gp.numericalSystem && reviseOutput.updatedLedger && reviseOutput.updatedLedger !== "(账本未更新)") {
                await writeFile(join(storyDir, "particle_ledger.md"), reviseOutput.updatedLedger, "utf-8");
              }
              if (reviseOutput.updatedHooks !== "(伏笔池未更新)") {
                await writeFile(join(storyDir, "pending_hooks.md"), reviseOutput.updatedHooks, "utf-8");
              }
            }
          } catch (reviseError) {
            // 修订失败 — 保留审计失败状态，但不丢失草稿
            this.config.logger?.warn(
              `Auto-revise failed for ${bookId} ch${chapterNumber}: ${String(reviseError).slice(0, 120)}`,
            );
          }
        }
      }
    } catch (auditError) {
      // 审计完全失败 — 章节仍然保存为 audit-skipped
      auditSkipped = true;
      this.config.logger?.error(
        `Audit failed for ${bookId} ch${chapterNumber}, saving draft as audit-skipped: ${String(auditError).slice(0, 120)}`,
      );
    }

    // 4. Save chapter (original or revised)
    const chaptersDir = join(bookDir, "chapters");
    const paddedNum = String(chapterNumber).padStart(4, "0");
    const title = output.title;
    const filename = `${paddedNum}_${title.replace(/[/\\?%*:|"<>]/g, "").replace(/\s+/g, "_").slice(0, 50)}.md`;

    const chapterHeading = book.language === "en"
      ? `# Chapter ${chapterNumber}: ${title}`
      : `# 第${chapterNumber}章 ${title}`;

    await writeFile(
      join(chaptersDir, filename),
      `${chapterHeading}\n\n${finalContent}`,
      "utf-8",
    );

    // Save original state files if not revised
    if (!revised) {
      await writer.saveChapter(bookDir, output, gp.numericalSystem);
    }

    // Save new truth files (summaries, subplots, emotional arcs, character matrix)
    await writer.saveNewTruthFiles(bookDir, output);

    // 5. Update chapter index
    const existingIndex = await this.state.loadChapterIndex(bookId);
    const now = new Date().toISOString();
    const newEntry: ChapterMeta = {
      number: chapterNumber,
      title: output.title,
      status: auditSkipped ? "audit-skipped" : (auditResult.passed ? "ready-for-review" : "audit-failed"),
      wordCount: finalWordCount,
      createdAt: now,
      updatedAt: now,
      auditIssues: auditResult.issues.map(
        (i) => `[${i.severity}] ${i.description}`,
      ),
      tokenUsage: totalUsage,
    };
    await this.state.saveChapterIndex(bookId, [...existingIndex, newEntry]);

    // 5.5 Audit drift correction — feed audit findings back into state
    // Prevents the Writer from repeating mistakes in the next chapter
    const driftIssues = auditResult.issues.filter(
      (i) => i.severity === "critical" || i.severity === "warning",
    );
    if (driftIssues.length > 0) {
      const storyDir = join(bookDir, "story");
      try {
        const statePath = join(storyDir, "current_state.md");
        const currentState = await readFile(statePath, "utf-8").catch(() => "");

        // Append drift correction section (or replace existing one)
        const correctionHeader = "## 审计纠偏（自动生成，下一章写作前参照）";
        const correctionBlock = [
          correctionHeader,
          `> 第${chapterNumber}章审计发现以下问题，下一章写作时必须避免：`,
          ...driftIssues.map((i) => `> - [${i.severity}] ${i.category}: ${i.description}`),
          "",
        ].join("\n");

        // Replace existing correction block or append
        const existingCorrectionIdx = currentState.indexOf(correctionHeader);
        const updatedState = existingCorrectionIdx >= 0
          ? currentState.slice(0, existingCorrectionIdx) + correctionBlock
          : currentState + "\n\n" + correctionBlock;

        await writeFile(statePath, updatedState, "utf-8");
      } catch {
        // Non-critical — don't block pipeline if drift correction fails
      }
    }

    // 5.6 Snapshot state for rollback support
    await this.state.snapshotState(bookId, chapterNumber);

    // 6. Send notification
    if (this.config.notifyChannels && this.config.notifyChannels.length > 0) {
      const statusEmoji = auditResult.passed ? "✅" : "⚠️";
      await dispatchNotification(this.config.notifyChannels, {
        title: `${statusEmoji} ${book.title} 第${chapterNumber}章`,
        body: [
          `**${output.title}** | ${finalWordCount}字`,
          revised ? "📝 已自动修正" : "",
          `审稿: ${auditResult.passed ? "通过" : "需人工审核"}`,
          ...auditResult.issues
            .filter((i) => i.severity !== "info")
            .map((i) => `- [${i.severity}] ${i.description}`),
        ]
          .filter(Boolean)
          .join("\n"),
      }, this.config.logger);
    }

    await this.emitWebhook("pipeline-complete", bookId, chapterNumber, {
      title: output.title,
      wordCount: finalWordCount,
      passed: auditResult.passed,
      revised,
    });

    return {
      chapterNumber,
      title: output.title,
      wordCount: finalWordCount,
      auditResult,
      revised,
      status: auditResult.passed ? "ready-for-review" : "audit-failed",
      tokenUsage: totalUsage,
    };
  }

  // ---------------------------------------------------------------------------
  // Import operations (delegated to ImportPipeline)
  // ---------------------------------------------------------------------------

  /**
   * Generate a qualitative style guide from reference text via LLM.
   * Also saves the statistical style_profile.json.
   */
  async generateStyleGuide(bookId: string, referenceText: string, sourceName?: string): Promise<string> {
    return this.importPipeline.generateStyleGuide(bookId, referenceText, sourceName);
  }

  /**
   * Import canon from parent book for spinoff writing.
   * Reads parent's truth files, uses LLM to generate parent_canon.md in target book.
   */
  async importCanon(targetBookId: string, parentBookId: string): Promise<string> {
    return this.importPipeline.importCanon(targetBookId, parentBookId);
  }

  /**
   * Import existing chapters into a book. Reverse-engineers all truth files
   * via sequential replay so the Writer and Auditor can continue naturally.
   */
  async importChapters(input: ImportChaptersInput): Promise<ImportChaptersResult> {
    return this.importPipeline.importChapters(input);
  }

  /**
   * Import fanfic canon from parent book. Uses LLM to parse parent's truth files
   * into a structured fanfic_canon.md for the target book.
   */
  async importFanficCanon(
    targetBookId: string,
    parentBookId: string,
    fanficMode: "canon" | "au" | "ooc" | "cp" = "canon",
  ): Promise<string> {
    const { FanficCanonImporter } = await import("../agents/fanfic-canon-importer.js");

    const targetBookDir = this.state.bookDir(targetBookId);
    const parentBookDir = this.state.bookDir(parentBookId);

    const agentCtx: AgentContext = {
      projectRoot: this.config.projectRoot,
      client: this.config.client,
      model: this.config.model,
      logger: this.config.logger,
    };

    const importer = new FanficCanonImporter(agentCtx);
    return importer.importCanon(targetBookDir, parentBookDir, fanficMode);
  }

  /**
   * Show the current fanfic_canon.md for a book, if it exists.
   */
  async showFanficCanon(bookId: string): Promise<string | null> {
    const bookDir = this.state.bookDir(bookId);
    try {
      return await readFile(join(bookDir, "story", "fanfic_canon.md"), "utf-8");
    } catch {
      return null;
    }
  }

  private static addUsage(
    a: TokenUsageSummary,
    b?: { readonly promptTokens: number; readonly completionTokens: number; readonly totalTokens: number },
  ): TokenUsageSummary {
    if (!b) return a;
    return {
      promptTokens: a.promptTokens + b.promptTokens,
      completionTokens: a.completionTokens + b.completionTokens,
      totalTokens: a.totalTokens + b.totalTokens,
    };
  }

  /** Convierte ChapterTelemetry.agentTokens[] en un TokenUsageSummary plano. */
  private static telemetryToUsage(t: { readonly agentTokens: ReadonlyArray<{ readonly promptTokens: number; readonly completionTokens: number; readonly totalTokens: number }> }): TokenUsageSummary {
    let prompt = 0, completion = 0, total = 0;
    for (const rec of t.agentTokens) {
      prompt += rec.promptTokens;
      completion += rec.completionTokens;
      total += rec.totalTokens;
    }
    return { promptTokens: prompt, completionTokens: completion, totalTokens: total };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async emitWebhook(
    event: WebhookEvent,
    bookId: string,
    chapterNumber?: number,
    data?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.config.notifyChannels || this.config.notifyChannels.length === 0) return;
    await dispatchWebhookEvent(this.config.notifyChannels, {
      event,
      bookId,
      chapterNumber,
      timestamp: new Date().toISOString(),
      data,
    }, this.config.logger);
  }

  private async readChapterContent(bookDir: string, chapterNumber: number): Promise<string> {
    const chaptersDir = join(bookDir, "chapters");
    const files = await readdir(chaptersDir);
    const paddedNum = String(chapterNumber).padStart(4, "0");
    const chapterFile = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
    if (!chapterFile) {
      throw new Error(`Chapter ${chapterNumber} file not found in ${chaptersDir}`);
    }
    const raw = await readFile(join(chaptersDir, chapterFile), "utf-8");
    // Strip the title line
    const lines = raw.split("\n");
    const contentStart = lines.findIndex((l, i) => i > 0 && l.trim().length > 0);
    return contentStart >= 0 ? lines.slice(contentStart).join("\n") : raw;
  }

  // ===========================
  // Layered Pipeline: delegates to LayeredPipelineRunner (R1)
  // ===========================

  /**
   * Ejecuta el pipeline de seis pasos para un capitulo.
   * Delegado a LayeredPipelineRunner para mantener runner.ts enfocado.
   */
  async runLayeredChapter(
    book: BookConfig,
    chapterNumber: number,
  ): Promise<LayeredChapterResult> {
    const layered = new LayeredPipelineRunner(this.config);
    return layered.run(book, chapterNumber);
  }
}

// [R1] Re-export del modulo extraido para compatibilidad
export type { LayeredChapterResult };
