import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { runShortFictionProductionMock } = vi.hoisted(() => ({
  runShortFictionProductionMock: vi.fn(async (_options: Record<string, unknown>) => ({
    storyId: "length-check",
    outlinePath: "shorts/length-check/outline/v002.md",
    outlineReviewPath: "shorts/length-check/reviews/outline-v001.md",
    draftReviewPath: "shorts/length-check/reviews/draft-v001.md",
    finalMarkdownPath: "shorts/length-check/final/story.md",
    finalJsonPath: "shorts/length-check/final/story.json",
    salesPackagePath: "shorts/length-check/final/sales.md",
    coverPromptPath: "shorts/length-check/final/cover-prompt.md",
    coverImagePath: "shorts/length-check/final/cover.png",
  })),
}));

vi.mock("../pipeline/short-fiction-runner.js", async () => {
  const actual = await vi.importActual<any>("../pipeline/short-fiction-runner.js");
  return { ...actual, runShortFictionProduction: runShortFictionProductionMock };
});

import { ShortRunActionPayloadSchema, normalizeActionPayload } from "../interaction/action-envelope.js";
import { createProposeActionTool, createShortFictionRunTool } from "../agent/agent-tools.js";

function createPipelineStub() {
  return {
    createAgentContext: vi.fn(() => ({})),
    runWithAgentContext: vi.fn(async (_context: unknown, task: () => Promise<unknown>) => task()),
  };
}

describe("short_run charsPerChapter validation (envelope layer)", () => {
  it("rejects an English charsPerChapter in the zh char range (en+1100)", () => {
    const parsed = ShortRunActionPayloadSchema.safeParse({
      direction: "an office suspense story",
      language: "en",
      charsPerChapter: 1100,
    });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(!parsed.success ? parsed.error.issues : [])).toMatch(/600-800/);
  });

  it("rejects a Chinese charsPerChapter in the en word range (zh+650)", () => {
    const parsed = ShortRunActionPayloadSchema.safeParse({
      direction: "女频短篇 婚姻背叛 证据反杀",
      language: "zh",
      charsPerChapter: 650,
    });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(!parsed.success ? parsed.error.issues : [])).toMatch(/900-1200/);
  });

  it("accepts en+700 and zh+1000", () => {
    expect(ShortRunActionPayloadSchema.safeParse({
      direction: "an office suspense story",
      language: "en",
      charsPerChapter: 700,
    }).success).toBe(true);
    expect(ShortRunActionPayloadSchema.safeParse({
      direction: "女频短篇 婚姻背叛 证据反杀",
      language: "zh",
      charsPerChapter: 1000,
    }).success).toBe(true);
  });

  it("keeps the 600-1200 union when language is omitted (session default decides later)", () => {
    expect(ShortRunActionPayloadSchema.safeParse({
      direction: "a short story",
      charsPerChapter: 900,
    }).success).toBe(true);
  });

  it("surfaces the language-specific range through normalizeActionPayload", () => {
    expect(() => normalizeActionPayload({
      shortRun: {
        direction: "an office suspense story",
        language: "en",
        charsPerChapter: 1100,
      },
    })).toThrow(/600-800/);
  });
});

describe("short_run charsPerChapter validation (propose_action)", () => {
  it("rejects en+1100 when the model proposes the confirmation card", async () => {
    await expect(createProposeActionTool("zh").execute("propose-short-en-1100", {
      action: "short_run",
      instruction: "用户要求写一篇英文短篇，每章 1100",
      shortRun: {
        direction: "an English office suspense story",
        language: "en",
        chapters: 12,
        charsPerChapter: 1100,
        cover: false,
      },
    } as never)).rejects.toThrow(/600-800/);
  });
});

describe("short_run charsPerChapter validation (tool layer, before pipeline start)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-short-length-"));
    runShortFictionProductionMock.mockClear();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("throws before starting the pipeline when a zh session confirms en+1100", async () => {
    const pipeline = createPipelineStub();
    const tool = createShortFictionRunTool(pipeline as never, root, {
      language: "zh",
      actionPayload: {
        shortRun: {
          direction: "an English office suspense story",
          language: "en",
          charsPerChapter: 1100,
          cover: false,
        },
      } as never,
    });

    await expect(tool.execute("short-en-1100", { direction: "fallback direction" } as never))
      .rejects.toThrow(/600-800/);
    expect(runShortFictionProductionMock).not.toHaveBeenCalled();
  });

  it("throws before starting the pipeline when an en session passes a zh-range params value", async () => {
    const pipeline = createPipelineStub();
    const tool = createShortFictionRunTool(pipeline as never, root, { language: "en" });

    await expect(tool.execute("short-en-params-1100", {
      direction: "office revenge thriller",
      charsPerChapter: 1100,
    } as never)).rejects.toThrow(/600-800/);
    expect(runShortFictionProductionMock).not.toHaveBeenCalled();
  });

  it("keeps the en no-length behavior: runner receives undefined and applies its own 650 default", async () => {
    const pipeline = createPipelineStub();
    const tool = createShortFictionRunTool(pipeline as never, root, {
      language: "zh",
      actionPayload: {
        shortRun: {
          direction: "an English office suspense story",
          language: "en",
          cover: false,
        },
      } as never,
    });

    await tool.execute("short-en-no-length", { direction: "fallback direction" } as never);

    expect(runShortFictionProductionMock).toHaveBeenCalledTimes(1);
    const runnerOptions = runShortFictionProductionMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(runnerOptions.language).toBe("en");
    expect(runnerOptions.charsPerChapter).toBeUndefined();
  });
});
