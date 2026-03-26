import { Hono } from "hono";
import { ApiError, isSafeBookId } from "../errors.js";
import type { ChapterService } from "../services/chapter-service.js";
import type { SaveChapterPayload } from "../../shared/contracts.js";

function jsonError(code: string, message: string, status: number) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function createChapterRoutes(chapterService: ChapterService): Hono {
  const app = new Hono();

  app.get("/books/:bookId/chapters", async (c) => {
    const bookId = c.req.param("bookId");
    if (!isSafeBookId(bookId)) {
      return jsonError("BOOK_NOT_FOUND", `Book \"${bookId}\" not found.`, 404);
    }

    const chapters = await chapterService.listChapters(bookId);

    if (!chapters) {
      return jsonError("BOOK_NOT_FOUND", `Book \"${bookId}\" not found.`, 404);
    }

    return c.json(chapters);
  });

  app.get("/books/:bookId/chapters/:chapterNumber", async (c) => {
    const bookId = c.req.param("bookId");
    const chapterNumberParam = c.req.param("chapterNumber");

    if (!isSafeBookId(bookId)) {
      return jsonError("BOOK_NOT_FOUND", `Book \"${bookId}\" not found.`, 404);
    }

    if (!/^\d+$/.test(chapterNumberParam)) {
      return jsonError("CHAPTER_NOT_FOUND", `Chapter ${chapterNumberParam} not found for book \"${bookId}\".`, 404);
    }

    const chapterNumber = Number.parseInt(chapterNumberParam, 10);

    if (chapterNumber < 1) {
      return jsonError("CHAPTER_NOT_FOUND", `Chapter ${chapterNumberParam} not found for book \"${bookId}\".`, 404);
    }

    if (!(await chapterService.hasBook(bookId))) {
      return jsonError("BOOK_NOT_FOUND", `Book \"${bookId}\" not found.`, 404);
    }

    let chapter;
    try {
      chapter = await chapterService.getChapter(bookId, chapterNumber);
    } catch (error) {
      if (error instanceof ApiError) {
        return jsonError(error.code, error.message, error.status);
      }
      throw error;
    }

    if (!chapter) {
      return jsonError("CHAPTER_NOT_FOUND", `Chapter ${chapterNumber} not found for book \"${bookId}\".`, 404);
    }

    return c.json(chapter);
  });

  app.put("/books/:bookId/chapters/:chapterNumber", async (c) => {
    const bookId = c.req.param("bookId");
    const chapterNumberParam = c.req.param("chapterNumber");

    if (!isSafeBookId(bookId)) {
      return jsonError("BOOK_NOT_FOUND", `Book "${bookId}" not found.`, 404);
    }

    if (!/^\d+$/.test(chapterNumberParam)) {
      return jsonError("CHAPTER_NOT_FOUND", `Chapter ${chapterNumberParam} not found for book "${bookId}".`, 404);
    }

    const chapterNumber = Number.parseInt(chapterNumberParam, 10);
    if (chapterNumber < 1) {
      return jsonError("CHAPTER_NOT_FOUND", `Chapter ${chapterNumberParam} not found for book "${bookId}".`, 404);
    }

    if (!(await chapterService.hasBook(bookId))) {
      return jsonError("BOOK_NOT_FOUND", `Book "${bookId}" not found.`, 404);
    }

    const payload = await parseSavePayload(c.req.raw);
    if (!payload) {
      return jsonError("INVALID_PAYLOAD", 'Expected JSON payload with string field "content".', 400);
    }

    let chapter;
    try {
      chapter = await chapterService.saveChapter(bookId, chapterNumber, payload.content);
    } catch (error) {
      if (error instanceof ApiError) {
        return jsonError(error.code, error.message, error.status);
      }
      throw error;
    }

    if (!chapter) {
      return jsonError("CHAPTER_NOT_FOUND", `Chapter ${chapterNumber} not found for book "${bookId}".`, 404);
    }

    return c.json(chapter);
  });

  return app;
}

async function parseSavePayload(request: Request): Promise<SaveChapterPayload | null> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return null;
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    typeof (payload as SaveChapterPayload).content !== "string"
  ) {
    return null;
  }

  return { content: (payload as SaveChapterPayload).content };
}
