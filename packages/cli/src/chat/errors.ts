/**
 * Error handling utilities for chat interface.
 * Provides user-friendly error messages and recovery suggestions.
 */

/**
 * Common error types and their user-friendly messages.
 */
export const ERROR_MESSAGES = {
  API_KEY_MISSING: {
    message: "API 密钥未设置",
    suggestion:
      "运行 'inkos config set-global' 或在项目 .env 文件中设置 INKOS_LLM_API_KEY",
  },
  BOOK_NOT_FOUND: {
    message: "书籍不存在",
    suggestion:
      "使用 'inkos book list' 查看可用书籍，或使用 'inkos book create' 创建新书",
  },
  NETWORK_ERROR: {
    message: "网络连接失败",
    suggestion:
      "检查网络连接，确认 API 端点可访问。如果使用代理，请确保代理配置正确",
  },
  RATE_LIMIT: {
    message: "API 请求频率超限",
    suggestion: "请稍等片刻后重试。如果问题持续，考虑升级 API 套餐",
  },
  INVALID_INPUT: {
    message: "输入无效",
    suggestion: "使用 /help 查看可用命令和正确用法",
  },
  CHAPTER_NOT_FOUND: {
    message: "章节不存在",
    suggestion: "使用 /status 查看书籍的章节信息",
  },
  STATE_ERROR: {
    message: "状态文件损坏",
    suggestion: "尝试使用 'inkos doctor' 修复项目状态",
  },
  UNKNOWN: {
    message: "未知错误",
    suggestion: "请查看错误详情，或使用 'inkos doctor' 检查环境",
  },
};

export type ErrorType = keyof typeof ERROR_MESSAGES;

export interface ParsedError {
  type: ErrorType;
  message: string;
  suggestion?: string;
  details?: string;
}

/**
 * Parse error and return user-friendly message.
 */
export function parseError(error: unknown): ParsedError {
  if (error instanceof Error) {
    const errorMessage = error.message.toLowerCase();

    // API key errors
    if (
      errorMessage.includes("api_key") ||
      errorMessage.includes("api key") ||
      errorMessage.includes("inkos_llm_api_key")
    ) {
      return { type: "API_KEY_MISSING", ...ERROR_MESSAGES.API_KEY_MISSING };
    }

    // Book not found
    if (
      errorMessage.includes("book") &&
      (errorMessage.includes("not found") || errorMessage.includes("不存在"))
    ) {
      return { type: "BOOK_NOT_FOUND", ...ERROR_MESSAGES.BOOK_NOT_FOUND };
    }

    // Network errors
    if (
      errorMessage.includes("network") ||
      errorMessage.includes("econnrefused") ||
      errorMessage.includes("enotfound")
    ) {
      return { type: "NETWORK_ERROR", ...ERROR_MESSAGES.NETWORK_ERROR };
    }

    // Rate limit
    if (
      errorMessage.includes("rate limit") ||
      errorMessage.includes("429") ||
      errorMessage.includes("too many requests")
    ) {
      return { type: "RATE_LIMIT", ...ERROR_MESSAGES.RATE_LIMIT };
    }

    // Chapter not found
    if (
      errorMessage.includes("chapter") &&
      (errorMessage.includes("not found") || errorMessage.includes("不存在"))
    ) {
      return { type: "CHAPTER_NOT_FOUND", ...ERROR_MESSAGES.CHAPTER_NOT_FOUND };
    }

    // State errors
    if (
      errorMessage.includes("state") ||
      errorMessage.includes("manifest") ||
      errorMessage.includes("corrupted")
    ) {
      return { type: "STATE_ERROR", ...ERROR_MESSAGES.STATE_ERROR };
    }

    // Return error with details
    return {
      type: "UNKNOWN",
      ...ERROR_MESSAGES.UNKNOWN,
      details: error.message,
    };
  }

  return { type: "UNKNOWN", ...ERROR_MESSAGES.UNKNOWN };
}

/**
 * Format error for display in TUI.
 */
export function formatErrorForDisplay(error: unknown): string {
  const parsed = parseError(error);
  let formatted = `✗ ${parsed.message}\n`;

  if (parsed.suggestion) {
    formatted += `建议: ${parsed.suggestion}\n`;
  }

  if (parsed.details) {
    formatted += `详细信息: ${parsed.details}`;
  }

  return formatted;
}

/**
 * Check if error is recoverable.
 */
export function isRecoverableError(error: unknown): boolean {
  const parsed = parseError(error);
  const unrecoverableErrors: ErrorType[] = ["API_KEY_MISSING", "STATE_ERROR"];
  return !unrecoverableErrors.includes(parsed.type);
}

/**
 * Get recovery action for error.
 */
export function getRecoveryAction(error: unknown): string | null {
  const parsed = parseError(error);

  if (parsed.type === "API_KEY_MISSING") {
    return "inkos config set-global";
  }

  if (parsed.type === "STATE_ERROR") {
    return "inkos doctor";
  }

  if (parsed.type === "BOOK_NOT_FOUND") {
    return "inkos book list";
  }

  return null;
}