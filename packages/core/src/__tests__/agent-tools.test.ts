import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateManager } from "../state/manager.js";
import {
  createReadTool,
  createGenerateCoverTool,
  createSubAgentTool,
  createShortFictionRunTool,
  createPatchChapterTextTool,
  createReplaceChapterTextTool,
  createRenameEntityTool,
  createWriteFileTool,
  createWriteTruthFileTool,
} from "../agent/agent-tools.js";

describe("agent deterministic writing tools", () => {
  let root: string;
  let state: StateManager;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-agent-tools-"));
    state = new StateManager(root);

    await state.saveBookConfig("harbor", {
      id: "harbor",
      title: "Harbor",
      platform: "tomato",
      genre: "other",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 3000,
      createdAt: "2026-04-16T00:00:00.000Z",
      updatedAt: "2026-04-16T00:00:00.000Z",
    });

    await mkdir(join(state.bookDir("harbor"), "story", "runtime"), { recursive: true });
    await mkdir(join(state.bookDir("harbor"), "chapters"), { recursive: true });
    await writeFile(join(state.bookDir("harbor"), "story", "story_bible.md"), "# Story Bible\n\nLin Yue guards the jade seal.\n", "utf-8");
    await writeFile(join(state.bookDir("harbor"), "chapters", "0003_Storm.md"), "# 第3章 风暴\n\nLin Yue kept the jade seal hidden.\n", "utf-8");
    await state.saveChapterIndex("harbor", [{
      number: 3,
      title: "风暴",
      status: "ready-for-review",
      wordCount: 120,
      createdAt: "2026-04-16T00:00:00.000Z",
      updatedAt: "2026-04-16T00:00:00.000Z",
      auditIssues: [],
      lengthWarnings: [],
    }]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes truth files through the deterministic tool path", async () => {
    const tool = createWriteTruthFileTool({} as never, root, "harbor");

    const result = await tool.execute("tool-1", {
      fileName: "story_bible.md",
      content: "# Story Bible\n\nLin Yue now distrusts the guild.\n",
    });

    expect(result.content[0]?.type).toBe("text");
    await expect(readFile(join(state.bookDir("harbor"), "story", "story_bible.md"), "utf-8"))
      .resolves.toContain("distrusts the guild");
  });

  it("renames entities through the deterministic edit controller", async () => {
    const tool = createRenameEntityTool({} as never, root, "harbor");

    await tool.execute("tool-3", {
      oldValue: "Lin Yue",
      newValue: "Lin Yan",
    });

    await expect(readFile(join(state.bookDir("harbor"), "story", "story_bible.md"), "utf-8"))
      .resolves.toContain("Lin Yan");
    await expect(readFile(join(state.bookDir("harbor"), "chapters", "0003_Storm.md"), "utf-8"))
      .resolves.toContain("Lin Yan");
  });

  it("patches chapter text through the deterministic edit controller", async () => {
    const tool = createPatchChapterTextTool({} as never, root, "harbor");

    await tool.execute("tool-4", {
      chapterNumber: 3,
      targetText: "jade seal hidden",
      replacementText: "jade seal locked beneath the altar",
    });

    await expect(readFile(join(state.bookDir("harbor"), "chapters", "0003_Storm.md"), "utf-8"))
      .resolves.toContain("locked beneath the altar");
    await expect(state.loadChapterIndex("harbor")).resolves.toEqual([
      expect.objectContaining({
        number: 3,
        status: "audit-failed",
        auditIssues: expect.arrayContaining([
          expect.stringContaining("Manual text edit requires review"),
        ]),
      }),
    ]);
  });

  it("fully replaces a chapter body while preserving its heading", async () => {
    await writeFile(
      join(state.bookDir("harbor"), "story", "runtime", "chapter-0003.intent.md"),
      "stale runtime",
      "utf-8",
    );
    const tool = createReplaceChapterTextTool({} as never, root, "harbor");

    await tool.execute("tool-replace-chapter", {
      chapterNumber: 3,
      content: "林越把玉印沉进港底。\n\n天亮前，她独自离开码头。",
    });

    await expect(readFile(join(state.bookDir("harbor"), "chapters", "0003_Storm.md"), "utf-8"))
      .resolves.toBe("# 第3章 风暴\n\n林越把玉印沉进港底。\n\n天亮前，她独自离开码头。\n");
    await expect(readFile(
      join(state.bookDir("harbor"), "story", "runtime", "chapter-0003.intent.md"),
      "utf-8",
    )).rejects.toThrow();
    await expect(state.loadChapterIndex("harbor")).resolves.toEqual([
      expect.objectContaining({
        number: 3,
        status: "audit-failed",
        wordCount: 22,
        auditIssues: expect.arrayContaining([
          expect.stringContaining("Manual chapter replacement requires review and state resync"),
        ]),
      }),
    ]);
  });

  it("requires an explicit title when the architect sub-agent creates a book", async () => {
    const pipeline = {
      initBook: vi.fn(async () => undefined),
    };
    const tool = createSubAgentTool(pipeline as never, null);

    const result = await tool.execute("tool-5", {
      agent: "architect",
      instruction: "写一本港风商战小说",
    });

    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("title is required");
    }
    expect(pipeline.initBook).not.toHaveBeenCalled();
  });

  it("passes the explicit architect title straight into initBook", async () => {
    const pipeline = {
      initBook: vi.fn(async () => undefined),
    };
    const tool = createSubAgentTool(pipeline as never, null);

    await tool.execute("tool-6", {
      agent: "architect",
      title: "夜港账本",
      instruction: "写一本港风商战小说",
    });

    expect(pipeline.initBook).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "夜港账本",
      }),
      expect.objectContaining({
        externalContext: "写一本港风商战小说",
      }),
    );
  });

  it("passes chapterWordCount through the writer sub-agent", async () => {
    const pipeline = {
      writeNextChapter: vi.fn(async () => ({
        chapterNumber: 4,
        wordCount: 2600,
      })),
    };
    const tool = createSubAgentTool(pipeline as never, "harbor");

    await tool.execute("tool-7", {
      agent: "writer",
      bookId: "harbor",
      chapterWordCount: 2600,
      instruction: "继续写，控制在 2600 字",
    } as any);

    expect(pipeline.writeNextChapter).toHaveBeenCalledWith("harbor", 2600);
  });

  it("surfaces writer sub-agent pipeline failures as tool errors", async () => {
    const pipeline = {
      writeNextChapter: vi.fn(async () => {
        throw new Error("disk write failed");
      }),
    };
    const tool = createSubAgentTool(pipeline as never, "harbor");

    await expect(tool.execute("tool-writer-fails", {
      agent: "writer",
      bookId: "harbor",
      instruction: "继续写下一章",
    } as any)).rejects.toThrow("disk write failed");
  });

  it("uses the active book for writer when bookId is omitted", async () => {
    const pipeline = {
      writeNextChapter: vi.fn(async () => ({
        chapterNumber: 4,
        wordCount: 2600,
      })),
    };
    const tool = createSubAgentTool(pipeline as never, "harbor");

    await tool.execute("tool-writer-active", {
      agent: "writer",
      chapterWordCount: 2600,
      instruction: "继续写下一章",
    } as any);

    expect(pipeline.writeNextChapter).toHaveBeenCalledWith("harbor", 2600);
  });

  it("documents sub_agent bookId as an optional active-book override", () => {
    const tool = createSubAgentTool({} as never, "harbor");
    const schemaText = JSON.stringify(tool.parameters);

    expect(schemaText).toContain("current active book");
    expect(schemaText).not.toContain("required for all agents except architect");
  });

  it("blocks non-architect sub-agents when no book is active", async () => {
    const pipeline = {
      writeNextChapter: vi.fn(async () => ({
        chapterNumber: 4,
        wordCount: 2600,
      })),
    };
    const tool = createSubAgentTool(pipeline as never, null);

    const result = await tool.execute("tool-writer-no-book", {
      agent: "writer",
      instruction: "继续写下一章",
    } as any);

    expect(pipeline.writeNextChapter).not.toHaveBeenCalled();
    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("No active book");
    }
  });

  it("exposes a standalone short fiction tool without benchmark inputs", () => {
    const pipeline = {
      createAgentContext: vi.fn(),
    };
    const tool = createShortFictionRunTool(pipeline as never, root);
    const schemaText = JSON.stringify(tool.parameters);
    const toolText = JSON.stringify({ description: tool.description, parameters: tool.parameters });

    expect(tool.name).toBe("short_fiction_run");
    expect(schemaText).toContain("direction");
    expect(schemaText).toContain("coverModel");
    expect(toolText).not.toContain("benchmark");
    expect(toolText).not.toContain("deconstruction");
  });

  it("exposes standalone cover generation as its own tool", () => {
    const tool = createGenerateCoverTool(root);
    const schemaText = JSON.stringify(tool.parameters);
    const toolText = JSON.stringify({ description: tool.description, parameters: tool.parameters });

    expect(tool.name).toBe("generate_cover");
    expect(schemaText).toContain("title");
    expect(schemaText).toContain("outputDir");
    expect(schemaText).toContain("coverPrompt");
    expect(toolText).toContain("revise the cover prompt");
    expect(schemaText).toContain("coverModel");
    expect(toolText).not.toContain("short_fiction_run");
  });

  it("allows architect revise mode to use the active book", async () => {
    const pipeline = {
      reviseFoundation: vi.fn(async () => undefined),
    };
    const tool = createSubAgentTool(pipeline as never, "harbor");

    const result = await tool.execute("tool-architect-revise-active", {
      agent: "architect",
      revise: true,
      feedback: "把角色目录改成一人一卡",
      instruction: "重写架构稿",
    } as any);

    expect(pipeline.reviseFoundation).toHaveBeenCalledWith("harbor", "把角色目录改成一人一卡");
    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("harbor");
    }
  });

  it("blocks architect revise mode when no book is active", async () => {
    const pipeline = {
      reviseFoundation: vi.fn(async () => undefined),
    };
    const tool = createSubAgentTool(pipeline as never, null);

    const result = await tool.execute("tool-architect-revise-no-book", {
      agent: "architect",
      bookId: "harbor",
      revise: true,
      feedback: "把角色目录改成一人一卡",
      instruction: "重写架构稿",
    } as any);

    expect(pipeline.reviseFoundation).not.toHaveBeenCalled();
    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("Open the book first");
    }
  });

  it("prefers explicit reviser mode over instruction guessing", async () => {
    const pipeline = {
      reviseDraft: vi.fn(async () => ({
        chapterNumber: 3,
        wordCount: 120,
        fixedIssues: [],
        applied: true,
        status: "ready-for-review" as const,
      })),
    };
    const tool = createSubAgentTool(pipeline as never, "harbor");

    await tool.execute("tool-8", {
      agent: "reviser",
      bookId: "harbor",
      chapterNumber: 3,
      mode: "spot-fix",
      instruction: "重写第3章",
    } as any);

    expect(pipeline.reviseDraft).toHaveBeenCalledWith("harbor", 3, "spot-fix");
  });

  it("uses explicit exporter params instead of guessing from instruction", async () => {
    const pipeline = {};
    const tool = createSubAgentTool(pipeline as never, "harbor", root);

    const result = await tool.execute("tool-9", {
      agent: "exporter",
      bookId: "harbor",
      format: "md",
      approvedOnly: false,
      instruction: "导出成 epub",
    } as any);

    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain(".md");
    }
  });

  it("keeps read tool scoped to books by default", async () => {
    const outsidePath = join(root, "outside.md");
    await writeFile(outsidePath, "outside secret", "utf-8");
    const tool = createReadTool(root);

    const result = await tool.execute("tool-read-default", {
      path: outsidePath,
    });

    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("Path traversal blocked");
      expect(result.content[0].text).not.toContain("outside secret");
    }
  });

  it("reads absolute system paths when explicitly enabled", async () => {
    const outsidePath = join(root, "outside.md");
    await writeFile(outsidePath, "outside secret", "utf-8");
    const tool = createReadTool(root, { allowSystemPaths: true });

    const result = await tool.execute("tool-read-system", {
      path: outsidePath,
    });

    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("outside secret");
    }
  });

  it("creates nested files through the generic write tool", async () => {
    const tool = createWriteFileTool(root);

    const result = await tool.execute("tool-10", {
      path: "harbor/story/runtime/notes.md",
      content: "# Notes\n\nWatch the harbor ledger.\n",
    });

    expect(result.content[0]?.type).toBe("text");
    await expect(readFile(join(state.bookDir("harbor"), "story", "runtime", "notes.md"), "utf-8"))
      .resolves.toContain("Watch the harbor ledger");
  });

  it("writes Phase 5 outline truth files through write_truth_file", async () => {
    const tool = createWriteTruthFileTool({} as never, root, "harbor");

    const result = await tool.execute("tool-truth-outline", {
      fileName: "outline/story_frame.md",
      content: "# Story Frame\n\nThe harbor debt is the central pressure.\n",
    });

    expect(result.content[0]?.type).toBe("text");
    await expect(readFile(join(state.bookDir("harbor"), "story", "outline", "story_frame.md"), "utf-8"))
      .resolves.toContain("central pressure");
  });

  it("writes Phase 5 role truth files through write_truth_file", async () => {
    const tool = createWriteTruthFileTool({} as never, root, "harbor");

    const result = await tool.execute("tool-truth-role", {
      fileName: "roles/major/Lin Yan.md",
      content: "# Lin Yan\n\nKeeps the ledger hidden.\n",
    });

    expect(result.content[0]?.type).toBe("text");
    await expect(readFile(join(state.bookDir("harbor"), "story", "roles", "major", "Lin Yan.md"), "utf-8"))
      .resolves.toContain("ledger hidden");
  });

  it("rejects unsafe truth file names", async () => {
    const tool = createWriteTruthFileTool({} as never, root, "harbor");

    const result = await tool.execute("tool-truth-unsafe", {
      fileName: "../escape.md",
      content: "escape",
    });

    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("Invalid truth file name");
    }
  });
});
