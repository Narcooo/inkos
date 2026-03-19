import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { StateManager } from "../state/manager.js";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_ROOT = join(tmpdir(), `inkos-manager-test-${Date.now()}`);
let mgr: StateManager;

beforeEach(async () => {
  await mkdir(TEST_ROOT, { recursive: true });
  mgr = new StateManager(TEST_ROOT);
});

afterEach(async () => {
  try { await rm(TEST_ROOT, { recursive: true, force: true }); } catch { /* ok */ }
});

// ---------------------------------------------------------------------------
// bookDir / booksDir
// ---------------------------------------------------------------------------

describe("path helpers", () => {
  it("booksDir is {root}/books", () => {
    expect(mgr.booksDir).toBe(join(TEST_ROOT, "books"));
  });

  it("bookDir returns {root}/books/{id}", () => {
    expect(mgr.bookDir("my-novel")).toBe(join(TEST_ROOT, "books", "my-novel"));
  });
});

// ---------------------------------------------------------------------------
// BookConfig CRUD
// ---------------------------------------------------------------------------

describe("saveBookConfig / loadBookConfig", () => {
  const bookConfig = {
    id: "test-book",
    title: "Test Novel",
    platform: "other" as const,
    genre: "xuanhuan",
    status: "active" as const,
    targetChapters: 100,
    chapterWordCount: 3000,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  it("saves and loads book config", async () => {
    await mgr.saveBookConfig("test-book", bookConfig);
    const loaded = await mgr.loadBookConfig("test-book");
    expect(loaded.id).toBe("test-book");
    expect(loaded.title).toBe("Test Novel");
    expect(loaded.genre).toBe("xuanhuan");
  });

  it("throws on empty book.json", async () => {
    const dir = mgr.bookDir("empty-book");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "book.json"), "", "utf-8");
    await expect(mgr.loadBookConfig("empty-book")).rejects.toThrow("empty");
  });

  it("throws on missing book.json", async () => {
    await expect(mgr.loadBookConfig("nonexistent")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// listBooks
// ---------------------------------------------------------------------------

describe("listBooks", () => {
  it("returns empty array when no books dir", async () => {
    const books = await mgr.listBooks();
    expect(books).toEqual([]);
  });

  it("returns only dirs with book.json", async () => {
    await mkdir(join(TEST_ROOT, "books", "real-book"), { recursive: true });
    await writeFile(join(TEST_ROOT, "books", "real-book", "book.json"), "{}", "utf-8");

    await mkdir(join(TEST_ROOT, "books", "not-a-book"), { recursive: true });
    // no book.json here

    const books = await mgr.listBooks();
    expect(books).toEqual(["real-book"]);
  });
});

// ---------------------------------------------------------------------------
// ChapterIndex
// ---------------------------------------------------------------------------

describe("chapterIndex", () => {
  it("returns empty array when no index.json", async () => {
    const index = await mgr.loadChapterIndex("new-book");
    expect(index).toEqual([]);
  });

  it("saves and loads chapter index", async () => {
    const chapters = [
      { number: 1, title: "第1章", wordCount: 3000, status: "approved" as const, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", auditIssues: [] },
      { number: 2, title: "第2章", wordCount: 2800, status: "drafted" as const, createdAt: "2026-01-02T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z", auditIssues: [] },
    ];
    await mgr.saveChapterIndex("idx-book", chapters);
    const loaded = await mgr.loadChapterIndex("idx-book");
    expect(loaded).toHaveLength(2);
    expect(loaded[0]!.title).toBe("第1章");
  });

  it("getNextChapterNumber returns 1 for new book", async () => {
    const next = await mgr.getNextChapterNumber("fresh");
    expect(next).toBe(1);
  });

  it("getNextChapterNumber returns max+1", async () => {
    const chapters = [
      { number: 1, title: "Ch1", wordCount: 100, status: "approved" as const, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", auditIssues: [] },
      { number: 5, title: "Ch5", wordCount: 100, status: "approved" as const, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", auditIssues: [] },
    ];
    await mgr.saveChapterIndex("gap-book", chapters);
    const next = await mgr.getNextChapterNumber("gap-book");
    expect(next).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// ProjectConfig
// ---------------------------------------------------------------------------

describe("projectConfig", () => {
  it("saves and loads project config", async () => {
    await mgr.saveProjectConfig({ name: "TestProject", version: "1.0" });
    const loaded = await mgr.loadProjectConfig();
    expect(loaded.name).toBe("TestProject");
  });

  it("throws when inkos.json does not exist", async () => {
    await expect(mgr.loadProjectConfig()).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// BookLock
// ---------------------------------------------------------------------------

describe("acquireBookLock", () => {
  it("acquires and releases lock", async () => {
    const release = await mgr.acquireBookLock("lock-book");
    expect(typeof release).toBe("function");
    await release();
    // After release, should be able to acquire again
    const release2 = await mgr.acquireBookLock("lock-book");
    await release2();
  });

  it("rejects double lock on same book", async () => {
    const release = await mgr.acquireBookLock("double-lock");
    await expect(mgr.acquireBookLock("double-lock")).rejects.toThrow("locked");
    await release();
  });
});
