import type { ChatActionSource, ChatRequestedIntent } from "./types";
import { isConfirmedProductionAction } from "../../shared/confirmed-production";

const READ_ONLY_TOOLS = new Set(["read", "grep", "ls"]);

export function shouldRefreshSidebarForTool(toolName: string): boolean {
  return !READ_ONLY_TOOLS.has(toolName);
}

export function isConfirmedProductionSend(
  actionSource: ChatActionSource,
  requestedIntent: ChatRequestedIntent | undefined,
): boolean {
  return isConfirmedProductionAction(actionSource, requestedIntent);
}
