import { Hono } from "hono";
import { ApiError, isSafeBookId } from "../errors.js";
import type { ChapterService } from "../services/chapter-service.js";
import type { ReviewActionPayload } from "../../shared/contracts.js";

function jsonError(code: string, message: string, status: number) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function createReviewRoutes(chapterService: ChapterService): Hono {
  const app = new Hono();

  app.post("/books/:bookId/review/approve", async (c) => {
    const validated = await validateReviewRequest(c.req.raw, c.req.param("bookId"));
    if (validated instanceof Response) {
      return validated;
    }

    if (!(await chapterService.hasBook(validated.bookId))) {
      return jsonError("BOOK_NOT_FOUND", `Book "${validated.bookId}" not found.`, 404);
    }

    try {
      const chapter = await chapterService.approveChapter(validated.bookId, validated.payload.chapterNumber);
      if (!chapter) {
        return jsonError(
          "CHAPTER_NOT_FOUND",
          `Chapter ${validated.payload.chapterNumber} not found for book "${validated.bookId}".`,
          404,
        );
      }
      return c.json(chapter);
    } catch (error) {
      if (error instanceof ApiError) {
        return jsonError(error.code, error.message, error.status);
      }
      throw error;
    }
  });

  app.post("/books/:bookId/review/reject", async (c) => {
    const validated = await validateReviewRequest(c.req.raw, c.req.param("bookId"));
    if (validated instanceof Response) {
      return validated;
    }

    if (!(await chapterService.hasBook(validated.bookId))) {
      return jsonError("BOOK_NOT_FOUND", `Book "${validated.bookId}" not found.`, 404);
    }

    try {
      const chapter = await chapterService.rejectChapter(
        validated.bookId,
        validated.payload.chapterNumber,
        validated.payload.reason,
      );
      if (!chapter) {
        return jsonError(
          "CHAPTER_NOT_FOUND",
          `Chapter ${validated.payload.chapterNumber} not found for book "${validated.bookId}".`,
          404,
        );
      }
      return c.json(chapter);
    } catch (error) {
      if (error instanceof ApiError) {
        return jsonError(error.code, error.message, error.status);
      }
      throw error;
    }
  });

  return app;
}

async function validateReviewRequest(
  request: Request,
  bookId: string,
): Promise<{ bookId: string; payload: ReviewActionPayload } | Response> {
  if (!isSafeBookId(bookId)) {
    return jsonError("BOOK_NOT_FOUND", `Book "${bookId}" not found.`, 404);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError(
      "INVALID_PAYLOAD",
      'Expected JSON payload with positive integer "chapterNumber" and optional string "reason".',
      400,
    );
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    !Number.isInteger((payload as ReviewActionPayload).chapterNumber) ||
    (payload as ReviewActionPayload).chapterNumber < 1 ||
    (((payload as ReviewActionPayload).reason as unknown) !== undefined && typeof (payload as ReviewActionPayload).reason !== "string")
  ) {
    return jsonError(
      "INVALID_PAYLOAD",
      'Expected JSON payload with positive integer "chapterNumber" and optional string "reason".',
      400,
    );
  }

  return {
    bookId,
    payload: {
      chapterNumber: (payload as ReviewActionPayload).chapterNumber,
      ...((payload as ReviewActionPayload).reason !== undefined ? { reason: (payload as ReviewActionPayload).reason } : {}),
    },
  };
}
