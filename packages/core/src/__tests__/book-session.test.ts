import { describe, expect, it } from "vitest";
import {
  BookSessionSchema,
  GlobalSessionSchema,
  createBookSession,
  appendBookSessionMessage,
} from "../interaction/session.js";

describe("BookSession", () => {
  describe("BookSessionSchema", () => {
    it("parses a valid session", () => {
      const raw = {
        sessionId: "123-abc",
        bookId: "my-book",
        messages: [],
        draftRounds: [],
        events: [],
        createdAt: 1000,
        updatedAt: 1000,
      };
      const result = BookSessionSchema.parse(raw);
      expect(result.sessionId).toBe("123-abc");
      expect(result.bookId).toBe("my-book");
    });

    it("accepts null bookId for draft sessions", () => {
      const raw = {
        sessionId: "123-abc",
        bookId: null,
        messages: [],
        draftRounds: [],
        events: [],
        createdAt: 1000,
        updatedAt: 1000,
      };
      const result = BookSessionSchema.parse(raw);
      expect(result.bookId).toBeNull();
    });

    it("defaults empty arrays", () => {
      const raw = {
        sessionId: "123-abc",
        bookId: null,
        createdAt: 1000,
        updatedAt: 1000,
      };
      const result = BookSessionSchema.parse(raw);
      expect(result.messages).toEqual([]);
      expect(result.draftRounds).toEqual([]);
      expect(result.events).toEqual([]);
    });
  });

  describe("GlobalSessionSchema", () => {
    it("parses with defaults", () => {
      const result = GlobalSessionSchema.parse({});
      expect(result.automationMode).toBe("semi");
      expect(result.activeBookId).toBeUndefined();
    });

    it("parses with values", () => {
      const result = GlobalSessionSchema.parse({ activeBookId: "book-1", automationMode: "auto" });
      expect(result.activeBookId).toBe("book-1");
      expect(result.automationMode).toBe("auto");
    });
  });

  describe("createBookSession", () => {
    it("creates session with bookId", () => {
      const session = createBookSession("my-book");
      expect(session.bookId).toBe("my-book");
      expect(session.sessionId).toBeTruthy();
      expect(session.messages).toEqual([]);
      expect(session.createdAt).toBeGreaterThan(0);
      expect(session.updatedAt).toBe(session.createdAt);
    });

    it("creates session with null bookId", () => {
      const session = createBookSession(null);
      expect(session.bookId).toBeNull();
    });

    it("generates unique sessionIds", () => {
      const a = createBookSession("book");
      const b = createBookSession("book");
      expect(a.sessionId).not.toBe(b.sessionId);
    });
  });

  describe("appendBookSessionMessage", () => {
    it("appends message and updates timestamp", () => {
      const session = createBookSession("book");
      const msg = { role: "user" as const, content: "hello", timestamp: Date.now() };
      const updated = appendBookSessionMessage(session, msg);
      expect(updated.messages).toHaveLength(1);
      expect(updated.messages[0].content).toBe("hello");
      expect(updated.updatedAt).toBeGreaterThanOrEqual(session.updatedAt);
    });

    it("sorts messages by timestamp", () => {
      let session = createBookSession("book");
      session = appendBookSessionMessage(session, { role: "user" as const, content: "second", timestamp: 200 });
      session = appendBookSessionMessage(session, { role: "assistant" as const, content: "first", timestamp: 100 });
      expect(session.messages[0].content).toBe("first");
      expect(session.messages[1].content).toBe("second");
    });
  });
});
