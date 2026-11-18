import { Command } from "commander";
import {
  PipelineRunner,
  StateManager,
  createWriteChaptersTool,
  executeExplicitCapabilityTool,
  type Observation,
} from "@actalk/inkos-core";
import { loadConfig, buildPipelineConfig, findProjectRoot, resolveBookId, log, logError, resolveCliProfileSkills } from "../utils.js";
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
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, {
        quiet: opts.quiet,
      }));
      const activatedSkills = await resolveCliProfileSkills(root, "longform-novel");

      if (!opts.json) log(formatAutoWriteStart(language, bookId, startChapter, targetChapter));

      const wordCount = opts.words ? parseInt(opts.words, 10) : undefined;

      const count = targetChapter - startChapter + 1;
      if (!opts.json) log(formatWriteNextProgress(language, startChapter, targetChapter, bookId));
      const action = await executeExplicitCapabilityTool({
        projectRoot: root,
        binding: { capabilityId: "longform", actionId: "write_chapters", profileId: "longform-novel", risk: "recoverable-write" },
        tool: createWriteChaptersTool(pipeline, bookId, { activeSkills: () => activatedSkills }),
        workId: bookId,
        parameters: {
          instruction: `Write consecutive chapters through chapter ${targetChapter}.`,
          bookId,
          startChapterNumber: startChapter,
          chapterCount: count,
          ...(wordCount ? { chapterWordCount: wordCount } : {}),
        },
      });
      const results = [...((action.data as {
        readonly chapters?: ReadonlyArray<{
          readonly chapterNumber: number;
          readonly title: string;
          readonly wordCount: number;
          readonly observations: ReadonlyArray<Observation>;
        }>;
      } | undefined)?.chapters ?? [])];

      if (!opts.json) {
        for (const result of results) {
          for (const line of formatWriteNextResultLines(language, result)) log(line);
          log("");
        }
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
            observationCount: r.observations.length,
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
