import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const writeNextChapterMock = vi.fn();
const auditDraftMock = vi.fn();
const reviseDraftMock = vi.fn();
const dispatchNotificationMock = vi.fn();
const buildPipelineConfigMock = vi.fn();
const loadConfigMock = vi.fn();
const loadBookConfigMock = vi.fn();
const getNextChapterNumberMock = vi.fn();
const logMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("@actalk/inkos-core", () => ({
  PipelineRunner: class {
    writeNextChapter = writeNextChapterMock;
    auditDraft = auditDraftMock;
    reviseDraft = reviseDraftMock;
  },
  StateManager: class {
    async loadBookConfig() {
      return loadBookConfigMock();
    }
    async getNextChapterNumber() {
      return getNextChapterNumberMock();
    }
  },
  loadBookProductionMap: vi.fn(async () => ({
    schemaVersion: "1.0", bookId: "demo-book", authorityBookId: "authority", title: "Demo",
    totalChapters: 3,
    volumes: [{ volumeId: "volume-001", volumeNumber: 1, title: "One", startChapter: 1, endChapter: 3, chapterCount: 3 }],
  })),
  resolveProductionScope: vi.fn((_map, nextChapter: number) => ({
    complete: nextChapter > 3,
    startChapter: nextChapter,
    targetChapter: 3,
    currentVolume: { volumeId: "volume-001", volumeNumber: 1, title: "One", startChapter: 1, endChapter: 3, chapterCount: 3 },
  })),
  createAutonomousPipelineActions: vi.fn(async ({ pipeline }) => ({ runChapter: pipeline.writeNextChapter })),
  createAutonomousProviderExecution: vi.fn(() => ({
    execute: async (_chapter: number, task: () => Promise<unknown>) => task(),
    loadPersistedProgress: async () => null,
    now: () => 0,
    sleep: async () => undefined,
  })),
  claimAutonomousJob: vi.fn(async () => ({ jobId: "autonomous-test", claimId: "claim", ownerPid: 1 })),
  releaseAutonomousJob: vi.fn(async () => undefined),
  deriveAutonomousJobIdentity: vi.fn(() => "autonomous-test"),
  loadAutonomousProductionState: vi.fn(async () => null),
  refreshAutonomousJobClaim: vi.fn(async () => undefined),
  startAutonomousJobHeartbeat: vi.fn(() => () => undefined),
  runBoundedAutonomousScope: vi.fn(async (params) => {
    let nextChapter = await params.getNextChapter();
    let completedThisRun = 0;
    while (nextChapter <= 3) {
      await params.runChapter();
      nextChapter += 1;
      completedThisRun += 1;
    }
    return { status: "VOLUME_COMPLETE", nextChapter, completedThisRun };
  }),
  saveAutonomousProductionState: vi.fn(async () => undefined),
  dispatchNotification: dispatchNotificationMock,
  resolveChapterReviewMode: vi.fn(() => "auto"),
  resolveRevisionGate: vi.fn(() => undefined),
  DEFAULT_REVISE_MODE: "spot-fix",
  // Real localization.ts imports these from core; keep them deterministic.
  formatLengthCount: (count: number) => `${count}字`,
  resolveLengthCountingMode: () => "chars",
}));

vi.mock("../utils.js", () => ({
  loadConfig: loadConfigMock,
  buildPipelineConfig: buildPipelineConfigMock,
  findProjectRoot: vi.fn(() => "/project"),
  resolveBookId: vi.fn(async (bookId?: string) => bookId ?? "auto-book"),
  getLegacyMigrationHint: vi.fn(async () => null),
  resolveContext: vi.fn(async () => undefined),
  log: logMock,
  logError: logErrorMock,
}));

const notifyChannels = [
  { type: "telegram", botToken: "123:ABC", chatId: "-100", format: "text" },
];

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

describe("--notify command option", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    loadBookConfigMock.mockResolvedValue({
      title: "示例书",
      language: "zh",
      writing: {},
    });
    loadConfigMock.mockResolvedValue({
      llm: {},
      writing: { reviewRetries: 1 },
      notify: notifyChannels,
    });
    buildPipelineConfigMock.mockReturnValue({});
    dispatchNotificationMock.mockResolvedValue(undefined);
  });

  afterAll(() => {
    exitSpy.mockRestore();
  });

  describe("write next", () => {
    it("skips the success notification for a single-chapter run (pipeline already notified per chapter)", async () => {
      writeNextChapterMock.mockResolvedValueOnce(chapterResult(4));

      const { writeCommand } = await import("../commands/write.js");
      await writeCommand.parseAsync(["node", "write", "next", "demo-book", "--notify"], { from: "node" });

      expect(writeNextChapterMock).toHaveBeenCalledTimes(1);
      expect(dispatchNotificationMock).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("sends one batch summary for a multi-chapter run", async () => {
      let chapter = 3;
      writeNextChapterMock.mockImplementation(async () => chapterResult(++chapter));

      const { writeCommand } = await import("../commands/write.js");
      await writeCommand.parseAsync(
        ["node", "write", "next", "demo-book", "--count", "2", "--notify"],
        { from: "node" },
      );

      expect(dispatchNotificationMock).toHaveBeenCalledTimes(1);
      const [channels, message] = dispatchNotificationMock.mock.calls[0]!;
      expect(channels).toBe(notifyChannels);
      expect(message.title).toBe("✅ 写作完成《示例书》");
      expect(message.body).toContain("本次完成 2 章（第4章到第5章）");
      expect(message.body).toContain("第4章 第4章 | 3000字 | 审计通过");
    });

    it("does not send a batch summary without --notify", async () => {
      let chapter = 3;
      writeNextChapterMock.mockImplementation(async () => chapterResult(++chapter));

      const { writeCommand } = await import("../commands/write.js");
      await writeCommand.parseAsync(
        ["node", "write", "next", "demo-book", "--count", "2"],
        { from: "node" },
      );

      expect(dispatchNotificationMock).not.toHaveBeenCalled();
    });

    it("sends a failure notification with the error message before exiting", async () => {
      writeNextChapterMock.mockRejectedValueOnce(new Error("LLM exploded"));

      const { writeCommand } = await import("../commands/write.js");
      await writeCommand.parseAsync(["node", "write", "next", "demo-book", "--notify"], { from: "node" });

      expect(dispatchNotificationMock).toHaveBeenCalledTimes(1);
      const [, message] = dispatchNotificationMock.mock.calls[0]!;
      expect(message.title).toBe("❌ 写作失败《示例书》");
      expect(message.body).toContain("LLM exploded");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("sends no failure notification without --notify", async () => {
      writeNextChapterMock.mockRejectedValueOnce(new Error("LLM exploded"));

      const { writeCommand } = await import("../commands/write.js");
      await writeCommand.parseAsync(["node", "write", "next", "demo-book"], { from: "node" });

      expect(dispatchNotificationMock).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("write rewrite", () => {
    it("sends a failure notification when the command fails", async () => {
      const { writeCommand } = await import("../commands/write.js");
      await writeCommand.parseAsync(
        ["node", "write", "rewrite", "a", "b", "c", "--notify"],
        { from: "node" },
      );

      expect(dispatchNotificationMock).toHaveBeenCalledTimes(1);
      const [channels, message] = dispatchNotificationMock.mock.calls[0]!;
      // Failure happened before the book config was loaded: helper loads the
      // project config itself and falls back to zh with no book name.
      expect(channels).toBe(notifyChannels);
      expect(message.title).toBe("❌ 重写失败");
      expect(message.body).toContain("Usage: inkos write rewrite");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("audit", () => {
    it("sends a completion notification with the audit verdict", async () => {
      auditDraftMock.mockResolvedValueOnce({
        chapterNumber: 4,
        passed: true,
        issues: [],
        summary: "整体一致",
      });

      const { auditCommand } = await import("../commands/audit.js");
      await auditCommand.parseAsync(["node", "audit", "demo-book", "--notify"], { from: "node" });

      expect(dispatchNotificationMock).toHaveBeenCalledTimes(1);
      const [channels, message] = dispatchNotificationMock.mock.calls[0]!;
      expect(channels).toBe(notifyChannels);
      expect(message.title).toBe("✅ 审计完成《示例书》");
      expect(message.body).toBe("第4章审计通过（0 个问题）\n整体一致");
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("uses English copy when the book language is en", async () => {
      loadBookConfigMock.mockResolvedValue({ title: "My Book", language: "en", writing: {} });
      auditDraftMock.mockResolvedValueOnce({
        chapterNumber: 2,
        passed: false,
        issues: [{ severity: "major", category: "timeline", description: "conflict" }],
        summary: "timeline conflict",
      });

      const { auditCommand } = await import("../commands/audit.js");
      await auditCommand.parseAsync(["node", "audit", "demo-book", "--notify"], { from: "node" });

      const [, message] = dispatchNotificationMock.mock.calls[0]!;
      expect(message.title).toBe("✅ Audit complete: My Book");
      expect(message.body).toBe("Chapter 2 audit failed (1 issue(s))\ntimeline conflict");
    });

    it("warns and skips when --notify is set but no channels are configured", async () => {
      loadConfigMock.mockResolvedValue({ llm: {}, writing: { reviewRetries: 1 }, notify: [] });
      auditDraftMock.mockResolvedValueOnce({
        chapterNumber: 4,
        passed: true,
        issues: [],
        summary: "ok",
      });

      const { auditCommand } = await import("../commands/audit.js");
      await auditCommand.parseAsync(["node", "audit", "demo-book", "--notify"], { from: "node" });

      expect(dispatchNotificationMock).not.toHaveBeenCalled();
      expect(logErrorMock).toHaveBeenCalledWith(expect.stringContaining("--notify"));
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("does not let a notification failure change the command exit code", async () => {
      dispatchNotificationMock.mockRejectedValueOnce(new Error("network down"));
      auditDraftMock.mockResolvedValueOnce({
        chapterNumber: 4,
        passed: true,
        issues: [],
        summary: "ok",
      });

      const { auditCommand } = await import("../commands/audit.js");
      await auditCommand.parseAsync(["node", "audit", "demo-book", "--notify"], { from: "node" });

      expect(logErrorMock).toHaveBeenCalledWith(expect.stringContaining("network down"));
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("sends a failure notification when the audit fails", async () => {
      auditDraftMock.mockRejectedValueOnce(new Error("no chapters"));

      const { auditCommand } = await import("../commands/audit.js");
      await auditCommand.parseAsync(["node", "audit", "demo-book", "--notify"], { from: "node" });

      const [, message] = dispatchNotificationMock.mock.calls[0]!;
      expect(message.title).toBe("❌ 审计失败《示例书》");
      expect(message.body).toContain("no chapters");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("revise", () => {
    it("sends a completion notification when the revision is applied", async () => {
      reviseDraftMock.mockResolvedValueOnce({
        chapterNumber: 3,
        wordCount: 3200,
        fixedIssues: ["fix a", "fix b"],
        applied: true,
        status: "ready-for-review",
      });

      const { reviseCommand } = await import("../commands/revise.js");
      await reviseCommand.parseAsync(["node", "revise", "demo-book", "3", "--notify"], { from: "node" });

      expect(dispatchNotificationMock).toHaveBeenCalledTimes(1);
      const [, message] = dispatchNotificationMock.mock.calls[0]!;
      expect(message.title).toBe("✅ 修订完成《示例书》");
      expect(message.body).toBe("第3章已修订 | 3200字 | 修复 2 个问题");
    });

    it("reports a kept original draft with the skip reason", async () => {
      reviseDraftMock.mockResolvedValueOnce({
        chapterNumber: 3,
        wordCount: 3000,
        fixedIssues: [],
        applied: false,
        status: "unchanged",
        skippedReason: "无阻断问题",
      });

      const { reviseCommand } = await import("../commands/revise.js");
      await reviseCommand.parseAsync(["node", "revise", "demo-book", "3", "--notify"], { from: "node" });

      const [, message] = dispatchNotificationMock.mock.calls[0]!;
      expect(message.title).toBe("✅ 修订完成《示例书》");
      expect(message.body).toBe("第3章保留原稿：无阻断问题");
    });

    it("sends a failure notification when the revision fails", async () => {
      reviseDraftMock.mockRejectedValueOnce(new Error("revision blew up"));

      const { reviseCommand } = await import("../commands/revise.js");
      await reviseCommand.parseAsync(["node", "revise", "demo-book", "3", "--notify"], { from: "node" });

      const [, message] = dispatchNotificationMock.mock.calls[0]!;
      expect(message.title).toBe("❌ 修订失败《示例书》");
      expect(message.body).toContain("revision blew up");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("auto", () => {
    it("sends one batch summary for a multi-chapter run", async () => {
      getNextChapterNumberMock.mockResolvedValue(1);
      let chapter = 0;
      writeNextChapterMock.mockImplementation(async () => chapterResult(++chapter));

      const { autoCommand } = await import("../commands/auto.js");
      await autoCommand.parseAsync(["node", "auto", "demo-book", "3", "--notify"], { from: "node" });

      expect(writeNextChapterMock).toHaveBeenCalledTimes(3);
      expect(dispatchNotificationMock).toHaveBeenCalledTimes(1);
      const [, message] = dispatchNotificationMock.mock.calls[0]!;
      expect(message.title).toBe("✅ 自动连写完成《示例书》");
      expect(message.body).toContain("本次完成 3 章（第1章到第3章）");
    });

    it("skips the success notification for a single-chapter run (pipeline already notified per chapter)", async () => {
      getNextChapterNumberMock.mockResolvedValue(3);
      writeNextChapterMock.mockResolvedValueOnce(chapterResult(3));

      const { autoCommand } = await import("../commands/auto.js");
      await autoCommand.parseAsync(["node", "auto", "demo-book", "3", "--notify"], { from: "node" });

      expect(dispatchNotificationMock).not.toHaveBeenCalled();
    });

    it("sends a failure notification when a chapter write fails mid-run", async () => {
      getNextChapterNumberMock.mockResolvedValue(1);
      writeNextChapterMock
        .mockResolvedValueOnce(chapterResult(1))
        .mockRejectedValueOnce(new Error("LLM exploded"));

      const { autoCommand } = await import("../commands/auto.js");
      await autoCommand.parseAsync(["node", "auto", "demo-book", "3", "--notify"], { from: "node" });

      expect(dispatchNotificationMock).toHaveBeenCalledTimes(1);
      const [, message] = dispatchNotificationMock.mock.calls[0]!;
      expect(message.title).toBe("❌ 自动连写失败《示例书》");
      expect(message.body).toContain("Chapter 2 failed");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
