import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReviserAgent } from "../agents/reviser.js";
import { buildLengthSpec } from "../utils/length-metrics.js";
import type { AuditIssue } from "../agents/continuity.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

const CRITICAL_ISSUE: AuditIssue = {
  severity: "critical",
  category: "continuity",
  description: "Fix the broken continuity",
  suggestion: "Repair the contradiction",
};

describe("ReviserAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tells the model to preserve the target range when a length spec is provided", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-reviser-test-"));
    const bookDir = join(root, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });

    const agent = new ReviserAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(ReviserAgent.prototype as never, "chat" as never).mockResolvedValue({
      content: [
        "=== FIXED_ISSUES ===",
        "- repaired",
        "",
        "=== REVISED_CONTENT ===",
        "修订后的正文。",
        "",
        "=== UPDATED_STATE ===",
        "状态卡",
        "",
        "=== UPDATED_HOOKS ===",
        "伏笔池",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    try {
      await agent.reviseChapter(
        bookDir,
        "原始正文。",
        1,
        [CRITICAL_ISSUE],
        "spot-fix",
        "xuanhuan",
        {
          lengthSpec: buildLengthSpec(220, "zh"),
        },
      );

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const systemPrompt = messages?.[0]?.content ?? "";
      const userPrompt = messages?.[1]?.content ?? "";

      expect(systemPrompt).toContain("保持章节字数在目标区间内");
      expect(userPrompt).toContain("目标字数：220");
      expect(userPrompt).toContain("允许区间：190-250");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
