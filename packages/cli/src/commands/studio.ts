import { Command } from "commander";
import { findProjectRoot, log, logError } from "../utils.js";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { access } from "node:fs/promises";

async function resolveStudioEntry(root: string): Promise<string | undefined> {
  const candidates = [
    {
      entry: join(root, "packages", "studio", "src", "api", "index.ts"),
      web: join(root, "packages", "studio", "dist", "web", "index.html"),
    },
    {
      entry: join(root, "packages", "studio", "dist", "api", "index.js"),
      web: join(root, "packages", "studio", "dist", "web", "index.html"),
    },
    {
      entry: join(root, "node_modules", "@actalk", "inkos-studio", "dist", "api", "index.js"),
      web: join(root, "node_modules", "@actalk", "inkos-studio", "dist", "web", "index.html"),
    },
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate.entry);
      await access(candidate.web);
      return candidate.entry;
    } catch {
      // continue
    }
  }

  return undefined;
}

export const studioCommand = new Command("studio")
  .description("Start InkOS Studio web workbench")
  .option("-p, --port <port>", "Server port", "4567")
  .action(async (opts) => {
    const root = findProjectRoot();
    const port = opts.port;
    const studioEntry = await resolveStudioEntry(root);

    if (!studioEntry) {
      logError(
        "InkOS Studio launcher could not find a runnable Studio server with built web assets.\n" +
        "Monorepo: build Studio so both packages/studio/src/api/index.ts and packages/studio/dist/web/index.html are available.\n" +
        "  pnpm --filter @actalk/inkos-studio build\n" +
        "Package layout: if you wire in @actalk/inkos-studio manually, make sure dist/api/index.js and dist/web/index.html are both present.",
      );
      return process.exit(1);
    }

    log(`Starting InkOS Studio on http://localhost:${port}`);

    const launch = studioEntry.endsWith(".ts")
      ? { command: "npx", args: ["tsx", studioEntry] }
      : { command: "node", args: [studioEntry] };

    const child = spawn(launch.command, launch.args, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, INKOS_STUDIO_PORT: port },
    });

    child.on("error", (e) => {
      logError(`Failed to start studio: ${e.message}`);
      process.exit(1);
    });

    child.on("exit", (code) => {
      process.exit(code ?? 0);
    });
  });
