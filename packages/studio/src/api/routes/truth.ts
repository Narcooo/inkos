import type { Hono } from "hono";
import type { StateManager } from "@actalk/inkos-core";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  isLegacyTruthShim,
  LEGACY_SHIM_FILES,
  listTruthFiles,
  resolveTruthFilePath,
} from "../books/truth-files.js";

interface RegisterTruthRoutesOptions {
  readonly state: StateManager;
}

export function registerTruthRoutes(app: Hono, options: RegisterTruthRoutesOptions): void {
  app.get("/api/v1/books/:id/truth/:file{.+}", async (c) => {
    const file = c.req.param("file");
    const id = c.req.param("id");

    const bookDir = options.state.bookDir(id);
    const resolved = resolveTruthFilePath(bookDir, file);
    if (!resolved) {
      return c.json({ error: "Invalid truth file" }, 400);
    }

    const legacy = await isLegacyTruthShim(bookDir, file);

    try {
      const content = await readFile(resolved, "utf-8");
      return c.json({ file, content, ...(legacy ? { legacy: true } : {}) });
    } catch {
      return c.json({ file, content: null, ...(legacy ? { legacy: true } : {}) });
    }
  });

  app.get("/api/v1/books/:id/truth", async (c) => {
    const id = c.req.param("id");
    const bookDir = options.state.bookDir(id);

    try {
      const files = await listTruthFiles(bookDir);
      return c.json({ files });
    } catch {
      return c.json({ files: [] });
    }
  });

  app.put("/api/v1/books/:id/truth/:file{.+}", async (c) => {
    const id = c.req.param("id");
    const file = c.req.param("file");
    const bookDir = options.state.bookDir(id);
    const resolved = resolveTruthFilePath(bookDir, file);
    if (!resolved) {
      return c.json({ error: "Invalid truth file" }, 400);
    }

    if (LEGACY_SHIM_FILES.has(file) && await isLegacyTruthShim(bookDir, file)) {
      return c.json(
        { error: "Legacy compat shim; edit outline/story_frame.md instead" },
        400,
      );
    }

    const { content } = await c.req.json<{ content: string }>();
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, content, "utf-8");
    return c.json({ ok: true });
  });
}
