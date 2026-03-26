import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, readdir, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateManager } from "../state/manager.js";
import type { BookConfig } from "../models/book.js";
import type { ChapterMeta } from "../models/chapter.js";

describe("StateManager", () => {
  let tempDir: string;
  let manager: StateManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "inkos-test-"));
    manager = new StateManager(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // BookConfig persistence
  // -------------------------------------------------------------------------

  describe("saveBookConfig / loadBookConfig", () => {
    const bookConfig: BookConfig = {
      id: "test-book",
      title: "Test Novel",
      platform: "tomato",
      genre: "xuanhuan",
      status: "active",
      targetChapters: 200,
      chapterWordCount: 3000,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    it("round-trips a BookConfig through save and load", async () => {
      await manager.saveBookConfig("test-book", bookConfig);
      const loaded = await manager.loadBookConfig("test-book");
      expect(loaded).toEqual(bookConfig);
    });

    it("creates the book directory on save", async () => {
      await manager.saveBookConfig("new-book", {
        ...bookConfig,
        id: "new-book",
      });
      const dirStat = await stat(manager.bookDir("new-book"));
      expect(dirStat.isDirectory()).toBe(true);
    });

    it("throws when loading a non-existent book", async () => {
      await expect(manager.loadBookConfig("nope")).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // ChapterIndex persistence
  // -------------------------------------------------------------------------

  describe("saveChapterIndex / loadChapterIndex", () => {
    const chapters: ReadonlyArray<ChapterMeta> = [
      {
        number: 1,
        title: "Ch1",
        status: "drafted",
        wordCount: 3000,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        auditIssues: [],
      },
      {
        number: 2,
        title: "Ch2",
        status: "drafting",
        wordCount: 0,
        createdAt: "2026-01-02T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        auditIssues: ["pacing issue"],
      },
    ];

    it("round-trips chapter index through save and load", async () => {
      await manager.saveChapterIndex("book-a", chapters);
      const loaded = await manager.loadChapterIndex("book-a");
      expect(loaded).toEqual(chapters);
    });

    it("returns empty array when no index exists", async () => {
      const loaded = await manager.loadChapterIndex("nonexistent");
      expect(loaded).toEqual([]);
    });

    it("creates the chapters directory on save", async () => {
      await manager.saveChapterIndex("book-b", []);
      const dirStat = await stat(
        join(manager.bookDir("book-b"), "chapters"),
      );
      expect(dirStat.isDirectory()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getNextChapterNumber
  // -------------------------------------------------------------------------

  describe("getNextChapterNumber", () => {
    it("returns 1 for an empty book (no chapters)", async () => {
      const next = await manager.getNextChapterNumber("empty-book");
      expect(next).toBe(1);
    });

    it("returns max+1 when chapters exist", async () => {
      const chapters: ReadonlyArray<ChapterMeta> = [
        {
          number: 1,
          title: "Ch1",
          status: "published",
          wordCount: 3000,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          auditIssues: [],
        },
        {
          number: 5,
          title: "Ch5",
          status: "drafted",
          wordCount: 2800,
          createdAt: "2026-01-05T00:00:00Z",
          updatedAt: "2026-01-05T00:00:00Z",
          auditIssues: [],
        },
        {
          number: 3,
          title: "Ch3",
          status: "approved",
          wordCount: 3100,
          createdAt: "2026-01-03T00:00:00Z",
          updatedAt: "2026-01-03T00:00:00Z",
          auditIssues: [],
        },
      ];
      await manager.saveChapterIndex("book-x", chapters);
      const next = await manager.getNextChapterNumber("book-x");
      expect(next).toBe(6);
    });

    it("returns 2 when only chapter 1 exists", async () => {
      const chapters: ReadonlyArray<ChapterMeta> = [
        {
          number: 1,
          title: "Ch1",
          status: "drafted",
          wordCount: 3000,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          auditIssues: [],
        },
      ];
      await manager.saveChapterIndex("book-y", chapters);
      const next = await manager.getNextChapterNumber("book-y");
      expect(next).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // listBooks
  // -------------------------------------------------------------------------

  describe("listBooks", () => {
    it("returns empty array when no books directory exists", async () => {
      const books = await manager.listBooks();
      expect(books).toEqual([]);
    });

    it("returns book IDs for directories with book.json", async () => {
      const bookConfig: BookConfig = {
        id: "alpha",
        title: "Alpha",
        platform: "tomato",
        genre: "urban",
        status: "active",
        targetChapters: 100,
        chapterWordCount: 3000,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      await manager.saveBookConfig("alpha", bookConfig);
      await manager.saveBookConfig("beta", { ...bookConfig, id: "beta", title: "Beta" });

      // Create a decoy directory without book.json
      await mkdir(join(manager.booksDir, "not-a-book"), { recursive: true });

      const books = await manager.listBooks();
      expect(books).toContain("alpha");
      expect(books).toContain("beta");
      expect(books).not.toContain("not-a-book");
      expect(books).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // snapshotState / restoreState
  // -------------------------------------------------------------------------

  describe("snapshotState / restoreState", () => {
    const bookId = "snap-book";

    beforeEach(async () => {
      const storyDir = join(manager.bookDir(bookId), "story");
      await mkdir(storyDir, { recursive: true });
      await writeFile(
        join(storyDir, "current_state.md"),
        "# State at ch1",
        "utf-8",
      );
      await writeFile(
        join(storyDir, "particle_ledger.md"),
        "# Ledger at ch1",
        "utf-8",
      );
      await writeFile(
        join(storyDir, "pending_hooks.md"),
        "# Hooks at ch1",
        "utf-8",
      );
    });

    it("snapshots current state files to a numbered directory", async () => {
      await manager.snapshotState(bookId, 1);

      const snapshotDir = join(
        manager.bookDir(bookId),
        "story",
        "snapshots",
        "1",
      );
      const state = await readFile(
        join(snapshotDir, "current_state.md"),
        "utf-8",
      );
      expect(state).toBe("# State at ch1");

      const ledger = await readFile(
        join(snapshotDir, "particle_ledger.md"),
        "utf-8",
      );
      expect(ledger).toBe("# Ledger at ch1");

      const hooks = await readFile(
        join(snapshotDir, "pending_hooks.md"),
        "utf-8",
      );
      expect(hooks).toBe("# Hooks at ch1");
    });

    it("restores state from a previous snapshot", async () => {
      await manager.snapshotState(bookId, 1);

      // Modify the current state files
      const storyDir = join(manager.bookDir(bookId), "story");
      await writeFile(
        join(storyDir, "current_state.md"),
        "# State at ch2 (modified)",
        "utf-8",
      );
      await writeFile(
        join(storyDir, "particle_ledger.md"),
        "# Ledger at ch2 (modified)",
        "utf-8",
      );
      await writeFile(
        join(storyDir, "pending_hooks.md"),
        "# Hooks at ch2 (modified)",
        "utf-8",
      );

      const restored = await manager.restoreState(bookId, 1);
      expect(restored).toBe(true);

      // Verify restored content
      const state = await readFile(
        join(storyDir, "current_state.md"),
        "utf-8",
      );
      expect(state).toBe("# State at ch1");

      const ledger = await readFile(
        join(storyDir, "particle_ledger.md"),
        "utf-8",
      );
      expect(ledger).toBe("# Ledger at ch1");
    });

    it("returns false when restoring from non-existent snapshot", async () => {
      const restored = await manager.restoreState(bookId, 999);
      expect(restored).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // acquireBookLock
  // -------------------------------------------------------------------------

  describe("acquireBookLock", () => {
    it("acquires a lock and returns a release function", async () => {
      // Ensure book directory exists
      await mkdir(manager.bookDir("lock-book"), { recursive: true });

      const release = await manager.acquireBookLock("lock-book");
      expect(typeof release).toBe("function");

      // Lock file should exist
      const lockPath = join(manager.bookDir("lock-book"), ".write.lock");
      const lockStat = await stat(lockPath);
      expect(lockStat.isFile()).toBe(true);

      // Release the lock
      await release();

      // Lock file should be gone
      await expect(stat(lockPath)).rejects.toThrow();
    });

    it("throws when lock is already held", async () => {
      await mkdir(manager.bookDir("lock-book-2"), { recursive: true });

      const release = await manager.acquireBookLock("lock-book-2");

      await expect(
        manager.acquireBookLock("lock-book-2"),
      ).rejects.toThrow(/is locked/);

      await release();
    });

    it("allows re-acquiring lock after release", async () => {
      await mkdir(manager.bookDir("lock-book-3"), { recursive: true });

      const release1 = await manager.acquireBookLock("lock-book-3");
      await release1();

      const release2 = await manager.acquireBookLock("lock-book-3");
      expect(typeof release2).toBe("function");
      await release2();
    });
  });

  // -------------------------------------------------------------------------
  // Path helpers
  // -------------------------------------------------------------------------

  describe("path helpers", () => {
    it("booksDir points to <projectRoot>/books", () => {
      expect(manager.booksDir).toBe(join(tempDir, "books"));
    });

    it("bookDir returns <booksDir>/<bookId>", () => {
      expect(manager.bookDir("my-book")).toBe(
        join(tempDir, "books", "my-book"),
      );
    });
  });

  // -------------------------------------------------------------------------
  // readChapterContent
  // -------------------------------------------------------------------------

  describe("readChapterContent", () => {
    const bookId = "read-ch-book";

    beforeEach(async () => {
      const chaptersDir = join(manager.bookDir(bookId), "chapters");
      await mkdir(chaptersDir, { recursive: true });
      await writeFile(
        join(chaptersDir, "0001_test_chapter.md"),
        "# 第1章 测试章节\n\n这是正文内容。\n第二段。",
        "utf-8",
      );
    });

    it("reads chapter content stripping the title line", async () => {
      const content = await manager.readChapterContent(bookId, 1);
      expect(content).toBe("这是正文内容。\n第二段。");
      expect(content).not.toContain("# 第1章");
    });

    it("throws when chapter file does not exist", async () => {
      await expect(manager.readChapterContent(bookId, 99)).rejects.toThrow(
        /Chapter 99 file not found/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // saveChapterRevision / listChapterRevisions
  // -------------------------------------------------------------------------

  describe("saveChapterRevision / listChapterRevisions", () => {
    const bookId = "rev-book";

    beforeEach(async () => {
      const chaptersDir = join(manager.bookDir(bookId), "chapters");
      await mkdir(chaptersDir, { recursive: true });
    });

    it("saves the first revision as v1.md", async () => {
      const version = await manager.saveChapterRevision(bookId, 1, "original content");
      expect(version).toBe(1);

      const revPath = join(
        manager.bookDir(bookId), "chapters", "revisions", "1", "v1.md",
      );
      const saved = await readFile(revPath, "utf-8");
      expect(saved).toBe("original content");
    });

    it("auto-increments version numbers", async () => {
      await manager.saveChapterRevision(bookId, 2, "v1 content");
      const v2 = await manager.saveChapterRevision(bookId, 2, "v2 content");
      const v3 = await manager.saveChapterRevision(bookId, 2, "v3 content");

      expect(v2).toBe(2);
      expect(v3).toBe(3);

      const revDir = join(
        manager.bookDir(bookId), "chapters", "revisions", "2",
      );
      const files = await readdir(revDir);
      expect(files.sort()).toEqual(["v1.md", "v2.md", "v3.md"]);
    });

    it("listChapterRevisions returns empty array when no revisions exist", async () => {
      const revisions = await manager.listChapterRevisions(bookId, 1);
      expect(revisions).toEqual([]);
    });

    it("listChapterRevisions returns sorted revisions", async () => {
      await manager.saveChapterRevision(bookId, 3, "first");
      await manager.saveChapterRevision(bookId, 3, "second");

      const revisions = await manager.listChapterRevisions(bookId, 3);
      expect(revisions).toHaveLength(2);
      expect(revisions[0]!.version).toBe(1);
      expect(revisions[1]!.version).toBe(2);
      expect(revisions[0]!.filePath).toContain("v1.md");
      expect(revisions[1]!.filePath).toContain("v2.md");
    });
  });
});
