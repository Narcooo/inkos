import type { Hono } from "hono";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function registerStudioStaticRoutes(app: Hono, staticDir: string): Promise<void> {
  app.get("/assets/*", async (c) => {
    const filePath = join(staticDir, c.req.path);
    try {
      const content = await readFile(filePath);
      const ext = filePath.split(".").pop() ?? "";
      const contentTypes: Record<string, string> = {
        js: "application/javascript",
        css: "text/css",
        svg: "image/svg+xml",
        png: "image/png",
        ico: "image/x-icon",
        json: "application/json",
      };
      return new Response(content, {
        headers: { "Content-Type": contentTypes[ext] ?? "application/octet-stream" },
      });
    } catch {
      return c.notFound();
    }
  });

  const indexPath = join(staticDir, "index.html");
  if (existsSync(indexPath)) {
    const indexHtml = await readFile(indexPath, "utf-8");
    app.get("*", (c) => {
      if (c.req.path.startsWith("/api/v1/")) return c.notFound();
      return c.html(indexHtml);
    });
  }
}
