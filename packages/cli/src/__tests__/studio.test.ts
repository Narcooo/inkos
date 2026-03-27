import { beforeEach, describe, expect, it, vi } from "vitest";

const accessMock = vi.fn();
const spawnMock = vi.fn(() => ({
  on: vi.fn(),
}));
const logMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("node:fs/promises", () => ({
  access: accessMock,
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
    accessMock.mockImplementation(async (path: string) => {
      if (path === "/project/packages/studio/src/api/index.ts" || path === "/project/packages/studio/dist/web/index.html") {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { studioCommand } = await import("../commands/studio.js");
    await studioCommand.parseAsync(["node", "studio", "--port", "9001"]);

    expect(spawnMock).toHaveBeenCalledWith(
      "npx",
      ["tsx", "/project/packages/studio/src/api/index.ts"],
      expect.objectContaining({
        cwd: "/project",
        stdio: "inherit",
        env: expect.objectContaining({ INKOS_STUDIO_PORT: "9001" }),
      }),
    );
  });

  it("launches built JavaScript entries through node", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (path === "/project/packages/studio/dist/api/index.js" || path === "/project/packages/studio/dist/web/index.html") {
        return;
      }
      if (path === "/project/node_modules/@actalk/inkos-studio/dist/api/index.js") {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { studioCommand } = await import("../commands/studio.js");
    await studioCommand.parseAsync(["node", "studio", "--port", "4567"]);

    expect(spawnMock).toHaveBeenCalledWith(
      "node",
      ["/project/packages/studio/dist/api/index.js"],
      expect.objectContaining({
        cwd: "/project",
        stdio: "inherit",
        env: expect.objectContaining({ INKOS_STUDIO_PORT: "4567" }),
      }),
    );
  });

  it("reports a clear setup error when no Studio entrypoint exists", async () => {
    accessMock.mockRejectedValue(new Error("missing"));

    const exitMock = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    const { studioCommand } = await import("../commands/studio.js");
    await studioCommand.parseAsync(["node", "studio"]);

    expect(logErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("InkOS Studio launcher could not find a runnable Studio server with built web assets."),
    );
    expect(logErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("Monorepo: build Studio so both packages/studio/src/api/index.ts and packages/studio/dist/web/index.html are available."),
    );
    expect(logErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("Package layout: if you wire in @actalk/inkos-studio manually, make sure dist/api/index.js and dist/web/index.html are both present."),
    );
    expect(exitMock).toHaveBeenCalledWith(1);

    exitMock.mockRestore();
  });

  it("falls back to the packaged node_modules path when monorepo targets are missing", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (
        path === "/project/node_modules/@actalk/inkos-studio/dist/api/index.js"
        || path === "/project/node_modules/@actalk/inkos-studio/dist/web/index.html"
      ) {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { studioCommand } = await import("../commands/studio.js");
    await studioCommand.parseAsync(["node", "studio", "--port", "4567"]);

    expect(spawnMock).toHaveBeenCalledWith(
      "node",
      ["/project/node_modules/@actalk/inkos-studio/dist/api/index.js"],
      expect.objectContaining({
        cwd: "/project",
        stdio: "inherit",
        env: expect.objectContaining({ INKOS_STUDIO_PORT: "4567" }),
      }),
    );
  });
});
