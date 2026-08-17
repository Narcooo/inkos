import { describe, expect, it, vi } from "vitest";
import { completeLongForm, mergeExactContinuation } from "../llm/long-form-completion.js";
import { PartialResponseError } from "../llm/provider.js";

describe("long-form completion", () => {
  it("removes only exact repeated overlap", () => {
    expect(mergeExactContinuation("甲\n乙\n丙", "乙\n丙\n丁")).toBe("甲\n乙\n丙\n丁");
    expect(mergeExactContinuation("甲乙", "丙丁")).toBe("甲乙\n丙丁");
  });

  it("does not resume an interrupted transport response", async () => {
    const generate = vi.fn().mockRejectedValue(new PartialResponseError(
      "不完整内容",
      new Error("connection closed"),
    ));

    await expect(completeLongForm({
      messages: [{ role: "user", content: "写完整文档" }],
      generate,
    })).rejects.toThrow("connection closed");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("runs one recovery pass after output-limit continuation fragments are merged", async () => {
    const generate = vi.fn()
      .mockRejectedValueOnce(new PartialResponseError(
        "# 雨夜\n\n## 人物\n店员",
        new Error("model reached the output limit"),
        "output-limit",
      ))
      .mockResolvedValueOnce({
        content: "# 雨夜\n\n## 人物\n店员\n\n## 剧本正文\n完整正文",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });
    const recoverAfterContinuation = vi.fn().mockResolvedValue(
      "# 雨夜\n\n## 人物\n店员\n\n## 剧本正文\n完整正文",
    );

    const result = await completeLongForm({
      messages: [{ role: "user", content: "写完整文档" }],
      generate,
      recoverAfterContinuation,
    });

    expect(recoverAfterContinuation).toHaveBeenCalledTimes(1);
    expect(recoverAfterContinuation.mock.calls[0]?.[0]).toContain("## 剧本正文");
    expect(result.content.match(/^# 雨夜/gmu)).toHaveLength(1);
  });
});
