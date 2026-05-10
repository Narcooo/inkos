import type { Hono } from "hono";
import {
  ContinuityAuditor,
  createLLMClient,
  PipelineRunner,
  type PipelineConfig,
  type ProjectConfig,
  type StateManager,
} from "@actalk/inkos-core";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

interface RegisterBookOpsRoutesOptions {
  readonly root: string;
  readonly state: StateManager;
  readonly loadCurrentProjectConfig: () => Promise<ProjectConfig>;
  readonly buildPipelineConfig: (overrides?: {
    readonly externalContext?: string;
    readonly sessionIdForSSE?: string;
  }) => Promise<PipelineConfig>;
  readonly broadcast: (event: string, data: unknown) => void;
}

type ReviseMode = "polish" | "rewrite" | "rework" | "spot-fix" | "anti-detect";

async function findChapterFile(bookDir: string, chapterNum: number): Promise<string | null> {
  const chaptersDir = join(bookDir, "chapters");
  const files = await readdir(chaptersDir);
  const paddedNum = String(chapterNum).padStart(4, "0");
  const match = files.find((file) => file.startsWith(paddedNum) && file.endsWith(".md"));
  return match ? join(chaptersDir, match) : null;
}

export function registerBookOpsRoutes(app: Hono, options: RegisterBookOpsRoutesOptions): void {
  app.post("/api/v1/books/:id/audit/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const bookDir = options.state.bookDir(id);

    options.broadcast("audit:start", { bookId: id, chapter: chapterNum });
    try {
      const book = await options.state.loadBookConfig(id);
      const chapterPath = await findChapterFile(bookDir, chapterNum);
      if (!chapterPath) return c.json({ error: "Chapter not found" }, 404);

      const content = await readFile(chapterPath, "utf-8");
      const currentConfig = await options.loadCurrentProjectConfig();
      const auditor = new ContinuityAuditor({
        client: createLLMClient(currentConfig.llm),
        model: currentConfig.llm.model,
        projectRoot: options.root,
        bookId: id,
      });
      const result = await auditor.auditChapter(bookDir, content, chapterNum, book.genre);
      options.broadcast("audit:complete", { bookId: id, chapter: chapterNum, passed: result.passed });
      return c.json(result);
    } catch (e) {
      options.broadcast("audit:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/revise/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const bookDir = options.state.bookDir(id);
    const body = await c.req
      .json<{ mode?: string; brief?: string }>()
      .catch(() => ({ mode: "spot-fix", brief: undefined }));

    options.broadcast("revise:start", { bookId: id, chapter: chapterNum });
    try {
      await options.state.loadBookConfig(id);
      const chapterPath = await findChapterFile(bookDir, chapterNum);
      if (!chapterPath) return c.json({ error: "Chapter not found" }, 404);

      const pipeline = new PipelineRunner(await options.buildPipelineConfig({
        externalContext: body.brief,
      }));
      const normalizedMode = (body.mode ?? "spot-fix") as ReviseMode;
      const result = await pipeline.reviseDraft(id, chapterNum, normalizedMode);
      options.broadcast("revise:complete", { bookId: id, chapter: chapterNum });
      return c.json(result);
    } catch (e) {
      options.broadcast("revise:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  app.delete("/api/v1/books/:id", async (c) => {
    const id = c.req.param("id");
    const bookDir = options.state.bookDir(id);
    try {
      await rm(bookDir, { recursive: true, force: true });
      options.broadcast("book:deleted", { bookId: id });
      return c.json({ ok: true, bookId: id });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.put("/api/v1/books/:id", async (c) => {
    const id = c.req.param("id");
    const updates = await c.req.json<{
      chapterWordCount?: number;
      targetChapters?: number;
      status?: string;
      language?: string;
    }>();
    try {
      const book = await options.state.loadBookConfig(id);
      const updated = {
        ...book,
        ...(updates.chapterWordCount !== undefined ? { chapterWordCount: Number(updates.chapterWordCount) } : {}),
        ...(updates.targetChapters !== undefined ? { targetChapters: Number(updates.targetChapters) } : {}),
        ...(updates.status !== undefined ? { status: updates.status as typeof book.status } : {}),
        ...(updates.language !== undefined ? { language: updates.language as "zh" | "en" } : {}),
        updatedAt: new Date().toISOString(),
      };
      await options.state.saveBookConfig(id, updated);
      return c.json({ ok: true, book: updated });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/rewrite/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const body: { brief?: string } = await c.req.json<{ brief?: string }>().catch(() => ({}));

    options.broadcast("rewrite:start", { bookId: id, chapter: chapterNum });
    try {
      const rollbackTarget = chapterNum - 1;
      const discarded = await options.state.rollbackToChapter(id, rollbackTarget);
      const pipeline = new PipelineRunner(await options.buildPipelineConfig({
        externalContext: body.brief,
      }));
      pipeline.writeNextChapter(id).then(
        (result) => options.broadcast("rewrite:complete", {
          bookId: id,
          chapterNumber: result.chapterNumber,
          title: result.title,
          wordCount: result.wordCount,
        }),
        (e: unknown) => options.broadcast("rewrite:error", {
          bookId: id,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
      return c.json({ status: "rewriting", bookId: id, chapter: chapterNum, rolledBackTo: rollbackTarget, discarded });
    } catch (e) {
      options.broadcast("rewrite:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/resync/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const body: { brief?: string } = await c.req.json<{ brief?: string }>().catch(() => ({}));

    try {
      const pipeline = new PipelineRunner(await options.buildPipelineConfig({
        externalContext: body.brief,
      }));
      const result = await pipeline.resyncChapterArtifacts(id, chapterNum);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });
}
