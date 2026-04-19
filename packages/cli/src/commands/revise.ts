import { Command } from "commander";
import { DEFAULT_REVISE_MODE, PipelineRunner, type ReviseMode } from "@actalk/inkos-core";
import { loadConfig, buildPipelineConfig, findProjectRoot, resolveBookId, log, logError } from "../utils.js";

export const reviseCommand = new Command("revise")
  .description("Revise a chapter based on audit issues")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .argument("[chapter]", "Chapter number (defaults to latest)")
  .option("--mode <mode>", "Revise mode: spot-fix, polish, rewrite, rework, anti-detect", DEFAULT_REVISE_MODE)
  .option("--brief <text>", "One-off creative guidance for this revise/rewrite only")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, chapterStr: string | undefined, opts) => {
    try {
      const config = await loadConfig();
      const root = findProjectRoot();

      let bookId: string;
      let chapterNumber: number | undefined;
      if (bookIdArg && /^\d+$/.test(bookIdArg)) {
        bookId = await resolveBookId(undefined, root);
        chapterNumber = parseInt(bookIdArg, 10);
      } else {
        bookId = await resolveBookId(bookIdArg, root);
        chapterNumber = chapterStr ? parseInt(chapterStr, 10) : undefined;
      }

      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, {
        externalContext: opts.brief,
      }));

      const mode = opts.mode as ReviseMode;
      if (!opts.json) log(`Revising "${bookId}"${chapterNumber ? ` chapter ${chapterNumber}` : " (latest)"} [mode: ${mode}]...`);

      const result = await pipeline.reviseDraft(bookId, chapterNumber, mode);

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else if (!result.applied) {
        log(`  Chapter ${result.chapterNumber}: kept original draft`);
        if (result.skippedReason) log(`  Reason: ${result.skippedReason}`);
      } else {
        log(`  Chapter ${result.chapterNumber} revised`);
        log(`  Words: ${result.wordCount}`);
        log(`  Status: ${result.status}`);
        log("  Fixed:");
        for (const fix of result.fixedIssues) {
          log(`    - ${fix}`);
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Revise failed: ${e}`);
      }
      process.exit(1);
    }
  });
