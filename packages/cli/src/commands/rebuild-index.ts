import { Command } from "commander";
import { StateManager } from "@actalk/inkos-core";
import { findProjectRoot, resolveBookId, log, logError } from "../utils.js";

export const rebuildIndexCommand = new Command("rebuild-index")
  .description("Rebuild the chapter index from on-disk chapter files")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);

      if (!opts.json) log(`Rebuilding chapter index for "${bookId}"...`);

      const index = await state.rebuildChapterIndex(bookId);

      if (opts.json) {
        log(JSON.stringify(index, null, 2));
      } else {
        log(`  Rebuilt index with ${index.length} chapter(s):`);
        for (const ch of index) {
          log(`    ${ch.number}. ${ch.title} [${ch.status}]`);
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Rebuild failed: ${e}`);
      }
      process.exit(1);
    }
  });
