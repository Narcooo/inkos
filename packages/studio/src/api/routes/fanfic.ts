import type { Hono } from "hono";
import {
  PipelineRunner,
  type PipelineConfig,
  type StateManager,
} from "@actalk/inkos-core";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

interface RegisterFanficRoutesOptions {
  readonly state: StateManager;
  readonly buildPipelineConfig: () => Promise<PipelineConfig>;
  readonly broadcast: (event: string, data: unknown) => void;
}

export function registerFanficRoutes(app: Hono, options: RegisterFanficRoutesOptions): void {
  app.post("/api/v1/fanfic/init", async (c) => {
    const body = await c.req.json<{
      title: string;
      sourceText: string;
      sourceName?: string;
      mode?: string;
      genre?: string;
      platform?: string;
      targetChapters?: number;
      chapterWordCount?: number;
      language?: string;
    }>();
    if (!body.title || !body.sourceText) {
      return c.json({ error: "title and sourceText are required" }, 400);
    }

    const now = new Date().toISOString();
    const bookId = body.title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 30);

    const bookConfig = {
      id: bookId,
      title: body.title,
      platform: (body.platform ?? "other") as "other",
      genre: (body.genre ?? "other") as "xuanhuan",
      status: "outlining" as const,
      targetChapters: body.targetChapters ?? 100,
      chapterWordCount: body.chapterWordCount ?? 3000,
      fanficMode: (body.mode ?? "canon") as "canon",
      ...(body.language ? { language: body.language as "zh" | "en" } : {}),
      createdAt: now,
      updatedAt: now,
    };

    options.broadcast("fanfic:start", { bookId, title: body.title });
    try {
      const pipeline = new PipelineRunner(await options.buildPipelineConfig());
      await pipeline.initFanficBook(
        bookConfig,
        body.sourceText,
        body.sourceName ?? "source",
        (body.mode ?? "canon") as "canon",
      );
      options.broadcast("fanfic:complete", { bookId });
      return c.json({ ok: true, bookId });
    } catch (e) {
      options.broadcast("fanfic:error", { bookId, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get("/api/v1/books/:id/fanfic", async (c) => {
    const id = c.req.param("id");
    const bookDir = options.state.bookDir(id);
    try {
      const content = await readFile(join(bookDir, "story", "fanfic_canon.md"), "utf-8");
      return c.json({ bookId: id, content });
    } catch {
      return c.json({ bookId: id, content: null });
    }
  });

  app.post("/api/v1/books/:id/fanfic/refresh", async (c) => {
    const id = c.req.param("id");
    const { sourceText, sourceName } = await c.req.json<{ sourceText: string; sourceName?: string }>();
    if (!sourceText?.trim()) return c.json({ error: "sourceText is required" }, 400);

    options.broadcast("fanfic:refresh:start", { bookId: id });
    try {
      const book = await options.state.loadBookConfig(id);
      const pipeline = new PipelineRunner(await options.buildPipelineConfig());
      await pipeline.importFanficCanon(
        id,
        sourceText,
        sourceName ?? "source",
        (book.fanficMode ?? "canon") as "canon",
      );
      options.broadcast("fanfic:refresh:complete", { bookId: id });
      return c.json({ ok: true });
    } catch (e) {
      options.broadcast("fanfic:refresh:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });
}
