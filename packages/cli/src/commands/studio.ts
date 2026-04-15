import { Command } from "commander";
import { findProjectRoot, log, logError } from "../utils.js";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { access } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface StudioLaunchSpec {
  readonly studioEntry: string;
  readonly command: string;
  readonly args: string[];
}

export interface BrowserLaunchSpec {
  readonly command: string;
  readonly args: string[];
}

export interface StudioCommandHooks {
  readonly launchStudio?: (projectRoot: string, port: string) => Promise<void> | void;
}

async function firstAccessiblePath(paths: readonly string[]): Promise<string | undefined> {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // continue
    }
  }
  return undefined;
}

const cliPackageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function toNodeImportSpecifier(modulePath: string): string {
  return pathToFileURL(modulePath).href;
}

export function resolveBrowserLaunch(
  platform: NodeJS.Platform,
  url: string,
): BrowserLaunchSpec {
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }
  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] };
  }
  return { command: "xdg-open", args: [url] };
}

export async function resolveStudioLaunch(root: string): Promise<StudioLaunchSpec | null> {
  const sourceEntry = await firstAccessiblePath([
    join(root, "packages", "studio", "src", "api", "index.ts"),
    join(root, "..", "packages", "studio", "src", "api", "index.ts"),
    join(root, "..", "studio", "src", "api", "index.ts"),
  ]);
  if (sourceEntry) {
    const studioPackageRoot = dirname(dirname(dirname(sourceEntry)));
    const localTsxLoader = await firstAccessiblePath([
      join(studioPackageRoot, "node_modules", "tsx", "dist", "loader.mjs"),
    ]);
    if (localTsxLoader) {
      return {
        studioEntry: sourceEntry,
        command: "node",
        args: ["--import", toNodeImportSpecifier(localTsxLoader), sourceEntry, root],
      };
    }

    const localTsx = await firstAccessiblePath([
      join(studioPackageRoot, "node_modules", ".bin", "tsx"),
    ]);
    if (localTsx) {
      return {
        studioEntry: sourceEntry,
        command: localTsx,
        args: [sourceEntry, root],
      };
    }
    return {
      studioEntry: sourceEntry,
      command: "npx",
      args: ["tsx", sourceEntry, root],
    };
  }

  const builtEntry = await firstAccessiblePath([
    join(root, "node_modules", "@actalk", "inkos-studio", "dist", "api", "index.js"),
    join(root, "node_modules", "@actalk", "inkos-studio", "server.cjs"),
    join(cliPackageRoot, "node_modules", "@actalk", "inkos-studio", "dist", "api", "index.js"),
    join(cliPackageRoot, "node_modules", "@actalk", "inkos-studio", "server.cjs"),
    join(cliPackageRoot, "..", "inkos-studio", "dist", "api", "index.js"),
    join(cliPackageRoot, "..", "inkos-studio", "server.cjs"),
  ]);
  if (builtEntry) {
    return {
      studioEntry: builtEntry,
      command: "node",
      args: [builtEntry, root],
    };
  }

  return null;
}

export async function launchStudioWorkbench(root: string, port: string): Promise<void> {
  const url = `http://localhost:${port}`;
  const launch = await resolveStudioLaunch(root);

  if (!launch) {
    logError(
      "InkOS Studio not found. If you cloned the repo, run:\n" +
      "  cd packages/studio && pnpm install && pnpm build\n" +
      "Then run 'inkos studio' from the project root.",
    );
    process.exit(1);
  }

  log(`Starting InkOS Studio on ${url}`);

  const child = spawn(launch.command, launch.args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, INKOS_STUDIO_PORT: port },
  });

  child.on("error", (e) => {
    logError(`Failed to start studio: ${e.message}`);
    process.exit(1);
  });

  const browserLaunch = resolveBrowserLaunch(process.platform, url);
  const browser = spawn(browserLaunch.command, browserLaunch.args, {
    cwd: root,
    stdio: "ignore",
    detached: true,
  });
  browser.on("error", () => {
    // Best effort only — server startup should not fail just because browser open failed.
  });
  if (typeof browser.unref === "function") {
    browser.unref();
  }

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

export function createStudioCommand(hooks: StudioCommandHooks = {}): Command {
  return new Command("studio")
  .description("Start InkOS Studio web workbench")
  .option("-p, --port <port>", "Server port", "4567")
  .action(async (opts) => {
    const root = findProjectRoot();
    const port = opts.port;
    if (hooks.launchStudio) {
      await hooks.launchStudio(root, port);
      return;
    }
    await launchStudioWorkbench(root, port);
  });
}

export const studioCommand = createStudioCommand();
