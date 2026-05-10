import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import {
  StateManager,
  createLLMClient,
  createLogger,
  loadProjectConfig,
  loadProjectSession,
  resolveSessionActiveBook,
  type PipelineConfig,
  type ProjectConfig,
  type LogSink,
  type LogEntry,
} from "@actalk/inkos-core";
import { isSafeBookId } from "./safety.js";
import { ApiError } from "./errors.js";
import { createStudioEventBus } from "./events.js";
import { registerStudioStaticRoutes } from "./static.js";
import { registerAnalyticsRoutes } from "./routes/analytics.js";
import { registerAgentRoutes } from "./routes/agent.js";
import { registerBookOpsRoutes } from "./routes/book-ops.js";
import { registerBookRoutes } from "./routes/books.js";
import { registerDaemonRoutes } from "./routes/daemon.js";
import { registerDetectionRoutes } from "./routes/detection.js";
import { registerDoctorRoutes } from "./routes/doctor.js";
import { registerExportRoutes } from "./routes/export.js";
import { registerFanficRoutes } from "./routes/fanfic.js";
import { registerGenreRoutes } from "./routes/genres.js";
import { registerLogsRoutes } from "./routes/logs.js";
import { registerProjectSettingsRoutes } from "./routes/project-settings.js";
import { registerRadarRoutes } from "./routes/radar.js";
import { registerServiceRoutes } from "./routes/services.js";
import { registerStyleImportRoutes } from "./routes/style-import.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerTruthRoutes } from "./routes/truth.js";
import { probeServiceCapabilities } from "./services/service-config.js";

function normalizeApiBookId(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_BOOK_ID", `${fieldName} must be a string`);
  }
  const bookId = value.trim();
  if (!bookId) {
    throw new ApiError(400, "INVALID_BOOK_ID", `${fieldName} cannot be blank`);
  }
  if (!isSafeBookId(bookId)) {
    throw new ApiError(400, "INVALID_BOOK_ID", `Invalid ${fieldName}: "${bookId}"`);
  }
  return bookId;
}

const bookCreateStatus = new Map<string, { status: "creating" | "error"; error?: string }>();

// --- Server factory ---

export function createStudioServer(initialConfig: ProjectConfig, root: string) {
  const app = new Hono();
  const state = new StateManager(root);
  const eventBus = createStudioEventBus();
  const { broadcast } = eventBus;
  let cachedConfig = initialConfig;

  app.use("/*", cors());

  // Structured error handler — ApiError returns typed JSON, others return 500
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status as 400);
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("LLM API key not set") || message.includes("INKOS_LLM_API_KEY not set")) {
      return c.json({ error: { code: "LLM_CONFIG_ERROR", message } }, 400);
    }
    console.error("[studio] Unexpected server error", error);
    return c.json(
      { error: { code: "INTERNAL_ERROR", message: "Unexpected server error." } },
      500,
    );
  });

  // BookId validation middleware — blocks path traversal on all book routes
  app.use("/api/v1/books/:id/*", async (c, next) => {
    const bookId = c.req.param("id");
    if (!isSafeBookId(bookId)) {
      throw new ApiError(400, "INVALID_BOOK_ID", `Invalid book ID: "${bookId}"`);
    }
    await next();
  });
  app.use("/api/v1/books/:id", async (c, next) => {
    const bookId = c.req.param("id");
    if (!isSafeBookId(bookId)) {
      throw new ApiError(400, "INVALID_BOOK_ID", `Invalid book ID: "${bookId}"`);
    }
    await next();
  });

  // Logger sink that broadcasts to SSE
  const sseSink: LogSink = {
    write(entry: LogEntry): void {
      broadcast("log", { level: entry.level, tag: entry.tag, message: entry.message });
    },
  };

  // Logger sink that prints to server terminal
  const consoleSink: LogSink = {
    write(entry: LogEntry): void {
      const prefix = `[${entry.tag}]`;
      if (entry.level === "warn") console.warn(prefix, entry.message);
      else if (entry.level === "error") console.error(prefix, entry.message);
      else console.log(prefix, entry.message);
    },
  };

  async function loadCurrentProjectConfig(
    options?: { readonly requireApiKey?: boolean },
  ): Promise<ProjectConfig> {
    const freshConfig = await loadProjectConfig(root, { ...options, consumer: "studio" });
    cachedConfig = freshConfig;
    return freshConfig;
  }

  async function buildPipelineConfig(
    overrides?: Partial<Pick<PipelineConfig, "externalContext" | "client" | "model">> & {
      readonly currentConfig?: ProjectConfig;
      readonly sessionIdForSSE?: string;
    },
  ): Promise<PipelineConfig> {
    const currentConfig = overrides?.currentConfig ?? await loadCurrentProjectConfig();
    const scopedSseSink: LogSink = overrides?.sessionIdForSSE
      ? {
          write(entry) {
            broadcast("log", {
              sessionId: overrides.sessionIdForSSE,
              level: entry.level,
              tag: entry.tag,
              message: entry.message,
            });
          },
        }
      : sseSink;
    const logger = createLogger({ tag: "studio", sinks: [scopedSseSink, consoleSink] });
    return {
      client: overrides?.client ?? createLLMClient(currentConfig.llm),
      model: overrides?.model ?? currentConfig.llm.model,
      projectRoot: root,
      defaultLLMConfig: currentConfig.llm,
      foundationReviewRetries: currentConfig.foundation?.reviewRetries ?? 2,
      modelOverrides: currentConfig.modelOverrides,
      notifyChannels: currentConfig.notify,
      logger,
      onStreamProgress: (progress) => {
        broadcast("llm:progress", {
          ...(overrides?.sessionIdForSSE ? { sessionId: overrides.sessionIdForSSE } : {}),
          status: progress.status,
          elapsedMs: progress.elapsedMs,
          totalChars: progress.totalChars,
          chineseChars: progress.chineseChars,
        });
      },
      externalContext: overrides?.externalContext,
    };
  }

  // --- Books ---

  registerBookRoutes(app, {
    root,
    state,
    bookCreateStatus,
    broadcast,
    buildPipelineConfig,
  });

  registerGenreRoutes(app, { root });

  // --- Truth files ---

  registerTruthRoutes(app, { state });

  registerAnalyticsRoutes(app, { state });
  eventBus.registerRoutes(app);

  // --- Model services ---

  registerServiceRoutes(app, {
    root,
  });

  registerProjectSettingsRoutes(app, { root, loadCurrentProjectConfig });

  // --- Daemon control ---

  registerDaemonRoutes(app, {
    loadCurrentProjectConfig,
    buildPipelineConfig,
    broadcast,
  });

  // --- Logs ---

  registerLogsRoutes(app, { root });

  // --- Sessions ---

  registerSessionRoutes(app, {
    root,
    loadProjectSession: () => loadProjectSession(root),
    resolveSessionActiveBook: (session) => resolveSessionActiveBook(root, session as any),
    normalizeApiBookId,
  });

  registerAgentRoutes(app, {
    root,
    state,
    bookCreateStatus,
    loadCurrentProjectConfig,
    buildPipelineConfig,
    normalizeApiBookId,
    broadcast,
  });

  registerExportRoutes(app, { root, state, buildPipelineConfig });
  registerDetectionRoutes(app, { state });
  registerBookOpsRoutes(app, {
    root,
    state,
    loadCurrentProjectConfig,
    buildPipelineConfig,
    broadcast,
  });

  registerStyleImportRoutes(app, { buildPipelineConfig, broadcast });
  registerFanficRoutes(app, { state, buildPipelineConfig, broadcast });
  registerRadarRoutes(app, { buildPipelineConfig, broadcast });

  // --- Doctor (environment health check) ---

  registerDoctorRoutes(app, {
    root,
    state,
    loadCurrentProjectConfig,
    probeServiceCapabilities,
  });

  return app;
}

// --- Standalone runner ---

export async function startStudioServer(
  root: string,
  port = 4567,
  options?: { readonly staticDir?: string },
): Promise<void> {
  const config = await loadProjectConfig(root, { consumer: "studio", requireApiKey: false });

  const app = createStudioServer(config, root);

  if (options?.staticDir) {
    await registerStudioStaticRoutes(app, options.staticDir);
  }

  console.log(`InkOS Studio running on http://localhost:${port}`);
  serve({ fetch: app.fetch, port });
}
