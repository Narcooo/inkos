import { Command } from "commander";
import { PipelineRunner } from "@actalk/inkos-core";
import { buildPipelineConfig, findProjectRoot, loadConfig, log, logError, resolveBookId, resolveContext } from "../utils.js";

export const composeCommand = new Command("compose")
  .description("Compose chapter runtime artifacts");

composeCommand
  .command("chapter")
  .description("Generate context/rule-stack/trace artifacts for the next chapter")
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

      const result = await pipeline.composeChapter(bookId, context);

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        log(`Composed chapter ${result.chapterNumber} for "${bookId}"`);
        log(`  Intent: ${result.intentPath}`);
        log(`  Context: ${result.contextPath}`);
        log(`  Rule stack: ${result.ruleStackPath}`);
        log(`  Trace: ${result.tracePath}`);
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to compose chapter: ${e}`);
      }
      process.exit(1);
    }
  });
