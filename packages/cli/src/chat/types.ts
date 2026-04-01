/**
 * Type definitions for the InkOS chat system.
 * Provides persistent conversation history with per-book isolation.
 */

/**
 * A single message in the chat conversation.
 */
export interface ChatMessage {
  /** Message role: 'user' or 'assistant' */
  role: "user" | "assistant";

  /** Message content */
  content: string;

  /** Timestamp when message was created */
  timestamp: string;

  /** Tools called during this message (assistant only) */
  toolCalls?: string[];

  /** Token usage for this message (optional) */
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Metadata for a chat history session.
 */
export interface ChatHistoryMetadata {
  /** When this chat session was first created */
  createdAt: string;

  /** When this chat session was last updated */
  updatedAt: string;

  /** Total number of messages in history */
  totalMessages: number;

  /** Total token usage across all messages */
  totalTokens?: number;
}

/**
 * Complete chat history for a single book.
 */
export interface ChatHistory {
  /** Book identifier */
  bookId: string;

  /** Conversation messages */
  messages: ChatMessage[];

  /** Session metadata */
  metadata: ChatHistoryMetadata;
}

/**
 * Configuration for chat history persistence.
 */
export interface ChatHistoryConfig {
  /** Maximum number of messages to retain */
  maxMessages: number;

  /** Directory to store chat history files */
  historyDir: string;

  /** File extension for history files */
  fileExtension: string;
}

/**
 * Default configuration for chat history.
 */
export const DEFAULT_CHAT_HISTORY_CONFIG: ChatHistoryConfig = {
  maxMessages: 50,
  historyDir: ".inkos/chat_history",
  fileExtension: ".json",
};

/**
 * Result of a slash command execution.
 */
export interface CommandResult {
  /** Whether the command was successful */
  success: boolean;

  /** Output message to display to user */
  message: string;

  /** Whether to switch to a different book */
  switchToBook?: string;

  /** Whether to clear the conversation */
  clearConversation?: boolean;

  /** Whether the chat UI should exit */
  shouldExit?: boolean;
}

/**
 * Supported slash commands in chat mode.
 */
export type SlashCommand =
  | "write"
  | "audit"
  | "revise"
  | "status"
  | "clear"
  | "switch"
  | "help"
  | "exit"
  | "quit";

/**
 * Slash command definition.
 */
export interface SlashCommandDefinition {
  /** Command name (without leading '/') */
  name: SlashCommand;

  /** Command description */
  description: string;

  /** Usage examples */
  usage: string[];

  /** Required arguments */
  requiredArgs: number;

  /** Optional arguments */
  optionalArgs: number;
}

/**
 * State of a chat session.
 */
export interface ChatSessionState {
  /** Currently active book */
  currentBook: string;

  /** Current conversation history */
  history: ChatHistory;

  /** Whether a tool is currently executing */
  isExecuting: boolean;

  /** Current executing tool name */
  executingTool?: string;

  /** Error message if session is in error state */
  error?: string;
}

export interface ExecutionMetadata {
  /** High-level execution role shown in the TUI */
  scope: "orchestrator" | "agent" | "local";

  /** Human-readable worker label */
  label: string;

  /** Pipeline/tool agent identifier when available */
  agentName?: string;

  /** Tool currently being executed */
  toolName?: string;

  /** Active model name when the worker is LLM-backed */
  model?: string;

  /** Active provider when known */
  provider?: string;
}

/**
 * Clack-specific callbacks for UI updates.
 */
export interface ClackCallbacks {
  /** Called when a tool starts executing */
  onToolStart?: (toolName: string, args: Record<string, unknown>) => void;

  /** Called when a tool completes */
  onToolComplete?: (toolName: string, result: string) => void;

  /** Called with streaming text chunks */
  onStreamChunk?: (chunk: string) => void;

  /** Called when execution status changes */
  onStatusChange?: (status: string) => void;

  /** Called when the active orchestrator/agent metadata changes */
  onExecutionMetadataChange?: (metadata: ExecutionMetadata | null) => void;
}
