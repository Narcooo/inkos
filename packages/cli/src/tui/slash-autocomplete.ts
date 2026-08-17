import type { CliLanguage } from "../localization.js";

const SLASH_COMMAND_VARIANTS: ReadonlyArray<{ zh: string; en: string }> = [
  { zh: "/new 输入你的想法", en: "/new describe your idea" },
  { zh: "/short 输入短篇方向", en: "/short describe the short" },
  { zh: "/play [open|guided] 输入互动世界开局", en: "/play [open|guided] describe the opening" },
  { zh: "/cover 输入封面方向", en: "/cover describe the cover" },
  { zh: "/write", en: "/write" },
  { zh: "/confirm", en: "/confirm" },
  { zh: "/cancel", en: "/cancel" },
  { zh: "/model <model>", en: "/model <model>" },
  { zh: "/help", en: "/help" },
  { zh: "/status", en: "/status" },
  { zh: "/clear", en: "/clear" },
  { zh: "/depth <light|normal|deep>", en: "/depth <light|normal|deep>" },
  { zh: "/quit", en: "/quit" },
  { zh: "/exit", en: "/exit" },
];

export function buildSlashCommands(language: CliLanguage = "zh"): readonly string[] {
  return SLASH_COMMAND_VARIANTS.map((variant) => (language === "en" ? variant.en : variant.zh));
}

export const SLASH_COMMANDS = buildSlashCommands("zh");

export type SlashNavigationDirection = "up" | "down";

export function getSlashSuggestions(input: string, commands: readonly string[]): string[] {
  const value = input.trim();
  if (!value.startsWith("/")) {
    return [];
  }

  return commands.filter((command) => slashCommandStem(command).startsWith(value));
}

export function getNextSlashSelection(
  currentIndex: number,
  suggestionCount: number,
  direction: SlashNavigationDirection,
): number {
  if (suggestionCount <= 0) {
    return 0;
  }

  if (direction === "down") {
    return (currentIndex + 1) % suggestionCount;
  }

  return (currentIndex - 1 + suggestionCount) % suggestionCount;
}

export function applySlashSuggestion(
  _input: string,
  suggestions: readonly string[],
  selectedIndex: number,
): string {
  const suggestion = suggestions[selectedIndex] ?? "";
  return slashSuggestionInsertion(suggestion);
}

function slashCommandStem(command: string): string {
  return command.match(/^\/\S+/)?.[0] ?? command;
}

function slashSuggestionInsertion(suggestion: string): string {
  const stem = slashCommandStem(suggestion);
  return suggestion === stem ? stem : `${stem} `;
}
