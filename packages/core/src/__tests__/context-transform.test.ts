import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBookContextTransform } from "../agent/context-transform.js";

describe("createBookContextTransform", () => {
  let projectRoot: string;
  const bookId = "test-book";

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "ctx-test-"));
    const storyDir = join(projectRoot, "books", bookId, "story");
    await mkdir(storyDir, { recursive: true });
    await writeFile(join(storyDir, "story_bible.md"), "# Story Bible\nA hero's journey.");
    await writeFile(join(storyDir, "current_focus.md"), "Focus on chapter 3.");
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("returns messages unchanged when bookId is null", async () => {
    const transform = createBookContextTransform(null, projectRoot);
    const messages = [
      { role: "user" as const, content: "hello", timestamp: Date.now() },
    ];
    const result = await transform(messages);
    expect(result).toBe(messages);
  });

  it("prepends a user message with truth file contents", async () => {
    const transform = createBookContextTransform(bookId, projectRoot);
    const original = [
      { role: "user" as const, content: "写下一章", timestamp: Date.now() },
    ];
    const result = await transform(original);

    expect(original).toHaveLength(1);
    expect(result).toHaveLength(2);
    const injected = result[0] as { role: string; content: string };
    expect(injected.role).toBe("user");
    expect(injected.content).toContain("story_bible.md");
    expect(injected.content).toContain("A hero's journey.");
    expect(injected.content).toContain("current_focus.md");
    expect(injected.content).toContain("Focus on chapter 3.");
    expect(result[1]).toBe(original[0]);
  });

  it("sorts truth files in priority order", async () => {
    const storyDir = join(projectRoot, "books", bookId, "story");
    await writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline");
    await writeFile(join(storyDir, "book_rules.md"), "# Book Rules");
    await writeFile(join(storyDir, "extra_notes.md"), "# Extra");

    const transform = createBookContextTransform(bookId, projectRoot);
    const result = await transform([
      { role: "user" as const, content: "test", timestamp: Date.now() },
    ]);
    const content = (result[0] as { content: string }).content;

    const bibleIdx = content.indexOf("story_bible.md");
    const outlineIdx = content.indexOf("volume_outline.md");
    const rulesIdx = content.indexOf("book_rules.md");
    const focusIdx = content.indexOf("current_focus.md");
    const extraIdx = content.indexOf("extra_notes.md");

    expect(bibleIdx).toBeLessThan(outlineIdx);
    expect(outlineIdx).toBeLessThan(rulesIdx);
    expect(rulesIdx).toBeLessThan(focusIdx);
    expect(focusIdx).toBeLessThan(extraIdx);
  });

  it("returns original messages when story/ directory does not exist", async () => {
    const transform = createBookContextTransform("nonexistent-book", projectRoot);
    const original = [
      { role: "user" as const, content: "test", timestamp: Date.now() },
    ];
    const result = await transform(original);
    expect(result).toBe(original);
  });
});
