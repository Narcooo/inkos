/**
 * Chat session manager.
 * Orchestrates conversation flow via runAgentLoop.
 */

import {
  type PipelineConfig,
  runAgentLoop,
} from "@actalk/inkos-core";
import { ChatHistoryManager } from "./history.js";
import { parseSlashCommand } from "./commands.js";
import { parseError } from "./errors.js";
import {
  type ChatHistory,
  type ChatMessage,
  type CommandResult,
  type ClackCallbacks,
} from "./types.js";

/**
 * Manages a chat session with an InkOS book.
 * All user input (including slash commands) is processed through runAgentLoop.
 */
export class ChatSession {
  private readonly config: PipelineConfig;
  private readonly historyManager: ChatHistoryManager;
  private currentBook: string;
  private history: ChatHistory;

  constructor(
    config: PipelineConfig,
    bookId: string,
    historyManager?: ChatHistoryManager
  ) {
    this.config = config;
    this.historyManager = historyManager ?? new ChatHistoryManager();
    this.currentBook = bookId;
    this.history = {
      bookId,
      messages: [],
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        totalMessages: 0,
      },
    };
  }

  /**
   * Initialize session by loading history.
   */
  async initialize(): Promise<void> {
    this.history = await this.historyManager.load(this.currentBook);
  }

  /**
   * Get current book ID.
   */
  getCurrentBook(): string {
    return this.currentBook;
  }

  /**
   * Get current history.
   */
  getHistory(): ChatHistory {
    return this.history;
  }

  /**
   * Process user input (slash command or natural language).
   * All input is processed through runAgentLoop for consistency.
   */
  async processInput(
    input: string,
    callbacks?: ClackCallbacks
  ): Promise<CommandResult> {
    // Handle special commands that don't need agent loop
    if (input.startsWith("/")) {
      const parsed = parseSlashCommand(input);

      if (!parsed.valid) {
        return { success: false, message: parsed.error };
      }

      // Handle clear/switch/help locally
      if (parsed.command === "clear") {
        await this.historyManager.clear(this.currentBook);
        this.history = await this.historyManager.load(this.currentBook);
        callbacks?.onStatusChange?.("已清空");

        return {
          success: true,
          message: "对话历史已清空",
          clearConversation: true,
        };
      }

      if (parsed.command === "switch" && parsed.args[0]) {
        const newBookId = parsed.args[0];
        this.currentBook = newBookId;
        this.history = await this.historyManager.load(newBookId);
        callbacks?.onStatusChange?.(`已切换: ${newBookId}`);

        return {
          success: true,
          message: `已切换到书籍: ${newBookId}`,
          switchToBook: newBookId,
        };
      }

      if (parsed.command === "help") {
        callbacks?.onStatusChange?.("显示帮助");
        return { success: true, message: "显示帮助" };
      }
    }

    // All other input (including /write, /audit, etc.) goes through agent loop
    return this.handleViaAgentLoop(input, callbacks);
  }

  /**
   * Handle all input via agent loop.
   * Converts slash commands to natural language instructions.
   */
  private async handleViaAgentLoop(
    input: string,
    callbacks?: ClackCallbacks
  ): Promise<CommandResult> {
    // Convert slash commands to natural language instructions
    let agentInstruction = input;

    if (input.startsWith("/")) {
      agentInstruction = this.convertSlashCommandToInstruction(input);
    }

    // Add user message to history
    const userMessage: ChatMessage = {
      role: "user",
      content: input,
      timestamp: new Date().toISOString(),
    };

    this.history = this.historyManager.addMessage(this.history, userMessage);

    try {
      // Setup callbacks for streaming progress
      const options = {
        onToolCall: (name: string, args: Record<string, unknown>) => {
          callbacks?.onToolStart?.(name, args);
          callbacks?.onStatusChange?.(`执行工具: ${name}`);
        },
        onToolResult: (name: string, result: string) => {
          callbacks?.onToolComplete?.(name, result);
        },
        onMessage: (content: string) => {
          callbacks?.onStreamChunk?.(content);
        },
        maxTurns: 10,
      };

      // Run agent loop with instruction
      const response = await runAgentLoop(this.config, agentInstruction, options);

      // Add assistant message to history
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: response,
        timestamp: new Date().toISOString(),
      };

      this.history = this.historyManager.addMessage(this.history, assistantMessage);

      // Save history
      await this.historyManager.save(this.history);

      callbacks?.onStatusChange?.("完成");

      return {
        success: true,
        message: response,
      };
    } catch (error) {
      const parsed = parseError(error);

      callbacks?.onStatusChange?.("错误");

      return {
        success: false,
        message: `${parsed.message}${parsed.suggestion ? `\n建议: ${parsed.suggestion}` : ""}`,
      };
    }
  }

  /**
   * Convert slash command to natural language instruction for agent.
   */
  private convertSlashCommandToInstruction(input: string): string {
    const parsed = parseSlashCommand(input);
    if (!parsed.valid) return input;

    const { command, args, options } = parsed;
    const bookId = this.currentBook;

    // Convert to natural language instruction
    switch (command) {
      case "write":
        return `请为书籍 ${bookId} 写下一章${options.guidance ? `，要求：${options.guidance}` : ""}`;

      case "audit":
        return args[0]
          ? `请审计书籍 ${bookId} 的第 ${args[0]} 章`
          : `请审计书籍 ${bookId} 的最新章节`;

      case "revise":
        return args[0]
          ? `请修订书籍 ${bookId} 的第 ${args[0]} 章${options.mode ? `，模式：${options.mode}` : ""}`
          : `请修订书籍 ${bookId} 的最新章节${options.mode ? `，模式：${options.mode}` : ""}`;

      case "status":
        return `请显示书籍 ${bookId} 的当前状态`;

      default:
        return input;
    }
  }

  /**
   * Switch to a different book.
   */
  async switchToBook(bookId: string): Promise<void> {
    this.currentBook = bookId;
    this.history = await this.historyManager.load(bookId);
  }

  /**
   * Clear history for current book.
   */
  async clearHistory(): Promise<void> {
    await this.historyManager.clear(this.currentBook);
    this.history = await this.historyManager.load(this.currentBook);
  }
}