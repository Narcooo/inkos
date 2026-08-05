import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
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
import { listChapterVersions, readChapterVersion } from "../state/chapter-workspace.js";

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

  it("plans whole-chapter replacement transactions as chapter-scoped edits", () => {
    const result = planEditTransaction({
      kind: "chapter-replace",
      bookId: "harbor",
      chapterNumber: 3,
      fullText: "# 第3章 新稿\n\n完整替换正文。",
    });

    expect(result.transactionType).toBe("chapter-replace");
    expect(result.affectedScope).toBe("chapter");
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

  it("does not rewrite trashed chapters during entity rename", async () => {
    const bookDir = join(projectRoot, "books", "trashbook");
    await mkdir(join(bookDir, "story"), { recursive: true });
    await mkdir(join(bookDir, "chapters", ".trash"), { recursive: true });
    await writeFile(join(bookDir, "story", "story_bible.md"), "主角陆尘住在港口。", "utf-8");
    await writeFile(join(bookDir, "chapters", ".trash", "0009_旧章.md"), "陆尘在被删除的章节里。", "utf-8");

    await executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => [],
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "entity-rename",
        bookId: "trashbook",
        entityType: "protagonist",
        oldValue: "陆尘",
        newValue: "林砚",
      },
    );

    await expect(readFile(join(bookDir, "story", "story_bible.md"), "utf-8")).resolves.toContain("林砚");
    await expect(readFile(join(bookDir, "chapters", ".trash", "0009_旧章.md"), "utf-8")).resolves.toContain("陆尘");
  });

  it("does not rewrite story snapshots during entity rename", async () => {
    const bookDir = join(projectRoot, "books", "harbor");
    await writeFile(join(bookDir, "story", "story_bible.md"), "主角陆尘住在港口。", "utf-8");
    await mkdir(join(bookDir, "story", "snapshots", "1"), { recursive: true });
    await writeFile(join(bookDir, "story", "snapshots", "1", "current_state.md"), "陆尘在旧快照里。", "utf-8");

    await executeEditTransaction(
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
    await expect(readFile(join(bookDir, "story", "snapshots", "1", "current_state.md"), "utf-8")).resolves.toContain("陆尘");
  });

  it("renames entity files whose filename embeds the old name so path references don't dangle", async () => {
    const bookDir = join(projectRoot, "books", "rolebook");
    await mkdir(join(bookDir, "roles", "主要角色"), { recursive: true });
    await mkdir(join(bookDir, "story"), { recursive: true });
    await writeFile(join(bookDir, "roles", "主要角色", "陈default.md"), "# 陈default\n\n陈default是主角。", "utf-8");
    // A manifest that references the role file by path — the path must follow the rename.
    await writeFile(join(bookDir, "story", "story_bible.md"), "主角档案见 roles/主要角色/陈default.md。", "utf-8");

    const result = await executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => [],
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "entity-rename",
        bookId: "rolebook",
        entityType: "protagonist",
        oldValue: "陈default",
        newValue: "陈烬",
      },
    );

    // The file is renamed on disk and its content updated.
    await expect(readFile(join(bookDir, "roles", "主要角色", "陈烬.md"), "utf-8")).resolves.toContain("陈烬");
    // The old filename is gone — no dangling reference.
    await expect(access(join(bookDir, "roles", "主要角色", "陈default.md")).then(() => true).catch(() => false))
      .resolves.toBe(false);
    // The manifest's path reference now points at the renamed file.
    await expect(readFile(join(bookDir, "story", "story_bible.md"), "utf-8"))
      .resolves.toContain("roles/主要角色/陈烬.md");
    expect(result.touchedFiles).toContain(join("roles", "主要角色", "陈烬.md"));
    expect(result.summary).toContain("renamed on disk");
  });

  it("aborts an entity rename when the target filename already exists, without rewriting content", async () => {
    const bookDir = join(projectRoot, "books", "collisionbook");
    await mkdir(join(bookDir, "roles", "主要角色"), { recursive: true });
    await writeFile(join(bookDir, "roles", "主要角色", "甲.md"), "甲的档案。", "utf-8");
    await writeFile(join(bookDir, "roles", "主要角色", "乙.md"), "乙的档案,提到甲。", "utf-8");

    await expect(executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => [],
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "entity-rename",
        bookId: "collisionbook",
        entityType: "character",
        oldValue: "甲",
        newValue: "乙",
      },
    )).rejects.toThrow(/already exists/);

    // The collision is detected before any write — content stays untouched (no partial application).
    await expect(readFile(join(bookDir, "roles", "主要角色", "乙.md"), "utf-8")).resolves.toBe("乙的档案,提到甲。");
  });

  it("rejects a rename target that contains a path separator", async () => {
    await expect(executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => [],
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "entity-rename",
        bookId: "harbor",
        entityType: "character",
        oldValue: "陆尘",
        newValue: "../evil",
      },
    )).rejects.toThrow(/path separators/);
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
    const versions = await listChapterVersions(bookDir, 3);
    expect(versions).toHaveLength(1);
    await expect(readChapterVersion(bookDir, 3, versions[0]!.id))
      .resolves.toContain("旧名字");
    expect(savedIndex[0]?.status).toBe("audit-failed");
    expect(savedIndex[0]?.auditIssues.at(-1)).toContain("Manual text edit requires review");
    expect(result.reviewRequired).toBe(true);
  });

  it("updates the index word count when patching chapter text", async () => {
    const bookDir = join(projectRoot, "books", "harbor");
    await writeFile(join(bookDir, "chapters", "0005_对账.md"), "# 第5章 对账\n\n她核对了三遍账目。", "utf-8");
    const chapterIndex = [{
      number: 5,
      title: "对账",
      status: "ready-for-review" as const,
      wordCount: 999,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      auditIssues: [],
      lengthWarnings: [],
    }];

    let savedIndex: ChapterMeta[] = [...chapterIndex];
    await executeEditTransaction(
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
        chapterNumber: 5,
        instruction: "Replace the recount detail",
        targetText: "三遍账目",
        replacementText: "五遍账目，又签了名",
      },
    );

    // Heading + whitespace stripped: "她核对了五遍账目，又签了名。" → 14 chars.
    expect(savedIndex[0]?.wordCount).toBe(14);
  });

  it("patches chapter text when the target only differs by whitespace", async () => {
    const bookDir = join(projectRoot, "books", "harbor");
    await writeFile(
      join(bookDir, "chapters", "0004_雨巷.md"),
      "# 第4章 雨巷\n\n她把账本\n塞进外套里，继续往前走。",
      "utf-8",
    );
    const chapterIndex = [{
      number: 4,
      title: "雨巷",
      status: "ready-for-review" as const,
      wordCount: 18,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      auditIssues: [],
      lengthWarnings: [],
    }];

    const result = await executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => chapterIndex,
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "chapter-local-edit",
        bookId: "harbor",
        chapterNumber: 4,
        instruction: "Patch wrapped text",
        targetText: "她把账本 塞进外套里",
        replacementText: "她把账本贴着胸口藏好",
      },
    );

    await expect(readFile(join(bookDir, "chapters", "0004_雨巷.md"), "utf-8"))
      .resolves.toContain("她把账本贴着胸口藏好，继续往前走。");
    expect(result.reviewRequired).toBe(true);
  });

  it("executes whole-chapter replacement and marks the chapter for review", async () => {
    const bookDir = join(projectRoot, "books", "replacebook");
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await mkdir(join(bookDir, "story", "runtime"), { recursive: true });
    await writeFile(join(bookDir, "chapters", "0002_旧章.md"), "# 第2章 旧章\n\n旧正文。", "utf-8");
    await writeFile(join(bookDir, "story", "runtime", "chapter-0002.plan.md"), "stale plan", "utf-8");
    await writeFile(
      join(bookDir, "story", "runtime", "chapter-0002.user-brief.md"),
      "保留雨夜证词。\n",
      "utf-8",
    );
    const chapterIndex = [{
      number: 2,
      title: "旧章",
      status: "ready-for-review" as const,
      wordCount: 3,
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
        kind: "chapter-replace",
        bookId: "replacebook",
        chapterNumber: 2,
        fullText: "# 第2章 新章\n\n新正文完整替换。",
      },
    );

    await expect(readFile(join(bookDir, "chapters", "0002_旧章.md"), "utf-8")).resolves.toContain("新正文完整替换");
    const versions = await listChapterVersions(bookDir, 2);
    expect(versions).toHaveLength(1);
    await expect(readChapterVersion(bookDir, 2, versions[0]!.id))
      .resolves.toContain("旧正文");
    await expect(access(join(bookDir, "story", "runtime", "chapter-0002.plan.md")).then(() => true).catch(() => false))
      .resolves.toBe(false);
    await expect(readFile(join(bookDir, "story", "runtime", "chapter-0002.user-brief.md"), "utf-8"))
      .resolves.toBe("保留雨夜证词。\n");
    expect(savedIndex[0]?.status).toBe("audit-failed");
    expect(savedIndex[0]?.wordCount).toBeGreaterThan(0);
    expect(savedIndex[0]?.auditIssues.at(-1)).toContain("Manual chapter replacement requires review");
    expect(result.reviewRequired).toBe(true);
    expect(result.summary).toContain("Replaced chapter 2");
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
