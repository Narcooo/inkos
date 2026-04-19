import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";

const readFileMock = vi.fn();
const writeFileMock = vi.fn();
const unlinkMock = vi.fn();
const endMock = vi.fn();
const createWriteStreamMock = vi.fn(() => ({ end: endMock }));
const schedulerStartMock = vi.fn();
const schedulerStopMock = vi.fn();
const logMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
  unlink: unlinkMock,
}));

vi.mock("node:fs", () => ({
  createWriteStream: createWriteStreamMock,
}));

vi.mock("@actalk/inkos-core", () => ({
  Scheduler: class {
    start = schedulerStartMock;
    stop = schedulerStopMock;
  },
}));

vi.mock("../utils.js", () => ({
  loadConfig: vi.fn(async () => ({
    daemon: {
      schedule: {
        radarCron: "0 */6 * * *",
        writeCron: "*/15 * * * *",
      },
      maxConcurrentBooks: 1,
      chaptersPerCycle: 1,
      retryDelayMs: 0,
      cooldownAfterChapterMs: 0,
      maxChaptersPerDay: 10,
    },
  })),
  findProjectRoot: vi.fn(() => "/project"),
  buildPipelineConfig: vi.fn(() => ({
    client: {
      provider: "openai",
      apiFormat: "chat",
      stream: false,
      defaults: {
        temperature: 0.7,
        maxTokens: 1024,
        thinkingBudget: 0,
      },
    },
    model: "test-model",
    projectRoot: "/project",
  })),
  log: logMock,
  logError: logErrorMock,
}));

describe("daemon command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("removes the pid file when startup fails after writing it", async () => {
    readFileMock.mockRejectedValueOnce(new Error("missing pid"));
    writeFileMock.mockResolvedValue(undefined);
    unlinkMock.mockResolvedValue(undefined);
    schedulerStartMock.mockRejectedValueOnce(new Error("scheduler boot failed"));

    const exitError = new Error("process.exit");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw Object.assign(exitError, { code });
    }) as never);

    const { upCommand } = await import("../commands/daemon.js");

    await expect(
      upCommand.parseAsync(["node", "up", "--quiet"]),
    ).rejects.toMatchObject({ code: 1 });

    const pidPath = join("/project", "inkos.pid");
    expect(writeFileMock).toHaveBeenCalledWith(pidPath, expect.any(String), "utf-8");
    expect(unlinkMock).toHaveBeenCalledWith(pidPath);

    exitSpy.mockRestore();
  });
});
