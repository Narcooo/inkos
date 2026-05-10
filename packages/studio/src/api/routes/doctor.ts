import type { Hono } from "hono";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { GLOBAL_ENV_PATH, type ProjectConfig } from "@actalk/inkos-core";

interface DoctorState {
  listBooks(): Promise<ReadonlyArray<unknown>>;
}

interface ServiceProbeResult {
  readonly ok: boolean;
}

interface RegisterDoctorRoutesOptions {
  readonly root: string;
  readonly state: DoctorState;
  readonly loadCurrentProjectConfig: (options?: { readonly requireApiKey?: boolean }) => Promise<ProjectConfig>;
  readonly probeServiceCapabilities: (args: {
    root: string;
    service: string;
    apiKey: string;
    baseUrl: string;
    preferredApiFormat?: "chat" | "responses";
    preferredStream?: boolean;
    preferredModel?: string;
    proxyUrl?: string;
  }) => Promise<ServiceProbeResult>;
}

export function registerDoctorRoutes(app: Hono, options: RegisterDoctorRoutesOptions): void {
  app.get("/api/v1/doctor", async (c) => {
    const checks = {
      inkosJson: existsSync(join(options.root, "inkos.json")),
      projectEnv: existsSync(join(options.root, ".env")),
      globalEnv: existsSync(GLOBAL_ENV_PATH),
      booksDir: existsSync(join(options.root, "books")),
      llmConnected: false,
      bookCount: 0,
    };

    try {
      const books = await options.state.listBooks();
      checks.bookCount = books.length;
    } catch {
      // Health checks should stay best-effort.
    }

    try {
      const currentConfig = await options.loadCurrentProjectConfig({ requireApiKey: false });
      const service = currentConfig.llm.service ?? currentConfig.llm.provider;
      const probe = await options.probeServiceCapabilities({
        root: options.root,
        service,
        apiKey: currentConfig.llm.apiKey,
        baseUrl: currentConfig.llm.baseUrl,
        preferredApiFormat: currentConfig.llm.apiFormat,
        preferredStream: currentConfig.llm.stream,
        preferredModel: currentConfig.llm.model,
        proxyUrl: currentConfig.llm.proxyUrl,
      });
      checks.llmConnected = probe.ok;
    } catch {
      // A failed model probe should not make the whole health endpoint fail.
    }

    return c.json(checks);
  });
}
