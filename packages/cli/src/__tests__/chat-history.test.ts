/**
 * Tests for ChatHistoryManager.
 */

import { describe, test, expect, beforeEach } from "vitest";
import { ChatHistoryManager } from "../chat/history.js";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

describe("ChatHistoryManager", () => {
  let manager: ChatHistoryManager;
  const testDir = ".test-chat-history";

  beforeEach(async () => {
    // Clean up test directory
    try {
      await rm(testDir, { recursive: true });
    } catch {
      // Ignore if doesn't exist
    }

    manager = new ChatHistoryManager({
      historyDir: testDir,
      maxMessages: 10,
    });
  });

  test("should create empty history for new book", async () => {
    const history = await manager.load("test-book");

    expect(history.bookId).toBe("test-book");
    expect(history.messages).toEqual([]);
    expect(history.metadata.totalMessages).toBe(0);
  });

  test("should save and load history", async () => {
    const history = await manager.load("test-book");

    history.messages.push({
      role: "user",
      content: "Hello",
      timestamp: new Date().toISOString(),
    });

    await manager.save(history);

    const loaded = await manager.load("test-book");
    expect(loaded.messages.length).toBe(1);
    expect(loaded.messages[0]?.content).toBe("Hello");
  });

  test("should atomically replace history files via a temporary file", async () => {
    let history = await manager.load("test-book");

    history = manager.addMessage(history, {
      role: "user",
      content: "Hello",
      timestamp: new Date().toISOString(),
    });

    await manager.save(history);

    await expect(writeFile(join(testDir, "test-book.json.manual.tmp"), "stale-temp", "utf-8")).resolves.toBeUndefined();
    await expect(manager.load("test-book")).resolves.toMatchObject({
      bookId: "test-book",
    });

    const entries = await readdir(testDir);
    expect(entries.filter((entry) => entry.endsWith(".tmp"))).toEqual(["test-book.json.manual.tmp"]);
    await expect(rm(join(testDir, "test-book.json.manual.tmp"))).resolves.toBeUndefined();
  });

  test("should merge messages saved from stale concurrent histories", async () => {
    const baseHistory = await manager.load("test-book");
    const historyA = manager.addMessage(baseHistory, {
      role: "user",
      content: "from-a",
      timestamp: "2026-04-01T00:00:00.000Z",
    });
    const historyB = manager.addMessage(baseHistory, {
      role: "assistant",
      content: "from-b",
      timestamp: "2026-04-01T00:00:01.000Z",
    });

    await manager.save(historyA);
    await manager.save(historyB);

    const loaded = await manager.load("test-book");
    expect(loaded.messages.map((message) => message.content)).toEqual(["from-a", "from-b"]);
  });

  test("should serialize parallel saves across manager instances", async () => {
    const managerA = new ChatHistoryManager({ historyDir: testDir, maxMessages: 10 });
    const managerB = new ChatHistoryManager({ historyDir: testDir, maxMessages: 10 });
    const baseHistory = await managerA.load("test-book");
    const historyA = managerA.addMessage(baseHistory, {
      role: "user",
      content: "parallel-a",
      timestamp: "2026-04-01T00:00:00.000Z",
    });
    const historyB = managerB.addMessage(baseHistory, {
      role: "assistant",
      content: "parallel-b",
      timestamp: "2026-04-01T00:00:01.000Z",
    });

    await expect(Promise.all([managerA.save(historyA), managerB.save(historyB)])).resolves.toHaveLength(2);

    const loaded = await manager.load("test-book");
    expect(loaded.messages.map((message) => message.content)).toEqual(["parallel-a", "parallel-b"]);
  });

  test("should not resurrect pruned messages from stale histories", async () => {
    let currentHistory = await manager.load("test-book");
    for (let i = 0; i < 10; i++) {
      currentHistory = manager.addMessage(currentHistory, {
        role: "user",
        content: `m${i}`,
        timestamp: `2026-04-01T00:00:${String(i).padStart(2, "0")}.000Z`,
      });
    }
    await manager.save(currentHistory);

    const staleHistory = currentHistory;
    const latestHistory = manager.addMessage(currentHistory, {
      role: "assistant",
      content: "m10",
      timestamp: "2026-04-01T00:00:10.000Z",
    });
    await manager.save(latestHistory);

    const staleWithNewMessage = manager.addMessage(staleHistory, {
      role: "assistant",
      content: "stale-new",
      timestamp: "2026-04-01T00:00:11.000Z",
    });
    await manager.save(staleWithNewMessage);

    const loaded = await manager.load("test-book");
    expect(loaded.messages.map((message) => message.content)).toEqual([
      "m2",
      "m3",
      "m4",
      "m5",
      "m6",
      "m7",
      "m8",
      "m9",
      "m10",
      "stale-new",
    ]);
  });

  test("should reject stale saves after history is cleared elsewhere", async () => {
    let history = await manager.load("test-book");
    history = manager.addMessage(history, {
      role: "user",
      content: "before-clear",
      timestamp: "2026-04-01T00:00:00.000Z",
    });
    history = await manager.save(history);

    const staleHistory = manager.addMessage(history, {
      role: "assistant",
      content: "stale-after-clear",
      timestamp: "2026-04-01T00:00:01.000Z",
    });

    const otherManager = new ChatHistoryManager({ historyDir: testDir, maxMessages: 10 });
    await otherManager.clear("test-book");

    await expect(manager.save(staleHistory)).rejects.toThrow(
      'Chat history for "test-book" was cleared in another session. Please retry.'
    );

    const loaded = await manager.load("test-book");
    expect(loaded.messages).toEqual([]);
  });

  test("should prune old messages when over limit", async () => {
    let history = await manager.load("test-book");

    // Add 15 messages (limit is 10)
    for (let i = 0; i < 15; i++) {
      history = manager.addMessage(history, {
        role: "user",
        content: `Message ${i}`,
        timestamp: new Date().toISOString(),
      });
    }

    await manager.save(history);

    const loaded = await manager.load("test-book");
    expect(loaded.messages.length).toBe(10);
    // Should keep most recent messages
    expect(loaded.messages[0]?.content).toBe("Message 5");
    expect(loaded.messages[9]?.content).toBe("Message 14");
  });

  test("should clear history", async () => {
    let history = await manager.load("test-book");

    history = manager.addMessage(history, {
      role: "user",
      content: "Test",
      timestamp: new Date().toISOString(),
    });

    await manager.save(history);
    await manager.clear("test-book");

    const loaded = await manager.load("test-book");
    expect(loaded.messages.length).toBe(0);
  });

  test("should calculate token usage", async () => {
    let history = await manager.load("test-book");

    history = manager.addMessage(history, {
      role: "user",
      content: "Test",
      timestamp: new Date().toISOString(),
      tokenUsage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      },
    });

    await manager.save(history);

    const loaded = await manager.load("test-book");
    expect(loaded.metadata.totalTokens).toBe(30);
  });

  test("should reject malformed history files instead of silently resetting them", async () => {
    await mkdir(testDir, { recursive: true });
    await writeFile(join(testDir, "test-book.json"), "{not-valid-json", "utf-8");

    await expect(manager.load("test-book")).rejects.toThrow(
      'Failed to parse chat history for "test-book"'
    );
  });

  test("should accept book ids across the full CJK unified ideographs range", async () => {
    const history = await manager.load("龦-book");

    expect(history.bookId).toBe("龦-book");
    await expect(manager.save(history)).resolves.toMatchObject({
      bookId: "龦-book",
    });
  });
});
