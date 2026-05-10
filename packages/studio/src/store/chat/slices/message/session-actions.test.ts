import { describe, expect, it, vi } from "vitest";
import {
  createDraftSessionId,
  removeSessionFromBookIndexes,
  resolveActiveSessionAfterDelete,
} from "./session-actions";

describe("message session action helpers", () => {
  it("creates draft session ids with timestamp prefix and random suffix", () => {
    vi.spyOn(Date, "now").mockReturnValue(123_456);
    vi.spyOn(Math, "random").mockReturnValue(0.123456);

    expect(createDraftSessionId()).toMatch(/^123456-[a-z0-9]+$/);

    vi.restoreAllMocks();
  });

  it("removes a session id from every book index", () => {
    expect(removeSessionFromBookIndexes({
      bookA: ["s1", "s2"],
      bookB: ["s2", "s3"],
      __null__: ["s4"],
    }, "s2")).toEqual({
      bookA: ["s1"],
      bookB: ["s3"],
      __null__: ["s4"],
    });
  });

  it("keeps active session when deleting an inactive session", () => {
    expect(resolveActiveSessionAfterDelete({
      activeSessionId: "s1",
      deletedSessionBookId: "bookA",
      deletedSessionId: "s2",
      sessionIdsByBook: { bookA: ["s3"] },
    })).toBe("s1");
  });

  it("falls back to the first session in the deleted session book", () => {
    expect(resolveActiveSessionAfterDelete({
      activeSessionId: "s2",
      deletedSessionBookId: "bookA",
      deletedSessionId: "s2",
      sessionIdsByBook: { bookA: ["s3", "s4"] },
    })).toBe("s3");
  });

  it("returns null when deleting the active session with no fallback", () => {
    expect(resolveActiveSessionAfterDelete({
      activeSessionId: "s2",
      deletedSessionBookId: null,
      deletedSessionId: "s2",
      sessionIdsByBook: { __null__: [] },
    })).toBeNull();
  });
});
