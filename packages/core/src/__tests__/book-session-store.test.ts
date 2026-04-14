import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadBookSession,
  persistBookSession,
  listBookSessions,
  findOrCreateBookSession,
} from "../interaction/book-session-store.js";
import { createBookSession, appendBookSessionMessage } from "../interaction/session.js";

describe("book-session-store", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "inkos-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("persistBookSession + loadBookSession", () => {
    it("round-trips a session", async () => {
      const session = createBookSession("my-book");
      await persistBookSession(tempDir, session);
      const loaded = await loadBookSession(tempDir, session.sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded!.sessionId).toBe(session.sessionId);
      expect(loaded!.bookId).toBe("my-book");
    });

    it("returns null for non-existent session", async () => {
      const loaded = await loadBookSession(tempDir, "nonexistent");
      expect(loaded).toBeNull();
    });

    it("persists messages", async () => {
      let session = createBookSession("book");
      session = appendBookSessionMessage(session, { role: "user" as const, content: "test", timestamp: 100 });
      await persistBookSession(tempDir, session);
      const loaded = await loadBookSession(tempDir, session.sessionId);
      expect(loaded!.messages).toHaveLength(1);
      expect(loaded!.messages[0].content).toBe("test");
    });
  });

  describe("listBookSessions", () => {
    it("returns empty for no sessions", async () => {
      const list = await listBookSessions(tempDir, "no-book");
      expect(list).toEqual([]);
    });

    it("filters by bookId", async () => {
      const s1 = createBookSession("book-a");
      const s2 = createBookSession("book-b");
      const s3 = createBookSession("book-a");
      await persistBookSession(tempDir, s1);
      await persistBookSession(tempDir, s2);
      await persistBookSession(tempDir, s3);

      const listA = await listBookSessions(tempDir, "book-a");
      expect(listA).toHaveLength(2);
      expect(listA.every((s) => s.bookId === "book-a")).toBe(true);

      const listB = await listBookSessions(tempDir, "book-b");
      expect(listB).toHaveLength(1);
    });

    it("sorts by updatedAt descending", async () => {
      const s1 = { ...createBookSession("book"), updatedAt: 100 };
      const s2 = { ...createBookSession("book"), updatedAt: 300 };
      const s3 = { ...createBookSession("book"), updatedAt: 200 };
      await persistBookSession(tempDir, s1);
      await persistBookSession(tempDir, s2);
      await persistBookSession(tempDir, s3);

      const list = await listBookSessions(tempDir, "book");
      expect(list[0].updatedAt).toBe(300);
      expect(list[1].updatedAt).toBe(200);
      expect(list[2].updatedAt).toBe(100);
    });

    it("lists null bookId sessions", async () => {
      const s = createBookSession(null);
      await persistBookSession(tempDir, s);
      const list = await listBookSessions(tempDir, null);
      expect(list).toHaveLength(1);
    });
  });

  describe("findOrCreateBookSession", () => {
    it("creates new if none exist", async () => {
      const session = await findOrCreateBookSession(tempDir, "new-book");
      expect(session.bookId).toBe("new-book");
      // Verify it was persisted
      const loaded = await loadBookSession(tempDir, session.sessionId);
      expect(loaded).not.toBeNull();
    });

    it("returns existing if found", async () => {
      const existing = createBookSession("book");
      await persistBookSession(tempDir, existing);
      const found = await findOrCreateBookSession(tempDir, "book");
      expect(found.sessionId).toBe(existing.sessionId);
    });
  });
});
