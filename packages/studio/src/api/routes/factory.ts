import { Hono, type Context } from "hono";
import type { FactoryBookPayload, FactoryGenerateOutlineRequest } from "../../shared/contracts.js";
import { ApiError, isSafeBookId } from "../errors.js";
import type { FactoryService } from "../services/factory-service.js";

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError(400, "INVALID_PAYLOAD", "Expected a valid JSON request body.");
  }
}

export function createFactoryRoutes(factoryService: FactoryService): Hono {
  const app = new Hono();

  app.post("/factory/setup-story", async (c) => {
    const payload = await readJson(c) as FactoryBookPayload;
    const bookId = payload.bookId;
    if (!isSafeBookId(bookId)) {
      throw new ApiError(404, "BOOK_NOT_FOUND", `Book \"${bookId}\" not found.`);
    }

    return c.json(await factoryService.setupStory(bookId));
  });

  app.post("/factory/generate-outline", async (c) => {
    const payload = await readJson(c) as FactoryGenerateOutlineRequest;
    const bookId = payload.bookId;
    if (!isSafeBookId(bookId)) {
      throw new ApiError(404, "BOOK_NOT_FOUND", `Book \"${bookId}\" not found.`);
    }

    return c.json(await factoryService.generateOutline(bookId, payload));
  });

  app.post("/factory/generate-first-chapter", async (c) => {
    const payload = await readJson(c) as FactoryBookPayload;
    const bookId = payload.bookId;
    if (!isSafeBookId(bookId)) {
      throw new ApiError(404, "BOOK_NOT_FOUND", `Book \"${bookId}\" not found.`);
    }

    return c.json(await factoryService.generateFirstChapter(bookId));
  });

  return app;
}
