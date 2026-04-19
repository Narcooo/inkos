import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createProjectSession,
  loadProjectSession,
  persistProjectSession,
} from "../interaction/project-session-store.js";
import {
  processProjectInteractionInput,
  processProjectInteractionRequest,
} from "../interaction/project-control.js";

let projectRoot: string;

describe("project interaction control", () => {
  beforeAll(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "inkos-project-control-"));
    await mkdir(join(projectRoot, "books", "harbor"), { recursive: true });
    await writeFile(join(projectRoot, "books", "harbor", "book.json"), "{}", "utf-8");
  });

  afterAll(async () => {
    // tmpdir cleanup omitted
  });

  it("routes continue through the persisted active book", async () => {
    await persistProjectSession(projectRoot, {
      ...createProjectSession(projectRoot),
      activeBookId: "harbor",
    });

    const tools = {
      listBooks: vi.fn(async () => ["harbor"]),
      writeNextChapter: vi.fn(async () => ({ ok: true })),
      reviseDraft: vi.fn(async () => ({ ok: true })),
      patchChapterText: vi.fn(async () => ({ ok: true })),
      renameEntity: vi.fn(async () => ({ ok: true })),
      updateCurrentFocus: vi.fn(async () => ({ ok: true })),
      updateAuthorIntent: vi.fn(async () => ({ ok: true })),
      writeTruthFile: vi.fn(async () => ({ ok: true })),
    };

    const result = await processProjectInteractionInput({
      projectRoot,
      input: "continue",
      tools,
    });

    expect(tools.writeNextChapter).toHaveBeenCalledWith("harbor");
    expect(result.session.activeBookId).toBe("harbor");
    expect(result.request.intent).toBe("write_next");
    expect(result.session.events.map((event) => event.kind)).toEqual([
      "task.started",
      "task.completed",
    ]);
  });

  it("persists mode switches in the project session", async () => {
    await persistProjectSession(projectRoot, {
      ...createProjectSession(projectRoot),
      activeBookId: "harbor",
    });

    const result = await processProjectInteractionInput({
      projectRoot,
      input: "切换到全自动",
      tools: {
        listBooks: vi.fn(async () => ["harbor"]),
        writeNextChapter: vi.fn(async () => ({ ok: true })),
        reviseDraft: vi.fn(async () => ({ ok: true })),
        patchChapterText: vi.fn(async () => ({ ok: true })),
        renameEntity: vi.fn(async () => ({ ok: true })),
        updateCurrentFocus: vi.fn(async () => ({ ok: true })),
        updateAuthorIntent: vi.fn(async () => ({ ok: true })),
        writeTruthFile: vi.fn(async () => ({ ok: true })),
      },
    });

    expect(result.session.automationMode).toBe("auto");
    expect(result.session.events.map((event) => event.kind)).toEqual([
      "task.started",
      "task.completed",
    ]);
  });

  it("persists failed execution state when a routed action throws", async () => {
    await persistProjectSession(projectRoot, {
      ...createProjectSession(projectRoot),
      activeBookId: "harbor",
    });

    await expect(processProjectInteractionInput({
      projectRoot,
      input: "continue",
      tools: {
        listBooks: vi.fn(async () => ["harbor"]),
        writeNextChapter: vi.fn(async () => {
          throw new Error("boom");
        }),
        reviseDraft: vi.fn(async () => ({ ok: true })),
        patchChapterText: vi.fn(async () => ({ ok: true })),
        renameEntity: vi.fn(async () => ({ ok: true })),
        updateCurrentFocus: vi.fn(async () => ({ ok: true })),
        updateAuthorIntent: vi.fn(async () => ({ ok: true })),
        writeTruthFile: vi.fn(async () => ({ ok: true })),
      },
    })).rejects.toThrow("boom");

    const failedSession = await loadProjectSession(projectRoot);
    expect(failedSession.currentExecution?.status).toBe("failed");
    expect(failedSession.events.at(-1)?.kind).toBe("task.failed");
    expect(failedSession.events.at(-1)?.detail).toContain("boom");
  });

  it("persists book selection into the shared project session", async () => {
    await persistProjectSession(projectRoot, createProjectSession(projectRoot));

    const result = await processProjectInteractionInput({
      projectRoot,
      input: "/open harbor",
      tools: {
        writeNextChapter: vi.fn(async () => ({ ok: true })),
        reviseDraft: vi.fn(async () => ({ ok: true })),
        patchChapterText: vi.fn(async () => ({ ok: true })),
        renameEntity: vi.fn(async () => ({ ok: true })),
        updateCurrentFocus: vi.fn(async () => ({ ok: true })),
        updateAuthorIntent: vi.fn(async () => ({ ok: true })),
        writeTruthFile: vi.fn(async () => ({ ok: true })),
        listBooks: vi.fn(async () => ["harbor"]),
      },
    });

    expect(result.session.activeBookId).toBe("harbor");
    expect(result.request.intent).toBe("select_book");
  });

  it("persists structured create_book requests into the shared project session", async () => {
    await persistProjectSession(projectRoot, createProjectSession(projectRoot));

    const tools = {
      listBooks: vi.fn(async () => ["harbor"]),
      createBook: vi.fn(async () => ({
        bookId: "night-harbor",
        title: "Night Harbor",
        __interaction: {
          responseText: "Created Night Harbor.",
        },
      })),
      exportBook: vi.fn(async () => ({ ok: true })),
      writeNextChapter: vi.fn(async () => ({ ok: true })),
      reviseDraft: vi.fn(async () => ({ ok: true })),
      patchChapterText: vi.fn(async () => ({ ok: true })),
      renameEntity: vi.fn(async () => ({ ok: true })),
      updateCurrentFocus: vi.fn(async () => ({ ok: true })),
      updateAuthorIntent: vi.fn(async () => ({ ok: true })),
      writeTruthFile: vi.fn(async () => ({ ok: true })),
    };

    const result = await processProjectInteractionRequest({
      projectRoot,
      request: {
        intent: "create_book",
        title: "Night Harbor",
        genre: "urban",
        platform: "tomato",
        chapterWordCount: 2800,
        targetChapters: 120,
      },
      tools,
    });

    expect(tools.createBook).toHaveBeenCalledWith({
      title: "Night Harbor",
      genre: "urban",
      platform: "tomato",
      chapterWordCount: 2800,
      targetChapters: 120,
    });
    expect(result.session.activeBookId).toBe("night-harbor");

    const persisted = await loadProjectSession(projectRoot);
    expect(persisted.activeBookId).toBe("night-harbor");
  });

  it("persists a creation draft across freeform ideation turns", async () => {
    const ideationRoot = await mkdtemp(join(tmpdir(), "inkos-project-ideation-"));
    await writeFile(join(ideationRoot, "inkos.json"), JSON.stringify({ language: "zh" }), "utf-8");
    await persistProjectSession(ideationRoot, createProjectSession(ideationRoot));

    const tools = {
      listBooks: vi.fn(async () => ["harbor"]),
      developBookDraft: vi.fn(async () => ({
        __interaction: {
          responseText: "我先按港风商战悬疑收着。你更想写长篇连载，还是十来章能收住？",
          details: {
            creationDraft: {
              concept: "港风商战悬疑，主角从灰产洗白。",
              title: "夜港账本",
              genre: "urban",
              nextQuestion: "更想写长篇连载，还是十来章能收住？",
              missingFields: ["targetChapters"],
              readyToCreate: false,
            },
          },
        },
      })),
      createBook: vi.fn(async () => ({ ok: true })),
      exportBook: vi.fn(async () => ({ ok: true })),
      writeNextChapter: vi.fn(async () => ({ ok: true })),
      reviseDraft: vi.fn(async () => ({ ok: true })),
      patchChapterText: vi.fn(async () => ({ ok: true })),
      renameEntity: vi.fn(async () => ({ ok: true })),
      updateCurrentFocus: vi.fn(async () => ({ ok: true })),
      updateAuthorIntent: vi.fn(async () => ({ ok: true })),
      writeTruthFile: vi.fn(async () => ({ ok: true })),
    };

    try {
      const result = await processProjectInteractionInput({
        projectRoot: ideationRoot,
        input: "我想写个港风商战悬疑，主角从灰产洗白。",
        tools,
      });

      expect(result.request.intent).toBe("develop_book");
      expect(result.session.creationDraft).toEqual(expect.objectContaining({
        title: "夜港账本",
        genre: "urban",
      }));

      const persisted = await loadProjectSession(ideationRoot);
      expect(persisted.creationDraft).toEqual(expect.objectContaining({
        title: "夜港账本",
      }));
    } finally {
      await rm(ideationRoot, { recursive: true, force: true });
    }
  });
});
