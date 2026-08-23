import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const writeNextChapterMock = vi.fn();
const buildPipelineConfigMock = vi.fn();
const loadConfigMock = vi.fn();
const loadBookConfigMock = vi.fn();
const getNextChapterNumberMock = vi.fn();
const runBoundedAutonomousScopeMock = vi.fn();
const loadBookProductionMapMock = vi.fn();
const createAutonomousPipelineActionsMock = vi.fn();
const createAutonomousProviderExecutionMock = vi.fn();
const resolveProductionScopeMock = vi.fn();
const saveAutonomousProductionStateMock = vi.fn();
const claimAutonomousJobMock = vi.fn();
const releaseAutonomousJobMock = vi.fn();
const loadAutonomousProductionStateMock = vi.fn();
const refreshAutonomousJobClaimMock = vi.fn();
const logMock = vi.fn();
const logErrorMock = vi.fn();
const pipelineRunnerConfigs: unknown[] = [];

vi.mock("@actalk/inkos-core", () => ({
  PipelineRunner: class {
    constructor(config: unknown) {
      pipelineRunnerConfigs.push(config);
    }
    writeNextChapter = writeNextChapterMock;
  },
  StateManager: class {
    async loadBookConfig() {
      return loadBookConfigMock();
    }
    async getNextChapterNumber() {
      return getNextChapterNumberMock();
    }
  },
  claimAutonomousJob: claimAutonomousJobMock,
  releaseAutonomousJob: releaseAutonomousJobMock,
  deriveAutonomousJobIdentity: vi.fn(() => "autonomous-test"),
  loadAutonomousProductionState: loadAutonomousProductionStateMock,
  refreshAutonomousJobClaim: refreshAutonomousJobClaimMock,
  startAutonomousJobHeartbeat: vi.fn(() => () => undefined),
  loadBookProductionMap: loadBookProductionMapMock,
  createAutonomousPipelineActions: createAutonomousPipelineActionsMock,
  createAutonomousProviderExecution: createAutonomousProviderExecutionMock,
  resolveProductionScope: resolveProductionScopeMock,
  runBoundedAutonomousScope: runBoundedAutonomousScopeMock,
  saveAutonomousProductionState: saveAutonomousProductionStateMock,
}));

vi.mock("../utils.js", () => ({
  loadConfig: loadConfigMock,
  buildPipelineConfig: buildPipelineConfigMock,
  findProjectRoot: vi.fn(() => "/project"),
  resolveBookId: vi.fn(async (bookId?: string) => bookId ?? "auto-book"),
  getLegacyMigrationHint: vi.fn(async () => null),
  log: logMock,
  logError: logErrorMock,
}));

vi.mock("../localization.js", () => ({
  formatWriteNextProgress: vi.fn(() => "progress"),
  formatWriteNextResultLines: vi.fn(() => ["ok"]),
  formatWriteNextComplete: vi.fn(() => "done"),
  formatAutoWriteStart: vi.fn(() => "auto-start"),
  formatAutoWriteAlreadyComplete: vi.fn(() => "nothing-to-do"),
  resolveCliLanguage: vi.fn(() => "zh"),
}));

function chapterResult(chapterNumber: number, status = "ready-for-review") {
  return {
    chapterNumber,
    title: `第${chapterNumber}章`,
    wordCount: 3000,
    auditResult: { passed: true, issues: [], summary: "ok" },
    revised: false,
    status,
  };
}

const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

describe("inkos auto command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadBookConfigMock.mockResolvedValue({
      language: "zh",
      writing: { reviewMode: "manual" },
    });
    loadConfigMock.mockResolvedValue({
      llm: {},
      writing: { reviewRetries: 1, reviewMode: "manual" },
    });
    buildPipelineConfigMock.mockReturnValue({});
    loadBookProductionMapMock.mockResolvedValue({
      schemaVersion: "1.0", bookId: "demo-book", authorityBookId: "authority", title: "Demo",
      totalChapters: 5,
      volumes: [{ volumeId: "volume-001", volumeNumber: 1, title: "One", startChapter: 1, endChapter: 5, chapterCount: 5 }],
    });
    runBoundedAutonomousScopeMock.mockResolvedValue({ status: "VOLUME_COMPLETE", nextChapter: 6 });
    resolveProductionScopeMock.mockReturnValue({ complete: false, startChapter: 3, targetChapter: 5, currentVolume: { volumeId: "volume-001" } });
    createAutonomousPipelineActionsMock.mockResolvedValue({ runChapter: writeNextChapterMock });
    createAutonomousProviderExecutionMock.mockReturnValue({
      execute: async (_chapter: number, task: () => Promise<unknown>) => task(),
      loadPersistedProgress: loadAutonomousProductionStateMock,
      now: () => 0,
      sleep: async () => undefined,
    });
    claimAutonomousJobMock.mockResolvedValue({ jobId: "autonomous-test", claimId: "claim", ownerPid: 1 });
    releaseAutonomousJobMock.mockResolvedValue(undefined);
    loadAutonomousProductionStateMock.mockResolvedValue(null);
    refreshAutonomousJobClaimMock.mockResolvedValue(undefined);
    pipelineRunnerConfigs.length = 0;
  });

  afterAll(() => {
    exitSpy.mockRestore();
  });

  it("writes from the current chapter up to the target chapter with forced auto review", async () => {
    getNextChapterNumberMock.mockResolvedValue(3);
    let chapter = 2;
    writeNextChapterMock.mockImplementation(async () => chapterResult(++chapter));

    const { autoCommand } = await import("../commands/auto.js");
    await autoCommand.parseAsync(["node", "auto", "demo-book", "5"], { from: "node" });

    expect(runBoundedAutonomousScopeMock).toHaveBeenCalledTimes(1);
    // reviewMode is "manual" on both book and project, but auto-write must
    // force the inline audit→revise loop.
    expect(buildPipelineConfigMock).toHaveBeenCalledWith(
      expect.anything(),
      "/project",
      expect.objectContaining({ chapterReviewMode: "auto" }),
    );
    expect(pipelineRunnerConfigs).toContainEqual(expect.objectContaining({ boundedAutonomousReview: true }));
    expect(createAutonomousProviderExecutionMock).toHaveBeenCalledWith(expect.objectContaining({
      projectRoot: "/project",
      bookId: "demo-book",
      jobId: "autonomous-test",
      getActiveStage: expect.any(Function),
    }));
    expect(runBoundedAutonomousScopeMock).toHaveBeenCalledWith(expect.objectContaining({
      providerRecovery: expect.objectContaining({ execute: expect.any(Function) }),
    }));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("refuses a persisted exhausted job without acquiring a claim or running a chapter", async () => {
    getNextChapterNumberMock.mockResolvedValue(3);
    loadAutonomousProductionStateMock.mockResolvedValue({ jobId: "autonomous-test", status: "REVIEW_EXHAUSTED" });

    const { autoCommand } = await import("../commands/auto.js");
    await autoCommand.parseAsync(["node", "auto", "demo-book", "5"], { from: "node" });

    expect(claimAutonomousJobMock).not.toHaveBeenCalled();
    expect(runBoundedAutonomousScopeMock).not.toHaveBeenCalled();
    expect(writeNextChapterMock).not.toHaveBeenCalled();
    expect(logErrorMock).toHaveBeenCalledWith(expect.stringContaining("REVISION_LIMIT_REACHED"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("does nothing when the book already reached the target chapter", async () => {
    getNextChapterNumberMock.mockResolvedValue(6);

    const { autoCommand } = await import("../commands/auto.js");
    await autoCommand.parseAsync(["node", "auto", "demo-book", "5"], { from: "node" });

    expect(runBoundedAutonomousScopeMock).not.toHaveBeenCalled();
    expect(buildPipelineConfigMock).not.toHaveBeenCalled();
    expect(logMock).toHaveBeenCalledWith("nothing-to-do");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("stops immediately when a chapter write fails", async () => {
    getNextChapterNumberMock.mockResolvedValue(1);
    resolveProductionScopeMock.mockReturnValue({ complete: false, startChapter: 1, targetChapter: 3, currentVolume: { volumeId: "volume-001" } });
    runBoundedAutonomousScopeMock.mockImplementationOnce(async (params) => {
      await params.runChapter();
      await params.runChapter();
    });
    writeNextChapterMock
      .mockResolvedValueOnce(chapterResult(1))
      .mockRejectedValueOnce(new Error("LLM exploded"));

    const { autoCommand } = await import("../commands/auto.js");
    await autoCommand.parseAsync(["node", "auto", "demo-book", "3"], { from: "node" });

    expect(writeNextChapterMock).toHaveBeenCalledTimes(2);
    expect(logErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("LLM exploded"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("stops when a chapter ends in state-degraded status", async () => {
    getNextChapterNumberMock.mockResolvedValue(1);
    resolveProductionScopeMock.mockReturnValue({ complete: false, startChapter: 1, targetChapter: 3, currentVolume: { volumeId: "volume-001" } });
    runBoundedAutonomousScopeMock.mockImplementationOnce(async (params) => {
      await params.runChapter();
      const result = await params.runChapter();
      if (result.status === "state-degraded") throw new Error("state-degraded");
    });
    writeNextChapterMock
      .mockResolvedValueOnce(chapterResult(1))
      .mockResolvedValueOnce(chapterResult(2, "state-degraded"));

    const { autoCommand } = await import("../commands/auto.js");
    await autoCommand.parseAsync(["node", "auto", "demo-book", "3"], { from: "node" });

    expect(writeNextChapterMock).toHaveBeenCalledTimes(2);
    expect(logErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("state-degraded"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
