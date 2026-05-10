import type { Hono } from "hono";
import {
  analyzeAITells,
  analyzeDetectionInsights,
  loadDetectionHistory,
  type StateManager,
} from "@actalk/inkos-core";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

interface RegisterDetectionRoutesOptions {
  readonly state: StateManager;
}

export function registerDetectionRoutes(app: Hono, options: RegisterDetectionRoutesOptions): void {
  app.post("/api/v1/books/:id/detect/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const bookDir = options.state.bookDir(id);

    try {
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNum).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const content = await readFile(join(chaptersDir, match), "utf-8");
      const result = analyzeAITells(content);
      return c.json({ chapterNumber: chapterNum, ...result });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/detect-all", async (c) => {
    const id = c.req.param("id");
    const bookDir = options.state.bookDir(id);

    try {
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const mdFiles = files.filter((f) => f.endsWith(".md") && /^\d{4}/.test(f)).sort();

      const results = await Promise.all(
        mdFiles.map(async (file) => {
          const num = parseInt(file.slice(0, 4), 10);
          const content = await readFile(join(chaptersDir, file), "utf-8");
          const result = analyzeAITells(content);
          return { chapterNumber: num, filename: file, ...result };
        }),
      );
      return c.json({ bookId: id, results });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get("/api/v1/books/:id/detect/stats", async (c) => {
    const id = c.req.param("id");
    try {
      const bookDir = options.state.bookDir(id);
      const history = await loadDetectionHistory(bookDir);
      const insights = analyzeDetectionInsights(history);
      return c.json(insights);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });
}
