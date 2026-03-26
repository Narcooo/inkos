import { Hono } from "hono";
import { isSafeBookId } from "../errors.js";
import type { ProjectService } from "../services/project-service.js";

function jsonError(code: string, message: string, status: number) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function createBookRoutes(projectService: ProjectService): Hono {
  const app = new Hono();

  app.get("/books", async (c) => c.json(await projectService.listBooks()));

  app.get("/books/:bookId", async (c) => {
    const bookId = c.req.param("bookId");
    if (!isSafeBookId(bookId)) {
      return jsonError("BOOK_NOT_FOUND", `Book \"${bookId}\" not found.`, 404);
    }

    const book = await projectService.getBook(bookId);
    if (!book) {
      return jsonError("BOOK_NOT_FOUND", `Book \"${bookId}\" not found.`, 404);
    }
    return c.json(book);
  });

  return app;
}
