import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PipelineRunner } from "../pipeline/runner.js";
import { StateManager } from "../state/manager.js";
import { ArchitectAgent } from "../agents/architect.js";
import { PlannerAgent } from "../agents/planner.js";
import { ComposerAgent } from "../agents/composer.js";
import { WriterAgent, type WriteChapterOutput } from "../agents/writer.js";
import { LengthNormalizerAgent } from "../agents/length-normalizer.js";
import { ContinuityAuditor, type AuditIssue, type AuditResult } from "../agents/continuity.js";
import { ReviserAgent, type ReviseOutput } from "../agents/reviser.js";
import { ChapterAnalyzerAgent } from "../agents/chapter-analyzer.js";
import type { BookConfig } from "../models/book.js";
import type { ChapterMeta } from "../models/chapter.js";
import { MemoryDB } from "../state/memory-db.js";
import * as memoryDbModule from "../state/memory-db.js";
import { countChapterLength } from "../utils/length-metrics.js";

const require = createRequire(import.meta.url);
const hasNodeSqlite = (() => {
  try {
    require("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

const sqliteIt = hasNodeSqlite ? it : it.skip;

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

const CRITICAL_ISSUE: AuditIssue = {
  severity: "critical",
  category: "continuity",
  description: "Fix the chapter state",
  suggestion: "Repair the contradiction",
};

function createAuditResult(overrides: Partial<AuditResult>): AuditResult {
  return {
    passed: true,
    issues: [],
    summary: "ok",
    tokenUsage: ZERO_USAGE,
    ...overrides,
  };
}

function createWriterOutput(overrides: Partial<WriteChapterOutput> = {}): WriteChapterOutput {
  return {
    chapterNumber: 1,
    title: "Test Chapter",
    content: "Original chapter body.",
    wordCount: "Original chapter body.".length,
    preWriteCheck: "check",
    postSettlement: "settled",
    updatedState: "writer state",
    updatedLedger: "writer ledger",
    updatedHooks: "writer hooks",
    chapterSummary: "| 1 | Original summary |",
    updatedSubplots: "writer subplots",
    updatedEmotionalArcs: "writer emotions",
    updatedCharacterMatrix: "writer matrix",
    postWriteErrors: [],
    postWriteWarnings: [],
    tokenUsage: ZERO_USAGE,
    ...overrides,
  };
}

function createReviseOutput(overrides: Partial<ReviseOutput> = {}): ReviseOutput {
  return {
    revisedContent: "Revised chapter body.",
    wordCount: "Revised chapter body.".length,
    fixedIssues: ["fixed"],
    updatedState: "revised state",
    updatedLedger: "revised ledger",
    updatedHooks: "revised hooks",
    tokenUsage: ZERO_USAGE,
    ...overrides,
  };
}

function createAnalyzedOutput(overrides: Partial<WriteChapterOutput> = {}): WriteChapterOutput {
  return createWriterOutput({
    content: "Analyzed final chapter body.",
    wordCount: "Analyzed final chapter body.".length,
    updatedState: "analyzed state",
    updatedLedger: "analyzed ledger",
    updatedHooks: "analyzed hooks",
    chapterSummary: "| 1 | Revised summary |",
    updatedSubplots: "analyzed subplots",
    updatedEmotionalArcs: "analyzed emotions",
    updatedCharacterMatrix: "analyzed matrix",
    ...overrides,
  });
}

function createStateCard(params: {
  readonly chapter: number;
  readonly location: string;
  readonly protagonistState: string;
  readonly goal: string;
  readonly conflict: string;
}): string {
  return [
    "# Current State",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Current Chapter | ${params.chapter} |`,
    `| Current Location | ${params.location} |`,
    `| Protagonist State | ${params.protagonistState} |`,
    `| Current Goal | ${params.goal} |`,
    "| Current Constraint | The city gates are watched. |",
    "| Current Alliances | Mentor allies are scattered. |",
    `| Current Conflict | ${params.conflict} |`,
    "",
  ].join("\n");
}

function createCaptureLogger() {
  const infos: string[] = [];
  const warnings: string[] = [];

  const logger = {
    debug() {},
    info(message: string) {
      infos.push(message);
    },
    warn(message: string) {
      warnings.push(message);
    },
    error() {},
    child() {
      return logger;
    },
  };

  return { logger, infos, warnings };
}

async function createRunnerFixture(
  configOverrides: Partial<ConstructorParameters<typeof PipelineRunner>[0]> = {},
): Promise<{
  root: string;
  runner: PipelineRunner;
  state: StateManager;
  bookId: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "inkos-runner-test-"));
  const state = new StateManager(root);
  const bookId = "test-book";
  const now = "2026-03-19T00:00:00.000Z";
  const book: BookConfig = {
    id: bookId,
    title: "Test Book",
    platform: "tomato",
    genre: "xuanhuan",
    status: "active",
    targetChapters: 10,
    chapterWordCount: 3000,
    createdAt: now,
    updatedAt: now,
  };

  await state.saveBookConfig(bookId, book);
  await mkdir(join(state.bookDir(bookId), "story"), { recursive: true });
  await mkdir(join(state.bookDir(bookId), "chapters"), { recursive: true });

  const runner = new PipelineRunner({
    client: {
      provider: "openai",
      apiFormat: "chat",
      stream: false,
      defaults: {
        temperature: 0.7,
        maxTokens: 4096,
        thinkingBudget: 0, maxTokensCap: null,
      },
    } as ConstructorParameters<typeof PipelineRunner>[0]["client"],
    model: "test-model",
    projectRoot: root,
    ...configOverrides,
  });

  return { root, runner, state, bookId };
}

describe("PipelineRunner", () => {
  beforeEach(() => {
    vi.spyOn(LengthNormalizerAgent.prototype, "normalizeChapter").mockImplementation(
      async ({ chapterContent, lengthSpec }) => ({
        normalizedContent: chapterContent,
        finalCount: countChapterLength(chapterContent, lengthSpec.countingMode),
        applied: false,
        mode: "none",
        tokenUsage: ZERO_USAGE,
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not reuse override clients when credential sources differ", () => {
    const previousKeyA = process.env.TEST_KEY_A;
    const previousKeyB = process.env.TEST_KEY_B;
    process.env.TEST_KEY_A = "key-a";
    process.env.TEST_KEY_B = "key-b";

    try {
      const runner = new PipelineRunner({
        client: {
          provider: "openai",
          apiFormat: "chat",
          stream: false,
          defaults: {
            temperature: 0.7,
            maxTokens: 4096,
            thinkingBudget: 0, maxTokensCap: null,
          },
        } as ConstructorParameters<typeof PipelineRunner>[0]["client"],
        model: "base-model",
        projectRoot: process.cwd(),
        defaultLLMConfig: {
          provider: "custom",
          baseUrl: "https://base.example/v1",
          apiKey: "base-key",
          model: "base-model",
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0,
          apiFormat: "chat",
          stream: false,
        },
        modelOverrides: {
          writer: {
            model: "writer-model",
            provider: "custom",
            baseUrl: "https://shared.example/v1",
            apiKeyEnv: "TEST_KEY_A",
          },
          auditor: {
            model: "auditor-model",
            provider: "custom",
            baseUrl: "https://shared.example/v1",
            apiKeyEnv: "TEST_KEY_B",
          },
        },
      });

      const resolveOverride = (
        runner as unknown as {
          resolveOverride: (agent: string) => { model: string; client: unknown };
        }
      ).resolveOverride.bind(runner);

      const writerOverride = resolveOverride("writer");
      const auditorOverride = resolveOverride("auditor");

      expect(writerOverride.client).not.toBe(auditorOverride.client);
    } finally {
      if (previousKeyA === undefined) delete process.env.TEST_KEY_A;
      else process.env.TEST_KEY_A = previousKeyA;

      if (previousKeyB === undefined) delete process.env.TEST_KEY_B;
      else process.env.TEST_KEY_B = previousKeyB;
    }
  });

  it("initializes control documents during book creation", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-init-book-test-"));
    const bookId = "bootstrap-book";
    const brief = "# Author Intent\n\nKeep the narrative centered on mentor conflict.\n";
    const now = "2026-03-22T00:00:00.000Z";
    const book: BookConfig = {
      id: bookId,
      title: "Bootstrap Book",
      platform: "tomato",
      genre: "xuanhuan",
      status: "outlining",
      targetChapters: 10,
      chapterWordCount: 3000,
      createdAt: now,
      updatedAt: now,
    };

    const runner = new PipelineRunner({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
        },
      } as ConstructorParameters<typeof PipelineRunner>[0]["client"],
      model: "test-model",
      projectRoot: root,
      externalContext: brief,
    });

    vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue({
      storyBible: "# Story Bible\n",
      volumeOutline: "# Volume Outline\n",
      bookRules: "---\nversion: \"1.0\"\n---\n\n# Book Rules\n",
      currentState: "# Current State\n",
      pendingHooks: "# Pending Hooks\n",
    });

    try {
      await runner.initBook(book);

      const storyDir = join(root, "books", bookId, "story");
      const authorIntent = await readFile(join(storyDir, "author_intent.md"), "utf-8");
      const currentFocus = await readFile(join(storyDir, "current_focus.md"), "utf-8");
      const runtimeDir = await stat(join(storyDir, "runtime"));

      expect(authorIntent).toContain("mentor conflict");
      expect(currentFocus).toContain("Current Focus");
      expect(runtimeDir.isDirectory()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("bootstraps missing control documents for legacy books before writing", async () => {
    const { root, runner, bookId } = await createRunnerFixture();

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Legacy chapter body.",
        wordCount: "Legacy chapter body.".length,
      }),
    );

    try {
      await runner.writeDraft(bookId);

      const storyDir = join(root, "books", bookId, "story");
      const authorIntent = await readFile(join(storyDir, "author_intent.md"), "utf-8");
      const currentFocus = await readFile(join(storyDir, "current_focus.md"), "utf-8");
      const runtimeDir = await stat(join(storyDir, "runtime"));

      expect(authorIntent).toContain("Author Intent");
      expect(currentFocus).toContain("Current Focus");
      expect(runtimeDir.isDirectory()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("routes writeDraft through planner and composer in v2 mode", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "v2",
    });

    await Promise.all([
      writeFile(join(state.bookDir(bookId), "story", "current_focus.md"), "# Current Focus\n\nBring focus back to the mentor conflict.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "volume_outline.md"), "# Volume Outline\n\n## Chapter 1\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n", "utf-8"),
    ]);

    const planChapter = vi.spyOn(PlannerAgent.prototype, "planChapter");
    const composeChapter = vi.spyOn(ComposerAgent.prototype, "composeChapter");
    const writeChapter = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Governed draft body.",
        wordCount: "Governed draft body.".length,
      }),
    );

    try {
      await runner.writeDraft(bookId, "Ignore the guild chase and bring focus back to mentor conflict.");

      expect(planChapter).toHaveBeenCalledTimes(1);
      expect(composeChapter).toHaveBeenCalledTimes(1);

      const writeInput = writeChapter.mock.calls[0]?.[0];
      expect(writeInput?.externalContext).toBeUndefined();
      expect(writeInput?.chapterIntent).toContain("# Chapter Intent");
      expect(writeInput?.contextPackage?.selectedContext.length).toBeGreaterThan(0);
      expect(writeInput?.ruleStack?.activeOverrides).toHaveLength(1);

      const runtimeDir = join(state.bookDir(bookId), "story", "runtime");
      await expect(stat(join(runtimeDir, "chapter-0001.intent.md"))).resolves.toBeTruthy();
      await expect(stat(join(runtimeDir, "chapter-0001.context.json"))).resolves.toBeTruthy();
      await expect(stat(join(runtimeDir, "chapter-0001.rule-stack.yaml"))).resolves.toBeTruthy();
      await expect(stat(join(runtimeDir, "chapter-0001.trace.json"))).resolves.toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reuses an existing planned intent for draft when no new context is provided in v2 mode", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "v2",
    });

    await Promise.all([
      mkdir(join(state.bookDir(bookId), "story", "runtime"), { recursive: true }),
      writeFile(join(state.bookDir(bookId), "story", "current_focus.md"), "# Current Focus\n\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "volume_outline.md"), "# Volume Outline\n\n## Chapter 1\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n", "utf-8"),
      writeFile(
        join(state.bookDir(bookId), "story", "runtime", "chapter-0001.intent.md"),
        [
          "# Chapter Intent",
          "",
          "## Goal",
          "Bring the focus back to the mentor conflict.",
          "",
          "## Outline Node",
          "Track the merchant guild trail.",
          "",
          "## Must Keep",
          "- Lin Yue still hides the broken oath token.",
          "",
          "## Must Avoid",
          "- Do not reveal the mastermind",
          "",
          "## Style Emphasis",
          "- Keep the narrative emotionally close to the mentor conflict.",
          "",
          "## Conflicts",
          "- outline_vs_request: allow local outline deferral",
          "",
          "## Pending Hooks Snapshot",
          "- none",
          "",
          "## Chapter Summaries Snapshot",
          "- none",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planChapter = vi.spyOn(PlannerAgent.prototype, "planChapter");
    const writeChapter = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Governed draft body.",
        wordCount: "Governed draft body.".length,
      }),
    );

    try {
      await runner.writeDraft(bookId);

      expect(planChapter).not.toHaveBeenCalled();
      const writeInput = writeChapter.mock.calls[0]?.[0];
      expect(writeInput?.chapterIntent).toContain("Bring the focus back to the mentor conflict.");
      expect(writeInput?.ruleStack?.activeOverrides).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  sqliteIt("syncs current-state facts into memory.db after drafting a chapter", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const chapterOneState = createStateCard({
      chapter: 1,
      location: "Ashen ferry crossing",
      protagonistState: "Lin Yue hides the broken oath token.",
      goal: "Find the vanished mentor before dawn.",
      conflict: "Mentor debt blocks every choice.",
    });

    await Promise.all([
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(
        join(state.bookDir(bookId), "story", "current_state.md"),
        createStateCard({
          chapter: 0,
          location: "Shrine outskirts",
          protagonistState: "Lin Yue begins with the oath token hidden.",
          goal: "Reach the trial city.",
          conflict: "The trial deadline is closing in.",
        }),
        "utf-8",
      ),
    ]);
    await state.snapshotState(bookId, 0);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Draft body.",
        wordCount: "Draft body.".length,
        updatedState: chapterOneState,
        updatedHooks: [
          "# Pending Hooks",
          "",
          "| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| mentor-debt | 1 | relationship | open | 1 | 6 | The mentor debt remains unresolved |",
          "",
        ].join("\n"),
        chapterSummary: [
          "| 1 | Ferry Debt | Lin Yue | Lin Yue crosses the ferry and recommits to the mentor trail | The debt hardens into the core conflict | mentor-debt advanced | tense | mainline |",
        ].join("\n"),
      }),
    );

    try {
      await runner.writeDraft(bookId);

      const memoryDb = new MemoryDB(state.bookDir(bookId));
      try {
        expect(memoryDb.getCurrentFacts()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              predicate: "Current Conflict",
              object: "Mentor debt blocks every choice.",
              validFromChapter: 1,
              sourceChapter: 1,
            }),
          ]),
        );
        expect(memoryDb.getChapterCount()).toBe(1);
        expect(memoryDb.getActiveHooks()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              hookId: "mentor-debt",
              status: "open",
            }),
          ]),
        );
      } finally {
        memoryDb.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  sqliteIt("syncs narrative memory from structured runtime state instead of stale markdown projections", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 1 | Markdown Summary | Lin Yue | Old markdown event | Old markdown state | markdown-hook advanced | tense | fallback |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| markdown-hook | 1 | mystery | open | 1 | 4 | Old markdown hook |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(join(stateDir, "manifest.json"), JSON.stringify({
        schemaVersion: 2,
        language: "en",
        lastAppliedChapter: 3,
        projectionVersion: 1,
        migrationWarnings: [],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "current_state.json"), JSON.stringify({
        chapter: 3,
        facts: [],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "hooks.json"), JSON.stringify({
        hooks: [
          {
            hookId: "structured-hook",
            startChapter: 2,
            type: "relationship",
            status: "progressing",
            lastAdvancedChapter: 3,
            expectedPayoff: "Reveal the mentor ledger.",
            notes: "Structured hook should win.",
          },
        ],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "chapter_summaries.json"), JSON.stringify({
        rows: [
          {
            chapter: 3,
            title: "Structured Summary",
            characters: "Lin Yue",
            events: "Structured runtime state event.",
            stateChanges: "Structured runtime state shift.",
            hookActivity: "structured-hook advanced",
            mood: "grim",
            chapterType: "mainline",
          },
        ],
      }, null, 2), "utf-8"),
    ]);

    try {
      await (runner as unknown as {
        syncNarrativeMemoryIndex: (targetBookId: string) => Promise<void>;
      }).syncNarrativeMemoryIndex(bookId);

      const memoryDb = new MemoryDB(state.bookDir(bookId));
      try {
        expect(memoryDb.getSummaries(1, 10)).toEqual([
          expect.objectContaining({
            chapter: 3,
            title: "Structured Summary",
            events: "Structured runtime state event.",
          }),
        ]);
        expect(memoryDb.getActiveHooks()).toEqual([
          expect.objectContaining({
            hookId: "structured-hook",
            status: "progressing",
          }),
        ]);
      } finally {
        memoryDb.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses a friendly fallback warning when sqlite memory indexing is unavailable", async () => {
    const { logger, warnings } = createCaptureLogger();
    const { root, runner, state, bookId } = await createRunnerFixture({
      logger,
    });

    await Promise.all([
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(
        join(state.bookDir(bookId), "story", "current_state.md"),
        createStateCard({
          chapter: 0,
          location: "Shrine outskirts",
          protagonistState: "Lin Yue begins with the oath token hidden.",
          goal: "Reach the trial city.",
          conflict: "The trial deadline is closing in.",
        }),
        "utf-8",
      ),
    ]);

    vi.spyOn(memoryDbModule, "MemoryDB").mockImplementation(() => {
      const error = new Error("No such built-in module: node:sqlite");
      (error as Error & { code?: string }).code = "ERR_UNKNOWN_BUILTIN_MODULE";
      throw error;
    });
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Draft body.",
        wordCount: "Draft body.".length,
      }),
    );

    try {
      const result = await runner.writeDraft(bookId);

      expect(result.chapterNumber).toBe(1);
      expect(warnings).toContain(
        "当前 Node 运行时不支持 SQLite 记忆索引，继续使用 Markdown 回退方案。",
      );
      expect(warnings.join("\n")).not.toContain("node:sqlite");
      expect(warnings.join("\n")).not.toContain("ERR_UNKNOWN_BUILTIN_MODULE");
      expect(warnings.join("\n")).not.toContain("状态事实同步已跳过：");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not misclassify generic runtime errors as sqlite-unavailable fallback", async () => {
    const { logger, warnings } = createCaptureLogger();
    const { root, runner, state, bookId } = await createRunnerFixture({
      logger,
    });

    await Promise.all([
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(
        join(state.bookDir(bookId), "story", "current_state.md"),
        createStateCard({
          chapter: 0,
          location: "Shrine outskirts",
          protagonistState: "Lin Yue begins with the oath token hidden.",
          goal: "Reach the trial city.",
          conflict: "The trial deadline is closing in.",
        }),
        "utf-8",
      ),
    ]);

    vi.spyOn(memoryDbModule, "MemoryDB").mockImplementation(() => {
      throw new Error("sync failed while handling cached node:sqlite telemetry text");
    });
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Draft body.",
        wordCount: "Draft body.".length,
      }),
    );

    try {
      const result = await runner.writeDraft(bookId);

      expect(result.chapterNumber).toBe(1);
      expect(warnings.join("\n")).toContain("叙事记忆同步已跳过：");
      expect(warnings.join("\n")).not.toContain("当前 Node 运行时不支持 SQLite 记忆索引");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  sqliteIt("recovers when sqlite-unavailable signature is transient and probe succeeds", async () => {
    const { logger, warnings } = createCaptureLogger();
    const { root, runner, state, bookId } = await createRunnerFixture({
      logger,
      inputGovernanceMode: "legacy",
    });

    await Promise.all([
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(
        join(state.bookDir(bookId), "story", "current_state.md"),
        createStateCard({
          chapter: 0,
          location: "Shrine outskirts",
          protagonistState: "Lin Yue begins with the oath token hidden.",
          goal: "Reach the trial city.",
          conflict: "The trial deadline is closing in.",
        }),
        "utf-8",
      ),
    ]);

    const RealMemoryDB = memoryDbModule.MemoryDB;
    let constructorCalls = 0;
    vi.spyOn(memoryDbModule, "MemoryDB").mockImplementation((...args: ConstructorParameters<typeof memoryDbModule.MemoryDB>) => {
      if (constructorCalls === 0) {
        constructorCalls += 1;
        const error = new Error("No such built-in module: node:sqlite");
        (error as Error & { code?: string }).code = "ERR_UNKNOWN_BUILTIN_MODULE";
        throw error;
      }
      constructorCalls += 1;
      return new RealMemoryDB(...args);
    });
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Draft body.",
        wordCount: "Draft body.".length,
        chapterSummary: "| 1 | Draft summary | Lin Yue | Draft event | Draft shift | hook advanced | tense | transition |",
        updatedHooks: [
          "# Pending Hooks",
          "",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| mentor-debt | 1 | relationship | open | 1 | 3 | Draft hook |",
        ].join("\n"),
      }),
    );

    try {
      const result = await runner.writeDraft(bookId);

      expect(result.chapterNumber).toBe(1);
      expect(warnings.join("\n")).not.toContain("当前 Node 运行时不支持 SQLite 记忆索引");
      expect(warnings.join("\n")).not.toContain("叙事记忆同步已跳过");

      const memoryDb = new MemoryDB(state.bookDir(bookId));
      try {
        expect(memoryDb.getChapterCount()).toBe(1);
        expect(memoryDb.getActiveHooks()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              hookId: "mentor-debt",
              status: "open",
            }),
          ]),
        );
      } finally {
        memoryDb.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  sqliteIt("retries transient sqlite busy errors during narrative memory sync", async () => {
    const { logger, warnings } = createCaptureLogger();
    const { root, runner, state, bookId } = await createRunnerFixture({
      logger,
      inputGovernanceMode: "legacy",
    });

    await Promise.all([
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(
        join(state.bookDir(bookId), "story", "current_state.md"),
        createStateCard({
          chapter: 0,
          location: "Shrine outskirts",
          protagonistState: "Lin Yue begins with the oath token hidden.",
          goal: "Reach the trial city.",
          conflict: "The trial deadline is closing in.",
        }),
        "utf-8",
      ),
    ]);

    const RealMemoryDB = memoryDbModule.MemoryDB;
    let constructorCalls = 0;
    vi.spyOn(memoryDbModule, "MemoryDB").mockImplementation((...args: ConstructorParameters<typeof memoryDbModule.MemoryDB>) => {
      if (constructorCalls === 0) {
        constructorCalls += 1;
        const error = new Error("database is locked");
        (error as Error & { code?: string }).code = "SQLITE_BUSY";
        throw error;
      }
      constructorCalls += 1;
      return new RealMemoryDB(...args);
    });
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Draft body.",
        wordCount: "Draft body.".length,
        chapterSummary: "| 1 | Draft summary | Lin Yue | Draft event | Draft shift | hook advanced | tense | transition |",
        updatedHooks: [
          "# Pending Hooks",
          "",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| mentor-debt | 1 | relationship | open | 1 | 3 | Draft hook |",
        ].join("\n"),
      }),
    );

    try {
      const result = await runner.writeDraft(bookId);

      expect(result.chapterNumber).toBe(1);
      expect(warnings.join("\n")).not.toContain("当前 Node 运行时不支持 SQLite 记忆索引");
      expect(warnings.join("\n")).not.toContain("叙事记忆同步已跳过");

      const memoryDb = new MemoryDB(state.bookDir(bookId));
      try {
        expect(memoryDb.getChapterCount()).toBe(1);
        expect(memoryDb.getActiveHooks()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              hookId: "mentor-debt",
              status: "open",
            }),
          ]),
        );
      } finally {
        memoryDb.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("logs explicit stage messages during book initialization", async () => {
    const { logger, infos } = createCaptureLogger();
    const { root, runner, state, bookId } = await createRunnerFixture({ logger });
    const book = await state.loadBookConfig(bookId);

    vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue({
      storyBible: "# Story Bible\n",
      volumeOutline: "# Volume Outline\n",
      bookRules: "---\nversion: \"1.0\"\n---\n\n# Book Rules\n",
      currentState: createStateCard({
        chapter: 0,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Find the vanished mentor.",
        conflict: "The mentor debt is still personal.",
      }),
      pendingHooks: "# Pending Hooks\n",
    });

    try {
      await runner.initBook(book);

      expect(infos).toEqual(expect.arrayContaining([
        "阶段：保存书籍配置",
        "阶段：生成基础设定",
        "阶段：写入基础设定文件",
        "阶段：初始化控制文档",
        "阶段：创建初始快照",
      ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("marks an outlining book as active after drafting the first chapter", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const book = await state.loadBookConfig(bookId);
    await state.saveBookConfig(bookId, { ...book, status: "outlining" });

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Draft body.",
        wordCount: "Draft body.".length,
      }),
    );

    try {
      await runner.writeDraft(bookId);

      const book = await state.loadBookConfig(bookId);
      expect(book.status).toBe("active");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("routes writeNextChapter through planner and composer in v2 mode", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "v2",
    });

    await Promise.all([
      writeFile(join(state.bookDir(bookId), "story", "current_focus.md"), "# Current Focus\n\nBring focus back to the mentor conflict.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "volume_outline.md"), "# Volume Outline\n\n## Chapter 1\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n", "utf-8"),
    ]);

    const planChapter = vi.spyOn(PlannerAgent.prototype, "planChapter");
    const composeChapter = vi.spyOn(ComposerAgent.prototype, "composeChapter");
    const writeChapter = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Governed pipeline draft.",
        wordCount: "Governed pipeline draft.".length,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );

    try {
      await runner.writeNextChapter(bookId, 220);

      expect(planChapter).toHaveBeenCalledTimes(1);
      expect(composeChapter).toHaveBeenCalledTimes(1);
      const writeInput = writeChapter.mock.calls[0]?.[0];
      expect(writeInput?.chapterIntent).toContain("# Chapter Intent");
      expect(writeInput?.contextPackage?.selectedContext.length).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("re-plans instead of reusing a persisted invalid intent artifact in v2 mode", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "v2",
    });
    const storyDir = join(state.bookDir(bookId), "story");
    const runtimeDir = join(storyDir, "runtime");
    await mkdir(runtimeDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "current_focus.md"), "# Current Focus\n\nBring focus back to the mentor conflict.\n", "utf-8"),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "### Golden First Three Chapters Rule",
          "",
          "**Chapter 1:**",
          "Track the merchant guild trail.",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n", "utf-8"),
      writeFile(
        join(runtimeDir, "chapter-0001.intent.md"),
        [
          "# Chapter Intent",
          "",
          "## Goal",
          "**",
          "",
          "## Outline Node",
          "**",
          "",
          "## Must Keep",
          "- none",
          "",
          "## Must Avoid",
          "- none",
          "",
          "## Style Emphasis",
          "- none",
          "",
          "## Conflicts",
          "- none",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planChapter = vi.spyOn(PlannerAgent.prototype, "planChapter");
    const writeChapter = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Governed pipeline draft.",
        wordCount: "Governed pipeline draft.".length,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );

    try {
      await runner.writeNextChapter(bookId, 220);

      expect(planChapter).toHaveBeenCalledTimes(1);
      const writeInput = writeChapter.mock.calls[0]?.[0];
      expect(writeInput?.chapterIntent).toContain("Track the merchant guild trail.");
      expect(writeInput?.chapterIntent).not.toContain("\n**\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("logs explicit stage messages during writeNextChapter", async () => {
    const { logger, infos } = createCaptureLogger();
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "v2",
      logger,
    });

    await Promise.all([
      writeFile(join(state.bookDir(bookId), "story", "current_focus.md"), "# Current Focus\n\nBring focus back to the mentor conflict.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "volume_outline.md"), "# Volume Outline\n\n## Chapter 1\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n", "utf-8"),
    ]);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Governed pipeline draft.",
        wordCount: "Governed pipeline draft.".length,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );

    try {
      await runner.writeNextChapter(bookId, 220);

      expect(infos).toEqual(expect.arrayContaining([
        "阶段：准备章节输入",
        "阶段：撰写章节草稿",
        "阶段：审计草稿",
        "阶段：落盘最终章节",
        "阶段：生成最终真相文件",
        "阶段：校验真相文件变更",
        "阶段：同步记忆索引",
        "阶段：更新章节索引与快照",
      ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("logs English stage messages during writeNextChapter for English books", async () => {
    const { logger, infos } = createCaptureLogger();
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "v2",
      logger,
    });
    const englishBook = {
      ...(await state.loadBookConfig(bookId)),
      genre: "other",
      language: "en" as const,
      chapterWordCount: 220,
    };

    await state.saveBookConfig(bookId, englishBook);
    await Promise.all([
      writeFile(join(state.bookDir(bookId), "story", "current_focus.md"), "# Current Focus\n\nBring focus back to the mentor conflict.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "volume_outline.md"), "# Volume Outline\n\n## Chapter 1\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n", "utf-8"),
    ]);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Governed pipeline draft.",
        wordCount: countChapterLength("Governed pipeline draft.", "en_words"),
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );

    try {
      await runner.writeNextChapter(bookId, 220);

      expect(infos).toEqual(expect.arrayContaining([
        "Stage: preparing chapter inputs",
        "Stage: writing chapter draft",
        "Stage: auditing draft",
        "Stage: persisting final chapter",
        "Stage: rebuilding final truth files",
        "Stage: validating truth file updates",
        "Stage: syncing memory indexes",
        "Stage: updating chapter index and snapshots",
      ]));
      expect(infos.join("\n")).not.toContain("阶段：");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes English audit drift correction blocks for English books", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const englishBook = {
      ...(await state.loadBookConfig(bookId)),
      genre: "other",
      language: "en" as const,
      chapterWordCount: 220,
    };

    await state.saveBookConfig(bookId, englishBook);
    await Promise.all([
      writeFile(join(state.bookDir(bookId), "story", "current_focus.md"), "# Current Focus\n\nKeep the pressure on the harbor debt.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "current_state.md"), createStateCard({
        chapter: 0,
        location: "Harbor gate",
        protagonistState: "Lin Yue is tracking the vanished mentor.",
        goal: "Reach the sealed berth.",
        conflict: "The harbor debt keeps pulling him sideways.",
      }), "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "story_bible.md"), "# Story Bible\n\n- The harbor seal cannot be forged.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n\n- The vanished mentor still owes a debt.\n", "utf-8"),
    ]);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Lin Yue reached the sealed berth before dawn.",
        wordCount: countChapterLength("Lin Yue reached the sealed berth before dawn.", "en_words"),
        updatedState: createStateCard({
          chapter: 1,
          location: "Sealed berth",
          protagonistState: "Lin Yue is winded but focused.",
          goal: "Inspect the berth before the guild arrives.",
          conflict: "The harbor debt is still active.",
        }),
        updatedHooks: "# Pending Hooks\n\n- The vanished mentor still owes a debt.\n",
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [{
          severity: "warning",
          category: "continuity",
          description: "Keep the berth timing precise in the next chapter.",
          suggestion: "Avoid skipping the dawn transition.",
        }],
        summary: "warning only",
      }),
    );

    try {
      await runner.writeNextChapter(bookId, 220);

      const currentState = await readFile(join(state.bookDir(bookId), "story", "current_state.md"), "utf-8");
      expect(currentState).toContain("## Audit Drift Correction");
      expect(currentState).toContain("> Chapter 1 audit found the following issues");
      expect(currentState).not.toContain("## 审计纠偏");
      expect(currentState).not.toContain("下一章写作前参照");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes reduced control inputs into auditor and reviser in v2 mode", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "v2",
    });

    await Promise.all([
      writeFile(join(state.bookDir(bookId), "story", "current_focus.md"), "# Current Focus\n\nBring focus back to the mentor conflict.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "volume_outline.md"), "# Volume Outline\n\n## Chapter 1\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n", "utf-8"),
    ]);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Needs governed revision.",
        wordCount: "Needs governed revision.".length,
      }),
    );
    const auditChapter = vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: false,
        issues: [CRITICAL_ISSUE],
        summary: "needs revision",
      }),
    );
    const reviseChapter = vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: "Governed revised content.",
        wordCount: "Governed revised content.".length,
      }),
    );
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        content: "Governed revised content.",
        wordCount: "Governed revised content.".length,
      }),
    );

    try {
      await runner.writeNextChapter(bookId, 220);

      expect(auditChapter.mock.calls[0]?.[4]).toMatchObject({
        chapterIntent: expect.stringContaining("# Chapter Intent"),
        contextPackage: expect.objectContaining({
          selectedContext: expect.any(Array),
        }),
        ruleStack: expect.objectContaining({
          activeOverrides: expect.any(Array),
        }),
      });
      expect(reviseChapter.mock.calls[0]?.[6]).toMatchObject({
        chapterIntent: expect.stringContaining("# Chapter Intent"),
        contextPackage: expect.objectContaining({
          selectedContext: expect.any(Array),
        }),
        ruleStack: expect.objectContaining({
          activeOverrides: expect.any(Array),
        }),
        lengthSpec: expect.objectContaining({
          target: 220,
          softMin: 190,
          softMax: 250,
        }),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("normalizes revised output once before re-audit when it leaves the target band", async () => {
    const { root, runner, bookId } = await createRunnerFixture();
    const writerDraft = "中段正文。".repeat(40);
    const overlongRevision = "修订后正文。".repeat(60);
    const normalizedRevision = "归一正文。".repeat(40);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        content: writerDraft,
        wordCount: writerDraft.length,
      }),
    );
    const auditChapter = vi.spyOn(ContinuityAuditor.prototype, "auditChapter")
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [CRITICAL_ISSUE],
          summary: "needs revision",
        }),
      )
      .mockResolvedValueOnce(
        createAuditResult({
          passed: true,
          issues: [],
          summary: "clean",
        }),
      );
    const reviseChapter = vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: overlongRevision,
        wordCount: overlongRevision.length,
      }),
    );
    const normalizeChapter = vi.mocked(
      LengthNormalizerAgent.prototype.normalizeChapter,
    ).mockResolvedValue({
      normalizedContent: normalizedRevision,
      finalCount: normalizedRevision.length,
      applied: true,
      mode: "compress",
      tokenUsage: ZERO_USAGE,
    });
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        content: normalizedRevision,
        wordCount: normalizedRevision.length,
      }),
    );

    try {
      await runner.writeNextChapter(bookId, 220);

      expect(reviseChapter.mock.calls[0]?.[6]).toMatchObject({
        lengthSpec: expect.objectContaining({
          target: 220,
          softMin: 190,
          softMax: 250,
        }),
      });
      expect(normalizeChapter).toHaveBeenCalledTimes(1);
      expect(normalizeChapter.mock.calls[0]?.[0]).toMatchObject({
        chapterContent: overlongRevision,
        lengthSpec: expect.objectContaining({
          target: 220,
        }),
      });
      expect(auditChapter.mock.calls[1]?.[1]).toBe(normalizedRevision);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("normalizes overlong writer output once before audit", async () => {
    const { root, runner, bookId } = await createRunnerFixture();
    const overlongDraft = "冗余句子。".repeat(60);
    const normalizedDraft = "压缩后的正文。".repeat(12);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: overlongDraft,
        wordCount: overlongDraft.length,
      }),
    );
    const normalizeChapter = vi.mocked(
      LengthNormalizerAgent.prototype.normalizeChapter,
    ).mockResolvedValue({
      normalizedContent: normalizedDraft,
      finalCount: normalizedDraft.length,
      applied: true,
      mode: "compress",
      tokenUsage: ZERO_USAGE,
    });
    const auditChapter = vi.spyOn(
      ContinuityAuditor.prototype,
      "auditChapter",
    ).mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        content: normalizedDraft,
        wordCount: normalizedDraft.length,
      }),
    );

    try {
      await runner.writeNextChapter(bookId, 220);

      expect(normalizeChapter).toHaveBeenCalledTimes(1);
      expect(auditChapter.mock.calls[0]?.[1]).toBe(normalizedDraft);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("normalizes short writer output once before audit", async () => {
    const { root, runner, bookId } = await createRunnerFixture();
    const shortDraft = "短句。".repeat(20);
    const normalizedDraft = "补足后的正文。".repeat(15);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: shortDraft,
        wordCount: shortDraft.length,
      }),
    );
    const normalizeChapter = vi.mocked(
      LengthNormalizerAgent.prototype.normalizeChapter,
    ).mockResolvedValue({
      normalizedContent: normalizedDraft,
      finalCount: normalizedDraft.length,
      applied: true,
      mode: "expand",
      tokenUsage: ZERO_USAGE,
    });
    const auditChapter = vi.spyOn(
      ContinuityAuditor.prototype,
      "auditChapter",
    ).mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        content: normalizedDraft,
        wordCount: normalizedDraft.length,
      }),
    );

    try {
      await runner.writeNextChapter(bookId, 220);

      expect(normalizeChapter).toHaveBeenCalledTimes(1);
      expect(normalizeChapter.mock.calls[0]?.[0]).toMatchObject({
        chapterContent: shortDraft,
        lengthSpec: expect.objectContaining({
          target: 220,
          softMin: 190,
          softMax: 250,
        }),
      });
      expect(auditChapter.mock.calls[0]?.[1]).toBe(normalizedDraft);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records a length warning when a single normalize pass still misses the hard range", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const overlongDraft = "冗余句子。".repeat(60);
    const stillOverHard = "仍然过长。".repeat(70);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: overlongDraft,
        wordCount: overlongDraft.length,
      }),
    );
    const normalizeChapter = vi.mocked(
      LengthNormalizerAgent.prototype.normalizeChapter,
    ).mockResolvedValue({
      normalizedContent: stillOverHard,
      finalCount: stillOverHard.length,
      applied: true,
      mode: "compress",
      tokenUsage: ZERO_USAGE,
    });
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        content: stillOverHard,
        wordCount: stillOverHard.length,
      }),
    );

    try {
      const result = await runner.writeNextChapter(bookId, 220);
      const chapterIndex = await state.loadChapterIndex(bookId);
      const chapterMeta = chapterIndex.find((entry) => entry.number === 1);

      expect(normalizeChapter).toHaveBeenCalledTimes(1);
      expect((result as { lengthWarnings?: ReadonlyArray<string> }).lengthWarnings?.[0]).toContain(
        "超出硬区间",
      );
      expect((result as { lengthTelemetry?: { finalCount: number } }).lengthTelemetry?.finalCount).toBe(
        stillOverHard.length,
      );
      expect(chapterMeta?.lengthWarnings?.[0]).toContain("超出硬区间");
      expect(chapterMeta?.lengthTelemetry?.lengthWarning).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the last actionable audit issues when re-audit returns failed with no issues", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "legacy",
    });
    const storyDir = join(state.bookDir(bookId), "story");
    const draftBody = "甲".repeat(210);
    const revisedBody = "乙".repeat(215);

    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 0,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Find the vanished mentor.",
        conflict: "The mentor debt is still personal.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
    ]);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        content: draftBody,
        wordCount: draftBody.length,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter")
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [CRITICAL_ISSUE],
          summary: "needs revision",
        }),
      )
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [],
          summary: "",
        }),
      );
    vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: revisedBody,
        wordCount: revisedBody.length,
        fixedIssues: ["- tightened continuity."],
      }),
    );
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        content: revisedBody,
        wordCount: revisedBody.length,
      }),
    );

    try {
      const result = await runner.writeNextChapter(bookId, 220);
      const savedIndex = await state.loadChapterIndex(bookId);

      expect(result.status).toBe("audit-failed");
      expect(result.auditResult.summary).toBe("needs revision");
      expect(result.auditResult.issues).toEqual([CRITICAL_ISSUE]);
      expect(savedIndex[0]?.auditIssues).toEqual([
        `[critical] ${CRITICAL_ISSUE.description}`,
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves the legacy fallback when input governance mode is legacy", async () => {
    const { root, runner, bookId } = await createRunnerFixture({
      inputGovernanceMode: "legacy",
      externalContext: "Legacy focus only.",
    });

    const planChapter = vi.spyOn(PlannerAgent.prototype, "planChapter");
    const composeChapter = vi.spyOn(ComposerAgent.prototype, "composeChapter");
    const writeChapter = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Legacy draft body.",
        wordCount: "Legacy draft body.".length,
      }),
    );

    try {
      await runner.writeDraft(bookId);

      expect(planChapter).not.toHaveBeenCalled();
      expect(composeChapter).not.toHaveBeenCalled();

      const writeInput = writeChapter.mock.calls[0]?.[0];
      expect(writeInput?.externalContext).toBe("Legacy focus only.");
      expect(writeInput?.chapterIntent).toBeUndefined();
      expect(writeInput?.contextPackage).toBeUndefined();
      expect(writeInput?.ruleStack).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the latest revised content as the input for follow-up spot-fix revisions", async () => {
    const { root, runner, bookId } = await createRunnerFixture();

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        content: "Original draft body.",
        wordCount: "Original draft body.".length,
        postWriteErrors: [
          {
            severity: "error",
            rule: "post-write",
            description: "Needs a deterministic fix",
            suggestion: "Repair the line",
          },
        ],
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter")
      .mockResolvedValueOnce(createAuditResult({
        passed: false,
        issues: [CRITICAL_ISSUE],
        summary: "needs another revision",
      }))
      .mockResolvedValueOnce(createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }));
    const reviseChapter = vi.spyOn(ReviserAgent.prototype, "reviseChapter")
      .mockResolvedValueOnce(createReviseOutput({
        revisedContent: "After first fix.",
        wordCount: "After first fix.".length,
      }))
      .mockResolvedValueOnce(createReviseOutput({
        revisedContent: "After second fix.",
        wordCount: "After second fix.".length,
      }));
    vi.spyOn(WriterAgent.prototype, "saveChapter").mockResolvedValue(undefined);
    vi.spyOn(WriterAgent.prototype, "saveNewTruthFiles").mockResolvedValue(undefined);
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        content: "After second fix.",
        wordCount: "After second fix.".length,
      }),
    );

    await runner.writeNextChapter(bookId);

    expect(reviseChapter).toHaveBeenCalledTimes(2);
    expect(reviseChapter.mock.calls[1]?.[1]).toBe("After first fix.");

    await rm(root, { recursive: true, force: true });
  });

  it("persists truth files derived from the final revised chapter", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        content: "Original draft body.",
        wordCount: "Original draft body.".length,
        updatedState: "original state",
        updatedLedger: "original ledger",
        updatedHooks: "original hooks",
        chapterSummary: "| 1 | Original summary |",
        updatedSubplots: "original subplots",
        updatedEmotionalArcs: "original emotions",
        updatedCharacterMatrix: "original matrix",
        postWriteErrors: [
          {
            severity: "error",
            rule: "post-write",
            description: "Needs a deterministic fix",
            suggestion: "Repair the line",
          },
        ],
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );
    vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: "Final revised body.",
        wordCount: "Final revised body.".length,
      }),
    );
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        content: "Final revised body.",
        wordCount: "Final revised body.".length,
        updatedState: "final analyzed state",
        updatedLedger: "final analyzed ledger",
        updatedHooks: "final analyzed hooks",
        chapterSummary: "| 1 | Final analyzed summary |",
        updatedSubplots: "final analyzed subplots",
        updatedEmotionalArcs: "final analyzed emotions",
        updatedCharacterMatrix: "final analyzed matrix",
      }),
    );

    await runner.writeNextChapter(bookId);

    const storyDir = join(state.bookDir(bookId), "story");
    await expect(readFile(join(storyDir, "current_state.md"), "utf-8"))
      .resolves.toContain("final analyzed state");
    await expect(readFile(join(storyDir, "pending_hooks.md"), "utf-8"))
      .resolves.toContain("final analyzed hooks");
    await expect(readFile(join(storyDir, "particle_ledger.md"), "utf-8"))
      .resolves.toContain("final analyzed ledger");
    await expect(readFile(join(storyDir, "chapter_summaries.md"), "utf-8"))
      .resolves.toContain("Final analyzed summary");
    await expect(readFile(join(storyDir, "subplot_board.md"), "utf-8"))
      .resolves.toContain("final analyzed subplots");
    await expect(readFile(join(storyDir, "emotional_arcs.md"), "utf-8"))
      .resolves.toContain("final analyzed emotions");
    await expect(readFile(join(storyDir, "character_matrix.md"), "utf-8"))
      .resolves.toContain("final analyzed matrix");

    await rm(root, { recursive: true, force: true });
  });

  it("persists structured runtime state and rendered projections from writer delta output", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "legacy",
    });

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        content: "Lin Yue follows the debt into the river-port ledger.",
        wordCount: countChapterLength("Lin Yue follows the debt into the river-port ledger.", "en_words"),
        postWriteErrors: [],
        postWriteWarnings: [],
        runtimeStateDelta: {
          chapter: 1,
          currentStatePatch: {
            currentGoal: "Follow the debt through the river-port ledger.",
            currentConflict: "Guild pressure keeps pulling against the debt trail.",
          },
          hookOps: {
            upsert: [
              {
                hookId: "mentor-debt",
                startChapter: 1,
                type: "relationship",
                status: "open",
                lastAdvancedChapter: 1,
                expectedPayoff: "Reveal why the mentor vanished.",
                notes: "The river-port ledger sharpens the debt line.",
              },
            ],
            resolve: [],
            defer: [],
          },
          chapterSummary: {
            chapter: 1,
            title: "River Ledger",
            characters: "Lin Yue",
            events: "Lin Yue follows the debt into the river-port ledger.",
            stateChanges: "The debt line sharpens.",
            hookActivity: "mentor-debt advanced",
            mood: "tense",
            chapterType: "investigation",
          },
          subplotOps: [],
          emotionalArcOps: [],
          characterMatrixOps: [],
          notes: [],
        },
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );

    await runner.writeNextChapter(bookId);

    const storyDir = join(state.bookDir(bookId), "story");
    const currentState = await readFile(join(storyDir, "current_state.md"), "utf-8");
    const hooks = await readFile(join(storyDir, "pending_hooks.md"), "utf-8");
    const summaries = await readFile(join(storyDir, "chapter_summaries.md"), "utf-8");
    const manifest = JSON.parse(await readFile(join(storyDir, "state", "manifest.json"), "utf-8"));
    const stateCurrent = JSON.parse(await readFile(join(storyDir, "state", "current_state.json"), "utf-8"));
    const stateHooks = JSON.parse(await readFile(join(storyDir, "state", "hooks.json"), "utf-8"));
    const stateSummaries = JSON.parse(await readFile(join(storyDir, "state", "chapter_summaries.json"), "utf-8"));

    expect(currentState).toContain("Follow the debt through the river-port ledger.");
    expect(hooks).toContain("mentor-debt");
    expect(summaries).toContain("River Ledger");
    expect(manifest.lastAppliedChapter).toBe(1);
    expect(stateCurrent.chapter).toBe(1);
    expect(stateHooks.hooks[0]?.hookId).toBe("mentor-debt");
    expect(stateSummaries.rows[0]?.title).toBe("River Ledger");

    await rm(root, { recursive: true, force: true });
  });

  it("does not corrupt persisted runtime state when writer delta is invalid", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "legacy",
    });
    const storyDir = join(state.bookDir(bookId), "story");
    await mkdir(join(storyDir, "state"), { recursive: true });
    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 0,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Find the vanished mentor.",
        conflict: "The mentor debt is still personal.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "state", "manifest.json"), JSON.stringify({
        schemaVersion: 2,
        language: "en",
        lastAppliedChapter: 0,
        projectionVersion: 1,
        migrationWarnings: [],
      }, null, 2), "utf-8"),
      writeFile(join(storyDir, "state", "current_state.json"), JSON.stringify({
        chapter: 0,
        facts: [],
      }, null, 2), "utf-8"),
      writeFile(join(storyDir, "state", "hooks.json"), JSON.stringify({
        hooks: [],
      }, null, 2), "utf-8"),
      writeFile(join(storyDir, "state", "chapter_summaries.json"), JSON.stringify({
        rows: [],
      }, null, 2), "utf-8"),
    ]);

    const beforeState = await readFile(join(storyDir, "current_state.md"), "utf-8");
    const beforeManifest = await readFile(join(storyDir, "state", "manifest.json"), "utf-8");

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        content: "Broken chapter body.",
        wordCount: countChapterLength("Broken chapter body.", "en_words"),
        postWriteErrors: [],
        postWriteWarnings: [],
        runtimeStateDelta: {
          chapter: 0,
          hookOps: {
            upsert: [],
            resolve: [],
            defer: [],
          },
          notes: [],
        } as unknown as NonNullable<ReturnType<typeof createWriterOutput>["runtimeStateDelta"]>,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );

    await expect(runner.writeNextChapter(bookId)).rejects.toThrow();

    await expect(readFile(join(storyDir, "current_state.md"), "utf-8")).resolves.toBe(beforeState);
    await expect(readFile(join(storyDir, "state", "manifest.json"), "utf-8")).resolves.toBe(beforeManifest);

    await rm(root, { recursive: true, force: true });
  });

  it("rolls back persisted runtime state when writer delta contains natural-language numeric drift", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "legacy",
    });
    const storyDir = join(state.bookDir(bookId), "story");
    await mkdir(join(storyDir, "state"), { recursive: true });
    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 0,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Find the vanished mentor.",
        conflict: "The mentor debt is still personal.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "state", "manifest.json"), JSON.stringify({
        schemaVersion: 2,
        language: "en",
        lastAppliedChapter: 0,
        projectionVersion: 1,
        migrationWarnings: [],
      }, null, 2), "utf-8"),
      writeFile(join(storyDir, "state", "current_state.json"), JSON.stringify({
        chapter: 0,
        facts: [],
      }, null, 2), "utf-8"),
      writeFile(join(storyDir, "state", "hooks.json"), JSON.stringify({
        hooks: [],
      }, null, 2), "utf-8"),
      writeFile(join(storyDir, "state", "chapter_summaries.json"), JSON.stringify({
        rows: [],
      }, null, 2), "utf-8"),
    ]);

    const beforeState = await readFile(join(storyDir, "current_state.md"), "utf-8");
    const beforeManifest = await readFile(join(storyDir, "state", "manifest.json"), "utf-8");

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        content: "Broken chapter body.",
        wordCount: countChapterLength("Broken chapter body.", "en_words"),
        postWriteErrors: [],
        postWriteWarnings: [],
        runtimeStateDelta: {
          chapter: 1,
          hookOps: {
            upsert: [
              {
                hookId: "mentor-debt",
                startChapter: 1,
                type: "relationship",
                status: "open",
                lastAdvancedChapter: "chapter one",
                expectedPayoff: "Reveal the debt.",
                notes: "Bad numeric drift.",
              },
            ],
            resolve: [],
            defer: [],
          },
          notes: [],
        } as unknown as NonNullable<ReturnType<typeof createWriterOutput>["runtimeStateDelta"]>,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );

    await expect(runner.writeNextChapter(bookId)).rejects.toThrow();

    await expect(readFile(join(storyDir, "current_state.md"), "utf-8")).resolves.toBe(beforeState);
    await expect(readFile(join(storyDir, "state", "manifest.json"), "utf-8")).resolves.toBe(beforeManifest);

    await rm(root, { recursive: true, force: true });
  });

  it("reports only resumed chapters in import results", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const now = "2026-03-19T00:00:00.000Z";
    const existingIndex: ChapterMeta[] = [
      {
        number: 1,
        title: "One",
        status: "imported",
        wordCount: 10,
        createdAt: now,
        updatedAt: now,
        auditIssues: [],
        lengthWarnings: [],
      },
      {
        number: 2,
        title: "Two",
        status: "imported",
        wordCount: 20,
        createdAt: now,
        updatedAt: now,
        auditIssues: [],
        lengthWarnings: [],
      },
    ];
    await state.saveChapterIndex(bookId, existingIndex);

    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockImplementation(async (input) =>
      createAnalyzedOutput({
        chapterNumber: input.chapterNumber,
        title: input.chapterTitle ?? `Chapter ${input.chapterNumber}`,
        content: input.chapterContent,
        wordCount: input.chapterContent.length,
      }),
    );
    vi.spyOn(WriterAgent.prototype, "saveChapter").mockResolvedValue(undefined);
    vi.spyOn(WriterAgent.prototype, "saveNewTruthFiles").mockResolvedValue(undefined);

    const result = await runner.importChapters({
      bookId,
      resumeFrom: 3,
      chapters: [
        { title: "One", content: "1111111111" },
        { title: "Two", content: "22222222222222222222" },
        { title: "Three", content: "333333333333333" },
        { title: "Four", content: "4444444444444444444444444" },
      ],
    });

    expect(result.importedCount).toBe(2);
    expect(result.totalWords).toBe("333333333333333".length + "4444444444444444444444444".length);
    expect(result.nextChapter).toBe(5);

    await rm(root, { recursive: true, force: true });
  });

  sqliteIt("rebuilds fact history from imported chapter snapshots", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();

    vi.spyOn(ArchitectAgent.prototype, "generateFoundationFromImport").mockResolvedValue({
      storyBible: "# Story Bible\n",
      volumeOutline: "# Volume Outline\n",
      bookRules: "---\nversion: \"1.0\"\n---\n\n# Book Rules\n",
      currentState: createStateCard({
        chapter: 0,
        location: "Shrine outskirts",
        protagonistState: "Lin Yue begins with the oath token hidden.",
        goal: "Reach the trial city.",
        conflict: "The trial deadline is closing in.",
      }),
      pendingHooks: "# Pending Hooks\n",
    });

    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter")
      .mockResolvedValueOnce(createAnalyzedOutput({
        chapterNumber: 1,
        title: "One",
        content: "One body.",
        wordCount: "One body.".length,
        updatedState: createStateCard({
          chapter: 1,
          location: "Ashen ferry crossing",
          protagonistState: "Lin Yue still hides the oath token.",
          goal: "Find the vanished mentor.",
          conflict: "The mentor debt is still personal.",
        }),
        updatedHooks: "# Pending Hooks\n",
      }))
      .mockResolvedValueOnce(createAnalyzedOutput({
        chapterNumber: 2,
        title: "Two",
        content: "Two body.",
        wordCount: "Two body.".length,
        updatedState: createStateCard({
          chapter: 2,
          location: "North watchtower",
          protagonistState: "Lin Yue finally shows the oath token.",
          goal: "Reach the watchtower before the guild.",
          conflict: "The merchant guild now contests the mentor trail.",
        }),
        updatedHooks: "# Pending Hooks\n",
      }));

    try {
      await runner.importChapters({
        bookId,
        chapters: [
          { title: "One", content: "One body." },
          { title: "Two", content: "Two body." },
        ],
      });

      const memoryDb = new MemoryDB(state.bookDir(bookId));
      try {
        const chapterOneFacts = memoryDb.getFactsAt("protagonist", 1);
        const currentFacts = memoryDb.getCurrentFacts();

        expect(chapterOneFacts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              predicate: "Current Conflict",
              object: "The mentor debt is still personal.",
            }),
          ]),
        );
        expect(currentFacts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              predicate: "Current Conflict",
              object: "The merchant guild now contests the mentor trail.",
              validFromChapter: 2,
              sourceChapter: 2,
            }),
          ]),
        );
      } finally {
        memoryDb.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  sqliteIt("rebuilds fact history from structured snapshot state instead of stale markdown snapshots", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const snapshotOneDir = join(storyDir, "snapshots", "1");
    const snapshotOneStateDir = join(snapshotOneDir, "state");
    await mkdir(snapshotOneStateDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(snapshotOneDir, "current_state.md"),
        createStateCard({
          chapter: 1,
          location: "Old markdown ferry crossing",
          protagonistState: "Markdown state still hides the oath token.",
          goal: "Follow the markdown trail.",
          conflict: "Old markdown conflict.",
        }),
        "utf-8",
      ),
      writeFile(join(snapshotOneStateDir, "current_state.json"), JSON.stringify({
        chapter: 1,
        facts: [
          {
            subject: "current",
            predicate: "Current Location",
            object: "Structured watchtower",
            validFromChapter: 1,
            validUntilChapter: null,
            sourceChapter: 1,
          },
          {
            subject: "protagonist",
            predicate: "Current Conflict",
            object: "Structured conflict replaces markdown drift.",
            validFromChapter: 1,
            validUntilChapter: null,
            sourceChapter: 1,
          },
        ],
      }, null, 2), "utf-8"),
    ]);

    try {
      await (runner as unknown as {
        syncCurrentStateFactHistory: (targetBookId: string, uptoChapter: number) => Promise<void>;
      }).syncCurrentStateFactHistory(bookId, 1);

      const memoryDb = new MemoryDB(state.bookDir(bookId));
      try {
        expect(memoryDb.getCurrentFacts()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              predicate: "Current Location",
              object: "Structured watchtower",
              validFromChapter: 1,
            }),
            expect.objectContaining({
              predicate: "Current Conflict",
              object: "Structured conflict replaces markdown drift.",
              validFromChapter: 1,
            }),
          ]),
        );
        expect(memoryDb.getCurrentFacts()).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              object: "Old markdown ferry crossing",
            }),
            expect.objectContaining({
              object: "Old markdown conflict.",
            }),
          ]),
        );
      } finally {
        memoryDb.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("tracks imported English chapters using word counts instead of characters", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const englishBook = {
      ...(await state.loadBookConfig(bookId)),
      genre: "other",
      language: "en" as const,
    };
    const now = "2026-03-19T00:00:00.000Z";

    await state.saveBookConfig(bookId, englishBook);
    await state.saveChapterIndex(bookId, [
      {
        number: 1,
        title: "Prelude",
        status: "imported",
        wordCount: 3,
        createdAt: now,
        updatedAt: now,
        auditIssues: [],
        lengthWarnings: [],
      },
      {
        number: 2,
        title: "Crossroads",
        status: "imported",
        wordCount: 2,
        createdAt: now,
        updatedAt: now,
        auditIssues: [],
        lengthWarnings: [],
      },
    ]);

    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockImplementation(async (input) =>
      createAnalyzedOutput({
        chapterNumber: input.chapterNumber,
        title: input.chapterTitle ?? `Chapter ${input.chapterNumber}`,
        content: input.chapterContent,
        wordCount: countChapterLength(input.chapterContent, "en_words"),
      }),
    );
    vi.spyOn(WriterAgent.prototype, "saveChapter").mockResolvedValue(undefined);
    vi.spyOn(WriterAgent.prototype, "saveNewTruthFiles").mockResolvedValue(undefined);

    const result = await runner.importChapters({
      bookId,
      resumeFrom: 3,
      chapters: [
        { title: "Prelude", content: "One two three" },
        { title: "Crossroads", content: "Four five" },
        { title: "The Watchtower", content: "The storm kept rolling west" },
        { title: "Aftermath", content: "Lanterns dimmed before dawn broke" },
      ],
    });

    const chapterIndex = await state.loadChapterIndex(bookId);
    const chapterThree = chapterIndex.find((entry) => entry.number === 3);
    const chapterFour = chapterIndex.find((entry) => entry.number === 4);

    expect(result.importedCount).toBe(2);
    expect(result.totalWords).toBe(10);
    expect(chapterThree?.wordCount).toBe(5);
    expect(chapterFour?.wordCount).toBe(5);

    await rm(root, { recursive: true, force: true });
  });

  it("imports English chapters with English foundation seeds and persistence files", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const englishBook = {
      ...(await state.loadBookConfig(bookId)),
      genre: "other",
      language: "en" as const,
      chapterWordCount: 2200,
    };

    await state.saveBookConfig(bookId, englishBook);

    const foundation = vi.spyOn(ArchitectAgent.prototype, "generateFoundationFromImport").mockResolvedValue({
      storyBible: "# Story Bible\n",
      volumeOutline: "# Volume Outline\n",
      bookRules: "---\nversion: \"1.0\"\n---\n\n# Book Rules\n",
      currentState: createStateCard({
        chapter: 0,
        location: "Harbor gate",
        protagonistState: "Mara arrives with a sealed letter.",
        goal: "Find the missing captain before sunrise.",
        conflict: "The harbor watch is searching every ship.",
      }),
      pendingHooks: "# Pending Hooks\n\n| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | notes |\n| --- | --- | --- | --- | --- | --- | --- |\n",
    });
    const saveChapter = vi.spyOn(WriterAgent.prototype, "saveChapter");

    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        chapterNumber: 1,
        title: "Prelude",
        content: "A cold wind crossed the harbor.",
        wordCount: countChapterLength("A cold wind crossed the harbor.", "en_words"),
        updatedState: createStateCard({
          chapter: 1,
          location: "Harbor gate",
          protagonistState: "Mara hides the sealed letter under her coat.",
          goal: "Slip past the harbor watch.",
          conflict: "The watch now searches for the missing captain's courier.",
        }),
        updatedHooks: "# Pending Hooks\n\n| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | notes |\n| --- | --- | --- | --- | --- | --- | --- |\n| captain-letter | 1 | mystery | open | 1 | The captain's disappearance is explained. | The sealed letter points to the vanished captain. |\n",
        chapterSummary: "| 1 | Prelude | Mara | Mara reaches the harbor with a sealed letter. | Mara hides the letter and studies the watch patrol. | The captain-letter mystery opens. | tense | setup |",
        updatedSubplots: [
          "# Subplot Board",
          "",
          "| Subplot | Status | Note |",
          "| --- | --- | --- |",
          "| Harbor search | Active | Mara begins the search for the missing captain. |",
          "",
        ].join("\n"),
        updatedEmotionalArcs: "",
        updatedCharacterMatrix: "",
      }),
    );

    try {
      await runner.importChapters({
        bookId,
        chapters: [
          { title: "Prelude", content: "A cold wind crossed the harbor." },
        ],
      });

      const storyDir = join(state.bookDir(bookId), "story");
      const chapterPath = join(state.bookDir(bookId), "chapters", "0001_Prelude.md");
      const chapterFile = await readFile(chapterPath, "utf-8");
      const chapterSummaries = await readFile(join(storyDir, "chapter_summaries.md"), "utf-8");
      const subplotBoard = await readFile(join(storyDir, "subplot_board.md"), "utf-8");

      expect(foundation.mock.calls[0]?.[1]).toContain("Chapter 1: Prelude");
      expect(foundation.mock.calls[0]?.[1]).not.toContain("第1章");
      expect(saveChapter.mock.calls[0]?.[3]).toBe("en");
      expect(chapterFile).toContain("# Chapter 1: Prelude");
      expect(chapterSummaries).toContain("# Chapter Summaries");
      expect(chapterSummaries).not.toContain("# 章节摘要");
      expect(subplotBoard).toContain("# Subplot Board");
      expect(subplotBoard).not.toContain("# 支线进度板");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("logs localized replay progress during chapter import", async () => {
    const { logger, infos } = createCaptureLogger();
    const { root, runner, bookId } = await createRunnerFixture({ logger });

    vi.spyOn(ArchitectAgent.prototype, "generateFoundationFromImport").mockResolvedValue({
      storyBible: "# Story Bible\n",
      volumeOutline: "# Volume Outline\n",
      bookRules: "---\nversion: \"1.0\"\n---\n\n# Book Rules\n",
      currentState: createStateCard({
        chapter: 0,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Find the vanished mentor.",
        conflict: "The mentor debt is still personal.",
      }),
      pendingHooks: "# Pending Hooks\n",
    });
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        chapterNumber: 1,
        title: "Prelude",
        content: "章节正文。",
        wordCount: "章节正文。".length,
      }),
    );
    vi.spyOn(WriterAgent.prototype, "saveChapter").mockResolvedValue(undefined);
    vi.spyOn(WriterAgent.prototype, "saveNewTruthFiles").mockResolvedValue(undefined);

    try {
      await runner.importChapters({
        bookId,
        chapters: [
          { title: "第一章", content: "章节正文。" },
        ],
      });

      expect(infos).toEqual(expect.arrayContaining([
        "步骤 1：从 1 章生成基础设定...",
        "基础设定已生成。",
        "步骤 2：从第 1 章开始顺序回放...",
        "分析章节 1/1：第一章...",
        "完成。已导入 1 章，共 5字。下一章：2",
      ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not leak imported future state into early replay chapters", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const englishBook = {
      ...(await state.loadBookConfig(bookId)),
      genre: "other",
      language: "en" as const,
      chapterWordCount: 2200,
    };

    await state.saveBookConfig(bookId, englishBook);
    await mkdir(join(storyDir, "snapshots", "0"), { recursive: true });
    await Promise.all([
      writeFile(join(storyDir, "subplot_board.md"), "# Subplot Board\n\nFUTURE LEAK subplot\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# Emotional Arcs\n\nFUTURE LEAK emotion\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# Character Matrix\n\nFUTURE LEAK matrix\n", "utf-8"),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| Chapter | Title | Characters | Key Events | State Changes | Hook Activity | Mood | Chapter Type |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 99 | Future | Future Cast | FUTURE LEAK event | FUTURE LEAK state | FUTURE LEAK hook | grim | finale |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "snapshots", "0", "current_state.md"),
        createStateCard({
          chapter: 60,
          location: "Chengdu court",
          protagonistState: "FUTURE LEAK snapshot",
          goal: "Secure the western kingdom.",
          conflict: "Late-book imperial rivalry is now fully active.",
        }),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "snapshots", "0", "pending_hooks.md"),
        [
          "# Pending Hooks",
          "",
          "| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| future-hook | 60 | mystery | open | 60 | Future payoff | FUTURE LEAK |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    vi.spyOn(ArchitectAgent.prototype, "generateFoundationFromImport").mockResolvedValue({
      storyBible: "# Story Bible\n",
      volumeOutline: "# Volume Outline\n",
      bookRules: "---\nversion: \"1.0\"\n---\n\n# Book Rules\n",
      currentState: createStateCard({
        chapter: 60,
        location: "Chengdu court",
        protagonistState: "FUTURE LEAK: Liu Bei already holds Yizhou.",
        goal: "Secure the western kingdom.",
        conflict: "Late-book imperial rivalry is now fully active.",
      }),
      pendingHooks: [
        "# Pending Hooks",
        "",
        "| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | notes |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| future-hook | 60 | mystery | open | 60 | Future payoff | FUTURE LEAK |",
        "",
      ].join("\n"),
    });

    let stateSeenByFirstReplay = "";
    let hooksSeenByFirstReplay = "";
    let subplotSeenByFirstReplay = "";
    let emotionalSeenByFirstReplay = "";
    let matrixSeenByFirstReplay = "";
    let summariesSeenByFirstReplay = "";

    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockImplementationOnce(async (input) => {
      stateSeenByFirstReplay = await readFile(join(input.bookDir, "story", "current_state.md"), "utf-8");
      hooksSeenByFirstReplay = await readFile(join(input.bookDir, "story", "pending_hooks.md"), "utf-8");
      subplotSeenByFirstReplay = await readFile(join(input.bookDir, "story", "subplot_board.md"), "utf-8").catch(() => "");
      emotionalSeenByFirstReplay = await readFile(join(input.bookDir, "story", "emotional_arcs.md"), "utf-8").catch(() => "");
      matrixSeenByFirstReplay = await readFile(join(input.bookDir, "story", "character_matrix.md"), "utf-8").catch(() => "");
      summariesSeenByFirstReplay = await readFile(join(input.bookDir, "story", "chapter_summaries.md"), "utf-8").catch(() => "");

      return createAnalyzedOutput({
        chapterNumber: 1,
        title: "Prelude",
        content: "A cold wind crossed the harbor.",
        wordCount: countChapterLength("A cold wind crossed the harbor.", "en_words"),
        updatedState: createStateCard({
          chapter: 1,
          location: "Harbor gate",
          protagonistState: "Mara hides the sealed letter under her coat.",
          goal: "Slip past the harbor watch.",
          conflict: "The watch now searches for the missing captain's courier.",
        }),
        updatedHooks: [
          "# Pending Hooks",
          "",
          "| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| captain-letter | 1 | mystery | open | 1 | The captain's disappearance is explained. | The sealed letter points to the vanished captain. |",
          "",
        ].join("\n"),
      });
    });

    try {
      await runner.importChapters({
        bookId,
        chapters: [
          { title: "Prelude", content: "A cold wind crossed the harbor." },
        ],
      });

      expect(stateSeenByFirstReplay).toContain("| Current Chapter | 0 |");
      expect(stateSeenByFirstReplay).not.toContain("FUTURE LEAK");
      expect(hooksSeenByFirstReplay).toContain("# Pending Hooks");
      expect(hooksSeenByFirstReplay).not.toContain("future-hook");
      expect(hooksSeenByFirstReplay).not.toContain("FUTURE LEAK");
      expect(subplotSeenByFirstReplay).not.toContain("FUTURE LEAK");
      expect(emotionalSeenByFirstReplay).not.toContain("FUTURE LEAK");
      expect(matrixSeenByFirstReplay).not.toContain("FUTURE LEAK");
      expect(summariesSeenByFirstReplay).not.toContain("FUTURE LEAK");

      const snapshotZeroState = await readFile(join(storyDir, "snapshots", "0", "current_state.md"), "utf-8");
      const snapshotZeroHooks = await readFile(join(storyDir, "snapshots", "0", "pending_hooks.md"), "utf-8");
      expect(snapshotZeroState).toContain("| Current Chapter | 0 |");
      expect(snapshotZeroState).not.toContain("FUTURE LEAK");
      expect(snapshotZeroHooks).toContain("# Pending Hooks");
      expect(snapshotZeroHooks).not.toContain("future-hook");
      expect(snapshotZeroHooks).not.toContain("FUTURE LEAK");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  sqliteIt("rebuilds current facts from the revised chapter snapshot", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const chaptersDir = join(state.bookDir(bookId), "chapters");
    const oldState = createStateCard({
      chapter: 1,
      location: "Ashen ferry crossing",
      protagonistState: "Lin Yue still hides the oath token.",
      goal: "Find the vanished mentor.",
      conflict: "The mentor debt is still personal.",
    });
    const revisedState = createStateCard({
      chapter: 1,
      location: "Ashen ferry crossing",
      protagonistState: "Lin Yue no longer hides the oath token.",
      goal: "Confront the vanished mentor.",
      conflict: "The oath token is public now, forcing the confrontation.",
    });

    await Promise.all([
      writeFile(join(chaptersDir, "0001_Test_Chapter.md"), "# 第1章 Test Chapter\n\nOriginal body.", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), oldState, "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
    ]);
    await state.saveChapterIndex(bookId, [{
      number: 1,
      title: "Test Chapter",
      status: "audit-failed",
      wordCount: "Original body.".length,
      createdAt: "2026-03-19T00:00:00.000Z",
      updatedAt: "2026-03-19T00:00:00.000Z",
      auditIssues: [],
      lengthWarnings: [],
    }]);
    await state.snapshotState(bookId, 1);

    vi.spyOn(ContinuityAuditor.prototype, "auditChapter")
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [CRITICAL_ISSUE],
          summary: "needs revision",
        }),
      )
      .mockResolvedValueOnce(
        createAuditResult({
          passed: true,
          issues: [],
          summary: "clean",
        }),
      );
    vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: "Revised body.",
        wordCount: "Revised body.".length,
        updatedState: revisedState,
        updatedHooks: "# Pending Hooks\n",
      }),
    );

    try {
      await runner.reviseDraft(bookId, 1);

      const memoryDb = new MemoryDB(state.bookDir(bookId));
      try {
        expect(memoryDb.getCurrentFacts()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              predicate: "Current Conflict",
              object: "The oath token is public now, forcing the confrontation.",
              validFromChapter: 1,
              sourceChapter: 1,
            }),
          ]),
        );
      } finally {
        memoryDb.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("feeds long-span fatigue warnings back into pipeline audit and drift correction", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const now = "2026-03-19T00:00:00.000Z";

    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 2,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Find the vanished mentor.",
        conflict: "The debt trail keeps narrowing.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# 章节摘要",
          "",
          "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
          "|------|------|----------|----------|----------|----------|----------|----------|",
          "| 1 | 旧路 | 林越 | 进城 | 潜伏开始 | 债印未解 | 克制 | 布局 |",
          "| 2 | 暗巷 | 林越 | 试探 | 目标未变 | 债印未解 | 克制 | 布局 |",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(join(state.bookDir(bookId), "chapters", "0001_旧路.md"), "# 第1章 旧路\n\n城门在晨雾里半开。林越顺着石阶慢慢往里走。巷口那盏灯一直没有灭。", "utf-8"),
      writeFile(join(state.bookDir(bookId), "chapters", "0002_暗巷.md"), "# 第2章 暗巷\n\n午后的风掠过墙头。林越没有回头，只是沿着阴影继续向前。墙后的铃声很轻。", "utf-8"),
    ]);
    await state.saveChapterIndex(bookId, [
      {
        number: 1,
        title: "旧路",
        status: "ready-for-review",
        wordCount: 36,
        createdAt: now,
        updatedAt: now,
        auditIssues: [],
        lengthWarnings: [],
      },
      {
        number: 2,
        title: "暗巷",
        status: "ready-for-review",
        wordCount: 36,
        createdAt: now,
        updatedAt: now,
        auditIssues: [],
        lengthWarnings: [],
      },
    ]);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 3,
        title: "回声",
        content: "夜色慢慢压低了屋檐。林越先停在门外，随后才抬手去碰那道旧债印。风从更深的巷子里吹了出来。",
        wordCount: "夜色慢慢压低了屋檐。林越先停在门外，随后才抬手去碰那道旧债印。风从更深的巷子里吹了出来。".length,
        updatedState: createStateCard({
          chapter: 3,
          location: "Ashen ferry crossing",
          protagonistState: "Lin Yue still hides the oath token.",
          goal: "Find the vanished mentor.",
          conflict: "The debt trail keeps narrowing.",
        }),
        updatedLedger: "",
        updatedHooks: "# Pending Hooks\n",
        chapterSummary: "| 3 | 回声 | 林越 | 继续潜伏 | 目标未变 | 债印未解 | 克制 | 布局 |",
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "ok",
      }),
    );

    try {
      const result = await runner.writeNextChapter(bookId);
      const currentState = await readFile(join(storyDir, "current_state.md"), "utf-8");

      expect(result.auditResult.issues.some((issue) => issue.category === "节奏单调")).toBe(true);
      expect(currentState).toContain("节奏单调");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("defaults manual reviseDraft to spot-fix when mode is omitted", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const chaptersDir = join(state.bookDir(bookId), "chapters");

    await Promise.all([
      writeFile(join(chaptersDir, "0001_Test_Chapter.md"), "# 第1章 Test Chapter\n\nOriginal body.", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 1,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Find the vanished mentor.",
        conflict: "The mentor debt is still personal.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
    ]);
    await state.saveChapterIndex(bookId, [{
      number: 1,
      title: "Test Chapter",
      status: "audit-failed",
      wordCount: "Original body.".length,
      createdAt: "2026-03-19T00:00:00.000Z",
      updatedAt: "2026-03-19T00:00:00.000Z",
      auditIssues: [],
      lengthWarnings: [],
    }]);

    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: false,
        issues: [CRITICAL_ISSUE],
        summary: "needs revision",
      }),
    );
    const reviseChapter = vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: "Spot-fixed body.",
        wordCount: "Spot-fixed body.".length,
        updatedState: createStateCard({
          chapter: 1,
          location: "Ashen ferry crossing",
          protagonistState: "Lin Yue still hides the oath token.",
          goal: "Find the vanished mentor.",
          conflict: "The mentor debt is repaired.",
        }),
        updatedHooks: "# Pending Hooks\n",
      }),
    );

    try {
      await runner.reviseDraft(bookId, 1);

      expect(reviseChapter).toHaveBeenCalledTimes(1);
      expect(reviseChapter.mock.calls[0]?.[4]).toBe("spot-fix");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes governed control inputs into manual revise in v2 mode", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "v2",
    });
    const storyDir = join(state.bookDir(bookId), "story");
    const chaptersDir = join(state.bookDir(bookId), "chapters");
    const originalBody = "林越推门进去，先看见柜台后那盏没关的灯。";

    await Promise.all([
      writeFile(join(storyDir, "current_focus.md"), "# 当前聚焦\n\n## 当前重点\n\n把注意力收回师债主线。\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# 卷纲\n\n## 第1章\n先处理商会路线噪音。\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 1,
        location: "旧港便利店",
        protagonistState: "林越仍在追查师债。",
        goal: "把注意力拉回师债线索。",
        conflict: "商会路线仍在分散注意力。",
      }), "utf-8"),
      writeFile(join(storyDir, "story_bible.md"), "# 世界观设定\n\n- 誓令碎片不可伪造。\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# 伏笔池\n\n- 师债线索仍未回收。\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), [
        "# 章节摘要",
        "",
        "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 1 | 夜灯 | 林越 | 林越继续追查师债 | 追查意图更强 | 师债推进 | 压抑 | 主线推进 |",
        "",
      ].join("\n"), "utf-8"),
      writeFile(join(chaptersDir, "0001_夜灯.md"), `# 第1章 夜灯\n\n${originalBody}`, "utf-8"),
    ]);
    await state.saveChapterIndex(bookId, [{
      number: 1,
      title: "夜灯",
      status: "audit-failed",
      wordCount: originalBody.length,
      createdAt: "2026-03-19T00:00:00.000Z",
      updatedAt: "2026-03-19T00:00:00.000Z",
      auditIssues: [],
      lengthWarnings: [],
    }]);

    const auditChapter = vi.spyOn(ContinuityAuditor.prototype, "auditChapter")
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [CRITICAL_ISSUE],
          summary: "needs revision",
        }),
      )
      .mockResolvedValueOnce(
        createAuditResult({
          passed: true,
          issues: [],
          summary: "clean",
        }),
      );
    const reviseChapter = vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: "林越推门进去，先停在门槛外听了一息，再去看柜台后那盏没关的灯。",
        wordCount: "林越推门进去，先停在门槛外听了一息，再去看柜台后那盏没关的灯。".length,
        fixedIssues: ["- 收紧了主线焦点。"],
        updatedState: createStateCard({
          chapter: 1,
          location: "旧港便利店",
          protagonistState: "林越把注意力重新拉回师债。",
          goal: "继续追查师债。",
          conflict: "商会路线暂时退居背景。",
        }),
        updatedHooks: "# 伏笔池\n\n- 师债线索仍未回收。\n",
      }),
    );

    try {
      await runner.reviseDraft(bookId, 1);

      expect(auditChapter.mock.calls[0]?.[4]).toMatchObject({
        chapterIntent: expect.stringContaining("# Chapter Intent"),
        contextPackage: expect.objectContaining({
          selectedContext: expect.any(Array),
        }),
        ruleStack: expect.objectContaining({
          activeOverrides: expect.any(Array),
        }),
      });
      expect(reviseChapter.mock.calls[0]?.[6]).toMatchObject({
        chapterIntent: expect.stringContaining("# Chapter Intent"),
        contextPackage: expect.objectContaining({
          selectedContext: expect.any(Array),
        }),
        ruleStack: expect.objectContaining({
          activeOverrides: expect.any(Array),
        }),
        lengthSpec: expect.objectContaining({
          target: 3000,
        }),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes merged AI-tell issues into manual revise and rejects no-improvement revisions", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const chaptersDir = join(state.bookDir(bookId), "chapters");
    const originalBody = "林越抬手。林越停步。林越转身。林越侧耳。";

    await Promise.all([
      writeFile(join(chaptersDir, "0001_Test_Chapter.md"), `# 第1章 Test Chapter\n\n${originalBody}`, "utf-8"),
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 1,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Find the vanished mentor.",
        conflict: "The mentor debt is still personal.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
    ]);
    await state.saveChapterIndex(bookId, [{
      number: 1,
      title: "Test Chapter",
      status: "audit-failed",
      wordCount: originalBody.length,
      createdAt: "2026-03-19T00:00:00.000Z",
      updatedAt: "2026-03-19T00:00:00.000Z",
      auditIssues: [],
      lengthWarnings: [],
    }]);

    vi.spyOn(ContinuityAuditor.prototype, "auditChapter")
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [{
            severity: "warning",
            category: "节奏",
            description: "结尾解释略多。",
            suggestion: "压缩一行解释。",
          }],
          summary: "needs revision",
        }),
      )
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [{
            severity: "warning",
            category: "节奏",
            description: "结尾解释略多。",
            suggestion: "压缩一行解释。",
          }],
          summary: "still weak",
        }),
      );
    const reviseChapter = vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: `${originalBody}\n\n修订后收束更利落。`,
        wordCount: `${originalBody}\n\n修订后收束更利落。`.length,
        fixedIssues: ["- 压缩了结尾解释。"],
      }),
    );

    try {
      const result = await runner.reviseDraft(bookId, 1);
      const savedChapter = await readFile(join(chaptersDir, "0001_Test_Chapter.md"), "utf-8");
      const savedIndex = await state.loadChapterIndex(bookId);

      expect(reviseChapter).toHaveBeenCalledTimes(1);
      expect(reviseChapter.mock.calls[0]?.[3]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ category: "节奏" }),
          expect.objectContaining({ category: "列表式结构" }),
        ]),
      );
      expect(result.applied).toBe(false);
      expect(result.status).toBe("unchanged");
      expect(result.skippedReason).toContain("did not improve");
      expect(savedChapter).toContain(originalBody);
      expect(savedChapter).not.toContain("修订后收束更利落");
      expect(savedIndex[0]?.status).toBe("audit-failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists manual revisions only when merged audit improves", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const chaptersDir = join(state.bookDir(bookId), "chapters");
    const originalBody = "林越抬手。林越停步。林越转身。林越侧耳。";
    const revisedBody = "门被风顶开，林越先停在门槛前。\n\n他侧过身，听见墙后那道更轻的呼吸。";

    await Promise.all([
      writeFile(join(chaptersDir, "0001_Test_Chapter.md"), `# 第1章 Test Chapter\n\n${originalBody}`, "utf-8"),
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 1,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Find the vanished mentor.",
        conflict: "The mentor debt is still personal.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
    ]);
    await state.saveChapterIndex(bookId, [{
      number: 1,
      title: "Test Chapter",
      status: "audit-failed",
      wordCount: originalBody.length,
      createdAt: "2026-03-19T00:00:00.000Z",
      updatedAt: "2026-03-19T00:00:00.000Z",
      auditIssues: [],
      lengthWarnings: [],
    }]);

    vi.spyOn(ContinuityAuditor.prototype, "auditChapter")
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [{
            severity: "warning",
            category: "节奏",
            description: "结尾解释略多。",
            suggestion: "压缩一行解释。",
          }],
          summary: "needs revision",
        }),
      )
      .mockResolvedValueOnce(
        createAuditResult({
          passed: true,
          issues: [],
          summary: "clean",
        }),
      );
    vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: revisedBody,
        wordCount: revisedBody.length,
        fixedIssues: ["- 收紧了结尾节奏。"],
        updatedState: createStateCard({
          chapter: 1,
          location: "Ashen ferry crossing",
          protagonistState: "Lin Yue still hides the oath token.",
          goal: "Find the vanished mentor.",
          conflict: "The mentor debt sharpens into a direct threat.",
        }),
        updatedHooks: "# Pending Hooks\n",
      }),
    );

    try {
      const result = await runner.reviseDraft(bookId, 1);
      const savedChapter = await readFile(join(chaptersDir, "0001_Test_Chapter.md"), "utf-8");
      const savedIndex = await state.loadChapterIndex(bookId);

      expect(result.applied).toBe(true);
      expect(result.status).toBe("ready-for-review");
      expect(result.fixedIssues).toEqual(["- 收紧了结尾节奏。"]);
      expect(savedChapter).toContain(revisedBody);
      expect(savedIndex[0]?.status).toBe("ready-for-review");
      expect(savedIndex[0]?.auditIssues).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("re-audits revisions against updated state overrides instead of stale on-disk truth files", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const chaptersDir = join(state.bookDir(bookId), "chapters");
    const originalBody = "Taryn kept one hand on the annexe key and listened at the door.";
    const revisedBody = `${originalBody}\n\nHe checked the seal again before he moved.`;

    await state.saveBookConfig(bookId, {
      ...(await state.loadBookConfig(bookId)),
      platform: "other",
      genre: "progression",
      language: "en",
      chapterWordCount: 1800,
    });

    await Promise.all([
      writeFile(join(chaptersDir, "0001_First.md"), `# Chapter 1: First\n\nOpening chapter.`, "utf-8"),
      writeFile(join(chaptersDir, "0002_Test_Chapter.md"), `# Chapter 2: Test Chapter\n\n${originalBody}`, "utf-8"),
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 1,
        location: "Orsden archive lower hall",
        protagonistState: "Taryn is still moving under Renn's first warning.",
        goal: "Reach the annexe.",
        conflict: "The archive is already compromised.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
    ]);
    await state.saveChapterIndex(bookId, [
      {
        number: 1,
        title: "First",
        status: "ready-for-review",
        wordCount: countChapterLength("Opening chapter.", "en_words"),
        createdAt: "2026-03-19T00:00:00.000Z",
        updatedAt: "2026-03-19T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      },
      {
        number: 2,
        title: "Test Chapter",
        status: "audit-failed",
        wordCount: countChapterLength(originalBody, "en_words"),
        createdAt: "2026-03-19T00:00:00.000Z",
        updatedAt: "2026-03-19T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      },
    ]);

    const auditChapter = vi.spyOn(ContinuityAuditor.prototype, "auditChapter")
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [{
            severity: "warning",
            category: "Pacing Check",
            description: "The beat needs a firmer end stop.",
            suggestion: "Tighten the closing move.",
          }],
          summary: "needs revision",
        }),
      )
      .mockImplementationOnce(async (_bookDir, _chapterContent, chapterNumber, _genre, options) => {
        const overrideState = (options as { truthFileOverrides?: { currentState?: string } } | undefined)
          ?.truthFileOverrides?.currentState;
        if (chapterNumber === 2 && overrideState?.includes("| Current Chapter | 2 |")) {
          return createAuditResult({
            passed: true,
            issues: [],
            summary: "clean",
          });
        }

        return createAuditResult({
          passed: false,
          issues: [{
            severity: "critical",
            category: "Chronicle Drift Check",
            description: "The chapter is presented as 'chapter 2', but the supplied Current State Card still lists 'Current Chapter | 1'.",
            suggestion: "Sync the state card before re-audit.",
          }],
          summary: "stale state card",
        });
      });

    vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: revisedBody,
        wordCount: countChapterLength(revisedBody, "en_words"),
        fixedIssues: ["- Synced the annexe beat and tightened the ending."],
        updatedState: createStateCard({
          chapter: 2,
          location: "East annexe corridor",
          protagonistState: "Taryn is pressed against the annexe door with the true key in hand.",
          goal: "Open the annexe before the cart clears the court.",
          conflict: "A forged key and rival searchers have turned lawful access into a trap.",
        }),
        updatedHooks: "# Pending Hooks\n",
      }),
    );

    try {
      const result = await runner.reviseDraft(bookId, 2);
      const savedIndex = await state.loadChapterIndex(bookId);

      expect(auditChapter).toHaveBeenCalledTimes(2);
      expect(result.applied).toBe(true);
      expect(result.status).toBe("ready-for-review");
      expect(savedIndex[1]?.status).toBe("ready-for-review");
      expect(savedIndex[1]?.auditIssues).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses chapter length telemetry target for manual revise when available", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const chaptersDir = join(state.bookDir(bookId), "chapters");
    const originalBody = "Tarin waited by the crooked berth marker and counted the missing lines twice.";
    const revisedBody = `${originalBody}\n\nHe did not move until the second bell rang across the water.`;

    await state.saveBookConfig(bookId, {
      ...(await state.loadBookConfig(bookId)),
      platform: "other",
      genre: "progression",
      language: "en",
      chapterWordCount: 1800,
    });

    await Promise.all([
      writeFile(join(chaptersDir, "0001_Test_Chapter.md"), `# Chapter 1: Test Chapter\n\n${originalBody}`, "utf-8"),
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 1,
        location: "Dock Nine",
        protagonistState: "Tarin still carries the sealed packet.",
        goal: "Find Captain Voss.",
        conflict: "The berth is wrong and the crew is missing.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
    ]);
    await state.saveChapterIndex(bookId, [{
      number: 1,
      title: "Test Chapter",
      status: "audit-failed",
      wordCount: countChapterLength(originalBody, "en_words"),
      createdAt: "2026-03-19T00:00:00.000Z",
      updatedAt: "2026-03-19T00:00:00.000Z",
      auditIssues: [],
      lengthWarnings: [],
      lengthTelemetry: {
        target: 900,
        softMin: 778,
        softMax: 1022,
        hardMin: 655,
        hardMax: 1145,
        countingMode: "en_words",
        writerCount: countChapterLength(originalBody, "en_words"),
        postWriterNormalizeCount: countChapterLength(originalBody, "en_words"),
        postReviseCount: 0,
        finalCount: countChapterLength(originalBody, "en_words"),
        normalizeApplied: false,
        lengthWarning: false,
      },
    }]);

    vi.spyOn(ContinuityAuditor.prototype, "auditChapter")
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [CRITICAL_ISSUE],
          summary: "needs revision",
        }),
      )
      .mockResolvedValueOnce(
        createAuditResult({
          passed: true,
          issues: [],
          summary: "clean",
        }),
      );

    const reviseChapter = vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: revisedBody,
        wordCount: countChapterLength(revisedBody, "en_words"),
        fixedIssues: ["- Tightened the berth discovery beat."],
        updatedState: createStateCard({
          chapter: 1,
          location: "Dock Nine",
          protagonistState: "Tarin still carries the sealed packet.",
          goal: "Find Captain Voss.",
          conflict: "The berth is wrong and the crew is missing.",
        }),
        updatedHooks: "# Pending Hooks\n",
      }),
    );

    try {
      await runner.reviseDraft(bookId, 1, "polish");

      expect(reviseChapter).toHaveBeenCalledTimes(1);
      expect(reviseChapter.mock.calls[0]?.[6]?.lengthSpec).toMatchObject({
        target: 900,
        countingMode: "en_words",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
