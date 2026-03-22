import { Command } from "commander";
import { PipelineRunner } from "@actalk/inkos-core";
import { buildPipelineConfig, findProjectRoot, loadConfig, log, logError, resolveBookId, resolveContext } from "../utils.js";

export const planCommand = new Command("plan")
  .description("Plan chapter input artifacts");

planCommand
  .command("chapter")
  .description("Generate chapter intent for the next chapter")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--context <text>", "Chapter steering guidance")
  .option("--context-file <path>", "Read guidance from file")
  .option("--json", "Output JSON")
  .option("-q, --quiet", "Suppress console output")
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const config = await loadConfig({ requireApiKey: false });
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const context = await resolveContext(opts);

      const pipeline = new PipelineRunner(
        buildPipelineConfig(config, root, {
          externalContext: context,
          inputGovernanceMode: "v2",
          quiet: opts.quiet,
        }),
      );

      const result = await pipeline.planChapter(bookId, context);

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        log(`Planned chapter ${result.chapterNumber} for "${bookId}"`);
        log(`  Goal: ${result.goal}`);
        log(`  Intent: ${result.intentPath}`);
        if (result.conflicts.length > 0) {
          log("  Conflicts:");
          for (const conflict of result.conflicts) {
            log(`    - ${conflict}`);
          }
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to plan chapter: ${e}`);
      }
      process.exit(1);
    }
  });
