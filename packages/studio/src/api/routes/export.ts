import type { Hono } from "hono";
import {
  buildExportArtifact,
  createInteractionToolsFromDeps,
  PipelineRunner,
  processProjectInteractionRequest,
  type PipelineConfig,
  type StateManager,
} from "@actalk/inkos-core";
import { join } from "node:path";

interface RegisterExportRoutesOptions {
  readonly root: string;
  readonly state: StateManager;
  readonly buildPipelineConfig: () => Promise<PipelineConfig>;
}

export function registerExportRoutes(app: Hono, options: RegisterExportRoutesOptions): void {
  app.get("/api/v1/books/:id/export", async (c) => {
    const id = c.req.param("id");
    const format = (c.req.query("format") ?? "txt") as string;
    const approvedOnly = c.req.query("approvedOnly") === "true";

    try {
      const artifact = await buildExportArtifact(options.state, id, {
        format: format as "txt" | "md" | "epub",
        approvedOnly,
      });
      const responseBody = typeof artifact.payload === "string"
        ? artifact.payload
        : new Uint8Array(artifact.payload);
      return new Response(responseBody, {
        headers: {
          "Content-Type": artifact.contentType,
          "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
        },
      });
    } catch {
      return c.json({ error: "Export failed" }, 500);
    }
  });

  app.post("/api/v1/books/:id/export-save", async (c) => {
    const id = c.req.param("id");
    const { format, approvedOnly } = await c.req
      .json<{ format?: string; approvedOnly?: boolean }>()
      .catch(() => ({ format: "txt", approvedOnly: false }));
    const fmt = format ?? "txt";

    try {
      const pipeline = new PipelineRunner(await options.buildPipelineConfig());
      const tools = createInteractionToolsFromDeps(pipeline, options.state);
      const bookDir = options.state.bookDir(id);
      const outputPath = join(bookDir, `${id}.${fmt === "epub" ? "epub" : fmt}`);
      const result = await processProjectInteractionRequest({
        projectRoot: options.root,
        request: {
          intent: "export_book",
          bookId: id,
          format: fmt as "txt" | "md" | "epub",
          approvedOnly,
          outputPath,
        },
        tools,
        activeBookId: id,
      });
      return c.json({
        ok: true,
        path: (result.details?.outputPath as string | undefined) ?? outputPath,
        format: fmt,
        chapters: (result.details?.chaptersExported as number | undefined) ?? 0,
      });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });
}
