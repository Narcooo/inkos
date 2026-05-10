import type { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

interface RegisterLogsRoutesOptions {
  readonly root: string;
}

export function registerLogsRoutes(app: Hono, options: RegisterLogsRoutesOptions): void {
  app.get("/api/v1/logs", async (c) => {
    const logPath = join(options.root, "inkos.log");
    try {
      const content = await readFile(logPath, "utf-8");
      const lines = content.trim().split("\n").slice(-100);
      const entries = lines.map((line) => {
        try { return JSON.parse(line); } catch { return { message: line }; }
      });
      return c.json({ entries });
    } catch {
      return c.json({ entries: [] });
    }
  });
}
