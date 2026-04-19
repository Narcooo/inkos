import { beforeEach, describe, expect, it, vi } from "vitest";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const accessMock = vi.fn();
const testDir = dirname(fileURLToPath(import.meta.url));
const cliPackageRoot = resolve(testDir, "..", "..");

vi.mock("node:fs/promises", () => ({
  access: accessMock,
}));

describe("studio runtime resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  const tsSourceEntry = join("/repo", "packages", "studio", "src", "api", "index.ts");
  const tsxLoader = join("/repo", "packages", "studio", "node_modules", "tsx", "dist", "loader.mjs");
  const projectBuiltEntry = join(
    "/repo",
    "test-project",
    "node_modules",
    "@actalk",
    "inkos-studio",
    "dist",
    "api",
    "index.js",
  );
  const cliBuiltEntry = join(
    cliPackageRoot,
    "node_modules",
    "@actalk",
    "inkos-studio",
    "dist",
    "api",
    "index.js",
  );

  it("prefers the repository-local tsx loader for monorepo sources", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (path === tsSourceEntry || path === tsxLoader) {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { resolveStudioLaunch } = await import("../commands/studio.js");
    const launch = await resolveStudioLaunch("/repo/test-project");

    expect(launch).toEqual({
      studioEntry: tsSourceEntry,
      command: "node",
      args: ["--import", tsxLoader, tsSourceEntry, "/repo/test-project"],
    });
  });

  it("uses a file URL for the tsx loader on Windows absolute paths", async () => {
    const { toNodeImportSpecifier } = await import("../commands/studio.js");
    expect(toNodeImportSpecifier("D:\\repo\\packages\\studio\\node_modules\\tsx\\dist\\loader.mjs"))
      .toBe("file:///D:/repo/packages/studio/node_modules/tsx/dist/loader.mjs");
  });

  it("finds monorepo packages/studio sources from a project directory", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (path === tsSourceEntry) {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { resolveStudioLaunch } = await import("../commands/studio.js");
    const launch = await resolveStudioLaunch("/repo/test-project");

    expect(launch).toEqual({
      studioEntry: tsSourceEntry,
      command: "npx",
      args: ["tsx", tsSourceEntry, "/repo/test-project"],
    });
  });

  it("uses node for built JavaScript entries", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (path === projectBuiltEntry) {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { resolveStudioLaunch } = await import("../commands/studio.js");
    const launch = await resolveStudioLaunch("/repo/test-project");

    expect(launch).toEqual({
      studioEntry: projectBuiltEntry,
      command: "node",
      args: [projectBuiltEntry, "/repo/test-project"],
    });
  });

  it("falls back to the CLI installation's bundled studio runtime", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (path === cliBuiltEntry) {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { resolveStudioLaunch } = await import("../commands/studio.js");
    const launch = await resolveStudioLaunch("/repo/test-project");

    expect(launch).toEqual({
      studioEntry: cliBuiltEntry,
      command: "node",
      args: [cliBuiltEntry, "/repo/test-project"],
    });
  });

  it("returns a browser launch spec for macOS", async () => {
    const { resolveBrowserLaunch } = await import("../commands/studio.js");
    expect(resolveBrowserLaunch("darwin", "http://localhost:4567")).toEqual({
      command: "open",
      args: ["http://localhost:4567"],
    });
  });

  it("returns a browser launch spec for Windows", async () => {
    const { resolveBrowserLaunch } = await import("../commands/studio.js");
    expect(resolveBrowserLaunch("win32", "http://localhost:4567")).toEqual({
      command: "cmd",
      args: ["/c", "start", "", "http://localhost:4567"],
    });
  });

  it("returns a browser launch spec for Linux", async () => {
    const { resolveBrowserLaunch } = await import("../commands/studio.js");
    expect(resolveBrowserLaunch("linux", "http://localhost:4567")).toEqual({
      command: "xdg-open",
      args: ["http://localhost:4567"],
    });
  });
});
