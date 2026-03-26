import { Command } from "commander";
import { PipelineRunner } from "@actalk/inkos-core";
import { loadConfig, buildPipelineConfig, findProjectRoot, resolveContext, resolveBookId, log, logError } from "../utils.js";

export const draftCommand = new Command("draft")
  .description("Write a draft chapter (no audit/revise)")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--words <n>", "Words per chapter (overrides book config)")
  .option("--context <text>", "Creative guidance (natural language)")
  .option("--context-file <path>", "Read guidance from file")
  .option("--json", "Output JSON")
  .option("-q, --quiet", "Suppress console output")
  .option("--legacy", "Use legacy single-agent pipeline instead of layered 6-step")
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const config = await loadConfig();
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const context = await resolveContext(opts);

      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, { quiet: opts.quiet }));

      const wordCount = opts.words ? parseInt(opts.words, 10) : undefined;

      if (!opts.json) log(`Writing draft for "${bookId}"...`);

      const result = await pipeline.writeDraft(bookId, context, wordCount, opts.legacy === true);

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        log(`  Chapter ${result.chapterNumber}: ${result.title}`);
        log(`  Words: ${result.wordCount}`);
        log(`  File: ${result.filePath}`);
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to write draft: ${e}`);
      }
      process.exit(1);
    }
  });
