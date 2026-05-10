import type { Hono } from "hono";
import {
  analyzeStyle,
  PipelineRunner,
  splitChapters,
  type PipelineConfig,
} from "@actalk/inkos-core";

interface RegisterStyleImportRoutesOptions {
  readonly buildPipelineConfig: () => Promise<PipelineConfig>;
  readonly broadcast: (event: string, data: unknown) => void;
}

export function registerStyleImportRoutes(
  app: Hono,
  options: RegisterStyleImportRoutesOptions,
): void {
  app.post("/api/v1/style/analyze", async (c) => {
    const { text, sourceName } = await c.req.json<{ text: string; sourceName: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    try {
      const profile = analyzeStyle(text, sourceName ?? "unknown");
      return c.json(profile);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/style/import", async (c) => {
    const id = c.req.param("id");
    const { text, sourceName } = await c.req.json<{ text: string; sourceName: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    options.broadcast("style:start", { bookId: id });
    try {
      const pipeline = new PipelineRunner(await options.buildPipelineConfig());
      const result = await pipeline.generateStyleGuide(id, text, sourceName ?? "unknown");
      options.broadcast("style:complete", { bookId: id });
      return c.json({ ok: true, result });
    } catch (e) {
      options.broadcast("style:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/import/chapters", async (c) => {
    const id = c.req.param("id");
    const { text, splitRegex } = await c.req.json<{ text: string; splitRegex?: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    options.broadcast("import:start", { bookId: id, type: "chapters" });
    try {
      const chapters = [...splitChapters(text, splitRegex)];
      const pipeline = new PipelineRunner(await options.buildPipelineConfig());
      const result = await pipeline.importChapters({ bookId: id, chapters });
      options.broadcast("import:complete", { bookId: id, type: "chapters", count: result.importedCount });
      return c.json(result);
    } catch (e) {
      options.broadcast("import:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/import/canon", async (c) => {
    const id = c.req.param("id");
    const { fromBookId } = await c.req.json<{ fromBookId: string }>();
    if (!fromBookId) return c.json({ error: "fromBookId is required" }, 400);

    options.broadcast("import:start", { bookId: id, type: "canon" });
    try {
      const pipeline = new PipelineRunner(await options.buildPipelineConfig());
      await pipeline.importCanon(id, fromBookId);
      options.broadcast("import:complete", { bookId: id, type: "canon" });
      return c.json({ ok: true });
    } catch (e) {
      options.broadcast("import:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });
}
