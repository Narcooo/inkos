import { Command } from "commander";
import { findProjectRoot, log, logError } from "../utils.js";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { access } from "node:fs/promises";

export const studioCommand = new Command("studio")
  .description("Start InkOS Studio web workbench")
  .option("-p, --port <port>", "Server port", "4567")
  .action(async (opts) => {
    const root = findProjectRoot();
    const port = opts.port;

    const studioCandidates = [
      { entry: join(root, "packages", "studio", "server.cjs"), repoRoot: root },
      { entry: join(root, "..", "packages", "studio", "server.cjs"), repoRoot: join(root, "..") },
      { entry: join(root, "node_modules", "@actalk", "inkos-studio", "server.cjs"), repoRoot: undefined },
    ];

    let studioEntry: string | undefined;
    let repoRoot: string | undefined;

    for (const candidate of studioCandidates) {
      try {
        await access(candidate.entry);
        studioEntry = candidate.entry;
        repoRoot = candidate.repoRoot;
        break;
      } catch {
        // continue
      }
    }

    if (!studioEntry) {
      logError(
        "InkOS Studio not found. If you cloned the repo, run:\n" +
        "  cd packages/studio && pnpm install && pnpm build\n" +
        "Then run 'inkos studio' from the project root.",
      );
      process.exit(1);
    }

    log(`Starting InkOS Studio on http://localhost:${port}`);

    const child = spawn("node", [studioEntry], {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        PORT: port,
        INKOS_STUDIO_PORT: port,
        INKOS_PROJECT_ROOT: root,
        ...(repoRoot ? { INKOS_REPO_ROOT: repoRoot } : {}),
      },
    });

    child.on("error", (e) => {
      logError(`Failed to start studio: ${e.message}`);
      process.exit(1);
    });

    child.on("exit", (code) => {
      process.exit(code ?? 0);
    });
  });
