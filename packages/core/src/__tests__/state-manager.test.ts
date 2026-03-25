import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir, stat } from "node:fs/promises";
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
        lengthWarnings: [],
      },
      {
        number: 2,
        title: "Ch2",
        status: "drafting",
        wordCount: 0,
        createdAt: "2026-01-02T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        auditIssues: ["pacing issue"],
        lengthWarnings: [],
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
          lengthWarnings: [],
        },
        {
          number: 5,
          title: "Ch5",
          status: "drafted",
          wordCount: 2800,
          createdAt: "2026-01-05T00:00:00Z",
          updatedAt: "2026-01-05T00:00:00Z",
          auditIssues: [],
          lengthWarnings: [],
        },
        {
          number: 3,
          title: "Ch3",
          status: "approved",
          wordCount: 3100,
          createdAt: "2026-01-03T00:00:00Z",
          updatedAt: "2026-01-03T00:00:00Z",
          auditIssues: [],
          lengthWarnings: [],
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
          lengthWarnings: [],
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

    it("copies structured runtime state into snapshot/state when present", async () => {
      const stateDir = manager.stateDir(bookId);
      await mkdir(stateDir, { recursive: true });
      await writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 1,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      );

      await manager.snapshotState(bookId, 1);

      const snapshotManifest = await readFile(
        join(manager.bookDir(bookId), "story", "snapshots", "1", "state", "manifest.json"),
        "utf-8",
      );
      expect(snapshotManifest).toContain("\"schemaVersion\": 2");
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

    it("restores structured runtime state files from snapshot/state", async () => {
      const stateDir = manager.stateDir(bookId);
      await mkdir(stateDir, { recursive: true });
      await writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 1,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      );

      await manager.snapshotState(bookId, 1);
      await writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 9,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      );

      const restored = await manager.restoreState(bookId, 1);
      expect(restored).toBe(true);

      const manifest = await readFile(join(stateDir, "manifest.json"), "utf-8");
      expect(manifest).toContain("\"lastAppliedChapter\": 1");
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

    it("allows only one concurrent lock claimant", async () => {
      await mkdir(manager.bookDir("lock-book-4"), { recursive: true });

      const results = await Promise.allSettled([
        manager.acquireBookLock("lock-book-4"),
        manager.acquireBookLock("lock-book-4"),
      ]);

      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");

      for (const result of fulfilled) {
        await result.value();
      }

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0]?.reason)).toMatch(/is locked/);
    });

    it("reclaims a stale lock when the recorded pid is no longer alive", async () => {
      await mkdir(manager.bookDir("lock-book-5"), { recursive: true });
      const lockPath = join(manager.bookDir("lock-book-5"), ".write.lock");
      await writeFile(lockPath, "pid:424242 ts:123", "utf-8");

      const killSpy = vi.spyOn(process, "kill").mockImplementation((((pid: number) => {
        if (pid === 424242) {
          const error = new Error("no such process") as NodeJS.ErrnoException;
          error.code = "ESRCH";
          throw error;
        }
        return true;
      }) as unknown) as typeof process.kill);

      try {
        const release = await manager.acquireBookLock("lock-book-5");
        const lockData = await readFile(lockPath, "utf-8");

        expect(typeof release).toBe("function");
        expect(lockData).toContain(`pid:${process.pid}`);

        await release();
      } finally {
        killSpy.mockRestore();
      }
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

    it("stateDir returns <bookDir>/story/state", () => {
      expect(manager.stateDir("my-book")).toBe(
        join(tempDir, "books", "my-book", "story", "state"),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Input governance control docs
  // -------------------------------------------------------------------------

  describe("ensureControlDocuments", () => {
    it("creates author intent, current focus, and runtime directory", async () => {
      await manager.ensureControlDocuments(
        "control-book",
        "# Initial Brief\n\nKeep the focus on mentor conflict.\n",
      );

      const storyDir = join(manager.bookDir("control-book"), "story");
      const authorIntent = await readFile(
        join(storyDir, "author_intent.md"),
        "utf-8",
      );
      const currentFocus = await readFile(
        join(storyDir, "current_focus.md"),
        "utf-8",
      );
      const runtimeStat = await stat(join(storyDir, "runtime"));

      expect(authorIntent).toContain("mentor conflict");
      expect(currentFocus).toContain("Current Focus");
      expect(runtimeStat.isDirectory()).toBe(true);
    });

    it("bootstraps and returns safe defaults for legacy books", async () => {
      const storyDir = join(manager.bookDir("legacy-book"), "story");
      await mkdir(storyDir, { recursive: true });
      await writeFile(
        join(storyDir, "story_bible.md"),
        "# Story Bible\n\nLegacy books may not have control docs yet.\n",
        "utf-8",
      );

      const controlDocs = await manager.loadControlDocuments("legacy-book");

      expect(controlDocs.authorIntent).toContain("# Author Intent");
      expect(controlDocs.currentFocus).toContain("# Current Focus");
      expect(controlDocs.runtimeDir).toBe(join(storyDir, "runtime"));
    });

    it("creates localized Chinese defaults for Chinese books", async () => {
      await manager.saveBookConfig("zh-book", {
        id: "zh-book",
        title: "中文书",
        platform: "tomato",
        genre: "other",
        status: "outlining",
        targetChapters: 100,
        chapterWordCount: 2200,
        language: "zh",
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T00:00:00Z",
      });

      await manager.ensureControlDocuments("zh-book");

      const storyDir = join(manager.bookDir("zh-book"), "story");
      const authorIntent = await readFile(
        join(storyDir, "author_intent.md"),
        "utf-8",
      );
      const currentFocus = await readFile(
        join(storyDir, "current_focus.md"),
        "utf-8",
      );

      expect(authorIntent).toContain("# 作者意图");
      expect(currentFocus).toContain("# 当前聚焦");
      expect(currentFocus).not.toContain("# Current Focus");
    });

    it("bootstraps structured runtime state from legacy markdown truth files", async () => {
      const bookId = "runtime-state-book";
      const storyDir = join(manager.bookDir(bookId), "story");
      await mkdir(storyDir, { recursive: true });
      await Promise.all([
        writeFile(
          join(storyDir, "current_state.md"),
          [
            "# Current State",
            "",
            "| Field | Value |",
            "| --- | --- |",
            "| Current Chapter | 3 |",
            "| Current Goal | Trace the mentor debt |",
            "",
          ].join("\n"),
          "utf-8",
        ),
        writeFile(
          join(storyDir, "pending_hooks.md"),
          [
            "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
            "| --- | --- | --- | --- | --- | --- | --- |",
            "| mentor-debt | 1 | relationship | open | 3 | 10 | Still unresolved |",
            "",
          ].join("\n"),
          "utf-8",
        ),
        writeFile(
          join(storyDir, "chapter_summaries.md"),
          [
            "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
            "| 3 | River Ledger | Lin Yue | He checks the old ledger | Debt sharpens | mentor-debt advanced | tense | mainline |",
            "",
          ].join("\n"),
          "utf-8",
        ),
      ]);

      await manager.ensureRuntimeState(bookId, 3);

      const manifest = await readFile(join(manager.stateDir(bookId), "manifest.json"), "utf-8");
      const currentState = await readFile(join(manager.stateDir(bookId), "current_state.json"), "utf-8");

      expect(manifest).toContain("\"schemaVersion\": 2");
      expect(currentState).toContain("\"chapter\": 3");
    });

    it("does not treat future hook start chapters as lastAppliedChapter during bootstrap", async () => {
      const bookId = "runtime-state-future-hooks-book";
      const storyDir = join(manager.bookDir(bookId), "story");
      await mkdir(storyDir, { recursive: true });
      await Promise.all([
        writeFile(
          join(storyDir, "current_state.md"),
          [
            "# Current State",
            "",
            "| Field | Value |",
            "| --- | --- |",
            "| Current Chapter | 1 |",
            "| Current Goal | Survive the harbor fallout |",
            "",
          ].join("\n"),
          "utf-8",
        ),
        writeFile(
          join(storyDir, "pending_hooks.md"),
          [
            "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
            "| --- | --- | --- | --- | --- | --- | --- |",
            "| long-payoff-1 | 108 | mystery | open | 1 | 108 | Future payoff anchor |",
            "| long-payoff-2 | 181 | relationship | open | 1 | 181 | Even later payoff anchor |",
            "",
          ].join("\n"),
          "utf-8",
        ),
        writeFile(
          join(storyDir, "chapter_summaries.md"),
          [
            "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
            "| 1 | Harbor Ash | Lin Yue | He survives the harbor fallout | The debt line opens | long-payoff-1 seeded | tense | opening |",
            "",
          ].join("\n"),
          "utf-8",
        ),
      ]);

      await manager.ensureRuntimeState(bookId, 1);

      const manifest = JSON.parse(
        await readFile(join(manager.stateDir(bookId), "manifest.json"), "utf-8"),
      ) as { lastAppliedChapter: number };

      expect(manifest.lastAppliedChapter).toBe(1);
    });
  });
});
