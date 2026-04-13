import { describe, expect, it } from "vitest";
import type { InteractionSession } from "@actalk/inkos-core";
import {
  appendStreamingAssistantChunk,
  createOptimisticUserMessageSession,
} from "../tui/chat-draft.js";

function createSession(): InteractionSession {
  return {
    sessionId: "session-1",
    projectRoot: "/tmp/inkos-demo",
    activeBookId: "harbor",
    automationMode: "semi",
    messages: [],
    events: [],
    draftRounds: [],
  };
}

describe("tui chat draft", () => {
  it("optimistically appends the user message before the model returns", () => {
    const next = createOptimisticUserMessageSession(createSession(), "continue current book", 100);
    expect(next.messages).toEqual([
      {
        role: "user",
        content: "continue current book",
        timestamp: 100,
      },
    ]);
  });

  it("creates and extends a streaming assistant draft message", () => {
    const afterUser = createOptimisticUserMessageSession(createSession(), "hi", 100);
    const afterFirstChunk = appendStreamingAssistantChunk(afterUser, "hello", 101);
    expect(afterFirstChunk.messages.at(-1)).toEqual({
      role: "assistant",
      content: "hello",
      timestamp: 101,
    });

    const afterSecondChunk = appendStreamingAssistantChunk(afterFirstChunk, " world", 101);
    expect(afterSecondChunk.messages.at(-1)?.content).toBe("hello world");
  });
});
