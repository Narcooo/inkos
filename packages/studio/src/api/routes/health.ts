import { Hono } from "hono";
import type { ProjectService } from "../services/project-service.js";

export function createHealthRoutes(projectService: ProjectService): Hono {
  const app = new Hono();

  app.get("/health", async (c) => c.json(await projectService.getHealthStatus()));

  return app;
}
