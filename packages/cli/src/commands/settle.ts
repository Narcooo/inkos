import { Command } from "commander";
import { PipelineRunner } from "@actalk/inkos-core";
import { loadConfig, buildPipelineConfig, findProjectRoot, resolveBookId, log, logError } from "../utils.js";

export const settleCommand = new Command("settle")
  .description("Post-hoc state settlement: sync truth files from confirmed chapter content")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .argument("[chapter]", "Chapter number (defaults to latest)")
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

      if (!opts.json) log(`Settling "${bookId}"${chapterNumber ? ` chapter ${chapterNumber}` : " (latest)"}...`);

      const result = await pipeline.settleDraft(bookId, chapterNumber);

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        log(`  Chapter ${result.chapterNumber} settled`);
        const s = result.settlement;
        const updated: string[] = [];
        if (s.updatedState && s.updatedState !== "(状态卡未更新)") updated.push("状态卡");
        if (s.updatedHooks && s.updatedHooks !== "(伏笔池未更新)") updated.push("伏笔池");
        if (s.updatedLedger && s.updatedLedger !== "(账本未更新)") updated.push("账本");
        if (s.chapterSummary) updated.push("章节摘要");
        if (s.updatedSubplots) updated.push("支线进度板");
        if (s.updatedEmotionalArcs) updated.push("情感弧线");
        if (s.updatedCharacterMatrix) updated.push("角色矩阵");
        if (updated.length > 0) {
          log(`  Updated: ${updated.join("、")}`);
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Settle failed: ${e}`);
      }
      process.exit(1);
    }
  });
