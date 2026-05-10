import { describe, expect, it } from "vitest";
import { formatRelativeTime, getSessionLabel } from "./session-helpers";

describe("sidebar session helpers", () => {
  it("uses explicit session title first", () => {
    expect(getSessionLabel({
      sessionId: "1-a",
      title: "第一个方案",
      messages: [{ role: "user", content: "ignored" }],
    })).toBe("第一个方案");
  });

  it("falls back to the first user message and trims long labels", () => {
    expect(getSessionLabel({
      sessionId: "1-a",
      title: null,
      messages: [{ role: "user", content: "  这是一段很长很长很长很长很长的需求，需要继续扩展  " }],
    })).toBe("这是一段很长很长很长很长很长的需求，需要…");
  });

  it("uses a new-session label when no title or user message exists", () => {
    expect(getSessionLabel({ sessionId: "1-a", title: null, messages: [] })).toBe("新会话");
  });

  it("formats relative session age from the id timestamp", () => {
    const now = 1_700_000_000_000;
    expect(formatRelativeTime(`${now}-abc`, now)).toBe("刚刚");
    expect(formatRelativeTime(`${now - 15 * 60_000}-abc`, now)).toBe("15 分钟");
    expect(formatRelativeTime(`${now - 3 * 60 * 60_000}-abc`, now)).toBe("3 小时");
    expect(formatRelativeTime(`${now - 5 * 24 * 60 * 60_000}-abc`, now)).toBe("5 天");
  });
});
