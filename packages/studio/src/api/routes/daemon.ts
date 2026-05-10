import type { Hono } from "hono";
import type { PipelineConfig, ProjectConfig } from "@actalk/inkos-core";

interface RegisterDaemonRoutesOptions {
  readonly loadCurrentProjectConfig: () => Promise<ProjectConfig>;
  readonly buildPipelineConfig: () => Promise<PipelineConfig>;
  readonly broadcast: (event: string, data: unknown) => void;
}

export function registerDaemonRoutes(app: Hono, options: RegisterDaemonRoutesOptions): void {
  let schedulerInstance: import("@actalk/inkos-core").Scheduler | null = null;

  app.get("/api/v1/daemon", (c) => {
    return c.json({
      running: schedulerInstance?.isRunning ?? false,
    });
  });

  app.post("/api/v1/daemon/start", async (c) => {
    if (schedulerInstance?.isRunning) {
      return c.json({ error: "Daemon already running" }, 400);
    }
    try {
      const { Scheduler } = await import("@actalk/inkos-core");
      const currentConfig = await options.loadCurrentProjectConfig();
      const scheduler = new Scheduler({
        ...(await options.buildPipelineConfig()),
        radarCron: currentConfig.daemon.schedule.radarCron,
        writeCron: currentConfig.daemon.schedule.writeCron,
        maxConcurrentBooks: currentConfig.daemon.maxConcurrentBooks,
        chaptersPerCycle: currentConfig.daemon.chaptersPerCycle,
        retryDelayMs: currentConfig.daemon.retryDelayMs,
        cooldownAfterChapterMs: currentConfig.daemon.cooldownAfterChapterMs,
        maxChaptersPerDay: currentConfig.daemon.maxChaptersPerDay,
        onChapterComplete: (bookId, chapter, status) => {
          options.broadcast("daemon:chapter", { bookId, chapter, status });
        },
        onError: (bookId, error) => {
          options.broadcast("daemon:error", { bookId, error: error.message });
        },
      });
      schedulerInstance = scheduler;
      options.broadcast("daemon:started", {});
      void scheduler.start().catch((e) => {
        const error = e instanceof Error ? e : new Error(String(e));
        if (schedulerInstance === scheduler) {
          scheduler.stop();
          schedulerInstance = null;
          options.broadcast("daemon:stopped", {});
        }
        options.broadcast("daemon:error", { bookId: "scheduler", error: error.message });
      });
      return c.json({ ok: true, running: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/daemon/stop", (c) => {
    if (!schedulerInstance?.isRunning) {
      return c.json({ error: "Daemon not running" }, 400);
    }
    schedulerInstance.stop();
    schedulerInstance = null;
    options.broadcast("daemon:stopped", {});
    return c.json({ ok: true, running: false });
  });
}
