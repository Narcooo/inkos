import { Hono, type Context } from "hono";
import { ApiError } from "../errors.js";
import type { ImportService } from "../services/import-service.js";

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError(400, "INVALID_PAYLOAD", "Expected a valid JSON request body.");
  }
}

export function createImportRoutes(importService: ImportService): Hono {
  const app = new Hono();

  app.post("/imports/idea", async (c) => {
    const payload = await readJson(c);
    return c.json(importService.normalizeIdea(payload as never));
  });

  app.post("/imports/files", async (c) => {
    const payload = await readJson(c);
    return c.json(importService.summarizeUpload(payload as never));
  });

  return app;
}
