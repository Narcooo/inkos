import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app.js";

describe("book read APIs", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function createProjectFixture(): Promise<string> {
    const projectRoot = await mkdtemp(join(tmpdir(), "inkos-studio-books-"));
    tempRoots.push(projectRoot);

    const bookDir = join(projectRoot, "books", "jade-city");
    const chaptersDir = join(bookDir, "chapters");
    const storyDir = join(bookDir, "story");

    await mkdir(chaptersDir, { recursive: true });
    await mkdir(storyDir, { recursive: true });

    await writeFile(join(bookDir, "book.json"), JSON.stringify({
      id: "jade-city",
      title: "Jade City",
      platform: "qidian",
      genre: "urban-fantasy",
      status: "active",
      targetChapters: 12,
      chapterWordCount: 2500,
      language: "en",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-02T00:00:00.000Z",
    }, null, 2));

    await writeFile(join(chaptersDir, "index.json"), JSON.stringify([
      {
        number: 1,
        title: "The Door Opens",
        status: "approved",
        wordCount: 1234,
        createdAt: "2026-03-01T10:00:00.000Z",
        updatedAt: "2026-03-01T11:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      },
      {
        number: 2,
        title: "A Debt Comes Due",
        status: "ready-for-review",
        wordCount: 1567,
        createdAt: "2026-03-02T10:00:00.000Z",
        updatedAt: "2026-03-02T11:00:00.000Z",
        auditIssues: ["[warning] tighten ending beat"],
        lengthWarnings: [],
        reviewNote: "Check the reveal pacing.",
      },
    ], null, 2));

    await writeFile(join(chaptersDir, "0001_the-door-opens.md"), "# The Door Opens\n\nA first chapter.\n");
    await writeFile(join(chaptersDir, "0002_a-debt-comes-due.md"), "# A Debt Comes Due\n\nA second chapter.\n");

    await writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Lan owes a favor.\n");
    await writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n- The debt marker has not resurfaced yet.\n");

    return projectRoot;
  }

  it("lists books with computed chapter stats", async () => {
    const projectRoot = await createProjectFixture();
    const app = createApp({ projectRoot });

    const response = await app.request("/api/books");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      {
        id: "jade-city",
        title: "Jade City",
        status: "active",
        platform: "qidian",
        genre: "urban-fantasy",
        targetChapters: 12,
        chapters: 2,
        chapterCount: 2,
        lastChapterNumber: 2,
        totalWords: 2801,
        approvedChapters: 1,
        pendingReview: 1,
        pendingReviewChapters: 1,
        failedReview: 0,
        failedChapters: 0,
        recentRunStatus: null,
        updatedAt: "2026-03-02T00:00:00.000Z",
      },
    ]);
  });

  it("returns a book detail payload", async () => {
    const projectRoot = await createProjectFixture();
    const app = createApp({ projectRoot });

    const response = await app.request("/api/books/jade-city");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "jade-city",
      title: "Jade City",
      status: "active",
      platform: "qidian",
      genre: "urban-fantasy",
      targetChapters: 12,
      chapters: 2,
      chapterCount: 2,
      lastChapterNumber: 2,
      totalWords: 2801,
      approvedChapters: 1,
      pendingReview: 1,
      pendingReviewChapters: 1,
      failedReview: 0,
      failedChapters: 0,
      recentRunStatus: null,
      updatedAt: "2026-03-02T00:00:00.000Z",
      createdAt: "2026-03-01T00:00:00.000Z",
      chapterWordCount: 2500,
      language: "en",
    });
  });

  it("lists chapter summaries and loads chapter detail via padded filenames", async () => {
    const projectRoot = await createProjectFixture();
    const app = createApp({ projectRoot });

    const summariesResponse = await app.request("/api/books/jade-city/chapters");
    expect(summariesResponse.status).toBe(200);
    await expect(summariesResponse.json()).resolves.toEqual([
      {
        number: 1,
        title: "The Door Opens",
        status: "approved",
        wordCount: 1234,
        auditIssueCount: 0,
        updatedAt: "2026-03-01T11:00:00.000Z",
        fileName: "0001_the-door-opens.md",
      },
      {
        number: 2,
        title: "A Debt Comes Due",
        status: "ready-for-review",
        wordCount: 1567,
        auditIssueCount: 1,
        updatedAt: "2026-03-02T11:00:00.000Z",
        fileName: "0002_a-debt-comes-due.md",
      },
    ]);

    const detailResponse = await app.request("/api/books/jade-city/chapters/2");
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toEqual({
      number: 2,
      title: "A Debt Comes Due",
      status: "ready-for-review",
      wordCount: 1567,
      auditIssueCount: 1,
      updatedAt: "2026-03-02T11:00:00.000Z",
      fileName: "0002_a-debt-comes-due.md",
      auditIssues: ["[warning] tighten ending beat"],
      reviewNote: "Check the reveal pacing.",
      content: "# A Debt Comes Due\n\nA second chapter.\n",
    });
  });

  it("saves chapter markdown in place and refreshes chapter metadata without renaming the file", async () => {
    const projectRoot = await createProjectFixture();
    const app = createApp({ projectRoot });

    const response = await app.request("/api/books/jade-city/chapters/2", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: "# A New Visible Title\n\nFresh prose lands here.",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      number: 2,
      title: "A New Visible Title",
      status: "ready-for-review",
      wordCount: 4,
      auditIssueCount: 1,
      updatedAt: expect.any(String),
      fileName: "0002_a-debt-comes-due.md",
      auditIssues: ["[warning] tighten ending beat"],
      reviewNote: "Check the reveal pacing.",
      content: "# A New Visible Title\n\nFresh prose lands here.",
    });

    await expect(readFile(join(projectRoot, "books", "jade-city", "chapters", "0002_a-debt-comes-due.md"), "utf-8")).resolves.toBe(
      "# A New Visible Title\n\nFresh prose lands here.",
    );

    await expect(readFile(join(projectRoot, "books", "jade-city", "chapters", "index.json"), "utf-8").then((raw) => JSON.parse(raw))).resolves.toEqual([
      {
        number: 1,
        title: "The Door Opens",
        status: "approved",
        wordCount: 1234,
        createdAt: "2026-03-01T10:00:00.000Z",
        updatedAt: "2026-03-01T11:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      },
      {
        number: 2,
        title: "A New Visible Title",
        status: "ready-for-review",
        wordCount: 4,
        createdAt: "2026-03-02T10:00:00.000Z",
        updatedAt: expect.any(String),
        auditIssues: ["[warning] tighten ending beat"],
        lengthWarnings: [],
        reviewNote: "Check the reveal pacing.",
      },
    ]);
  });

  it("saves chapters by padded-number prefix even when the filename separator changes", async () => {
    const projectRoot = await createProjectFixture();
    const chaptersDir = join(projectRoot, "books", "jade-city", "chapters");
    await rm(join(chaptersDir, "0002_a-debt-comes-due.md"));
    await writeFile(join(chaptersDir, "0002-a-debt-comes-due.md"), "# A Debt Comes Due\n\nA second chapter.\n");

    const app = createApp({ projectRoot });
    const response = await app.request("/api/books/jade-city/chapters/2", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: "# A Debt Comes Due\n\nUpdated through a hyphenated filename.",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      number: 2,
      title: "A Debt Comes Due",
      status: "ready-for-review",
      wordCount: 5,
      auditIssueCount: 1,
      updatedAt: expect.any(String),
      fileName: "0002-a-debt-comes-due.md",
      auditIssues: ["[warning] tighten ending beat"],
      reviewNote: "Check the reveal pacing.",
      content: "# A Debt Comes Due\n\nUpdated through a hyphenated filename.",
    });

    await expect(readFile(join(chaptersDir, "0002-a-debt-comes-due.md"), "utf-8")).resolves.toBe(
      "# A Debt Comes Due\n\nUpdated through a hyphenated filename.",
    );
  });

  it("strips generated chapter-number headings when refreshing saved metadata", async () => {
    const projectRoot = await createProjectFixture();
    const app = createApp({ projectRoot });

    const response = await app.request("/api/books/jade-city/chapters/2", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: "# Chapter 2: Cleaner Signals\n\nFresh prose lands here.",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      number: 2,
      title: "Cleaner Signals",
      status: "ready-for-review",
      wordCount: 4,
      auditIssueCount: 1,
      updatedAt: expect.any(String),
      fileName: "0002_a-debt-comes-due.md",
      auditIssues: ["[warning] tighten ending beat"],
      reviewNote: "Check the reveal pacing.",
      content: "# Chapter 2: Cleaner Signals\n\nFresh prose lands here.",
    });

    await expect(readFile(join(projectRoot, "books", "jade-city", "chapters", "index.json"), "utf-8").then((raw) => JSON.parse(raw))).resolves.toEqual([
      {
        number: 1,
        title: "The Door Opens",
        status: "approved",
        wordCount: 1234,
        createdAt: "2026-03-01T10:00:00.000Z",
        updatedAt: "2026-03-01T11:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      },
      {
        number: 2,
        title: "Cleaner Signals",
        status: "ready-for-review",
        wordCount: 4,
        createdAt: "2026-03-02T10:00:00.000Z",
        updatedAt: expect.any(String),
        auditIssues: ["[warning] tighten ending beat"],
        lengthWarnings: [],
        reviewNote: "Check the reveal pacing.",
      },
    ]);
  });

  it("approves and rejects chapters through review routes", async () => {
    const projectRoot = await createProjectFixture();
    const app = createApp({ projectRoot });

    const approveResponse = await app.request("/api/books/jade-city/review/approve", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ chapterNumber: 2 }),
    });

    expect(approveResponse.status).toBe(200);
    await expect(approveResponse.json()).resolves.toEqual({
      number: 2,
      title: "A Debt Comes Due",
      status: "approved",
      wordCount: 1567,
      auditIssueCount: 1,
      updatedAt: expect.any(String),
      fileName: "0002_a-debt-comes-due.md",
      auditIssues: ["[warning] tighten ending beat"],
      reviewNote: "Check the reveal pacing.",
      content: "# A Debt Comes Due\n\nA second chapter.\n",
    });

    const rejectResponse = await app.request("/api/books/jade-city/review/reject", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ chapterNumber: 1, reason: "Needs a stronger opening image." }),
    });

    expect(rejectResponse.status).toBe(200);
    await expect(rejectResponse.json()).resolves.toEqual({
      number: 1,
      title: "The Door Opens",
      status: "rejected",
      wordCount: 1234,
      auditIssueCount: 0,
      updatedAt: expect.any(String),
      fileName: "0001_the-door-opens.md",
      auditIssues: [],
      reviewNote: "Needs a stronger opening image.",
      content: "# The Door Opens\n\nA first chapter.\n",
    });
  });

  it("lists supported truth files and marks optional missing files unavailable", async () => {
    const projectRoot = await createProjectFixture();
    const app = createApp({ projectRoot });

    const summariesResponse = await app.request("/api/books/jade-city/truth-files");
    expect(summariesResponse.status).toBe(200);
    await expect(summariesResponse.json()).resolves.toEqual([
      {
        name: "current_state.md",
        label: "Current State",
        exists: true,
        path: "story/current_state.md",
        optional: false,
        available: true,
      },
      {
        name: "particle_ledger.md",
        label: "Particle Ledger",
        exists: false,
        path: "story/particle_ledger.md",
        optional: true,
        available: false,
      },
      {
        name: "pending_hooks.md",
        label: "Pending Hooks",
        exists: true,
        path: "story/pending_hooks.md",
        optional: false,
        available: true,
      },
      {
        name: "chapter_summaries.md",
        label: "Chapter Summaries",
        exists: false,
        path: "story/chapter_summaries.md",
        optional: true,
        available: false,
      },
      {
        name: "subplot_board.md",
        label: "Subplot Board",
        exists: false,
        path: "story/subplot_board.md",
        optional: true,
        available: false,
      },
      {
        name: "emotional_arcs.md",
        label: "Emotional Arcs",
        exists: false,
        path: "story/emotional_arcs.md",
        optional: true,
        available: false,
      },
      {
        name: "character_matrix.md",
        label: "Character Matrix",
        exists: false,
        path: "story/character_matrix.md",
        optional: true,
        available: false,
      },
    ]);

    const detailResponse = await app.request("/api/books/jade-city/truth-files/particle_ledger.md");
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toEqual({
      name: "particle_ledger.md",
      label: "Particle Ledger",
      exists: false,
      path: "story/particle_ledger.md",
      optional: true,
      available: false,
      content: null,
    });
  });

  it("returns readable JSON errors for missing books, chapters, and unsupported truth files", async () => {
    const projectRoot = await createProjectFixture();
    const app = createApp({ projectRoot });

    const missingBook = await app.request("/api/books/missing-book");
    expect(missingBook.status).toBe(404);
    await expect(missingBook.json()).resolves.toEqual({
      error: {
        code: "BOOK_NOT_FOUND",
        message: 'Book "missing-book" not found.',
      },
    });

    const missingChapter = await app.request("/api/books/jade-city/chapters/9");
    expect(missingChapter.status).toBe(404);
    await expect(missingChapter.json()).resolves.toEqual({
      error: {
        code: "CHAPTER_NOT_FOUND",
        message: 'Chapter 9 not found for book "jade-city".',
      },
    });

    const missingTruthFile = await app.request("/api/books/jade-city/truth-files/not-real.md");
    expect(missingTruthFile.status).toBe(404);
    await expect(missingTruthFile.json()).resolves.toEqual({
      error: {
        code: "TRUTH_FILE_NOT_FOUND",
        message: 'Truth file "not-real.md" is not supported for book "jade-city".',
      },
    });
  });

  it("returns readable JSON errors for invalid chapter save and review payloads", async () => {
    const projectRoot = await createProjectFixture();
    const app = createApp({ projectRoot });

    const invalidSave = await app.request("/api/books/jade-city/chapters/2", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: 42 }),
    });

    expect(invalidSave.status).toBe(400);
    await expect(invalidSave.json()).resolves.toEqual({
      error: {
        code: "INVALID_PAYLOAD",
        message: 'Expected JSON payload with string field "content".',
      },
    });

    const invalidReject = await app.request("/api/books/jade-city/review/reject", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ chapterNumber: 2, reason: 99 }),
    });

    expect(invalidReject.status).toBe(400);
    await expect(invalidReject.json()).resolves.toEqual({
      error: {
        code: "INVALID_PAYLOAD",
        message: 'Expected JSON payload with positive integer "chapterNumber" and optional string "reason".',
      },
    });
  });

  it("returns readable JSON errors for missing books and chapters on write and review routes", async () => {
    const projectRoot = await createProjectFixture();
    const app = createApp({ projectRoot });

    const missingChapterSave = await app.request("/api/books/jade-city/chapters/9", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: "# Missing\n" }),
    });

    expect(missingChapterSave.status).toBe(404);
    await expect(missingChapterSave.json()).resolves.toEqual({
      error: {
        code: "CHAPTER_NOT_FOUND",
        message: 'Chapter 9 not found for book "jade-city".',
      },
    });

    const missingBookReview = await app.request("/api/books/missing-book/review/approve", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ chapterNumber: 1 }),
    });

    expect(missingBookReview.status).toBe(404);
    await expect(missingBookReview.json()).resolves.toEqual({
      error: {
        code: "BOOK_NOT_FOUND",
        message: 'Book "missing-book" not found.',
      },
    });
  });

  it("rejects non-digit chapter path segments instead of partially parsing them", async () => {
    const projectRoot = await createProjectFixture();
    const app = createApp({ projectRoot });

    const response = await app.request("/api/books/jade-city/chapters/2junk");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CHAPTER_NOT_FOUND",
        message: 'Chapter 2junk not found for book "jade-city".',
      },
    });
  });

  it("surfaces invalid book data as a server error instead of a missing book", async () => {
    const projectRoot = await createProjectFixture();
    await writeFile(join(projectRoot, "books", "jade-city", "book.json"), "{ invalid json", "utf-8");
    const app = createApp({ projectRoot });

    const response = await app.request("/api/books/jade-city");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected server error.",
      },
    });
  });

  it("fails explicitly when duplicate padded chapter files exist", async () => {
    const projectRoot = await createProjectFixture();
    await writeFile(
      join(projectRoot, "books", "jade-city", "chapters", "0002_duplicate-copy.md"),
      "# Duplicate\n\nShould not be picked arbitrarily.\n",
    );
    const app = createApp({ projectRoot });

    const response = await app.request("/api/books/jade-city/chapters/2");

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CHAPTER_FILE_CONFLICT",
        message: 'Multiple chapter files match chapter 2 in book "jade-city".',
      },
    });
  });

  it("rejects book ids that try to escape the books directory", async () => {
    const projectRoot = await createProjectFixture();
    const app = createApp({ projectRoot });

    const response = await app.request("/api/books/%2E%2E%2Fescape");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "BOOK_NOT_FOUND",
        message: 'Book "../escape" not found.',
      },
    });
  });

  it("surfaces invalid book data on truth-file routes as server errors", async () => {
    const projectRoot = await createProjectFixture();
    const brokenBookDir = join(projectRoot, "books", "broken-book");
    await mkdir(join(brokenBookDir, "story"), { recursive: true });
    await writeFile(join(brokenBookDir, "book.json"), "{not-valid-json", "utf-8");

    const app = createApp({ projectRoot });
    const response = await app.request("/api/books/broken-book/truth-files/current_state.md");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected server error.",
      },
    });
  });

  it("returns 404 for missing required truth-file detail requests", async () => {
    const projectRoot = await createProjectFixture();
    const storyPath = join(projectRoot, "books", "jade-city", "story", "current_state.md");
    await rm(storyPath, { force: true });

    const app = createApp({ projectRoot });
    const response = await app.request("/api/books/jade-city/truth-files/current_state.md");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "TRUTH_FILE_NOT_FOUND",
        message: 'Truth file "current_state.md" not found for book "jade-city".',
      },
    });
  });

  it("surfaces corrupt chapter index data as a server error", async () => {
    const projectRoot = await createProjectFixture();
    await writeFile(join(projectRoot, "books", "jade-city", "chapters", "index.json"), "{ bad json", "utf-8");

    const app = createApp({ projectRoot });
    const response = await app.request("/api/books/jade-city");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected server error.",
      },
    });
  });
});
