import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BookConfig } from "../models/book.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

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

interface FakeStore {
  facts: Array<{
    id: number;
    subject: string;
    predicate: string;
    object: string;
    validFromChapter: number;
    validUntilChapter: number | null;
    sourceChapter: number;
  }>;
  summaries: Array<{
    chapter: number;
    title: string;
    characters: string;
    events: string;
    stateChanges: string;
    hookActivity: string;
    mood: string;
    chapterType: string;
  }>;
  hooks: Array<{
    hookId: string;
    startChapter: number;
    type: string;
    status: string;
    lastAdvancedChapter: number;
    expectedPayoff: string;
    notes: string;
  }>;
  nextFactId: number;
}

class FakeMemoryDB {
  static stores = new Map<string, FakeStore>();

  private readonly store: FakeStore;

  constructor(private readonly bookDir: string) {
    const existing = FakeMemoryDB.stores.get(bookDir);
    if (existing) {
      this.store = existing;
      return;
    }

    const created: FakeStore = {
      facts: [],
      summaries: [],
      hooks: [],
      nextFactId: 1,
    };
    FakeMemoryDB.stores.set(bookDir, created);
    this.store = created;
  }

  close(): void {}

  replaceSummaries(summaries: FakeStore["summaries"]): void {
    this.store.summaries = summaries.map((summary) => ({ ...summary }));
  }

  replaceHooks(hooks: FakeStore["hooks"]): void {
    this.store.hooks = hooks.map((hook) => ({ ...hook }));
  }

  resetFacts(): void {
    this.store.facts = [];
    this.store.nextFactId = 1;
  }

  addFact(fact: Omit<FakeStore["facts"][number], "id">): number {
    const id = this.store.nextFactId++;
    this.store.facts.push({ id, ...fact });
    return id;
  }

  invalidateFact(id: number, untilChapter: number): void {
    const index = this.store.facts.findIndex((fact) => fact.id === id);
    if (index >= 0) {
      this.store.facts[index] = {
        ...this.store.facts[index]!,
        validUntilChapter: untilChapter,
      };
    }
  }
}

describe("PipelineRunner structured-state memory sync", () => {
  let root = "";

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("../state/memory-db.js");
    FakeMemoryDB.stores.clear();
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("uses structured runtime state for narrative memory during writeNextChapter even when markdown projections drift after persistence", async () => {
    vi.doMock("../state/memory-db.js", () => ({
      MemoryDB: FakeMemoryDB,
    }));

    const { PipelineRunner } = await import("../pipeline/runner.js");
    const { StateManager } = await import("../state/manager.js");
    const { WriterAgent } = await import("../agents/writer.js");
    const { ContinuityAuditor } = await import("../agents/continuity.js");

    root = await mkdtemp(join(tmpdir(), "inkos-runner-memory-sync-"));
    const state = new StateManager(root);
    const bookId = "memory-sync-book";
    const now = "2026-03-25T00:00:00.000Z";
    const book: BookConfig = {
      id: bookId,
      title: "Memory Sync Book",
      platform: "tomato",
      genre: "xuanhuan",
      status: "active",
      language: "en",
      targetChapters: 10,
      chapterWordCount: 10,
      createdAt: now,
      updatedAt: now,
    };

    await state.saveBookConfig(bookId, book);
    const bookDir = state.bookDir(bookId);
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 0,
        location: "Shrine outskirts",
        protagonistState: "Lin Yue begins with the oath token hidden.",
        goal: "Reach the trial city.",
        conflict: "The trial deadline is closing in.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
    ]);

    const runner = new PipelineRunner({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0,
          maxTokensCap: null,
        },
      } as ConstructorParameters<typeof PipelineRunner>[0]["client"],
      model: "test-model",
      projectRoot: root,
      inputGovernanceMode: "legacy",
    });

    const originalSaveChapter = WriterAgent.prototype.saveChapter;
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue({
      chapterNumber: 1,
      title: "Structured Chapter",
      content: "Lin Yue follows the debt into the watchtower archive.",
      wordCount: 9,
      preWriteCheck: "check",
      postSettlement: "settled",
      updatedState: "unused legacy state",
      updatedLedger: "unused legacy ledger",
      updatedHooks: "unused legacy hooks",
      chapterSummary: "| 1 | unused summary |",
      updatedSubplots: "",
      updatedEmotionalArcs: "",
      updatedCharacterMatrix: "",
      postWriteErrors: [],
      postWriteWarnings: [],
      tokenUsage: ZERO_USAGE,
      runtimeStateDelta: {
        chapter: 1,
        currentStatePatch: {
          currentGoal: "Trace the debt through the watchtower archive.",
          currentConflict: "Guild pressure keeps colliding with the debt trail.",
        },
        hookOps: {
          upsert: [
            {
              hookId: "structured-hook",
              startChapter: 1,
              type: "relationship",
              status: "open",
              lastAdvancedChapter: 1,
              expectedPayoff: "Reveal why the mentor vanished.",
              notes: "Structured hook should win.",
            },
          ],
          mention: [],
          resolve: [],
          defer: [],
        },
        chapterSummary: {
          chapter: 1,
          title: "Structured Summary",
          characters: "Lin Yue",
          events: "Lin Yue follows the debt into the watchtower archive.",
          stateChanges: "The debt trail sharpens.",
          hookActivity: "structured-hook advanced",
          mood: "tense",
          chapterType: "investigation",
        },
        subplotOps: [],
        emotionalArcOps: [],
        characterMatrixOps: [],
        notes: [],
      },
    });
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue({
      passed: true,
      issues: [],
      summary: "clean",
      tokenUsage: ZERO_USAGE,
    });
    vi.spyOn(WriterAgent.prototype, "saveChapter").mockImplementation(async function (
      this: InstanceType<typeof WriterAgent>,
      bookDirArg,
      output,
      numericalSystem,
      language,
    ) {
      await originalSaveChapter.call(this, bookDirArg, output, numericalSystem, language);
      await Promise.all([
        writeFile(
          join(bookDirArg, "story", "pending_hooks.md"),
          [
            "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
            "| --- | --- | --- | --- | --- | --- | --- |",
            "| markdown-drift-hook | 1 | mystery | open | 1 | 5 | Drifted markdown hook |",
            "",
          ].join("\n"),
          "utf-8",
        ),
        writeFile(
          join(bookDirArg, "story", "chapter_summaries.md"),
          [
            "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
            "| 1 | Markdown Drift Summary | Lin Yue | Drifted markdown event | Drifted markdown state | markdown-drift-hook advanced | flat | fallback |",
            "",
          ].join("\n"),
          "utf-8",
        ),
      ]);
    });

    await runner.writeNextChapter(bookId);

    const narrativeStore = FakeMemoryDB.stores.get(bookDir);
    expect(await readFile(join(storyDir, "pending_hooks.md"), "utf-8")).toContain("markdown-drift-hook");
    expect(await readFile(join(storyDir, "chapter_summaries.md"), "utf-8")).toContain("Markdown Drift Summary");
    expect(narrativeStore?.hooks).toEqual([
      expect.objectContaining({
        hookId: "structured-hook",
        notes: "Structured hook should win.",
      }),
    ]);
    expect(narrativeStore?.summaries).toEqual([
      expect.objectContaining({
        chapter: 1,
        title: "Structured Summary",
        events: "Lin Yue follows the debt into the watchtower archive.",
      }),
    ]);
  });
});
