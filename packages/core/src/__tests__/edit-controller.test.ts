import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ChapterMeta } from "../models/chapter.js";
import {
  classifyTruthAuthority,
  normalizeTruthFileName,
} from "../interaction/truth-authority.js";
import {
  executeEditTransaction,
  planEditTransaction,
  type EditRequest,
} from "../interaction/edit-controller.js";

let projectRoot: string;

beforeAll(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "inkos-edit-controller-"));
  await mkdir(join(projectRoot, "books", "harbor", "story", "runtime"), { recursive: true });
  await mkdir(join(projectRoot, "books", "harbor", "chapters"), { recursive: true });
});

describe("truth authority", () => {
  it("normalizes supported truth files", () => {
    expect(normalizeTruthFileName("story_bible")).toBe("story_bible.md");
    expect(normalizeTruthFileName("current_state.md")).toBe("current_state.md");
  });

  it("classifies control and truth authority tiers", () => {
    expect(classifyTruthAuthority("author_intent.md")).toBe("direction");
    expect(classifyTruthAuthority("current_focus.md")).toBe("direction");
    expect(classifyTruthAuthority("story_bible.md")).toBe("foundation");
    expect(classifyTruthAuthority("book_rules.md")).toBe("rules");
    expect(classifyTruthAuthority("current_state.md")).toBe("runtime-truth");
  });
});

describe("edit controller", () => {
  it("plans entity rename transactions", () => {
    const result = planEditTransaction({
      kind: "entity-rename",
      bookId: "harbor",
      entityType: "protagonist",
      oldValue: "陆尘",
      newValue: "林砚",
    });

    expect(result.transactionType).toBe("entity-rename");
    expect(result.affectedScope).toBe("book");
    expect(result.requiresTruthRebuild).toBe(true);
  });

  it("plans chapter rewrite transactions", () => {
    const result = planEditTransaction({
      kind: "chapter-rewrite",
      bookId: "harbor",
      chapterNumber: 3,
      instruction: "Keep the ending reveal.",
    });

    expect(result.transactionType).toBe("chapter-rewrite");
    expect(result.affectedScope).toBe("downstream");
    expect(result.requiresTruthRebuild).toBe(true);
  });

  it("plans local text edits without forcing full-book rebuild", () => {
    const result = planEditTransaction({
      kind: "chapter-local-edit",
      bookId: "harbor",
      chapterNumber: 5,
      instruction: "Only rewrite the final paragraph.",
    });

    expect(result.transactionType).toBe("chapter-local-edit");
    expect(result.affectedScope).toBe("chapter");
    expect(result.requiresTruthRebuild).toBe(true);
  });

  it("plans truth-file edits with authority metadata", () => {
    const result = planEditTransaction({
      kind: "truth-file-edit",
      bookId: "harbor",
      fileName: "book_rules",
      instruction: "Lock the protagonist name to Lin Yan.",
    });

    expect(result.transactionType).toBe("truth-file-edit");
    expect(result.truthAuthority).toBe("rules");
    expect(result.affectedScope).toBe("book");
  });

  it("plans focus edits as direction-level transactions", () => {
    const result = planEditTransaction({
      kind: "focus-edit",
      bookId: "harbor",
      instruction: "Bring the story back to the old case.",
    });

    expect(result.transactionType).toBe("focus-edit");
    expect(result.truthAuthority).toBe("direction");
    expect(result.affectedScope).toBe("future");
    expect(result.requiresTruthRebuild).toBe(false);
  });

  it("executes entity rename across truth files and chapters", async () => {
    const bookDir = join(projectRoot, "books", "harbor");
    await writeFile(join(bookDir, "story", "story_bible.md"), "主角陆尘住在港口。", "utf-8");
    await writeFile(join(bookDir, "chapters", "0001_旧名字.md"), "# 第1章 旧名字\n\n陆尘走进港口。", "utf-8");

    const result = await executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => [],
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "entity-rename",
        bookId: "harbor",
        entityType: "protagonist",
        oldValue: "陆尘",
        newValue: "林砚",
      },
    );

    await expect(readFile(join(bookDir, "story", "story_bible.md"), "utf-8")).resolves.toContain("林砚");
    await expect(readFile(join(bookDir, "chapters", "0001_旧名字.md"), "utf-8")).resolves.toContain("林砚");
    expect(result.touchedFiles.length).toBeGreaterThan(0);
  });

  it("executes chapter text patches and marks the chapter for review", async () => {
    const bookDir = join(projectRoot, "books", "harbor");
    await writeFile(join(bookDir, "chapters", "0003_灰墙榜下.md"), "# 第3章 灰墙榜下\n\n旧名字在这里。", "utf-8");
    await writeFile(join(bookDir, "story", "runtime", "chapter-0003.intent.md"), "stale", "utf-8");
    const chapterIndex = [{
      number: 3,
      title: "灰墙榜下",
      status: "ready-for-review" as const,
      wordCount: 12,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      auditIssues: [],
      lengthWarnings: [],
    }];

    let savedIndex: ChapterMeta[] = [...chapterIndex];
    const result = await executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => chapterIndex,
        saveChapterIndex: async (_bookId, index) => {
          savedIndex = [...index];
        },
      },
      {
        kind: "chapter-local-edit",
        bookId: "harbor",
        chapterNumber: 3,
        instruction: "Replace old text",
        targetText: "旧名字",
        replacementText: "新名字",
      },
    );

    await expect(readFile(join(bookDir, "chapters", "0003_灰墙榜下.md"), "utf-8")).resolves.toContain("新名字");
    expect(savedIndex[0]?.status).toBe("audit-failed");
    expect(savedIndex[0]?.auditIssues.at(-1)).toContain("Manual text edit requires review");
    expect(result.reviewRequired).toBe(true);
  });

  it("does not swallow unexpected filesystem errors while collecting editable files", async () => {
    const invalidRoot = join(projectRoot, "invalid-root.txt");
    await writeFile(invalidRoot, "not a directory", "utf-8");

    await expect(executeEditTransaction(
      {
        bookDir: () => invalidRoot,
        loadChapterIndex: async () => [],
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "entity-rename",
        bookId: "harbor",
        entityType: "protagonist",
        oldValue: "陆尘",
        newValue: "林砚",
      },
    )).rejects.toThrow(/not a directory|ENOTDIR/i);
  });
});
