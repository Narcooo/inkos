import { Hono } from "hono";
import { isSafeBookId } from "../errors.js";
import type { TruthFileService } from "../services/truth-file-service.js";

function jsonError(code: string, message: string, status: number) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function createTruthFileRoutes(truthFileService: TruthFileService): Hono {
  const app = new Hono();

  app.get("/books/:bookId/truth-files", async (c) => {
    const bookId = c.req.param("bookId");
    if (!isSafeBookId(bookId)) {
      return jsonError("BOOK_NOT_FOUND", `Book \"${bookId}\" not found.`, 404);
    }

    const truthFiles = await truthFileService.listTruthFiles(bookId);

    if (!truthFiles) {
      return jsonError("BOOK_NOT_FOUND", `Book \"${bookId}\" not found.`, 404);
    }

    return c.json(truthFiles);
  });

  app.get("/books/:bookId/truth-files/:name", async (c) => {
    const bookId = c.req.param("bookId");
    const name = c.req.param("name");

    if (!isSafeBookId(bookId)) {
      return jsonError("BOOK_NOT_FOUND", `Book \"${bookId}\" not found.`, 404);
    }

    if (!(await truthFileService.hasBook(bookId))) {
      return jsonError("BOOK_NOT_FOUND", `Book \"${bookId}\" not found.`, 404);
    }

    if (!truthFileService.isSupported(name)) {
      return jsonError("TRUTH_FILE_NOT_FOUND", `Truth file \"${name}\" is not supported for book \"${bookId}\".`, 404);
    }

    const truthFile = await truthFileService.getTruthFile(bookId, name);
    if (!truthFile) {
      return jsonError("TRUTH_FILE_NOT_FOUND", `Truth file \"${name}\" not found for book \"${bookId}\".`, 404);
    }

    return c.json(truthFile);
  });

  return app;
}
