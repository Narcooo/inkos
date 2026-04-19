import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createProjectSession, persistProjectSession } from "../tui/session-store.js";
import { processTuiInput } from "../tui/app.js";

let projectRoot: string;

describe("tui control flow", () => {
  beforeAll(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "inkos-tui-control-"));
    await mkdir(join(projectRoot, "books", "harbor"), { recursive: true });
    await writeFile(join(projectRoot, "books", "harbor", "book.json"), "{}", "utf-8");
    await writeFile(join(projectRoot, "inkos.json"), JSON.stringify({ language: "zh" }), "utf-8");
  });

  afterAll(async () => {
    // tmpdir cleanup omitted
  });

  it("routes continue through the active project book", async () => {
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

    const result = await processTuiInput(projectRoot, "continue", tools);

    expect(tools.writeNextChapter).toHaveBeenCalledWith("harbor");
    expect(result.session.activeBookId).toBe("harbor");
    expect(result.session.currentExecution?.status).toBe("waiting_human");
    expect(result.session.pendingDecision?.kind).toBe("review-next-step");
    expect(result.session.pendingDecision?.summary).toContain("等待");
    expect(result.session.messages.at(0)?.role).toBe("user");
    expect(result.session.messages.at(-1)?.role).toBe("assistant");
  });

  it("routes focus updates through the interaction runtime", async () => {
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

    await processTuiInput(projectRoot, "把 focus 拉回旧案线", tools);

    expect(tools.updateCurrentFocus).toHaveBeenCalledWith("harbor", "把 focus 拉回旧案线");
  });

  it("persists automation mode changes through the session", async () => {
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

    const result = await processTuiInput(projectRoot, "切换到全自动", tools);

    expect(result.session.automationMode).toBe("auto");
  });

  it("routes truth-file edits through the shared control flow", async () => {
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

    await processTuiInput(projectRoot, "/truth current_focus.md Bring it back", tools);

    expect(tools.writeTruthFile).toHaveBeenCalledWith(
      "harbor",
      "current_focus.md",
      "Bring it back",
    );
  });

  it("binds the active book through /open in multi-book projects", async () => {
    await mkdir(join(projectRoot, "books", "beta"), { recursive: true });
    await writeFile(join(projectRoot, "books", "beta", "book.json"), "{}", "utf-8");
    await persistProjectSession(projectRoot, createProjectSession(projectRoot));

    const tools = {
      listBooks: vi.fn(async () => ["harbor", "beta"]),
      writeNextChapter: vi.fn(async () => ({ ok: true })),
      reviseDraft: vi.fn(async () => ({ ok: true })),
      patchChapterText: vi.fn(async () => ({ ok: true })),
      renameEntity: vi.fn(async () => ({ ok: true })),
      updateCurrentFocus: vi.fn(async () => ({ ok: true })),
      updateAuthorIntent: vi.fn(async () => ({ ok: true })),
      writeTruthFile: vi.fn(async () => ({ ok: true })),
    };

    const result = await processTuiInput(projectRoot, "/open beta", tools);

    expect(result.session.activeBookId).toBe("beta");
    expect(result.session.messages.at(-1)?.content).toContain("beta");
  });

  it("formats interactive summaries in English when the project language is en", async () => {
    await writeFile(join(projectRoot, "inkos.json"), JSON.stringify({ language: "en" }), "utf-8");
    await persistProjectSession(projectRoot, createProjectSession(projectRoot));

    const tools = {
      listBooks: vi.fn(async () => ["harbor", "beta"]),
      writeNextChapter: vi.fn(async () => ({ ok: true })),
      reviseDraft: vi.fn(async () => ({ ok: true })),
      patchChapterText: vi.fn(async () => ({ ok: true })),
      renameEntity: vi.fn(async () => ({ ok: true })),
      updateCurrentFocus: vi.fn(async () => ({ ok: true })),
      updateAuthorIntent: vi.fn(async () => ({ ok: true })),
      writeTruthFile: vi.fn(async () => ({ ok: true })),
    };

    const result = await processTuiInput(projectRoot, "/open beta", tools);

    expect(result.session.messages.at(-1)?.content).toBe("Active book: beta");

    await writeFile(join(projectRoot, "inkos.json"), JSON.stringify({ language: "zh" }), "utf-8");
  });
});
