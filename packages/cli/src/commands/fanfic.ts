import { Command } from "commander";
import { PipelineRunner } from "@actalk/inkos-core";
import { loadConfig, buildPipelineConfig, findProjectRoot, resolveBookId, log, logError } from "../utils.js";

const FANFIC_MODES = ["canon", "au", "ooc", "cp"] as const;
type FanficMode = typeof FANFIC_MODES[number];

export const fanficCommand = new Command("fanfic")
  .description("Fan fiction writing tools — import canon, manage fanfic mode");

fanficCommand
  .command("init")
  .description("Initialize a fanfic book by importing canon from the parent book")
  .argument("[book-id]", "Target fanfic book ID (auto-detected if only one book)")
  .requiredOption("--from <parent-book-id>", "Parent book ID to import canon from")
  .option("--mode <mode>", "Fanfic mode: canon|au|ooc|cp (default: canon)", "canon")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const config = await loadConfig();

      const mode = opts.mode as FanficMode;
      if (!FANFIC_MODES.includes(mode)) {
        throw new Error(`Invalid fanfic mode: ${mode}. Must be one of: ${FANFIC_MODES.join(", ")}`);
      }

      const pipeline = new PipelineRunner(buildPipelineConfig(config, root));

      if (!opts.json) {
        log(`Importing fanfic canon from "${opts.from}" into "${bookId}" (mode: ${mode})...`);
      }

      await pipeline.importFanficCanon(bookId, opts.from, mode);

      if (opts.json) {
        log(JSON.stringify({
          bookId,
          parentBookId: opts.from,
          mode,
          output: "story/fanfic_canon.md",
        }, null, 2));
      } else {
        log(`Fanfic canon imported: story/fanfic_canon.md`);
        log(`Mode: ${mode}`);
        log(`Writer and auditor will use this file for fanfic-aware writing and review.`);
        log(`\nTip: Set fanficMode in book_rules.md frontmatter to enable fanfic audit dimensions.`);
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Fanfic init failed: ${e}`);
      }
      process.exit(1);
    }
  });

fanficCommand
  .command("show")
  .description("Show the current fanfic_canon.md for a book")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const config = await loadConfig();

      const pipeline = new PipelineRunner(buildPipelineConfig(config, root));
      const canon = await pipeline.showFanficCanon(bookId);

      if (!canon) {
        if (opts.json) {
          log(JSON.stringify({ bookId, canon: null }));
        } else {
          log(`No fanfic_canon.md found for "${bookId}".`);
          log(`Run "inkos fanfic init ${bookId} --from <parent-book-id>" to create one.`);
        }
        return;
      }

      if (opts.json) {
        log(JSON.stringify({ bookId, canon }, null, 2));
      } else {
        log(canon);
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Fanfic show failed: ${e}`);
      }
      process.exit(1);
    }
  });

fanficCommand
  .command("refresh")
  .description("Refresh fanfic_canon.md by re-reading parent book (after parent has new chapters)")
  .argument("[book-id]", "Target fanfic book ID (auto-detected if only one book)")
  .requiredOption("--from <parent-book-id>", "Parent book ID to re-read from")
  .option("--mode <mode>", "Fanfic mode: canon|au|ooc|cp (default: canon)", "canon")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const config = await loadConfig();

      const mode = opts.mode as FanficMode;
      if (!FANFIC_MODES.includes(mode)) {
        throw new Error(`Invalid fanfic mode: ${mode}. Must be one of: ${FANFIC_MODES.join(", ")}`);
      }

      const pipeline = new PipelineRunner(buildPipelineConfig(config, root));

      if (!opts.json) {
        log(`Refreshing fanfic canon from "${opts.from}" for "${bookId}" (mode: ${mode})...`);
      }

      await pipeline.importFanficCanon(bookId, opts.from, mode);

      if (opts.json) {
        log(JSON.stringify({
          bookId,
          parentBookId: opts.from,
          mode,
          output: "story/fanfic_canon.md",
          refreshed: true,
        }, null, 2));
      } else {
        log(`Fanfic canon refreshed: story/fanfic_canon.md`);
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Fanfic refresh failed: ${e}`);
      }
      process.exit(1);
    }
  });
