import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BookConfig } from "../models/book.js";
import { PlannerAgent } from "../agents/planner.js";

describe("PlannerAgent", () => {
  let root: string;
  let bookDir: string;
  let storyDir: string;
  let book: BookConfig;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-planner-test-"));
    bookDir = join(root, "books", "planner-book");
    storyDir = join(bookDir, "story");
    await mkdir(join(storyDir, "runtime"), { recursive: true });

    book = {
      id: "planner-book",
      title: "Planner Book",
      platform: "tomato",
      genre: "xuanhuan",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 3000,
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "author_intent.md"),
        "# Author Intent\n\nKeep the book emotionally centered on the mentor-student bond.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_focus.md"),
        "# Current Focus\n\nBring the focus back to the mentor conflict before opening new subplots.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "story_bible.md"),
        "# Story Bible\n\n- The jade seal cannot be destroyed.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        "# Volume Outline\n\n## Chapter 3\nTrack the merchant guild's escape route.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "book_rules.md"),
        "---\nprohibitions:\n  - Do not reveal the mastermind\n---\n\n# Book Rules\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_state.md"),
        "# Current State\n\n- Lin Yue still hides the broken oath token.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        "# Chapter Summaries\n\n| 2 | Trial fallout | Mentor left without explanation |\n",
        "utf-8",
      ),
    ]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("uses current focus as the chapter goal and writes a chapter intent file", async () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
    });

    expect(result.intent.goal).toContain("mentor conflict");
    await expect(readFile(result.runtimePath, "utf-8")).resolves.toContain("mentor conflict");
  });

  it("preserves hard facts from state and canon in mustKeep", async () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
    });

    expect(result.intent.mustKeep).toContain("Lin Yue still hides the broken oath token.");
    expect(result.intent.mustKeep).toContain("The jade seal cannot be destroyed.");
  });

  it("records conflicts when the external request diverges from the outline", async () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
      externalContext: "Ignore the guild chase and bring the focus back to mentor conflict.",
    });

    expect(result.intent.conflicts).toHaveLength(1);
    expect(result.intent.conflicts[0]?.type).toBe("outline_vs_request");
    await expect(readFile(result.runtimePath, "utf-8")).resolves.toContain("outline_vs_request");
  });
});
