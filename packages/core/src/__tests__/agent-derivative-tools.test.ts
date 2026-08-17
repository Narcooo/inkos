import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createContinuationImportTool,
  createFanficBookTool,
  createImitationBookTool,
  createSpinoffBookTool,
} from "../agent/agent-tools.js";
import { StateManager } from "../state/manager.js";

function mockPipeline() {
  return {
    runWithAgentContext: vi.fn(async (
      context: { readonly signal?: AbortSignal },
      task: () => Promise<unknown>,
    ) => {
      context.signal?.throwIfAborted();
      return task();
    }),
    initFanficBook: vi.fn(async () => undefined),
    initSpinoffBook: vi.fn(async () => undefined),
    initImitationBook: vi.fn(async () => undefined),
    importChapters: vi.fn(async (input: {
      bookId: string;
      chapters: ReadonlyArray<{ title: string; content: string }>;
    }) => ({
      bookId: input.bookId,
      importedCount: input.chapters.length,
      totalWords: 1200,
      nextChapter: input.chapters.length + 1,
    })),
  };
}

describe("derivative-work agent tools", () => {
  let root: string;
  let state: StateManager;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-derivative-tools-"));
    state = new StateManager(root);
    await state.saveBookConfig("harbor", {
      id: "harbor",
      title: "雾港账页",
      platform: "tomato",
      genre: "suspense",
      status: "active",
      language: "zh",
      targetChapters: 80,
      chapterWordCount: 2400,
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates fanfiction from confirmed source text inside the agent context", async () => {
    const pipeline = mockPipeline();
    const controller = new AbortController();
    const tool = createFanficBookTool(pipeline as never, root);

    const result = await tool.execute("fanfic-1", {
      title: "霜港来信",
      sourceText: "原作中林鹿守着一座废弃灯塔。",
      sourceName: "霜港正典",
      mode: "canon",
      targetChapters: 24,
      language: "zh",
    }, controller.signal);

    expect(pipeline.initFanficBook).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "霜港来信",
        title: "霜港来信",
        fanficMode: "canon",
        targetChapters: 24,
      }),
      "原作中林鹿守着一座废弃灯塔。",
      "霜港正典",
      "canon",
    );
    expect(pipeline.runWithAgentContext).toHaveBeenCalledWith(
      { signal: controller.signal, activatedSkills: [] },
      expect.any(Function),
    );
    expect(result.details).toMatchObject({
      kind: "book_created",
      creationKind: "fanfic",
      bookId: "霜港来信",
    });
  });

  it("inherits parent-book defaults when creating a side story", async () => {
    const pipeline = mockPipeline();
    const tool = createSpinoffBookTool(pipeline as never, root);

    const result = await tool.execute("spinoff-1", {
      title: "雨夜旧账",
      parentBookId: "harbor",
      direction: "老船工失踪前最后一夜",
    });

    expect(pipeline.initSpinoffBook).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "雨夜旧账",
        parentBookId: "harbor",
        platform: "tomato",
        genre: "suspense",
        targetChapters: 80,
        chapterWordCount: 2400,
      }),
      "harbor",
      "老船工失踪前最后一夜",
    );
    expect(result.details).toMatchObject({
      kind: "book_created",
      creationKind: "spinoff",
      parentBookId: "harbor",
    });
  });

  it("creates an original imitation project without copying the reference plot", async () => {
    const pipeline = mockPipeline();
    const tool = createImitationBookTool(pipeline as never, root);

    const result = await tool.execute("imitation-1", {
      title: "纸灯新案",
      referenceText: "雨从檐角一滴滴落下来，像一只迟疑的钟。",
      sourceName: "参考散文",
      storyIdea: "县城档案员调查一批被替换的死亡证明",
      genre: "suspense",
    });

    expect(pipeline.initImitationBook).toHaveBeenCalledWith(
      expect.objectContaining({ id: "纸灯新案", title: "纸灯新案" }),
      "雨从檐角一滴滴落下来，像一只迟疑的钟。",
      "县城档案员调查一批被替换的死亡证明",
      "参考散文",
    );
    expect(result.details).toMatchObject({
      kind: "book_created",
      creationKind: "imitation",
      bookId: "纸灯新案",
    });
  });

  it("imports an uploaded manuscript into a newly created continuation book", async () => {
    await mkdir(join(root, ".inkos", "uploads", "continuation"), { recursive: true });
    await writeFile(
      join(root, ".inkos", "uploads", "continuation", "novel.txt"),
      "第一章 雨港\n\n林鹿在旧码头找到一本账簿。\n\n第二章 空号\n\n电话那头只有潮声。\n",
      "utf-8",
    );
    const pipeline = mockPipeline();
    const tool = createContinuationImportTool(pipeline as never, null, root);

    const result = await tool.execute("continuation-1", {
      title: "雾港续章",
      sourcePath: ".inkos/uploads/continuation/novel.txt",
      language: "zh",
    });

    expect(pipeline.importChapters).toHaveBeenCalledWith({
      bookId: "雾港续章",
      chapters: [
        { title: "雨港", content: "林鹿在旧码头找到一本账簿。" },
        { title: "空号", content: "电话那头只有潮声。" },
      ],
      resumeFrom: undefined,
      importMode: "continuation",
    });
    await expect(state.loadBookConfig("雾港续章")).resolves.toMatchObject({
      id: "雾港续章",
      title: "雾港续章",
    });
    expect(result.details).toMatchObject({
      kind: "book_created",
      creationKind: "continuation",
      bookId: "雾港续章",
      importedCount: 2,
    });
  });

  it("rejects non-uploaded absolute continuation paths", async () => {
    const pipeline = mockPipeline();
    const tool = createContinuationImportTool(pipeline as never, null, root);

    await expect(tool.execute("continuation-absolute", {
      title: "不安全路径",
      sourcePath: join(root, "novel.txt"),
    })).rejects.toThrow("must be project-relative");
    expect(pipeline.importChapters).not.toHaveBeenCalled();
  });
});
