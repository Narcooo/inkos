import { Command } from "commander";
import { StateManager, writeExportArtifact } from "@actalk/inkos-core";
import { join } from "node:path";
import { findProjectRoot, resolveBookId, log, logError } from "../utils.js";

export const exportCommand = new Command("export")
  .description("Export book chapters to a single file")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--format <format>", "Output format (txt, md, epub)", "txt")
  .option("--output <path>", "Output file path")
  .option("--approved-only", "Only export approved chapters")
  .option("--json", "Output JSON metadata")
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);

      const result = await writeExportArtifact(state, bookId, {
        format: opts.format as "txt" | "md" | "epub",
        approvedOnly: Boolean(opts.approvedOnly),
        outputPath: opts.output ?? join(root, `${bookId}_export.${opts.format}`),
      });

      if (opts.json) {
        log(JSON.stringify({
          bookId,
          chaptersExported: result.chaptersExported,
          totalWords: result.totalWords,
          format: result.format,
          outputPath: result.outputPath,
        }, null, 2));
      } else {
        log(`Exported ${result.chaptersExported} chapters (${result.totalWords} words)`);
        log(`Output: ${result.outputPath}`);
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to export: ${e}`);
      }
      process.exit(1);
    }
  });
