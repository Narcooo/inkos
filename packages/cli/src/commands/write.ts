import { Command } from "commander";
import {
  PipelineRunner,
  StateManager,
  createResyncChapterStateTool,
  createWriteChaptersTool,
  executeExplicitCapabilityTool,
  type Observation,
} from "@actalk/inkos-core";
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { loadConfig, buildPipelineConfig, findProjectRoot, resolveContext, resolveBookId, log, logError, resolveCliProfileSkills } from "../utils.js";
import {
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

export const writeCommand = new Command("write")
  .description("Write chapters");

export function buildWriteNextParameters(input: {
  readonly bookId: string;
  readonly startChapterNumber: number;
  readonly chapterCount: number;
  readonly chapterWordCount?: number;
  readonly instruction?: string;
}) {
  return {
    instruction: input.instruction || "Write the requested consecutive chapters for the active Work.",
    bookId: input.bookId,
    startChapterNumber: input.startChapterNumber,
    chapterCount: input.chapterCount,
    ...(input.chapterWordCount ? { chapterWordCount: input.chapterWordCount } : {}),
  };
}

writeCommand
  .command("next")
  .description("Write the next chapter for a book")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--count <n>", "Number of chapters to write", "1")
  .option("--words <n>", "Words per chapter (overrides book config)")
  .option("--context <text>", "Creative guidance (natural language)")
  .option("--context-file <path>", "Read guidance from file")
  .option("--json", "Output JSON")
  .option("-q, --quiet", "Suppress console output")
  .option("--notify", "Send a notification to configured notify channels when the command finishes")
  .action(async (bookIdArg: string | undefined, opts) => {
    let notifyLanguage: CliLanguage = "zh";
    let notifyBookName: string | undefined;
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const context = await resolveContext(opts);
      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      const startChapterNumber = await state.getNextChapterNumber(bookId);
      const language = resolveCliLanguage(book.language);
      notifyLanguage = language;
      notifyBookName = book.title ?? bookId;
      const config = await loadConfig();

      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, {
        externalContext: context,
        quiet: opts.quiet,
      }));
      const activatedSkills = await resolveCliProfileSkills(root, "longform-novel");

      const count = parseInt(opts.count, 10);
      const wordCount = opts.words ? parseInt(opts.words, 10) : undefined;

      if (!opts.json) log(formatWriteNextProgress(language, 1, count, bookId));
      const action = await executeExplicitCapabilityTool({
        projectRoot: root,
        binding: { capabilityId: "longform", actionId: "write_chapters", profileId: "longform-novel", risk: "recoverable-write" },
        tool: createWriteChaptersTool(pipeline, bookId, { activeSkills: () => activatedSkills }),
        workId: bookId,
        parameters: buildWriteNextParameters({
          bookId,
          startChapterNumber,
          chapterCount: count,
          chapterWordCount: wordCount,
          instruction: context,
        }),
      });
      const actionData = action.data as {
        readonly chapters?: ReadonlyArray<{
          readonly chapterNumber: number;
          readonly title: string;
          readonly wordCount: number;
          readonly observations: ReadonlyArray<Observation>;
        }>;
      } | undefined;
      const results = [...(actionData?.chapters ?? [])];

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
          title: formatNotifyCommandTitle(language, "write-next", notifyBookName, true),
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
          title: formatNotifyCommandTitle(notifyLanguage, "write-next", notifyBookName, false),
          body: formatNotifyFailureBody(notifyLanguage, e),
        });
      }
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to write chapter: ${e}`);
      }
      process.exit(1);
    }
  });

writeCommand
  .command("rewrite")
  .description("Re-generate a specific chapter: rewrite [book-id] <chapter>")
  .argument("<args...>", "Book ID (optional) and chapter number")
  .option("--force", "Skip confirmation prompt")
  .option("--words <n>", "Words per chapter (overrides book config)")
  .option("--brief <text>", "One-off creative guidance for this rewrite only")
  .option("--json", "Output JSON")
  .option("--notify", "Send a notification to configured notify channels when the command finishes")
  .action(async (args: ReadonlyArray<string>, opts) => {
    let notifyLanguage: CliLanguage = "zh";
    let notifyBookName: string | undefined;
    try {
      const root = findProjectRoot();

      let bookId: string;
      let chapter: number;
      if (args.length === 1) {
        chapter = parseInt(args[0]!, 10);
        if (isNaN(chapter)) throw new Error(`Expected chapter number, got "${args[0]}"`);
        bookId = await resolveBookId(undefined, root);
      } else if (args.length === 2) {
        chapter = parseInt(args[1]!, 10);
        if (isNaN(chapter)) throw new Error(`Expected chapter number, got "${args[1]}"`);
        bookId = await resolveBookId(args[0], root);
      } else {
        throw new Error("Usage: inkos write rewrite [book-id] <chapter>");
      }

      if (!opts.force) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question(`Rewrite chapter ${chapter} of "${bookId}"? This will delete chapter ${chapter} and all later chapters. (y/N) `, resolve);
        });
        rl.close();
        if (answer.toLowerCase() !== "y") {
          log("Cancelled.");
          return;
        }
      }

      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      notifyLanguage = resolveCliLanguage(book.language);
      notifyBookName = book.title ?? bookId;
      const bookDir = state.bookDir(bookId);
      const chaptersDir = join(bookDir, "chapters");
      const restoreFrom = chapter - 1;
      const restoreSnapshotDir = join(bookDir, "story", "snapshots", String(restoreFrom));
      await stat(restoreSnapshotDir).catch(() => {
        throw new Error(`Cannot rewrite chapter ${chapter}: missing snapshot for chapter ${restoreFrom}`);
      });

      // Remove existing chapter file
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapter).padStart(4, "0");
      const existing = files.filter((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      for (const f of existing) {
        await unlink(join(chaptersDir, f));
        if (!opts.json) log(`Removed: ${f}`);
      }

      // Remove from index (and all chapters after it)
      const index = await state.loadChapterIndex(bookId);
      const trimmed = index.filter((ch) => ch.number < chapter);
      await state.saveChapterIndex(bookId, trimmed);

      // Also remove later chapter files since state will be rolled back
      const laterFiles = files.filter((f) => {
        const num = parseInt(f.slice(0, 4), 10);
        return num > chapter && f.endsWith(".md");
      });
      for (const f of laterFiles) {
        await unlink(join(chaptersDir, f));
        if (!opts.json) log(`Removed later chapter: ${f}`);
      }

      // Restore state to previous chapter's end-state (chapter 1 uses snapshot-0 from initBook)
      const restored = await state.restoreState(bookId, restoreFrom);
      if (!restored) {
        throw new Error(`Cannot rewrite chapter ${chapter}: failed to restore snapshot for chapter ${restoreFrom}`);
      }
      if (!opts.json) log(`State restored from chapter ${restoreFrom} snapshot.`);

      const nextChapter = await state.getNextChapterNumber(bookId);
      if (nextChapter !== chapter) {
        throw new Error(`Cannot rewrite chapter ${chapter}: expected next chapter to be ${chapter}, but resolved to ${nextChapter}`);
      }

      if (!opts.json) log(`Regenerating chapter ${chapter}...`);

      const wordCount = opts.words ? parseInt(opts.words, 10) : undefined;

      const config = await loadConfig();
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, {
        externalContext: opts.brief,
      }));
      const activatedSkills = await resolveCliProfileSkills(root, "longform-novel");

      const action = await executeExplicitCapabilityTool({
        projectRoot: root,
        binding: { capabilityId: "longform", actionId: "write_chapters", profileId: "longform-novel", risk: "recoverable-write" },
        tool: createWriteChaptersTool(pipeline, bookId, { activeSkills: () => activatedSkills }),
        workId: bookId,
        parameters: {
          instruction: opts.brief?.trim() || `Rewrite chapter ${chapter}.`,
          bookId,
          chapterCount: 1,
          ...(wordCount ? { chapterWordCount: wordCount } : {}),
        },
      });
      const result = (action.data as {
        readonly chapters?: ReadonlyArray<{
          readonly chapterNumber: number;
          readonly title: string;
          readonly wordCount: number;
          readonly observations: ReadonlyArray<Observation>;
        }>;
      } | undefined)?.chapters?.[0];
      if (!result) throw new Error("Rewrite action completed without a chapter artifact.");
      const language = resolveCliLanguage(book.language);

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        for (const line of formatWriteNextResultLines(language, {
          chapterNumber: result.chapterNumber,
          title: result.title,
          wordCount: result.wordCount,
          observations: result.observations,
        })) {
          log(line);
        }
      }

      // Success notification intentionally skipped: the pipeline already sent
      // the per-chapter notification for this exact chapter (runner.ts, end of
      // writeNextChapter) — a command-level one would be a duplicate. --notify
      // only adds the failure notification for this command.
    } catch (e) {
      if (opts.notify) {
        await sendCommandNotification({
          title: formatNotifyCommandTitle(notifyLanguage, "write-rewrite", notifyBookName, false),
          body: formatNotifyFailureBody(notifyLanguage, e),
        });
      }
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to rewrite chapter: ${e}`);
      }
      process.exit(1);
    }
  });

writeCommand
  .command("sync")
  .description("Rebuild truth files and SQLite indexes from the latest edited chapter body")
  .argument("<args...>", "Book ID (optional) and chapter number")
  .option("--brief <text>", "One-off guidance for how to interpret the edited chapter while syncing")
  .option("--json", "Output JSON")
  .action(async (args: ReadonlyArray<string>, opts) => {
    try {
      const root = findProjectRoot();

      let bookId: string;
      let chapter: number;
      if (args.length === 1) {
        chapter = parseInt(args[0]!, 10);
        if (isNaN(chapter)) throw new Error(`Expected chapter number, got "${args[0]}"`);
        bookId = await resolveBookId(undefined, root);
      } else if (args.length === 2) {
        chapter = parseInt(args[1]!, 10);
        if (isNaN(chapter)) throw new Error(`Expected chapter number, got "${args[1]}"`);
        bookId = await resolveBookId(args[0], root);
      } else {
        throw new Error("Usage: inkos write sync [book-id] <chapter>");
      }

      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      const language = resolveCliLanguage(book.language);
      const config = await loadConfig();
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, {
        externalContext: opts.brief,
      }));
      const activatedSkills = await resolveCliProfileSkills(root, "longform-novel", { includeRecommended: true });
      const action = await executeExplicitCapabilityTool({
        projectRoot: root,
        binding: { capabilityId: "longform", actionId: "resync_chapter_state", profileId: "longform-novel", risk: "recoverable-write" },
        tool: createResyncChapterStateTool(pipeline, bookId, {
          defaultSkills: activatedSkills,
          language: book.language,
        }),
        workId: bookId,
        parameters: { bookId, chapterNumber: chapter },
      });
      const result = action.data as {
        readonly chapterNumber: number;
        readonly observations: ReadonlyArray<Observation>;
      };
      const chapterMeta = (await state.loadChapterIndex(bookId)).find((item) => item.number === result.chapterNumber);
      if (!chapterMeta) throw new Error(`Resync action completed without chapter ${result.chapterNumber}.`);

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        for (const line of formatWriteNextResultLines(language, {
          chapterNumber: result.chapterNumber,
          title: chapterMeta.title,
          wordCount: chapterMeta.wordCount,
          observations: result.observations,
        })) {
          log(line);
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to sync chapter artifacts: ${e}`);
      }
      process.exit(1);
    }
  });
