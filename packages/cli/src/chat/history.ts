/**
 * Chat history persistence manager.
 * Stores conversation history per-book in .inkos/chat_history/<bookId>.json
 */

import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, rm, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { platform } from "node:os";
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

  // Must only contain safe characters: letters, numbers, underscores, hyphens, and CJK Unified Ideographs in U+4E00–U+9FFF
  const safePattern = /^[\w\u4e00-\u9fff-]+$/;
  return safePattern.test(bookId);
}

/**
 * Cross-platform file replacement with best-effort atomicity.
 *
 * On Unix/Linux/macOS: Uses rename() which atomically replaces existing files.
 * On Windows: Uses a backup-and-rename strategy to minimize data loss risk:
 *   1. Clean up any existing backup file
 *   2. Rename target to backup (if exists)
 *   3. Rename temp to target
 *   4. Remove backup
 *
 * This ensures that if the process crashes between steps, either:
 * - The original file still exists (step 1/2 failure)
 * - The new file is in place with a backup (step 3 success, step 4 pending)
 * - Recovery is possible from the backup
 */
async function atomicReplaceFile(tempPath: string, targetPath: string): Promise<void> {
  if (platform() === "win32") {
    // Windows: rename() cannot atomically replace existing files
    // Use backup-and-rename strategy with unique backup name
    const backupPath = `${targetPath}.${randomUUID()}.bak`;

    try {
      // Step 1: Clean up any stale backup files from previous crashed runs (best effort)
      // Since backupPath uses a fresh UUID, this removes old *.bak files to prevent accumulation
      // Note: This only cleans up one specific backup path pattern; full cleanup would require glob
      await rm(backupPath, { force: true }).catch(() => undefined);

      // Step 2: Create backup of existing file (if any)
      try {
        await rename(targetPath, backupPath);
      } catch (error) {
        // If target doesn't exist (ENOENT), that's fine - no backup needed
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }

      // Step 3: Move temp file to target location
      await rename(tempPath, targetPath);

      // Step 4: Clean up backup (best effort)
      await rm(backupPath, { force: true }).catch(() => undefined);
    } catch (error) {
      // Attempt rollback: restore backup if step 3 failed
      try {
        await rename(backupPath, targetPath);
      } catch {
        // Ignore rollback errors - we tried our best
      }
      throw error;
    }
  } else {
    // Unix/Linux/macOS: rename() atomically replaces existing files
    await rename(tempPath, targetPath);
  }
}

/**
 * Manages chat history persistence for individual books.
 */
export class ChatHistoryManager {
  private readonly config: ChatHistoryConfig;
  private readonly saveQueues = new Map<string, Promise<void>>();
  private static readonly LOCK_TIMEOUT_MS = 5000;
  private static readonly LOCK_STALE_MS = 2000;
  private static readonly LOCK_RETRY_MS = 20;

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
        revision: 0,
      },
    };
  }

  private getHistoryRevision(history: ChatHistory): number {
    return history.metadata.revision ?? 0;
  }

  private getLockDirPath(bookId: string): string {
    return `${this.getHistoryFilePath(bookId)}.lock`;
  }

  private getLockOwnerPath(bookId: string): string {
    return join(this.getLockDirPath(bookId), "owner.json");
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") {
        return false;
      }
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        return true;
      }
      throw error;
    }
  }

  private parseHistory(bookId: string, data: string): ChatHistory {
    let history: ChatHistory;
    try {
      history = JSON.parse(data) as ChatHistory;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse chat history for "${bookId}": ${message}`);
    }

    if (!history.bookId || !Array.isArray(history.messages) || !history.metadata) {
      throw new Error(`Invalid chat history format for "${bookId}"`);
    }

    if (history.bookId !== bookId) {
      throw new Error(
        `Chat history bookId mismatch for "${bookId}": found "${history.bookId}"`
      );
    }
    return history;
  }

  private async loadExistingHistoryIfPresent(bookId: string): Promise<ChatHistory | null> {
    const filePath = this.getHistoryFilePath(bookId);

    try {
      const data = await readFile(filePath, "utf-8");
      return this.parseHistory(bookId, data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  private getMessageKey(message: ChatMessage): string {
    return JSON.stringify({
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      toolCalls: message.toolCalls ?? [],
      tokenUsage: message.tokenUsage ?? null,
    });
  }

  private mergeHistories(existingHistory: ChatHistory, incomingHistory: ChatHistory): ChatHistory {
    const existingKeys = existingHistory.messages.map((message) => this.getMessageKey(message));
    const existingKeySet = new Set(existingKeys);
    const incomingKeys = incomingHistory.messages.map((message) => this.getMessageKey(message));

    let latestSharedIncomingIndex = -1;
    for (let index = incomingKeys.length - 1; index >= 0; index--) {
      if (existingKeySet.has(incomingKeys[index]!)) {
        latestSharedIncomingIndex = index;
        break;
      }
    }

    let appendedMessages: ChatMessage[];
    if (latestSharedIncomingIndex >= 0) {
      appendedMessages = incomingHistory.messages
        .slice(latestSharedIncomingIndex + 1)
        .filter((message) => !existingKeySet.has(this.getMessageKey(message)));
    } else if (existingHistory.messages.length === 0) {
      if (this.getHistoryRevision(incomingHistory) < this.getHistoryRevision(existingHistory)) {
        throw new Error(
          `Chat history for "${incomingHistory.bookId}" was cleared in another session. Please retry.`
        );
      }

      appendedMessages = [...incomingHistory.messages];
    } else {
      const existingRevision = this.getHistoryRevision(existingHistory);
      const incomingRevision = this.getHistoryRevision(incomingHistory);

      if (existingHistory.metadata.clearedAt && incomingRevision < existingRevision) {
        throw new Error(
          `Chat history for "${incomingHistory.bookId}" was cleared in another session. Please retry.`
        );
      }

      if (incomingRevision === 0 && existingRevision === 1) {
        appendedMessages = incomingHistory.messages.filter(
          (message) => !existingKeySet.has(this.getMessageKey(message))
        );
      } else {
        throw new Error(
          `Chat history for "${incomingHistory.bookId}" changed in another session. Please retry.`
        );
      }
    }

    // Merge messages and sort by timestamp to preserve conversational order
    const mergedMessages = [...existingHistory.messages, ...appendedMessages];
    const indexedMessages = mergedMessages.map((message, index) => ({ message, index }));
    indexedMessages.sort((a, b) => {
      const timeA = new Date(a.message.timestamp).getTime();
      const timeB = new Date(b.message.timestamp).getTime();
      if (timeA !== timeB) {
        return timeA - timeB;
      }
      // If timestamps are equal, maintain relative order by using array index as tie-breaker
      return a.index - b.index;
    });
    const sortedMessages = indexedMessages.map((entry) => entry.message);

    return {
      ...incomingHistory,
      messages: sortedMessages,
      metadata: {
        ...incomingHistory.metadata,
        createdAt: existingHistory.metadata.createdAt,
      },
    };
  }

  private async acquireFileLock(bookId: string): Promise<() => Promise<void>> {
    const lockDirPath = this.getLockDirPath(bookId);
    const startedAt = Date.now();
    await this.ensureHistoryDir();

    while (true) {
      try {
        await mkdir(lockDirPath);
        await writeFile(
          this.getLockOwnerPath(bookId),
          JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
          "utf-8"
        );
        return async () => {
          await rm(lockDirPath, { recursive: true, force: true });
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }

        try {
          let hasLiveOwner = false;
          const ownerData = await readFile(this.getLockOwnerPath(bookId), "utf-8").catch((lockError) => {
            if ((lockError as NodeJS.ErrnoException).code === "ENOENT") {
              return null;
            }

            throw lockError;
          });
          if (ownerData) {
            let owner: { pid?: number };
            try {
              owner = JSON.parse(ownerData) as { pid?: number };
            } catch {
              await rm(lockDirPath, { recursive: true, force: true });
              continue;
            }

            if (typeof owner.pid === "number") {
              if (this.isProcessAlive(owner.pid)) {
                hasLiveOwner = true;
              } else {
                await rm(lockDirPath, { recursive: true, force: true });
                continue;
              }
            }
          }

          if (!hasLiveOwner) {
            const lockStats = await stat(lockDirPath);
            if (Date.now() - lockStats.mtimeMs > ChatHistoryManager.LOCK_STALE_MS) {
              await rm(lockDirPath, { recursive: true, force: true });
              continue;
            }
          }
        } catch (lockError) {
          if ((lockError as NodeJS.ErrnoException).code === "ENOENT") {
            continue;
          }

          throw lockError;
        }

        if (Date.now() - startedAt > ChatHistoryManager.LOCK_TIMEOUT_MS) {
          throw new Error(`Timed out waiting for chat history lock for "${bookId}"`);
        }

        await sleep(ChatHistoryManager.LOCK_RETRY_MS);
      }
    }
  }

  private async withBookLock<T>(bookId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.saveQueues.get(bookId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.finally(() => gate);
    this.saveQueues.set(bookId, queued);

    await previous.catch(() => undefined);
    try {
      const releaseFileLock = await this.acquireFileLock(bookId);
      try {
        return await operation();
      } finally {
        await releaseFileLock();
      }
    } finally {
      release();
      if (this.saveQueues.get(bookId) === queued) {
        this.saveQueues.delete(bookId);
      }
    }
  }

  /**
   * Load chat history for a book.
   * Returns empty history if file doesn't exist.
   */
  async load(bookId: string): Promise<ChatHistory> {
    const existingHistory = await this.loadExistingHistoryIfPresent(bookId);
    return existingHistory ?? this.createEmptyHistory(bookId);
  }

  /**
   * Save chat history for a book.
   * Automatically prunes old messages if over limit.
   * @returns The pruned and updated history
   */
  async save(history: ChatHistory): Promise<ChatHistory> {
    return this.withBookLock(history.bookId, async () => {
      await this.ensureHistoryDir();
      const existingHistory = await this.loadExistingHistoryIfPresent(history.bookId);
      const mergedHistory = existingHistory
        ? this.mergeHistories(existingHistory, history)
        : history;
      const prunedHistory = this.pruneOldMessages(mergedHistory);

      const updatedHistory: ChatHistory = {
        ...prunedHistory,
        metadata: {
          ...prunedHistory.metadata,
          clearedAt: undefined,
          updatedAt: new Date().toISOString(),
          totalMessages: prunedHistory.messages.length,
          totalTokens: this.calculateTotalTokens(prunedHistory.messages),
          revision: (existingHistory ? this.getHistoryRevision(existingHistory) : 0) + 1,
        },
      };

      const filePath = this.getHistoryFilePath(updatedHistory.bookId);
      const tempFilePath = `${filePath}.${randomUUID()}.tmp`;
      const data = JSON.stringify(updatedHistory, null, 2);

      try {
        await writeFile(tempFilePath, data, "utf-8");
        await atomicReplaceFile(tempFilePath, filePath);
      } finally {
        await rm(tempFilePath, { force: true }).catch(() => undefined);
      }

      return updatedHistory;
    });
  }

  /**
   * Clear chat history for a book.
   * Removes the history file.
   */
  async clear(bookId: string): Promise<void> {
    await this.withBookLock(bookId, async () => {
      await this.ensureHistoryDir();
      const existingHistory = await this.loadExistingHistoryIfPresent(bookId);
      const clearedHistory = this.createEmptyHistory(bookId);
      const nextRevision = (existingHistory ? this.getHistoryRevision(existingHistory) : 0) + 1;
      const filePath = this.getHistoryFilePath(bookId);
      const tempFilePath = `${filePath}.${randomUUID()}.tmp`;

      const data = JSON.stringify(
        {
          ...clearedHistory,
          metadata: {
            ...clearedHistory.metadata,
            clearedAt: clearedHistory.metadata.updatedAt,
            revision: nextRevision,
          },
        },
        null,
        2
      );

      try {
        await writeFile(tempFilePath, data, "utf-8");
        await atomicReplaceFile(tempFilePath, filePath);
      } finally {
        await rm(tempFilePath, { force: true }).catch(() => undefined);
      }
    });
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
      const date = new Date(msg.timestamp as any);
      const timestamp = Number.isNaN(date.getTime())
        ? String((msg as any).timestamp ?? "Unknown time")
        : date.toLocaleTimeString();
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
