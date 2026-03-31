/**
 * CLI command for launching the InkOS chat interface.
 */

import { Command } from "commander";
import { resolveBookId } from "../utils.js";
import { ChatApp } from "../chat/index.js";

export const chatCommand = new Command("chat")
  .description("Interactive chat with InkOS agent")
  .argument("[book-id]", "Book ID (auto-detect if omitted)")
  .option("--lang <language>", "Language (zh/en)", "zh")
  .option("--max-messages <n>", "Max messages in history", "100")
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const bookId = await resolveBookId(bookIdArg, process.cwd());

      const app = new ChatApp({
        language: opts.lang as "zh" | "en",
        maxMessages: parseInt(opts.maxMessages, 10),
      });

      await app.start(bookId);
    } catch (e) {
      process.stderr.write(`[ERROR] Failed to start chat: ${e}\n`);
      process.exit(1);
    }
  });