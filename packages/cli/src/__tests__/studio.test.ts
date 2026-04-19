import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";

const accessMock = vi.fn();
const spawnMock = vi.fn(() => ({
  on: vi.fn(),
}));
const logMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("node:fs/promises", () => ({
  access: accessMock,
  mkdir: vi.fn(),
  readFile: vi.fn(async () => ""),
  writeFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("../utils.js", () => ({
  findProjectRoot: vi.fn(() => "/project"),
  log: logMock,
  logError: logErrorMock,
}));

describe("studio command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("launches TypeScript sources through tsx in monorepo mode", async () => {
    const tsEntry = join("/project", "packages", "studio", "src", "api", "index.ts");
    accessMock.mockImplementation(async (path: string) => {
      if (path === tsEntry) {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { createStudioCommand } = await import("../commands/studio.js");
    await createStudioCommand().parseAsync(["node", "studio", "--port", "9001"]);

    expect(spawnMock).toHaveBeenCalledWith(
      "npx",
      ["tsx", tsEntry, "/project"],
      expect.objectContaining({
        cwd: "/project",
        stdio: "inherit",
        env: expect.objectContaining({ INKOS_STUDIO_PORT: "9001" }),
      }),
    );
  });

  it("launches built JavaScript entries through node", async () => {
    const jsEntry = join(
      "/project",
      "node_modules",
      "@actalk",
      "inkos-studio",
      "dist",
      "api",
      "index.js",
    );
    accessMock.mockImplementation(async (path: string) => {
      if (path === jsEntry) {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { createStudioCommand } = await import("../commands/studio.js");
    await createStudioCommand().parseAsync(["node", "studio", "--port", "4567"]);

    expect(spawnMock).toHaveBeenCalledWith(
      "node",
      [jsEntry, "/project"],
      expect.objectContaining({
        cwd: "/project",
        stdio: "inherit",
        env: expect.objectContaining({ INKOS_STUDIO_PORT: "4567" }),
      }),
    );
  });
});
