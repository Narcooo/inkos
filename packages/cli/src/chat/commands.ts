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
    optionalArgs: 1,
  },
  audit: {
    name: "audit",
    description: "审计指定章节，检查连续性、OOC、数值等问题",
    usage: ["/audit", "/audit 5"],
    requiredArgs: 0,
    optionalArgs: 1,
  },
  revise: {
    name: "revise",
    description: "修订指定章节的文字质量",
    usage: ["/revise", "/revise 5", "/revise 5 --mode polish"],
    requiredArgs: 0,
    optionalArgs: 2,
  },
  status: {
    name: "status",
    description: "显示当前书籍状态（章数、字数、审计情况）",
    usage: ["/status"],
    requiredArgs: 0,
    optionalArgs: 0,
  },
  clear: {
    name: "clear",
    description: "清空当前对话历史",
    usage: ["/clear"],
    requiredArgs: 0,
    optionalArgs: 0,
  },
  switch: {
    name: "switch",
    description: "切换到另一本书",
    usage: ["/switch book-id"],
    requiredArgs: 1,
    optionalArgs: 0,
  },
  help: {
    name: "help",
    description: "显示帮助信息",
    usage: ["/help"],
    requiredArgs: 0,
    optionalArgs: 0,
  },
};

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
  const parts = trimmed.split(/\s+/);
  const commandName = parts[0]?.toLowerCase() as SlashCommand;

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

  // Validate argument count
  if (args.length < definition.requiredArgs) {
    return {
      valid: false,
      error: `命令 ${commandName} 至少需要 ${definition.requiredArgs} 个参数。用法: ${definition.usage.join(" | ")}`,
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
  args: string[]
): { valid: true } | { valid: false; error: string } {
  const definition = SLASH_COMMANDS[command];

  if (args.length < definition.requiredArgs) {
    return {
      valid: false,
      error: `命令 ${command} 需要至少 ${definition.requiredArgs} 个参数`,
    };
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
    case "revise": {
      // Note: mode is handled via options, not args
      break;
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
  };

  return names[command];
}