import type { Hono } from "hono";
import { PipelineRunner, type PipelineConfig } from "@actalk/inkos-core";

interface RegisterRadarRoutesOptions {
  readonly buildPipelineConfig: () => Promise<PipelineConfig>;
  readonly broadcast: (event: string, data: unknown) => void;
}

export function registerRadarRoutes(app: Hono, options: RegisterRadarRoutesOptions): void {
  app.post("/api/v1/radar/scan", async (c) => {
    options.broadcast("radar:start", {});
    try {
      const pipeline = new PipelineRunner(await options.buildPipelineConfig());
      const result = await pipeline.runRadar();
      options.broadcast("radar:complete", { result });
      return c.json(result);
    } catch (e) {
      options.broadcast("radar:error", { error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });
}
