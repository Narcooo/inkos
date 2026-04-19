// Pure helper functions extracted from ChatBar for reuse in ChatPage and tests.

interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestamp: number;
}

interface SharedSessionMeta {
  readonly activeBookId?: string;
  readonly automationMode?: string;
  readonly currentStage?: string;
  readonly pendingSummary?: string;
  readonly draftTitle?: string;
}

interface BookRef {
  readonly id: string;
}

export function coerceSharedSessionMessages(
  messages: ReadonlyArray<{ role: "user" | "assistant" | "system"; content: string; timestamp: number }>,
): ReadonlyArray<ChatMessage> {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
      timestamp: message.timestamp,
    }));
}

export function resolveDirectWriteTarget(
  activeBookId: string | undefined,
  books: ReadonlyArray<BookRef>,
): { bookId: string | null; reason: "active" | "single" | "missing" | "ambiguous" } {
  if (activeBookId && books.some((book) => book.id === activeBookId)) {
    return { bookId: activeBookId, reason: "active" };
  }
  if (books.length === 1) {
    return { bookId: books[0]!.id, reason: "single" };
  }
  if (books.length === 0) {
    return { bookId: null, reason: "missing" };
  }
  return { bookId: null, reason: "ambiguous" };
}

export function formatSharedSessionContext(meta: SharedSessionMeta): string {
  return [
    meta.activeBookId ?? "no-book",
    meta.draftTitle ? `draft:${meta.draftTitle}` : undefined,
    meta.automationMode ?? "semi",
    meta.currentStage,
  ].filter(Boolean).join(" · ");
}
