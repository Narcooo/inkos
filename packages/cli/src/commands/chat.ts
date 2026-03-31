/**
 * CLI command for launching the InkOS chat interface.
 */

import { Command } from "commander";
import { startChat } from "../chat/index.js";
import { resolveBookId } from "../utils.js";

export const chatCommand = new Command("chat")
  .description("Interactive chat with InkOS agent")
  .argument("[book-id]", "Book ID (auto-detect if omitted)")
  .option("--lang <language>", "Language (zh/en)", "zh")
  .option("--max-messages <n>", "Max messages in history", "100")
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const bookId = await resolveBookId(bookIdArg, process.cwd());

      await startChat(bookId, {
        language: opts.lang as "zh" | "en",
        maxMessages: parseInt(opts.maxMessages, 10),
      });
    } catch (e) {
      process.stderr.write(`[ERROR] Failed to start chat: ${e}\n`);
      process.exit(1);
    }
  });