import { beforeEach, describe, expect, it, vi } from "vitest";

const reviseDraftMock = vi.fn();
const resyncChapterArtifactsMock = vi.fn();
const buildPipelineConfigMock = vi.fn();
const loadBookConfigMock = vi.fn();
const logMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("@actalk/inkos-core", () => ({
  DEFAULT_REVISE_MODE: "spot-fix",
  PipelineRunner: class {
    reviseDraft = reviseDraftMock;
    resyncChapterArtifacts = resyncChapterArtifactsMock;
  },
  StateManager: class {
    async loadBookConfig() {
      return loadBookConfigMock();
    }
  },
}));

vi.mock("../utils.js", () => ({
  loadConfig: vi.fn(async () => ({ llm: {} })),
  buildPipelineConfig: buildPipelineConfigMock,
  findProjectRoot: vi.fn(() => "/project"),
  resolveBookId: vi.fn(async (bookId?: string) => bookId ?? "auto-book"),
  getLegacyMigrationHint: vi.fn(async () => undefined),
  resolveContext: vi.fn(),
  log: logMock,
  logError: logErrorMock,
}));

vi.mock("../localization.js", () => ({
  formatWriteNextResultLines: vi.fn(() => ["ok"]),
  resolveCliLanguage: vi.fn(() => "zh"),
}));

describe("revision-related CLI commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reviseDraftMock.mockResolvedValue({
      chapterNumber: 3,
      wordCount: 1200,
      fixedIssues: [],
      applied: true,
      status: "ready-for-review",
    });
    resyncChapterArtifactsMock.mockResolvedValue({
      chapterNumber: 3,
      title: "Synced Chapter",
      wordCount: 1200,
      revised: false,
      status: "ready-for-review",
      auditResult: { passed: true, issues: [], summary: "synced" },
    });
    buildPipelineConfigMock.mockReturnValue({});
    loadBookConfigMock.mockResolvedValue({ language: "zh" });
  });

  it("passes one-off brief into revise command pipeline config", async () => {
    const { reviseCommand } = await import("../commands/revise.js");

    await reviseCommand.parseAsync(["node", "revise", "demo-book", "3", "--mode", "rewrite", "--brief", "把注意力拉回师债主线。"], { from: "node" });

    expect(buildPipelineConfigMock).toHaveBeenCalledWith(expect.anything(), "/project", {
      externalContext: "把注意力拉回师债主线。",
    });
    expect(reviseDraftMock).toHaveBeenCalledWith("demo-book", 3, "rewrite");
  });

  it("exposes write sync and passes brief into pipeline config", async () => {
    const { writeCommand } = await import("../commands/write.js");

    await writeCommand.parseAsync(["node", "write", "sync", "demo-book", "3", "--brief", "以师债线为准同步状态。"], { from: "node" });

    expect(buildPipelineConfigMock).toHaveBeenCalledWith(expect.anything(), "/project", {
      externalContext: "以师债线为准同步状态。",
    });
    expect(resyncChapterArtifactsMock).toHaveBeenCalledWith("demo-book", 3);
  });
});
