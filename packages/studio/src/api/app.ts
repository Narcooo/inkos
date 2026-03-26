import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createBookRoutes } from "./routes/books.js";
import { createChapterRoutes } from "./routes/chapters.js";
import { createHealthRoutes } from "./routes/health.js";
import { createReviewRoutes } from "./routes/review.js";
import { createRunRoutes } from "./routes/runs.js";
import { createTruthFileRoutes } from "./routes/truth-files.js";
import { ChapterService } from "./services/chapter-service.js";
import { ApiError } from "./errors.js";
import { ProjectService } from "./services/project-service.js";
import { RunStore } from "./lib/run-store.js";
import { RunService, type RunExecutor } from "./services/run-service.js";
import { TruthFileService } from "./services/truth-file-service.js";

export interface CreateAppOptions {
  readonly projectRoot: string;
  readonly staticRoot?: string;
  readonly runExecutor?: RunExecutor;
}

export function createApp(options: CreateAppOptions): Hono {
  const app = new Hono();
  const projectService = new ProjectService(options.projectRoot);
  const chapterService = new ChapterService(options.projectRoot);
  const truthFileService = new TruthFileService(options.projectRoot);
  const runStore = new RunStore();
  const runService = new RunService(options.projectRoot, runStore, options.runExecutor);

  app.route("/api", createHealthRoutes(projectService));
  app.route("/api", createBookRoutes(projectService));
  app.route("/api", createChapterRoutes(chapterService));
  app.route("/api", createReviewRoutes(chapterService));
  app.route("/api", createRunRoutes(chapterService, runService));
  app.route("/api", createTruthFileRoutes(truthFileService));

  if (options.staticRoot) {
    app.use("/assets/*", serveStatic({ root: options.staticRoot }));
    app.get("/", serveStatic({ root: options.staticRoot, path: "index.html" }));
  }

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return new Response(JSON.stringify({ error: { code: error.code, message: error.message } }), {
        status: error.status,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Unexpected server error." } }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  });

  app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "Route not found." } }, 404));

  return app;
}
