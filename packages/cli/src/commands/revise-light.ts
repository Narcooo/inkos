import { Command } from "commander";
import { PipelineRunner } from "@actalk/inkos-core";
import { loadConfig, buildPipelineConfig, findProjectRoot, resolveBookId, resolveContext, log, logError } from "../utils.js";

export const reviseLightCommand = new Command("revise-light")
  .description("Lightweight revision: only chapter text + instructions, no truth files")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .argument("[chapter]", "Chapter number (defaults to latest)")
  .option("--context <text>", "Revision instructions (inline text)")
  .option("--context-file <path>", "Read revision instructions from file")
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

      const pipeline = new PipelineRunner(buildPipelineConfig(config, root));

      const instructions = await resolveContext(opts);
      if (!instructions?.trim()) {
        logError("revise-light requires --context or --context-file");
        process.exit(1);
      }

      if (!opts.json) log(`Revise-light "${bookId}"${chapterNumber ? ` chapter ${chapterNumber}` : " (latest)"}...`);

      const result = await pipeline.reviseDraftLight(bookId, chapterNumber, instructions);

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        log(`  Chapter ${result.chapterNumber} revised (light mode)`);
        log(`  Words: ${result.wordCount}`);
        if (result.fixedIssues.length > 0) {
          log("  Fixed:");
          for (const fix of result.fixedIssues) {
            log(`    - ${fix}`);
          }
        }
        log("\n  💡 Run `inkos settle` to sync truth files after confirming the revision.");
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Revise-light failed: ${e}`);
      }
      process.exit(1);
    }
  });
