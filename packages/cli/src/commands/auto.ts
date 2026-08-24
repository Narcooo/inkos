import { Command } from "commander";
import {
  PipelineRunner,
  StateManager,
  claimAutonomousJob,
  createAutonomousPipelineActions,
  createAutonomousProviderExecution,
  deriveAutonomousJobIdentity,
  loadBookProductionMap,
  loadAutonomousProductionState,
  refreshAutonomousJobClaim,
  releaseAutonomousJob,
  resolveProductionScope,
  runBoundedAutonomousScope,
  saveAutonomousProductionState,
  startAutonomousJobHeartbeat,
} from "@actalk/inkos-core";
import { loadConfig, buildPipelineConfig, findProjectRoot, getLegacyMigrationHint, resolveBookId, log, logError } from "../utils.js";
import {
  formatAutoWriteAlreadyComplete,
  formatAutoWriteStart,
  formatNotifyBatchWriteBody,
  formatNotifyCommandTitle,
  formatNotifyFailureBody,
  formatWriteNextComplete,
  formatWriteNextProgress,
  formatWriteNextResultLines,
  resolveCliLanguage,
  type CliLanguage,
} from "../localization.js";
import { sendCommandNotification } from "../notify-helper.js";

export const autoCommand = new Command("auto")
  .description("Auto-write chapters until the book reaches a target chapter number: auto [book-id] <target-chapter>")
  .argument("<args...>", "Book ID (optional, auto-detected if only one book) and target chapter number")
  .option("--words <n>", "Words per chapter (overrides book config)")
  .option("--json", "Output JSON")
  .option("-q, --quiet", "Suppress console output")
  .option("--notify", "Send a notification to configured notify channels when the command finishes")
  .action(async (args: ReadonlyArray<string>, opts) => {
    let notifyLanguage: CliLanguage = "zh";
    let notifyBookName: string | undefined;
    try {
      const root = findProjectRoot();

      let bookId: string;
      let targetChapter: number;
      if (args.length === 1) {
        targetChapter = parseInt(args[0]!, 10);
        if (isNaN(targetChapter)) throw new Error(`Expected target chapter number, got "${args[0]}"`);
        bookId = await resolveBookId(undefined, root);
      } else if (args.length === 2) {
        targetChapter = parseInt(args[1]!, 10);
        if (isNaN(targetChapter)) throw new Error(`Expected target chapter number, got "${args[1]}"`);
        bookId = await resolveBookId(args[0], root);
      } else {
        throw new Error("Usage: inkos auto [book-id] <target-chapter>");
      }
      if (targetChapter < 1) {
        throw new Error(`Target chapter must be >= 1, got ${targetChapter}`);
      }

      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      const language = resolveCliLanguage(book.language);
      notifyLanguage = language;
      notifyBookName = book.title ?? bookId;
      const migrationHint = await getLegacyMigrationHint(root, bookId);
      if (migrationHint && !opts.json) {
        log(`[migration] ${migrationHint}`);
      }

      const startChapter = await state.getNextChapterNumber(bookId);
      if (startChapter > targetChapter) {
        if (opts.json) {
          log(JSON.stringify([], null, 2));
        } else {
          log(formatAutoWriteAlreadyComplete(language, bookId, startChapter - 1, targetChapter));
        }
        return;
      }

      const config = await loadConfig();
      // `inkos auto` is unattended batch writing, so the audit→revise loop must
      // run inline: force "auto" regardless of book/project reviewMode settings.
      let activeStage = {
        stage: "PREPARING",
        role: "writer",
        provider: null as string | null,
        model: null as string | null,
      };
      const pipeline = new PipelineRunner({
        ...buildPipelineConfig(config, root, {
          quiet: opts.quiet,
          chapterReviewMode: "auto",
        }),
        boundedAutonomousReview: true,
        onAutonomousStage: (event) => { activeStage = event; },
      });

      if (!opts.json) log(formatAutoWriteStart(language, bookId, startChapter, targetChapter));

      const wordCount = opts.words ? parseInt(opts.words, 10) : undefined;
      const productionMap = await loadBookProductionMap(root, bookId);
      if (!productionMap) throw new Error("BLOCKED_BOOK_PRODUCTION_MAP_MISSING");
      const dynamicScope = resolveProductionScope(productionMap, startChapter, "current-volume");
      if (targetChapter !== dynamicScope.targetChapter) {
        throw new Error(`AUTONOMOUS_TARGET_MUST_MATCH_CURRENT_VOLUME: expected ${dynamicScope.targetChapter}`);
      }
      const jobId = deriveAutonomousJobIdentity({ map: productionMap, mode: "current-volume", nextChapter: startChapter });
      const providerRecovery = createAutonomousProviderExecution({
        projectRoot: root,
        bookId,
        jobId,
        getActiveStage: () => activeStage,
      });
      const persisted = await loadAutonomousProductionState<{ readonly jobId?: string; readonly status?: string }>(root, bookId);
      if (persisted?.jobId === jobId && (persisted.status === "REVIEW_EXHAUSTED" || persisted.status === "HELD_AFTER_TWO_REVISIONS")) {
        throw new Error("REVISION_LIMIT_REACHED");
      }
      const actions = await createAutonomousPipelineActions({ bookId, state, pipeline });
      const results: Awaited<ReturnType<typeof pipeline.writeNextChapter>>[] = [];
      const claim = await claimAutonomousJob({ projectRoot: root, bookId, jobId });
      let claimFailure: unknown;
      const stopHeartbeat = startAutonomousJobHeartbeat(root, bookId, claim, (error) => { claimFailure = error; });
      let progress;
      try {
        progress = await runBoundedAutonomousScope({
          map: productionMap,
          mode: "current-volume",
          getNextChapter: () => state.getNextChapterNumber(bookId),
          ...(actions.pendingChapterNumber !== undefined ? { pendingChapterNumber: actions.pendingChapterNumber } : {}),
          shouldStop: () => false,
          ...(actions.resumePendingChapter ? { resumePendingChapter: actions.resumePendingChapter } : {}),
          runChapter: async () => {
            if (claimFailure) throw claimFailure;
            const chapter = startChapter + results.length;
            if (!opts.json) log(formatWriteNextProgress(language, chapter, dynamicScope.targetChapter, bookId));
            let result;
            try {
              result = await actions.runChapter(wordCount);
            } catch (error) {
              throw new Error(
                `Chapter ${chapter} failed, stopping auto-write (${results.length} chapter(s) completed this run): ${error instanceof Error ? error.message : String(error)}`,
                { cause: error },
              );
            }
            if (claimFailure) throw claimFailure;
            results.push(result as Awaited<ReturnType<typeof pipeline.writeNextChapter>>);
            if (!opts.json) {
              for (const line of formatWriteNextResultLines(language, {
                chapterNumber: result.chapterNumber,
                title: result.title,
                wordCount: result.wordCount,
                auditPassed: result.auditResult.passed,
                revised: result.revised,
                status: result.status,
                issues: result.auditResult.issues,
              })) log(line);
              log("");
            }
            return result;
          },
          persistProgress: async (value) => {
            if (claimFailure) throw claimFailure;
            await refreshAutonomousJobClaim(root, bookId, claim);
            const current = await loadAutonomousProductionState<Record<string, unknown>>(root, bookId);
            await saveAutonomousProductionState(root, bookId, { ...(current ?? {}), ...value });
          },
          providerRecovery,
        });
      } finally {
        stopHeartbeat();
        await releaseAutonomousJob(root, bookId, claim);
      }
      if (progress.status === "REVIEW_EXHAUSTED" || progress.status === "HELD_AFTER_TWO_REVISIONS") {
        throw new Error("REVISION_LIMIT_REACHED");
      }

      if (opts.json) {
        log(JSON.stringify(results, null, 2));
      } else {
        log(formatWriteNextComplete(language));
      }

      // The pipeline itself already sends one notification per completed
      // chapter whenever notify channels are configured (runner.ts, end of
      // writeNextChapter). A single-chapter run would therefore duplicate that
      // exact notification — only send a command-level batch summary when this
      // run wrote more than one chapter.
      if (opts.notify && results.length > 1) {
        await sendCommandNotification({
          title: formatNotifyCommandTitle(language, "auto", notifyBookName, true),
          body: formatNotifyBatchWriteBody(language, results.map((r) => ({
            chapterNumber: r.chapterNumber,
            title: r.title,
            wordCount: r.wordCount,
            auditPassed: r.auditResult.passed,
          }))),
        }, config);
      }
    } catch (e) {
      if (opts.notify) {
        await sendCommandNotification({
          title: formatNotifyCommandTitle(notifyLanguage, "auto", notifyBookName, false),
          body: formatNotifyFailureBody(notifyLanguage, e),
        });
      }
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Auto-write failed: ${e}`);
      }
      process.exit(1);
    }
  });
