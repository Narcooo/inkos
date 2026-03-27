import { StateManager, type BookConfig, type ChapterMeta } from "@actalk/inkos-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app.js";

describe("factory APIs", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function createProjectRoot(): Promise<string> {
    const projectRoot = await mkdtemp(join(tmpdir(), "inkos-studio-factory-"));
    tempRoots.push(projectRoot);
    return projectRoot;
  }

  async function seedBootstrappedBook(projectRoot: string): Promise<void> {
    const state = new StateManager(projectRoot);
    const book: BookConfig = {
      id: "rain-listener",
      title: "Rain Listener",
      genre: "urban-fantasy",
      platform: "other",
      status: "outlining",
      targetChapters: 12,
      chapterWordCount: 2500,
      language: "en",
      createdAt: "2026-03-27T00:00:00.000Z",
      updatedAt: "2026-03-27T00:00:00.000Z",
    };

    await state.saveProjectConfig({ name: "Factory Test", language: "en", books: [book.id] });
    await writeFile(join(projectRoot, ".env"), "INKOS_LLM_PROVIDER=openai\nINKOS_LLM_MODEL=gpt-test\n", "utf-8");
    await state.saveBookConfig(book.id, book);
    await state.saveChapterIndex(book.id, []);
    await mkdir(join(projectRoot, "books", book.id, "story"), { recursive: true });
    await writeFile(
      join(projectRoot, "books", book.id, "story", "bootstrap_intake.json"),
      JSON.stringify({ type: "idea", titleSuggestion: "Rain Listener", sourceText: "A city speaks through rain.", prompt: "A city speaks through rain." }),
      "utf-8",
    );
  }

  it("creates story foundation as a distinct factory step after bootstrap book creation", async () => {
    const projectRoot = await createProjectRoot();
    await seedBootstrappedBook(projectRoot);
    const setupStory = vi.fn(async ({ projectRoot: root, bookId }: { projectRoot: string; bookId: string }) => {
      await writeFile(join(root, "books", bookId, "story", "author_intent.md"), "# Author Intent\n\nA city speaks through rain.\n", "utf-8");
      await writeFile(join(root, "books", bookId, "story", "current_focus.md"), "# Current Focus\n\nOpen with rain.\n", "utf-8");
    });
    const app = createApp({ projectRoot, factoryDependencies: { setupStory } } as never);

    await expect(access(join(projectRoot, "books", "rain-listener", "story", "author_intent.md"))).rejects.toBeTruthy();

    const response = await app.request("/api/factory/setup-story", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookId: "rain-listener" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      book: expect.objectContaining({ id: "rain-listener", title: "Rain Listener" }),
    });
    await expect(readFile(join(projectRoot, "books", "rain-listener", "story", "author_intent.md"), "utf-8")).resolves.toContain("A city speaks through rain.");
    await expect(readFile(join(projectRoot, "books", "rain-listener", "story", "current_focus.md"), "utf-8")).resolves.toContain("Current Focus");
    expect(setupStory).toHaveBeenCalledWith({ projectRoot, bookId: "rain-listener" });
  });

  it("generates an outline through the factory route", async () => {
    const projectRoot = await createProjectRoot();
    await seedBootstrappedBook(projectRoot);
    const generateOutline = vi.fn(async () => ({
      bookId: "rain-listener",
      chapterNumber: 1,
      intentPath: "runtime/chapter-1.intent.md",
      goal: "Introduce the rainbound city.",
      conflicts: ["stakes: the sword remembers before the hero does"],
    }));
    const app = createApp({
      projectRoot,
      factoryDependencies: {
        generateOutline,
      },
    } as never);

    const response = await app.request("/api/factory/generate-outline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookId: "rain-listener", context: "Use the intake as chapter-one context." }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      bookId: "rain-listener",
      chapterNumber: 1,
      intentPath: "runtime/chapter-1.intent.md",
      goal: "Introduce the rainbound city.",
      conflicts: ["stakes: the sword remembers before the hero does"],
    });
    expect(generateOutline).toHaveBeenCalledWith({
      projectRoot,
      bookId: "rain-listener",
      context: "Use the intake as chapter-one context.",
    });
  });

  it("returns the generated first chapter through the factory route", async () => {
    const projectRoot = await createProjectRoot();
    await seedBootstrappedBook(projectRoot);
    const chapterIndex: ChapterMeta[] = [{
      number: 1,
      createdAt: "2026-03-27T00:10:00.000Z",
      title: "The Rain Remembers",
      status: "ready-for-review",
      wordCount: 1234,
      auditIssues: [],
      lengthWarnings: [],
      updatedAt: "2026-03-27T00:10:00.000Z",
    }];
    const state = new StateManager(projectRoot);
    const generateFirstChapter = vi.fn(async () => {
      await state.saveChapterIndex("rain-listener", chapterIndex);
      await writeFile(join(projectRoot, "books", "rain-listener", "chapters", "0001_the_rain_remembers.md"), "# The Rain Remembers\n\nChapter body.", "utf-8");
      return {
        chapterNumber: 1,
        title: "The Rain Remembers",
        wordCount: 1234,
        auditResult: {
          passed: true,
          summary: "Looks good.",
          issues: [],
        },
        revised: false,
        status: "ready-for-review" as const,
      };
    });
    const app = createApp({
      projectRoot,
      factoryDependencies: {
        generateFirstChapter,
      },
    } as never);

    const response = await app.request("/api/factory/generate-first-chapter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookId: "rain-listener" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      book: expect.objectContaining({ id: "rain-listener", chapters: 1, chapterCount: 1 }),
      chapter: {
        number: 1,
        title: "The Rain Remembers",
        status: "ready-for-review",
        wordCount: 1234,
        auditIssueCount: 0,
        updatedAt: "2026-03-27T00:10:00.000Z",
        fileName: "0001_the_rain_remembers.md",
        auditIssues: [],
        content: "# The Rain Remembers\n\nChapter body.",
      },
    });
  });
});
