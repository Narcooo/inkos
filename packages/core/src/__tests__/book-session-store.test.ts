import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadBookSession,
  persistBookSession,
  listBookSessions,
  renameBookSession,
  deleteBookSession,
  migrateBookSession,
  extractFirstUserMessageTitle,
  SessionAlreadyMigratedError,
} from "../interaction/book-session-store.js";
import { createBookSession, appendBookSessionMessage } from "../interaction/session.js";
import { mkdir, writeFile } from "node:fs/promises";

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

    it("createBookSession initializes title as null", () => {
      const session = createBookSession("book");
      expect(session.title).toBeNull();
    });

    it("parses old session files without title field", async () => {
      const oldFormat = {
        sessionId: "old-session",
        bookId: "book",
        messages: [],
        draftRounds: [],
        events: [],
        createdAt: 1000,
        updatedAt: 1000,
      };
      const dir = join(tempDir, ".inkos", "sessions");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "old-session.json"), JSON.stringify(oldFormat));

      const loaded = await loadBookSession(tempDir, "old-session");
      expect(loaded).not.toBeNull();
      expect(loaded!.title).toBeNull();
    });

    it("round-trips title through persist/load", async () => {
      let session = createBookSession("book");
      session = { ...session, title: "测试标题" };
      await persistBookSession(tempDir, session);

      const loaded = await loadBookSession(tempDir, session.sessionId);
      expect(loaded!.title).toBe("测试标题");
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

  describe("renameBookSession", () => {
    it("sets title and updates updatedAt", async () => {
      const session = createBookSession("book");
      await persistBookSession(tempDir, session);
      const oldUpdatedAt = session.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 5));
      await renameBookSession(tempDir, session.sessionId, "新标题");

      const loaded = await loadBookSession(tempDir, session.sessionId);
      expect(loaded!.title).toBe("新标题");
      expect(loaded!.updatedAt).toBeGreaterThan(oldUpdatedAt);
    });

    it("returns null for non-existent session", async () => {
      const result = await renameBookSession(tempDir, "nonexistent", "title");
      expect(result).toBeNull();
    });
  });

  describe("deleteBookSession", () => {
    it("removes session file", async () => {
      const session = createBookSession("book");
      await persistBookSession(tempDir, session);

      await deleteBookSession(tempDir, session.sessionId);

      const loaded = await loadBookSession(tempDir, session.sessionId);
      expect(loaded).toBeNull();
    });

    it("does nothing for non-existent session", async () => {
      await expect(deleteBookSession(tempDir, "nonexistent")).resolves.toBeUndefined();
    });
  });

  describe("extractFirstUserMessageTitle", () => {
    it("returns null when messages array is empty", () => {
      expect(extractFirstUserMessageTitle([])).toBeNull();
    });

    it("returns null when no user message exists", () => {
      expect(extractFirstUserMessageTitle([
        { role: "assistant", content: "hi" },
        { role: "system", content: "prompt" },
      ])).toBeNull();
    });

    it("picks the first user message content", () => {
      expect(extractFirstUserMessageTitle([
        { role: "system", content: "sys" },
        { role: "user", content: "第一条提问" },
        { role: "assistant", content: "回答" },
        { role: "user", content: "第二条提问" },
      ])).toBe("第一条提问");
    });

    it("collapses whitespace into single spaces", () => {
      expect(extractFirstUserMessageTitle([
        { role: "user", content: "多行\n\n内容   有空格" },
      ])).toBe("多行 内容 有空格");
    });

    it("truncates content longer than 20 chars with ellipsis", () => {
      expect(extractFirstUserMessageTitle([
        { role: "user", content: "这是一段超过二十个字符的很长的提问内容会被截断" },
      ])).toBe("这是一段超过二十个字符的很长的提问内容会…");
    });

    it("returns null when content is only whitespace", () => {
      expect(extractFirstUserMessageTitle([
        { role: "user", content: "   \n\t   " },
      ])).toBeNull();
    });

    it("returns null for non-array input", () => {
      expect(extractFirstUserMessageTitle(null)).toBeNull();
      expect(extractFirstUserMessageTitle(undefined)).toBeNull();
      expect(extractFirstUserMessageTitle("not array")).toBeNull();
    });
  });

  describe("listBookSessions: 老 session lazy migration", () => {
    it("把 title 为 null 但已有用户消息的老 session 补写 title 并持久化", async () => {
      const session = {
        ...createBookSession("book-a"),
        title: null,
        messages: [
          { role: "user" as const, content: "帮我写下一章", timestamp: 100 },
          { role: "assistant" as const, content: "好的，正在构思...", timestamp: 200 },
        ],
      };
      await persistBookSession(tempDir, session);

      // 触发 list → 应该迁移
      const list = await listBookSessions(tempDir, "book-a");
      expect(list).toHaveLength(1);
      expect(list[0].title).toBe("帮我写下一章");

      // 验证已经落盘
      const reloaded = await loadBookSession(tempDir, session.sessionId);
      expect(reloaded!.title).toBe("帮我写下一章");
    });

    it("不覆盖已有 title 的 session", async () => {
      let session = createBookSession("book-a");
      session = {
        ...session,
        title: "原有标题",
        messages: [
          { role: "user" as const, content: "后来的消息", timestamp: 100 },
        ],
      };
      await persistBookSession(tempDir, session);

      const list = await listBookSessions(tempDir, "book-a");
      expect(list[0].title).toBe("原有标题");

      const reloaded = await loadBookSession(tempDir, session.sessionId);
      expect(reloaded!.title).toBe("原有标题");
    });

    it("没有用户消息的 session：title 保持 null，不 persist", async () => {
      const session = createBookSession("book-a");
      await persistBookSession(tempDir, session);
      const originalUpdatedAt = session.updatedAt;

      const list = await listBookSessions(tempDir, "book-a");
      expect(list[0].title).toBeNull();

      const reloaded = await loadBookSession(tempDir, session.sessionId);
      expect(reloaded!.title).toBeNull();
      expect(reloaded!.updatedAt).toBe(originalUpdatedAt);
    });

    it("多条老 session 同时迁移", async () => {
      const s1 = {
        ...createBookSession("book-b"),
        title: null,
        messages: [{ role: "user" as const, content: "问题一", timestamp: 1 }],
      };
      const s2 = {
        ...createBookSession("book-b"),
        title: null,
        messages: [{ role: "user" as const, content: "问题二", timestamp: 1 }],
      };
      await persistBookSession(tempDir, s1);
      await persistBookSession(tempDir, s2);

      const list = await listBookSessions(tempDir, "book-b");
      expect(list).toHaveLength(2);
      const titles = new Set(list.map((s) => s.title));
      expect(titles).toEqual(new Set(["问题一", "问题二"]));
    });
  });

  describe("migrateBookSession", () => {
    it("binds an orphan session to a book", async () => {
      const session = createBookSession(null);
      await persistBookSession(tempDir, session);
      const oldUpdatedAt = session.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 5));
      const migrated = await migrateBookSession(tempDir, session.sessionId, "book-1");

      expect(migrated).not.toBeNull();
      expect(migrated!.bookId).toBe("book-1");
      expect(migrated!.updatedAt).toBeGreaterThan(oldUpdatedAt);
    });

    it("returns null for non-existent session", async () => {
      const result = await migrateBookSession(tempDir, "nonexistent", "book-1");
      expect(result).toBeNull();
    });

    it("throws when session is already bound to a book", async () => {
      const session = createBookSession("book-1");
      await persistBookSession(tempDir, session);

      await expect(migrateBookSession(tempDir, session.sessionId, "book-2")).rejects.toBeInstanceOf(
        SessionAlreadyMigratedError,
      );
    });
  });
});
