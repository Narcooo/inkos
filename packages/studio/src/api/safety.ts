// Validates book IDs to prevent path traversal in API requests.

/** Validates bookId — blocks traversal sequences and null bytes. */
export function isSafeBookId(bookId: string): boolean {
  return (
    typeof bookId === "string"
    && bookId.length > 0
    && bookId.trim() === bookId
    && bookId !== "."
    && bookId !== ".."
    && !bookId.includes("..")
    && !/[\\/\0]/.test(bookId)
  );
}
