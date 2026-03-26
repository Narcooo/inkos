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
  findProjectRoot: vi.fn(() => "/repo/project"),
  log: logMock,
  logError: logErrorMock,
}));

describe("studio command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("launches the monorepo studio server through node", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (path.replaceAll("\\", "/") === "/repo/packages/studio/server.cjs") {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { studioCommand } = await import("../commands/studio.js");
    await studioCommand.parseAsync(["node", "studio", "--port", "9001"]);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const call = spawnMock.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("spawn was not called");
    const [command, args, options] = call as unknown as [string, string[], { cwd: string; stdio: string; env: Record<string, string> }];
    expect(command).toBe("node");
    expect(args).toHaveLength(1);
    expect(args[0]!.replaceAll("\\", "/")).toBe("/repo/packages/studio/server.cjs");
    expect(options.cwd).toBe("/repo/project");
    expect(options.stdio).toBe("inherit");
    expect(options.env.PORT).toBe("9001");
    expect(options.env.INKOS_STUDIO_PORT).toBe("9001");
    expect(options.env.INKOS_PROJECT_ROOT).toBe("/repo/project");
    expect(options.env.INKOS_REPO_ROOT.replaceAll("\\", "/")).toBe("/repo");
  });

  it("launches the installed studio server package through node", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (path.replaceAll("\\", "/") === "/repo/project/node_modules/@actalk/inkos-studio/server.cjs") {
        return;
      }
      throw new Error(`missing: ${path}`);
    });

    const { studioCommand } = await import("../commands/studio.js");
    await studioCommand.parseAsync(["node", "studio", "--port", "4567"]);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const call = spawnMock.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("spawn was not called");
    const [command, args, options] = call as unknown as [string, string[], { cwd: string; stdio: string; env: Record<string, string> }];
    expect(command).toBe("node");
    expect(args).toHaveLength(1);
    expect(args[0]!.replaceAll("\\", "/")).toBe("/repo/project/node_modules/@actalk/inkos-studio/server.cjs");
    expect(options.cwd).toBe("/repo/project");
    expect(options.stdio).toBe("inherit");
    expect(options.env.PORT).toBe("4567");
    expect(options.env.INKOS_STUDIO_PORT).toBe("4567");
    expect(options.env.INKOS_PROJECT_ROOT).toBe("/repo/project");
  });
});
