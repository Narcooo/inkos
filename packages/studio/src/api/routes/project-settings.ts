import type { Hono } from "hono";
import type { ProjectConfig } from "@actalk/inkos-core";
import {
  ensureRawLlmConfig,
  readProjectConfigFile,
  updateProjectConfigFile,
} from "../project-config-file.js";

interface RegisterProjectSettingsRoutesOptions {
  readonly root: string;
  readonly loadCurrentProjectConfig: (options?: { requireApiKey?: boolean }) => Promise<ProjectConfig>;
}

export function registerProjectSettingsRoutes(
  app: Hono,
  options: RegisterProjectSettingsRoutesOptions,
): void {
  app.get("/api/v1/project", async (c) => {
    const currentConfig = await options.loadCurrentProjectConfig({ requireApiKey: false });
    const raw = await readProjectConfigFile(options.root);
    const languageExplicit = "language" in raw && raw.language !== "";

    return c.json({
      name: currentConfig.name,
      language: currentConfig.language,
      languageExplicit,
      model: currentConfig.llm.model,
      provider: currentConfig.llm.provider,
      baseUrl: currentConfig.llm.baseUrl,
      stream: currentConfig.llm.stream,
      temperature: currentConfig.llm.temperature,
    });
  });

  app.put("/api/v1/project", async (c) => {
    const updates = await c.req.json<Record<string, unknown>>();
    try {
      await updateProjectConfigFile(options.root, (existing) => {
        const llm = ensureRawLlmConfig(existing);
        if (updates.temperature !== undefined) {
          llm.temperature = updates.temperature;
        }
        if (updates.stream !== undefined) {
          llm.stream = updates.stream;
        }
        if (updates.language === "zh" || updates.language === "en") {
          existing.language = updates.language;
        }
      });
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/project/language", async (c) => {
    const { language } = await c.req.json<{ language: "zh" | "en" }>();
    try {
      await updateProjectConfigFile(options.root, (existing) => {
        existing.language = language;
      });
      return c.json({ ok: true, language });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get("/api/v1/project/model-overrides", async (c) => {
    const raw = await readProjectConfigFile(options.root);
    return c.json({ overrides: raw.modelOverrides ?? {} });
  });

  app.put("/api/v1/project/model-overrides", async (c) => {
    const { overrides } = await c.req.json<{ overrides: Record<string, unknown> }>();
    await updateProjectConfigFile(options.root, (raw) => {
      raw.modelOverrides = overrides;
    });
    return c.json({ ok: true });
  });

  app.get("/api/v1/project/notify", async (c) => {
    const raw = await readProjectConfigFile(options.root);
    return c.json({ channels: raw.notify ?? [] });
  });

  app.put("/api/v1/project/notify", async (c) => {
    const { channels } = await c.req.json<{ channels: unknown[] }>();
    await updateProjectConfigFile(options.root, (raw) => {
      raw.notify = channels;
    });
    return c.json({ ok: true });
  });
}
