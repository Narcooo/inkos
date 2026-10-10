import { describe, expect, it, vi } from "vitest";
import { FanficCanonImporter } from "../agents/fanfic-canon-importer.js";
import type { LLMClient } from "../llm/provider.js";

const TEST_CLIENT: LLMClient = {
  provider: "openai",
  apiFormat: "chat",
  stream: false,
  _piModel: { contextWindow: 21_280 },
} as unknown as LLMClient;

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

describe("FanficCanonImporter", () => {
  it("retains the complete original source without a model call when it fits", async () => {
    const agent = new FanficCanonImporter({client: TEST_CLIENT, model: "test-model", projectRoot: process.cwd()});
    const chat = vi.spyOn(agent as unknown as {chat: (...args: unknown[]) => Promise<unknown>}, "chat");
    const submit = vi.spyOn(agent as unknown as {submitStructured: (...args: unknown[]) => Promise<unknown>}, "submitStructured");
    const source = "# Arrival\n\nEli is the curator. She keeps Nora's blue notebook.\n\n# Departure\n\nNora asks Eli to return it.\n";
    const result = await agent.importFromText(source, "Gallery", "canon", "en");
    expect(result.fullDocument.endsWith(source)).toBe(true);
    expect(chat).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("semantically compiles long source chunks instead of truncating the tail", async () => {
    const agent = new FanficCanonImporter({
      client: TEST_CLIENT,
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const chatSpy = vi.spyOn(
      agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> },
      "chat",
    )
      .mockResolvedValueOnce({
        content: "片段1资料：主角甲第一次登场。",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "片段2资料：TAIL_CANON_MARKER 是尾部关键正典。",
        usage: ZERO_USAGE,
      });
    const submitSpy = vi.spyOn(
      agent as unknown as { submitStructured: (...args: unknown[]) => Promise<unknown> },
      "submitStructured",
    ).mockResolvedValue({
      result: {
        canonMarkdown: "## 关键事实\n\nTAIL_CANON_MARKER 是尾部关键正典。",
      },
      usage: ZERO_USAGE,
    });

    const source = `${"前段".repeat(600)}TAIL_CANON_MARKER`;
    const result = await agent.importFromText(source, "长原作", "canon");

    expect(chatSpy).toHaveBeenCalledTimes(2);
    expect(chatSpy.mock.calls.map(call=>call[1])).toEqual([{professionalGuidance:false},{professionalGuidance:false}]);
    expect(submitSpy.mock.calls[0]?.[2]).toEqual({professionalGuidance:false});
    const secondChunkMessages = chatSpy.mock.calls[1]?.[0] as Array<{ role: string; content: string }>;
    expect(secondChunkMessages[1]?.content).toContain("TAIL_CANON_MARKER");
    const finalMessages = submitSpy.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(finalMessages[1]?.content).toContain("片段2资料：TAIL_CANON_MARKER");
    expect(finalMessages[0]?.content).not.toContain("已截断");
    expect(result.fullDocument).toContain("TAIL_CANON_MARKER");
    expect(result.fullDocument).not.toContain("力量体系");
  });
});
