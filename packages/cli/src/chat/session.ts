/**
 * Chat session manager.
 * Orchestrates conversation flow via runAgentLoop.
 */

import {
  type PipelineConfig,
  runAgentLoop,
} from "@actalk/inkos-core";
import { ChatHistoryManager } from "./history.js";
import { parseSlashCommand, validateCommandArgs } from "./commands.js";
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

      // Validate command arguments
      const argsValidation = validateCommandArgs(parsed.command, parsed.args);
      if (!argsValidation.valid) {
        return { success: false, message: argsValidation.error };
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

        // Validate book ID to prevent path traversal
        const isSafeBookId =
          typeof newBookId === "string" &&
          newBookId.length > 0 &&
          !newBookId.includes("..") &&
          !newBookId.includes("/") &&
          !newBookId.includes("\\");

        if (!isSafeBookId) {
          return {
            success: false,
            message: `无效的书籍 ID: ${newBookId}`,
          };
        }

        try {
          const loadedHistory = await this.historyManager.load(newBookId);
          this.currentBook = newBookId;
          this.history = loadedHistory;
          callbacks?.onStatusChange?.(`已切换: ${newBookId}`);

          return {
            success: true,
            message: `已切换到书籍: ${newBookId}`,
            switchToBook: newBookId,
          };
        } catch (error) {
          const message =
            (error as Error)?.message && typeof (error as Error).message === "string"
              ? (error as Error).message
              : "无效的书籍 ID，无法加载对应的对话历史";
          callbacks?.onStatusChange?.(`切换失败: ${newBookId}`);
          return {
            success: false,
            message: `无法切换到书籍 "${newBookId}": ${message}`,
          };
        }
      }

      if (parsed.command === "help") {
        callbacks?.onStatusChange?.("显示帮助");

        // Generate help text
        const helpText = `## 📚 InkOS Chat 命令帮助

### 交互式命令
输入 \`/\` 然后按 **Tab** 键查看可用命令：

- \`/write\` - 写下一章（自动续写最新章之后的一章）
- \`/audit [章节号]\` - 审计指定章节（不指定则审计最新章节）
- \`/revise [章节号] --mode [polish|rewrite|rework]\` - 修订章节
- \`/status\` - 显示书籍当前状态
- \`/clear\` - 清空对话历史
- \`/switch <书籍ID>\` - 切换到其他书籍
- \`/help\` - 显示此帮助信息
- \`/exit\` 或 \`/quit\` - 退出聊天界面

### Tab 自动补全
1. 输入 \`/\` 开始命令
2. 按 **Tab** 键查看匹配的命令
3. 使用 **↑↓ 箭头** 导航建议
4. 再次按 **Tab** 自动补全选中的命令

### 自然语言
你也可以直接用自然语言与 InkOS 对话：

\`> 写下一章，增加一些动作戏\`
\`> 审计最新章节\`
\`> 这本书目前有多少字了？\`

### 快捷键
- **Tab** - 自动补全命令
- **↑/↓** - 导航命令建议
- **Esc** - 退出聊天
- **Enter** - 提交消息`;

        return { success: true, message: helpText };
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

    // Save user message immediately in case agent fails
    this.history = await this.historyManager.save(this.history);

    try {
      // Build conversation context from recent history (excluding current message)
      const previousMessages = this.history.messages.slice(0, -1).slice(-10); // Exclude last (current) message
      let conversationContext = "";

      if (previousMessages.length > 0) {
        conversationContext = "\n\n## 对话历史\n\n" +
          previousMessages
            .map(msg => `${msg.role === "user" ? "用户" : "助手"}: ${msg.content}`)
            .join("\n\n") +
          "\n\n---\n\n";
      }

      // Combine context with instruction
      const fullInstruction = conversationContext + agentInstruction;

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

      // Run agent loop with instruction (including conversation context)
      const response = await runAgentLoop(this.config, fullInstruction, options);

      // Add assistant message to history
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: response,
        timestamp: new Date().toISOString(),
      };

      this.history = this.historyManager.addMessage(this.history, assistantMessage);

      // Save history with assistant response
      this.history = await this.historyManager.save(this.history);

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