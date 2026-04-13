export const SLASH_COMMANDS = [
  "/new 输入你的想法",
  "/draft",
  "/create",
  "/discard",
  "/write",
  "/books",
  "/open <book>",
  "/mode <auto|semi|manual>",
  "/rewrite <n>",
  "/focus <text>",
  "/truth <file> <content>",
  "/rename <from> => <to>",
  "/replace <n> <from> => <to>",
  "/export [txt|md|epub]",
  "/help",
  "/status",
  "/clear",
  "/depth <light|normal|deep>",
  "/quit",
  "/exit",
] as const;

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
