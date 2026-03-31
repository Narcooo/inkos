/**
 * Main Chat Application using @clack/prompts.
 */

import * as p from "@clack/prompts";
import { isCancel } from "@clack/core";
import { ChatSession } from "./session.js";
import { ChatHistoryManager } from "./history.js";
import {
  type ChatHistory,
  type ChatMessage,
  type ClackCallbacks,
} from "./types.js";
import { SLASH_COMMANDS } from "./commands.js";
import type { PipelineConfig } from "@actalk/inkos-core";
import { loadConfig, buildPipelineConfig } from "../utils.js";

export interface ChatAppConfig {
  language?: "zh" | "en";
  maxMessages?: number;
}

export class ChatApp {
  private readonly config: ChatAppConfig;
  private readonly historyManager: ChatHistoryManager;
  private session: ChatSession | null = null;

  constructor(config: ChatAppConfig) {
    this.config = config;
    this.historyManager = new ChatHistoryManager({
      maxMessages: config.maxMessages ?? 50,
    });
  }

  async start(bookId: string): Promise<void> {
    p.intro(`InkOS Chat - Book: ${bookId}`);

    // Load config and create session
    const s = p.spinner();
    s.start("Initializing session...");

    try {
      const projectConfig = await loadConfig();
      const pipelineConfig = buildPipelineConfig(projectConfig, process.cwd());

      this.session = new ChatSession(pipelineConfig, bookId, this.historyManager);
      await this.session.initialize();

      s.stop("Session initialized");
    } catch (error) {
      s.stop("Failed to initialize");
      p.log.error(`Failed to initialize: ${error}`);
      return;
    }

    // Show welcome message
    const history = this.session.getHistory();
    if (history.messages.length === 0) {
      p.log.info("Welcome! This is your first chat session.");
      this.showHelp();
    } else {
      p.log.info(`Loaded ${history.messages.length} messages from history.`);
    }

    // Main loop
    while (true) {
      try {
        const shouldContinue = await this.chatLoop(bookId);
        if (!shouldContinue) break;
      } catch (error) {
        if (isCancel(error)) {
          await this.handleExit();
          break;
        }
        this.handleError(error);
      }
    }

    p.outro("Goodbye!");
  }

  private async chatLoop(bookId: string): Promise<boolean> {
    // Show recent history
    this.displayRecentMessages();

    // Get user input
    const input = await p.text({
      message: "Your message (or /help)",
      placeholder: "/help for commands, or type naturally",
      validate: (value) => {
        if (!value || !value.trim()) return "Please enter a message";
        if (value.length > 5000) return "Message too long (max 5000 chars)";
      },
    });

    if (isCancel(input)) {
      throw input;
    }

    const userInput = input as string;

    // Handle special commands that don't need agent
    if (userInput === "/help") {
      this.showHelp();
      return true;
    }

    if (userInput === "/status") {
      this.showStatus(bookId);
      return true;
    }

    if (userInput === "/clear") {
      await this.clearHistory(bookId);
      return true;
    }

    if (userInput === "/exit" || userInput === "/quit") {
      return false;
    }

    // Process through session
    await this.processWithSession(userInput, bookId);

    return true;
  }

  private displayRecentMessages(limit: number = 10): void {
    if (!this.session) return;

    const history = this.session.getHistory();
    if (history.messages.length === 0) return;

    const recent = history.messages.slice(-limit);
    p.log.info(`--- Recent ${recent.length} messages ---`);

    for (const msg of recent) {
      const timestamp = new Date(msg.timestamp).toLocaleTimeString();
      const roleLabel = msg.role === "user" ? "👤 You" : "🤖 InkOS";

      if (msg.role === "user") {
        p.log.step(`${roleLabel} [${timestamp}]`);
      } else {
        p.log.success(`${roleLabel} [${timestamp}]`);
      }

      // Show content (no truncation - display full message)
      const lines = msg.content.split("\n");
      for (const line of lines) {
        p.log.message(line, { symbol: "  " });
      }
    }

    p.log.info("---");
  }

  private showHelp(): void {
    p.log.info("━━ Available Commands ━━");

    const commands = Object.values(SLASH_COMMANDS);
    for (const cmd of commands) {
      p.log.message(`/${cmd.name}`, { symbol: "◆" });
      p.log.message(`  ${cmd.description}`, { symbol: "  " });
      if (cmd.usage.length > 0) {
        p.log.message(`  Example: ${cmd.usage[0]}`, { symbol: "    " });
      }
    }

    p.log.info("━━━━━━━━━━━━━━━━━━━━━━━━");
    p.log.info("You can also type naturally to interact with InkOS.");
  }

  private showStatus(bookId: string): void {
    if (!this.session) return;

    const history = this.session.getHistory();

    p.log.info("━━ Session Status ━━");
    p.log.step(`Book: ${bookId}`);
    p.log.step(`Messages: ${history.messages.length}`);

    if (history.metadata.totalTokens) {
      p.log.step(`Tokens: ${history.metadata.totalTokens.toLocaleString()}`);
    }

    p.log.step(`Last updated: ${new Date(history.metadata.updatedAt).toLocaleString()}`);
    p.log.info("━━━━━━━━━━━━━━━━━━━━");
  }

  private async clearHistory(bookId: string): Promise<void> {
    if (!this.session) return;

    const confirm = await p.select({
      message: "Clear all chat history?",
      options: [
        { value: "yes", label: "✓ Yes, clear everything" },
        { value: "no", label: "✗ No, keep history" },
      ],
    });

    if (isCancel(confirm) || confirm !== "yes") {
      p.log.info("Cancelled.");
      return;
    }

    await this.session.clearHistory();
    p.log.success("Chat history cleared.");
  }

  private async processWithSession(input: string, bookId: string): Promise<void> {
    if (!this.session) return;

    // Show processing spinner
    const s = p.spinner();
    s.start("Processing your request...");

    // Track if any content was streamed
    let hasStreamedContent = false;

    // Process with callbacks
    const result = await this.session.processInput(input, {
      onToolStart: (toolName) => {
        s.message(`Executing: ${toolName}`);
      },
      onToolComplete: (toolName) => {
        s.message(`${toolName} completed`);
      },
      onStreamChunk: (chunk) => {
        // Show streaming text
        if (!hasStreamedContent) {
          hasStreamedContent = true;
          s.stop("Receiving response...");
        }
        p.log.message(chunk, { symbol: "" });
      },
      onStatusChange: (status) => {
        s.message(status);
      },
    });

    s.stop(result.success ? "✓ Done" : "✗ Failed");

    // Only show error messages or short status updates
    // Full responses are already shown via streaming
    if (!result.success) {
      p.log.error(result.message);
    }

    // Handle book switch
    if (result.switchToBook) {
      p.log.info(`Switched to book: ${result.switchToBook}`);
    }
  }

  private handleError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    p.log.error(`Error: ${message}`);
  }

  private async handleExit(): Promise<void> {
    if (!this.session) return;

    const history = this.session.getHistory();
    if (history.messages.length === 0) return;

    const shouldSave = await p.select({
      message: "Save chat history before exit?",
      options: [
        { value: true, label: "✓ Save" },
        { value: false, label: "✗ Discard" },
      ],
    });

    if (shouldSave && this.session) {
      await this.historyManager.save(history);
      p.log.success("History saved.");
    }
  }
}