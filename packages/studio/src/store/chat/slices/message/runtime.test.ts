import { describe, expect, it } from "vitest";
import { extractErrorMessage, extractToolError } from "./runtime";

describe("chat runtime error copy", () => {
  it("localizes known assistant errors", () => {
    expect(extractErrorMessage({
      message: "Latest chapter 1 is state-degraded. Repair state or rewrite that chapter before continuing.",
    })).toBe("최신 1장이 상태 저하(state-degraded) 상태입니다. 다음 장을 쓰기 전에 상태를 복구하거나 해당 장을 다시 써주세요.");
  });

  it("localizes known tool errors", () => {
    expect(extractToolError({
      content: [
        {
          type: "text",
          text: "Latest chapter 2 is state-degraded. Repair state or rewrite that chapter before continuing.",
        },
      ],
    })).toBe("최신 2장이 상태 저하(state-degraded) 상태입니다. 다음 장을 쓰기 전에 상태를 복구하거나 해당 장을 다시 써주세요.");
  });
});
