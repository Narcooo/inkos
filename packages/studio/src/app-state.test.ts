import { describe, expect, it } from "vitest";
import { DEFAULT_CHAT_OPEN } from "./app-state";

describe("app shell state", () => {
  it("opens the chat panel by default", () => {
    expect(DEFAULT_CHAT_OPEN).toBe(true);
  });
});
