import { describe, expect, it } from "vitest";
import {
  buildInputHistory,
  moveHistoryCursor,
  type InputHistoryState,
} from "../tui/input-history.js";

describe("tui input history", () => {
  it("builds unique history from user messages only", () => {
    const history = buildInputHistory([
      { role: "user", content: "first", timestamp: 1 },
      { role: "assistant", content: "reply", timestamp: 2 },
      { role: "user", content: "second", timestamp: 3 },
      { role: "user", content: "second", timestamp: 4 },
      { role: "user", content: "third", timestamp: 5 },
    ]);

    expect(history).toEqual(["first", "second", "third"]);
  });

  it("moves up through history and restores draft when moving back down", () => {
    const entries = ["first", "second", "third"];
    const initial: InputHistoryState = { cursor: null, draft: "" };

    const firstUp = moveHistoryCursor(entries, initial, "drafting", "up");
    expect(firstUp.value).toBe("third");
    expect(firstUp.state).toEqual({ cursor: 2, draft: "drafting" });

    const secondUp = moveHistoryCursor(entries, firstUp.state, firstUp.value, "up");
    expect(secondUp.value).toBe("second");
    expect(secondUp.state.cursor).toBe(1);

    const down = moveHistoryCursor(entries, secondUp.state, secondUp.value, "down");
    expect(down.value).toBe("third");

    const finalDown = moveHistoryCursor(entries, down.state, down.value, "down");
    expect(finalDown.value).toBe("drafting");
    expect(finalDown.state.cursor).toBeNull();
  });
});
