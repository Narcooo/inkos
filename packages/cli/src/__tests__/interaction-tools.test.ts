import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createInteractionToolsFromDeps } from "../tui/tools.js";

const chapterResult = {
  chapterNumber: 1,
  title: "Draft",
  wordCount: 1200,
  revised: false,
  status: "ready-for-review" as const,
  auditResult: {
    passed: true,
    issues: [],
    summary: "ok",
  },
};

const reviseResult = {
  chapterNumber: 3,
  wordCount: 1200,
  fixedIssues: [],
  applied: true,
  status: "ready-for-review" as const,
};

let projectRoot: string;

describe("interaction tools adapter", () => {
  beforeAll(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "inkos-interaction-tools-"));
    await mkdir(join(projectRoot, "books", "harbor", "story"), { recursive: true });
  });

  afterAll(async () => {
    // tmpdir cleanup omitted
  });

  it("delegates writeNextChapter and reviseDraft to the pipeline", async () => {
    const pipeline = {
      writeNextChapter: vi.fn(async () => chapterResult),
      reviseDraft: vi.fn(async () => reviseResult),
    };
    const state = {
      ensureControlDocuments: vi.fn(async () => {}),
      bookDir: vi.fn((bookId: string) => join(projectRoot, "books", bookId)),
      loadBookConfig: vi.fn(async () => ({
        id: "harbor",
        title: "Harbor",
        platform: "other" as const,
        genre: "other",
        status: "outlining" as const,
        targetChapters: 200,
        chapterWordCount: 3000,
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z",
      })),
      loadChapterIndex: vi.fn(async () => []),
      saveChapterIndex: vi.fn(async () => undefined),
      listBooks: vi.fn(async () => ["harbor"]),
    };

    const tools = createInteractionToolsFromDeps(projectRoot, pipeline, state);

    await tools.writeNextChapter("harbor");
    await tools.reviseDraft("harbor", 3, "rewrite");

    expect(pipeline.writeNextChapter).toHaveBeenCalledWith("harbor");
    expect(pipeline.reviseDraft).toHaveBeenCalledWith("harbor", 3, "rewrite");
  });

  it("writes current_focus and author_intent through the canonical story paths", async () => {
    const pipeline = {
      writeNextChapter: vi.fn(async () => chapterResult),
      reviseDraft: vi.fn(async () => reviseResult),
    };
    const state = {
      ensureControlDocuments: vi.fn(async () => {}),
      bookDir: vi.fn((bookId: string) => join(projectRoot, "books", bookId)),
      loadBookConfig: vi.fn(async () => ({
        id: "harbor",
        title: "Harbor",
        platform: "other" as const,
        genre: "other",
        status: "outlining" as const,
        targetChapters: 200,
        chapterWordCount: 3000,
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z",
      })),
      loadChapterIndex: vi.fn(async () => []),
      saveChapterIndex: vi.fn(async () => undefined),
      listBooks: vi.fn(async () => ["harbor"]),
    };

    const tools = createInteractionToolsFromDeps(projectRoot, pipeline, state);

    await tools.updateCurrentFocus("harbor", "# Current Focus\n\nBring focus back to the old case.\n");
    await tools.updateAuthorIntent("harbor", "# Author Intent\n\nWrite a cold harbor mystery.\n");

    await expect(readFile(join(projectRoot, "books", "harbor", "story", "current_focus.md"), "utf-8"))
      .resolves.toContain("Bring focus back to the old case");
    await expect(readFile(join(projectRoot, "books", "harbor", "story", "author_intent.md"), "utf-8"))
      .resolves.toContain("Write a cold harbor mystery");
  });
});
