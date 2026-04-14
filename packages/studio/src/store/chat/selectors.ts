import type { ChatState } from "./types";

export const chatSelectors = {
  hasPendingTool: (s: ChatState) => s.pendingBookArgs !== null,
  isCreating: (s: ChatState) => s.bookCreating,
  isEmpty: (s: ChatState) => s.messages.length === 0 && !s.loading,
};
