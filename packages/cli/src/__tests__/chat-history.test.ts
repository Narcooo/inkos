/**
 * Tests for ChatHistoryManager.
 */

import { describe, test, expect, beforeEach } from "vitest";
import { ChatHistoryManager } from "../chat/history.js";
import { mkdir, rm, writeFile } from "node:fs/promises";
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
});
