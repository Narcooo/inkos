import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLLMTranslationModel } from "../translation/llm-model.js";

const chatCompletionMock = vi.hoisted(() => vi.fn());

vi.mock("../llm/provider.js", () => ({
  chatCompletion: chatCompletionMock,
}));

describe("LLM translation model", () => {
  beforeEach(() => {
    chatCompletionMock.mockReset();
  });

  it("injects the translation Skill into translation and review calls", async () => {
    chatCompletionMock
      .mockResolvedValueOnce({
        content: JSON.stringify({ segments: [{ index: 1, target: "The rain fell." }], glossary: [] }),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ passed: true, summary: "Faithful.", issues: [] }),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });
    const model = createLLMTranslationModel({
      client: { provider: "openai" } as never,
      model: "test-model",
      activatedSkills: [{
        skill: {
          id: "inkos-translation",
          name: "Long-form translation",
          description: "Preserve terminology and voice.",
          body: "Treat the glossary as persistent authority.",
          source: "builtin",
        },
        resources: [],
      }],
    });

    const request = {
      sourceLanguage: "中文",
      targetLanguage: "English",
      chapterTitle: "雨夜",
      glossary: [],
      segments: [{ index: 1, source: "雨落下来。" }],
    };
    await model.translateSegments(request);
    await model.reviewChapter?.({
      ...request,
      segments: [{ index: 1, source: "雨落下来。", target: "The rain fell." }],
    });

    expect(chatCompletionMock).toHaveBeenCalledTimes(2);
    for (const call of chatCompletionMock.mock.calls) {
      const messages = call[2] as ReadonlyArray<{ role: string; content: string }>;
      expect(messages[0]?.content).toContain("Activated professional skills");
      expect(messages[0]?.content).toContain("inkos-translation");
      expect(messages[0]?.content).toContain("Treat the glossary as persistent authority.");
    }
  });
});
