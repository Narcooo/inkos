import type { Hono } from "hono";
import { computeAnalytics, type StateManager } from "@actalk/inkos-core";

interface RegisterAnalyticsRoutesOptions {
  readonly state: StateManager;
}

export function registerAnalyticsRoutes(app: Hono, options: RegisterAnalyticsRoutesOptions): void {
  app.get("/api/v1/books/:id/analytics", async (c) => {
    const id = c.req.param("id");
    try {
      const chapters = await options.state.loadChapterIndex(id);
      return c.json(computeAnalytics(id, chapters));
    } catch {
      return c.json({ error: `Book "${id}" not found` }, 404);
    }
  });
}
