/**
 * Slash command parser and executor.
 * Handles user commands like /write, /audit, /revise, etc.
 */

import {
  type SlashCommand,
  type SlashCommandDefinition,
} from "./types.js";

/**
 * Available slash command definitions.
 */
export const SLASH_COMMANDS: Record<SlashCommand, SlashCommandDefinition> = {
  write: {
    name: "write",
    description: "写下一章（自动续写最新章之后的一章）",
    usage: ["/write", "/write --guidance '增加动作戏'"],
    requiredArgs: 0,
    optionalArgs: 0,
    maxPositionalArgs: 0,
    options: {
      guidance: { required: false, needsValue: true },
    },
  },
  audit: {
    name: "audit",
    description: "审计指定章节，检查连续性、OOC、数值等问题",
    usage: ["/audit", "/audit 5"],
    requiredArgs: 0,
    optionalArgs: 1,
    maxPositionalArgs: 1,
  },
  revise: {
    name: "revise",
    description: "修订指定章节的文字质量",
    usage: ["/revise", "/revise 5", "/revise 5 --mode polish", "/revise 5 --mode rewrite"],
    requiredArgs: 0,
    optionalArgs: 1,
    maxPositionalArgs: 1,
    options: {
      mode: {
        required: false,
        needsValue: true,
        enum: ["polish", "rewrite", "rework", "anti-detect", "spot-fix"],
      },
    },
  },
  status: {
    name: "status",
    description: "显示当前书籍状态（章数、字数、审计情况）",
    usage: ["/status"],
    requiredArgs: 0,
    optionalArgs: 0,
    maxPositionalArgs: 0,
  },
  clear: {
    name: "clear",
    description: "清空当前对话历史",
    usage: ["/clear"],
    requiredArgs: 0,
    optionalArgs: 0,
    maxPositionalArgs: 0,
  },
  switch: {
    name: "switch",
    description: "切换到另一本书",
    usage: ["/switch book-id"],
    requiredArgs: 1,
    optionalArgs: 0,
    maxPositionalArgs: 1,
  },
  help: {
    name: "help",
    description: "显示帮助信息",
    usage: ["/help"],
    requiredArgs: 0,
    optionalArgs: 0,
    maxPositionalArgs: 0,
  },
  exit: {
    name: "exit",
    description: "退出聊天界面",
    usage: ["/exit"],
    requiredArgs: 0,
    optionalArgs: 0,
    maxPositionalArgs: 0,
  },
  quit: {
    name: "quit",
    description: "退出聊天界面（同 /exit）",
    usage: ["/quit"],
    requiredArgs: 0,
    optionalArgs: 0,
    maxPositionalArgs: 0,
  },
};

function validatePositionalArgs(
  command: SlashCommand,
  definition: SlashCommandDefinition,
  args: string[]
): { valid: true } | { valid: false; error: string } {
  if (args.length < definition.requiredArgs) {
    return {
      valid: false,
      error: `命令 ${command} 至少需要 ${definition.requiredArgs} 个参数。用法: ${definition.usage.join(" | ")}`,
    };
  }

  const maxPositionalArgs = definition.maxPositionalArgs
    ?? definition.requiredArgs + definition.optionalArgs;

  if (args.length > maxPositionalArgs) {
    return {
      valid: false,
      error: maxPositionalArgs === 0
        ? `命令 ${command} 不接受额外参数。用法: ${definition.usage.join(" | ")}`
        : `命令 ${command} 最多接受 ${maxPositionalArgs} 个参数。用法: ${definition.usage.join(" | ")}`,
    };
  }

  return { valid: true };
}

/**
 * Build the input text inserted by Tab autocomplete.
 * Commands that need no further input should not get a trailing space.
 */
export function getAutocompleteInput(command: SlashCommand): string {
  const definition = SLASH_COMMANDS[command];
  const maxPositionalArgs = definition.maxPositionalArgs
    ?? definition.requiredArgs + definition.optionalArgs;
  const needsMoreInput = maxPositionalArgs > 0 || (definition.options && Object.keys(definition.options).length > 0);
  return `/${command}${needsMoreInput ? " " : ""}`;
}

/**
 * Parse slash command input.
 * Returns command name, arguments, and options.
 */
export function parseSlashCommand(input: string):
  | {
      command: SlashCommand;
      args: string[];
      options: Record<string, string>;
      valid: true;
    }
  | {
      valid: false;
      error: string;
    } {
  // Remove leading slash
  const trimmed = input.slice(1).trim();

  // Tokenize with quote support
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = "";
    } else if (/\s/.test(char) && !inQuotes) {
      // Treat any whitespace as separator when not in quotes
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (current.length > 0) {
    parts.push(current);
  }

  // If we finished parsing while still inside quotes, the user has an unmatched quote
  if (inQuotes) {
    return {
      valid: false,
      error: "命令中的引号未闭合。请检查后重试。",
    };
  }
  const commandName = parts[0]?.toLowerCase() as SlashCommand;

  // Check for empty command
  if (!commandName) {
    return {
      valid: false,
      error: "请输入命令。输入 /help 查看可用命令。",
    };
  }

  // Validate command exists
  if (!SLASH_COMMANDS[commandName]) {
    return {
      valid: false,
      error: `未知命令: ${commandName}。输入 /help 查看可用命令。`,
    };
  }

  const definition = SLASH_COMMANDS[commandName];
  const argsAndOptions = parts.slice(1);

  // Parse arguments and options
  const args: string[] = [];
  const options: Record<string, string> = {};

  for (let i = 0; i < argsAndOptions.length; i++) {
    const part = argsAndOptions[i];

    // Check if this is an option (--key value)
    if (part?.startsWith("--")) {
      const key = part.slice(2);
      const value = argsAndOptions[i + 1];

      if (value && !value.startsWith("--")) {
        options[key] = value;
        i++; // Skip the value in next iteration
      } else {
        // Flag option without value (e.g., --verbose)
        options[key] = "true";
      }
    } else if (part) {
      // Regular argument
      args.push(part);
    }
  }

  const argValidation = validatePositionalArgs(commandName, definition, args);
  if (!argValidation.valid) {
    return {
      valid: false,
      error: argValidation.error,
    };
  }

  return {
    command: commandName,
    args,
    options,
    valid: true,
  };
}

/**
 * Validate slash command arguments.
 */
export function validateCommandArgs(
  command: SlashCommand,
  args: string[],
  options: Record<string, string> = {}
): { valid: true } | { valid: false; error: string } {
  const definition = SLASH_COMMANDS[command];
  const argValidation = validatePositionalArgs(command, definition, args);
  if (!argValidation.valid) {
    return argValidation;
  }

  // Validate options
  const optionValidation = validateOptions(command, definition, options);
  if (!optionValidation.valid) {
    return optionValidation;
  }

  // Special validation for specific commands
  switch (command) {
    case "audit":
    case "revise": {
      // Validate chapter number if provided
      if (args[0]) {
        const chapter = parseInt(args[0], 10);
        if (isNaN(chapter) || chapter < 1) {
          return {
            valid: false,
            error: `章节号必须是正整数: ${args[0]}`,
          };
        }
      }
      break;
    }
  }

  return { valid: true };
}

/**
 * Validate command options.
 */
function validateOptions(
  command: SlashCommand,
  definition: SlashCommandDefinition,
  options: Record<string, string>
): { valid: true } | { valid: false; error: string } {
  const allowedOptions = definition.options ?? {};

  // Check for unknown options (typos or unsupported options)
  for (const key of Object.keys(options)) {
    if (!allowedOptions[key]) {
      return {
        valid: false,
        error: `命令 ${command} 不支持选项 --${key}。用法: ${definition.usage.join(" | ")}`,
      };
    }
  }

  // Validate each allowed option
  for (const [key, optionDef] of Object.entries(allowedOptions)) {
    const value = options[key];

    // Check required options
    if (optionDef.required && !value) {
      return {
        valid: false,
        error: `命令 ${command} 必须提供选项 --${key}。用法: ${definition.usage.join(" | ")}`,
      };
    }

    // Check options that need values (not flags)
    if (value && optionDef.needsValue && value === "true") {
      return {
        valid: false,
        error: `选项 --${key} 需要一个值（不能省略）。用法: ${definition.usage.join(" | ")}`,
      };
    }

    // Check enum values
    if (value && optionDef.enum && !optionDef.enum.includes(value)) {
      return {
        valid: false,
        error: `选项 --${key} 的值必须是: ${optionDef.enum.join(", ")}。当前值: ${value}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Build tool arguments from slash command.
 */
export function buildToolArgsFromCommand(
  command: SlashCommand,
  args: string[],
  options: Record<string, string>,
  bookId: string
): Record<string, unknown> {
  switch (command) {
    case "write":
      return {
        bookId,
        ...(options.guidance ? { guidance: options.guidance } : {}),
      };

    case "audit": {
      const chapterNumber = args[0] ? parseInt(args[0], 10) : undefined;
      return {
        bookId,
        ...(chapterNumber ? { chapterNumber } : {}),
      };
    }

    case "revise": {
      const chapterNumber = args[0] ? parseInt(args[0], 10) : undefined;
      const mode = options.mode;
      return {
        bookId,
        ...(chapterNumber ? { chapterNumber } : {}),
        ...(mode ? { mode } : {}),
      };
    }

    case "status":
      return { bookId };

    case "switch":
      return { bookId: args[0] || bookId };

    case "clear":
    case "help":
      return { bookId };

    default:
      return { bookId };
  }
}

/**
 * Get command display name for user feedback.
 */
export function getCommandDisplayName(command: SlashCommand): string {
  const names: Record<SlashCommand, string> = {
    write: "写章节",
    audit: "审计章节",
    revise: "修订章节",
    status: "查看状态",
    clear: "清空对话",
    switch: "切换书籍",
    help: "显示帮助",
    exit: "退出聊天",
    quit: "退出聊天",
  };

  return names[command];
}
