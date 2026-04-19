const READ_ONLY_TOOLS = new Set(["read", "grep", "ls"]);

export function shouldRefreshSidebarForTool(toolName: string): boolean {
  return !READ_ONLY_TOOLS.has(toolName);
}
