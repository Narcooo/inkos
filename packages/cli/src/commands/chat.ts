/**
 * CLI command for launching the InkOS chat interface.
 */

import { Command } from "commander";
import { startChat } from "../chat/index.js";
import { resolveBookId, logError } from "../utils.js";

export const chatCommand = new Command("chat")
  .description("Interactive chat with InkOS agent")
  .argument("[book-id]", "Book ID (auto-detect if omitted)")
  .option("--max-messages <n>", "Max messages in history", (value) => Number.parseInt(value, 10), 100)
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const bookId = await resolveBookId(bookIdArg, process.cwd());

      // Validate max-messages
      const maxMessages = opts.maxMessages;
      if (isNaN(maxMessages) || maxMessages <= 0) {
        throw new Error("--max-messages must be a positive integer");
      }

      await startChat(bookId, {
        maxMessages,
      });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      logError(`Failed to start chat: ${errorMessage}`);
      process.exit(1);
    }
  });
