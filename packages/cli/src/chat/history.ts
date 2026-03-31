/**
 * Chat history persistence manager.
 * Stores conversation history per-book in .inkos/chat_history/<bookId>.json
 */

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  type ChatHistory,
  type ChatMessage,
  type ChatHistoryConfig,
  DEFAULT_CHAT_HISTORY_CONFIG,
} from "./types.js";

/**
 * Validates that a book ID is safe for filesystem use.
 * Prevents path traversal attacks.
 */
function isValidBookId(bookId: string): boolean {
  // Must be a non-empty string
  if (typeof bookId !== "string" || bookId.length === 0) {
    return false;
  }

  // Must not contain path separators or parent directory references
  if (bookId.includes("/") || bookId.includes("\\") || bookId.includes("..")) {
    return false;
  }

  // Must only contain safe characters: letters, numbers, underscores, hyphens, Chinese characters
  const safePattern = /^[\w\u4e00-\u9fa5-]+$/;
  return safePattern.test(bookId);
}

/**
 * Manages chat history persistence for individual books.
 */
export class ChatHistoryManager {
  private readonly config: ChatHistoryConfig;

  constructor(config?: Partial<ChatHistoryConfig>) {
    this.config = {
      ...DEFAULT_CHAT_HISTORY_CONFIG,
      ...config,
    };
  }

  /**
   * Get the file path for a book's chat history.
   * @throws Error if bookId is invalid (path traversal attempt)
   */
  private getHistoryFilePath(bookId: string): string {
    if (!isValidBookId(bookId)) {
      throw new Error(`Invalid book ID: ${bookId} contains unsafe characters`);
    }
    return join(this.config.historyDir, `${bookId}${this.config.fileExtension}`);
  }

  /**
   * Ensure the history directory exists.
   */
  private async ensureHistoryDir(): Promise<void> {
    await mkdir(this.config.historyDir, { recursive: true });
  }

  /**
   * Create a new empty chat history for a book.
   */
  private createEmptyHistory(bookId: string): ChatHistory {
    const now = new Date().toISOString();
    return {
      bookId,
      messages: [],
      metadata: {
        createdAt: now,
        updatedAt: now,
        totalMessages: 0,
      },
    };
  }

  /**
   * Load chat history for a book.
   * Returns empty history if file doesn't exist.
   */
  async load(bookId: string): Promise<ChatHistory> {
    const filePath = this.getHistoryFilePath(bookId);

    try {
      const data = await readFile(filePath, "utf-8");
      const history = JSON.parse(data) as ChatHistory;

      // Validate structure
      if (!history.bookId || !history.messages || !history.metadata) {
        return this.createEmptyHistory(bookId);
      }

      return history;
    } catch (error) {
      // File doesn't exist or is invalid - return empty history
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return this.createEmptyHistory(bookId);
      }
      // Invalid JSON or other error - return empty history
      return this.createEmptyHistory(bookId);
    }
  }

  /**
   * Save chat history for a book.
   * Automatically prunes old messages if over limit.
   * @returns The pruned and updated history
   */
  async save(history: ChatHistory): Promise<ChatHistory> {
    await this.ensureHistoryDir();

    // Prune if over limit
    const prunedHistory = this.pruneOldMessages(history);

    // Update metadata
    const updatedHistory: ChatHistory = {
      ...prunedHistory,
      metadata: {
        ...prunedHistory.metadata,
        updatedAt: new Date().toISOString(),
        totalMessages: prunedHistory.messages.length,
        totalTokens: this.calculateTotalTokens(prunedHistory.messages),
      },
    };

    const filePath = this.getHistoryFilePath(updatedHistory.bookId);
    const data = JSON.stringify(updatedHistory, null, 2);

    await writeFile(filePath, data, "utf-8");
    return updatedHistory;
  }

  /**
   * Clear chat history for a book.
   * Removes the history file.
   */
  async clear(bookId: string): Promise<void> {
    const filePath = this.getHistoryFilePath(bookId);

    try {
      await rm(filePath);
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  /**
   * Prune old messages to stay within the configured limit.
   * Removes oldest messages first.
   */
  pruneOldMessages(history: ChatHistory): ChatHistory {
    if (history.messages.length <= this.config.maxMessages) {
      return history;
    }

    // Remove oldest messages to stay at limit
    const excessCount = history.messages.length - this.config.maxMessages;
    const prunedMessages = history.messages.slice(excessCount);

    return {
      ...history,
      messages: prunedMessages,
    };
  }

  /**
   * Add a new message to history.
   * Returns updated history (does not save to disk).
   */
  addMessage(history: ChatHistory, message: ChatMessage): ChatHistory {
    return {
      ...history,
      messages: [...history.messages, message],
    };
  }

  /**
   * Calculate total token usage across all messages.
   */
  private calculateTotalTokens(messages: ChatMessage[]): number {
    return messages.reduce((total, msg) => {
      return total + (msg.tokenUsage?.totalTokens ?? 0);
    }, 0);
  }

  /**
   * Get the number of messages in history.
   */
  getMessageCount(history: ChatHistory): number {
    return history.messages.length;
  }

  /**
   * Check if history is at the configured limit.
   */
  isAtLimit(history: ChatHistory): boolean {
    return history.messages.length >= this.config.maxMessages;
  }

  /**
   * Get the last N messages from history.
   */
  getLastMessages(history: ChatHistory, count: number): ChatMessage[] {
    return history.messages.slice(-count);
  }

  /**
   * Format messages for display (user-friendly timestamps).
   */
  formatMessagesForDisplay(messages: ChatMessage[]): string[] {
    return messages.map((msg) => {
      const timestamp = new Date(msg.timestamp).toLocaleTimeString();
      const roleLabel = msg.role === "user" ? "You" : "InkOS";

      let formatted = `[${timestamp}] ${roleLabel}: ${msg.content}`;

      // Add tool calls info for assistant messages
      if (msg.role === "assistant" && msg.toolCalls?.length) {
        formatted += `\n  Tools: ${msg.toolCalls.join(", ")}`;
      }

      return formatted;
    });
  }
}