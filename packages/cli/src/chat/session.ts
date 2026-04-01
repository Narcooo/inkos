/**
 * Chat session manager.
 * Orchestrates conversation flow via runAgentLoop.
 */

import {
  type PipelineConfig,
  runAgentLoop,
  type AgentLLMOverride,
} from "@actalk/inkos-core";
import { ChatHistoryManager } from "./history.js";
import { parseSlashCommand, validateCommandArgs } from "./commands.js";
import { parseError } from "./errors.js";
import { resolveBookId } from "../utils.js";
import {
  type ChatHistory,
  type ChatMessage,
  type CommandResult,
  type ChatUICallbacks,
  type ExecutionMetadata,
} from "./types.js";

const TOOL_AGENT_METADATA: Record<string, { agentName: string; label: string; usesModel: boolean }> = {
  plan_chapter: { agentName: "planner", label: "planner", usesModel: true },
  compose_chapter: { agentName: "composer", label: "composer", usesModel: true },
  write_draft: { agentName: "writer", label: "writer", usesModel: true },
  audit_chapter: { agentName: "auditor", label: "auditor", usesModel: true },
  revise_chapter: { agentName: "reviser", label: "reviser", usesModel: true },
  scan_market: { agentName: "radar", label: "radar", usesModel: true },
  create_book: { agentName: "architect", label: "architect", usesModel: true },
  import_style: { agentName: "style-analyzer", label: "style-analyzer", usesModel: true },
  import_canon: { agentName: "fanfic-canon-importer", label: "fanfic-canon-importer", usesModel: true },
  import_chapters: { agentName: "chapter-analyzer", label: "chapter-analyzer", usesModel: true },
  write_full_pipeline: { agentName: "writer", label: "writer-pipeline", usesModel: true },
  get_book_status: { agentName: "state-manager", label: "state-manager", usesModel: false },
  read_truth_files: { agentName: "state-manager", label: "state-manager", usesModel: false },
  list_books: { agentName: "state-manager", label: "state-manager", usesModel: false },
  update_author_intent: { agentName: "control-docs", label: "control-docs", usesModel: false },
  update_current_focus: { agentName: "control-docs", label: "control-docs", usesModel: false },
  web_fetch: { agentName: "web-fetch", label: "web-fetch", usesModel: false },
  write_truth_file: { agentName: "truth-file-writer", label: "truth-file-writer", usesModel: false },
};

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

  private getDefaultProvider(): string | undefined {
    return this.config.defaultLLMConfig?.provider;
  }

  private resolveAgentModelInfo(agentName: string): { model?: string; provider?: string } {
    const override = this.config.modelOverrides?.[agentName];
    if (!override) {
      return {
        model: this.config.model,
        provider: this.getDefaultProvider(),
      };
    }

    if (typeof override === "string") {
      return {
        model: override,
        provider: this.getDefaultProvider(),
      };
    }

    const typedOverride = override as AgentLLMOverride;
    return {
      model: typedOverride.model,
      provider: typedOverride.provider ?? this.getDefaultProvider(),
    };
  }

  private getOrchestratorMetadata(): ExecutionMetadata {
    return {
      scope: "orchestrator",
      label: "inkos-agent",
      agentName: "inkos-agent",
      model: this.config.model,
      provider: this.getDefaultProvider(),
    };
  }

  private getExecutionMetadataForTool(toolName: string): ExecutionMetadata {
    const toolMeta = TOOL_AGENT_METADATA[toolName];
    if (!toolMeta) {
      return {
        scope: "local",
        label: toolName,
        toolName,
      };
    }

    if (!toolMeta.usesModel) {
      return {
        scope: "local",
        label: toolMeta.label,
        agentName: toolMeta.agentName,
        toolName,
      };
    }

    const modelInfo = this.resolveAgentModelInfo(toolMeta.agentName);
    return {
      scope: "agent",
      label: toolMeta.label,
      agentName: toolMeta.agentName,
      toolName,
      model: modelInfo.model,
      provider: modelInfo.provider,
    };
  }

  /**
   * Persist an assistant message in the current history.
   */
  private async appendAssistantMessage(content: string): Promise<void> {
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content,
      timestamp: new Date().toISOString(),
    };

    this.history = this.historyManager.addMessage(this.history, assistantMessage);
    this.history = await this.historyManager.save(this.history);
  }

  private isHistoryPersistenceConflict(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return error.message.includes("changed in another session")
      || error.message.includes("cleared in another session")
      || error.message.includes("Timed out waiting for chat history lock");
  }

  private async handleHistoryPersistenceConflict(
    error: unknown,
    callbacks?: ChatUICallbacks
  ): Promise<CommandResult | null> {
    if (!this.isHistoryPersistenceConflict(error)) {
      return null;
    }

    this.history = await this.historyManager.load(this.currentBook);
    const message = error instanceof Error ? error.message : String(error);

    callbacks?.onStatusChange?.("错误");
    callbacks?.onExecutionMetadataChange?.(null);

    return {
      success: false,
      message,
    };
  }

  /**
   * Persist a local user/assistant exchange that never reaches the agent loop.
   */
  private async recordLocalExchange(
    input: string,
    response: string
  ): Promise<void> {
    const userMessage: ChatMessage = {
      role: "user",
      content: input,
      timestamp: new Date().toISOString(),
    };

    this.history = this.historyManager.addMessage(this.history, userMessage);
    await this.appendAssistantMessage(response);
  }

  /**
   * Process user input (slash command or natural language).
   * All input is processed through runAgentLoop for consistency.
   */
  async processInput(
    input: string,
    callbacks?: ChatUICallbacks
  ): Promise<CommandResult> {
    // Handle special commands that don't need agent loop
    if (input.startsWith("/")) {
      const parsed = parseSlashCommand(input);

      if (!parsed.valid) {
        await this.recordLocalExchange(input, parsed.error);
        return { success: false, message: parsed.error };
      }

      // Validate command arguments
      const argsValidation = validateCommandArgs(parsed.command, parsed.args);
      if (!argsValidation.valid) {
        await this.recordLocalExchange(input, argsValidation.error);
        return { success: false, message: argsValidation.error };
      }

      // Handle clear/switch/help/exit locally
      if (parsed.command === "exit" || parsed.command === "quit") {
        callbacks?.onStatusChange?.("正在退出...");
        return {
          success: true,
          message: "退出聊天界面",
          shouldExit: true,
        };
      }

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
          const message = `无效的书籍 ID: ${newBookId}`;
          await this.recordLocalExchange(input, message);
          return {
            success: false,
            message,
          };
        }

        try {
          const validatedBookId = await resolveBookId(newBookId, this.config.projectRoot);
          const loadedHistory = await this.historyManager.load(validatedBookId);
          this.currentBook = validatedBookId;
          this.history = loadedHistory;
          callbacks?.onStatusChange?.(`已切换: ${validatedBookId}`);

          return {
            success: true,
            message: `已切换到书籍: ${validatedBookId}`,
            switchToBook: validatedBookId,
          };
        } catch (error) {
          const message =
            (error as Error)?.message && typeof (error as Error).message === "string"
              ? (error as Error).message
              : "无效的书籍 ID，无法加载对应的对话历史";
          const fullMessage = `无法切换到书籍 "${newBookId}": ${message}`;
          await this.recordLocalExchange(input, fullMessage);
          callbacks?.onStatusChange?.(`切换失败: ${newBookId}`);
          return {
            success: false,
            message: fullMessage,
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
- **Esc** - 退出聊天（执行中连按两次强制退出）
- **Enter** - 提交消息`;

        // Add user and assistant messages to history
        const userMessage: ChatMessage = {
          role: "user",
          content: input,
          timestamp: new Date().toISOString(),
        };
        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: helpText,
          timestamp: new Date().toISOString(),
        };

        this.history = this.historyManager.addMessage(this.history, userMessage);
        this.history = this.historyManager.addMessage(this.history, assistantMessage);
        this.history = await this.historyManager.save(this.history);

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
    callbacks?: ChatUICallbacks
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
    try {
      this.history = await this.historyManager.save(this.history);
    } catch (error) {
      const conflictResult = await this.handleHistoryPersistenceConflict(error, callbacks);
      if (conflictResult) {
        return conflictResult;
      }
      throw error;
    }

    try {
      callbacks?.onExecutionMetadataChange?.(this.getOrchestratorMetadata());

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
            callbacks?.onExecutionMetadataChange?.(this.getExecutionMetadataForTool(name));
            callbacks?.onToolStart?.(name, args);
            callbacks?.onStatusChange?.(`执行工具: ${name}`);
          },
          onToolResult: (name: string, result: string) => {
            callbacks?.onExecutionMetadataChange?.(this.getOrchestratorMetadata());
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
      callbacks?.onExecutionMetadataChange?.(null);

      return {
        success: true,
        message: response,
      };
    } catch (error) {
      const conflictResult = await this.handleHistoryPersistenceConflict(error, callbacks);
      if (conflictResult) {
        return conflictResult;
      }

      const parsed = parseError(error);
      const message = `${parsed.message}${parsed.suggestion ? `\n建议: ${parsed.suggestion}` : ""}`;

      await this.appendAssistantMessage(message);

      callbacks?.onStatusChange?.("错误");
      callbacks?.onExecutionMetadataChange?.(null);

      return {
        success: false,
        message,
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
