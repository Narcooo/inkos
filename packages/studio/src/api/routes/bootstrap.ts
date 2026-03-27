import { Hono, type Context } from "hono";
import { ApiError } from "../errors.js";
import type { BootstrapService } from "../services/bootstrap-service.js";

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError(400, "INVALID_PAYLOAD", "Expected a valid JSON request body.");
  }
}

export function createBootstrapRoutes(bootstrapService: BootstrapService): Hono {
  const app = new Hono();

  app.get("/bootstrap/status", async (c) => c.json(await bootstrapService.getStatus()));

  app.post("/bootstrap/project", async (c) => {
    const payload = await readJson(c);
    return c.json(await bootstrapService.createProject(payload as never), 201);
  });

  app.post("/bootstrap/book", async (c) => {
    const payload = await readJson(c);
    return c.json(await bootstrapService.createBook(payload as never), 201);
  });

  return app;
}
