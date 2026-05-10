import type { Hono } from "hono";
import {
  createAndPersistBookSession,
  deleteBookSession,
  listBookSessions,
  loadBookSession,
  renameBookSession,
} from "@actalk/inkos-core";
import { ApiError } from "../errors.js";

interface ProjectSessionLike {
  readonly activeBookId?: string | null;
}

interface RegisterSessionRoutesOptions {
  readonly root: string;
  readonly loadProjectSession: () => Promise<ProjectSessionLike>;
  readonly resolveSessionActiveBook: (session: ProjectSessionLike) => Promise<string | null | undefined>;
  readonly normalizeApiBookId: (value: unknown, fieldName: string) => string | null;
}

export function registerSessionRoutes(app: Hono, options: RegisterSessionRoutesOptions): void {
  app.get("/api/v1/interaction/session", async (c) => {
    const session = await options.loadProjectSession();
    const activeBookId = await options.resolveSessionActiveBook(session);
    return c.json({
      session: activeBookId && session.activeBookId !== activeBookId
        ? { ...session, activeBookId }
        : session,
      activeBookId,
    });
  });

  app.get("/api/v1/sessions", async (c) => {
    const bookId = c.req.query("bookId");
    const sessions = await listBookSessions(options.root, bookId === undefined ? null : bookId === "null" ? null : bookId);
    return c.json({ sessions });
  });

  app.get("/api/v1/sessions/:sessionId", async (c) => {
    const session = await loadBookSession(options.root, c.req.param("sessionId"));
    if (!session) return c.json({ error: "Session not found" }, 404);
    return c.json({ session });
  });

  app.post("/api/v1/sessions", async (c) => {
    const body = await c.req.json<{ bookId?: string | null; sessionId?: string }>().catch(() => ({}));
    const bookId = options.normalizeApiBookId((body as { bookId?: unknown }).bookId, "bookId");
    const sessionId = (body as { sessionId?: string }).sessionId;
    const safeSessionId = sessionId && /^[0-9]+-[a-z0-9]+$/.test(sessionId) ? sessionId : undefined;
    const session = await createAndPersistBookSession(options.root, bookId, safeSessionId);
    return c.json({ session });
  });

  app.put("/api/v1/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json<{ title?: string }>().catch(() => ({}) as { title?: string });
    const title = body.title?.trim();
    if (!title) {
      throw new ApiError(400, "INVALID_SESSION_TITLE", "Session title is required");
    }

    const session = await renameBookSession(options.root, sessionId, title);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }
    return c.json({ session });
  });

  app.delete("/api/v1/sessions/:sessionId", async (c) => {
    await deleteBookSession(options.root, c.req.param("sessionId"));
    return c.json({ ok: true });
  });
}
