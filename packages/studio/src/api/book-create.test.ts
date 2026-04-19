import { describe, expect, it, vi } from "vitest";
import { buildStudioBookConfig, normalizeStudioPlatform, waitForStudioBookReady } from "./book-create";

describe("normalizeStudioPlatform", () => {
  it("keeps supported chinese platform ids and folds unsupported values to other", () => {
    expect(normalizeStudioPlatform("tomato")).toBe("tomato");
    expect(normalizeStudioPlatform("qidian")).toBe("qidian");
    expect(normalizeStudioPlatform("feilu")).toBe("feilu");
    expect(normalizeStudioPlatform("royal-road")).toBe("other");
    expect(normalizeStudioPlatform(undefined)).toBe("other");
  });
});

describe("buildStudioBookConfig", () => {
  it("preserves supported platform selections from studio create requests", () => {
    const config = buildStudioBookConfig(
      {
        title: "测试书",
        genre: "xuanhuan",
        platform: "qidian",
        language: "zh",
        chapterWordCount: 2500,
        targetChapters: 120,
      },
      "2026-03-30T00:00:00.000Z",
    );

    expect(config).toMatchObject({
      title: "测试书",
      genre: "xuanhuan",
      platform: "qidian",
      language: "zh",
      chapterWordCount: 2500,
      targetChapters: 120,
    });
  });

  it("normalizes unsupported platform ids to other for storage", () => {
    const config = buildStudioBookConfig(
      {
        title: "English Book",
        genre: "other",
        platform: "royal-road",
        language: "en",
      },
      "2026-03-30T00:00:00.000Z",
    );

    expect(config.platform).toBe("other");
    expect(config.language).toBe("en");
    expect(config.id).toBe("english-book");
  });
});

describe("waitForStudioBookReady", () => {
  it("retries until the created book becomes readable", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Book not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        book: { id: "new-book" },
        chapters: [],
        nextChapter: 1,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    const wait = vi.fn(async () => {});

    const result = await waitForStudioBookReady("new-book", {
      fetchImpl,
      wait,
      maxAttempts: 2,
      retryDelayMs: 1,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      book: { id: "new-book" },
      nextChapter: 1,
    });
  });

  it("throws a clear error when the book never becomes readable", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "Book not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(waitForStudioBookReady("missing-book", {
      fetchImpl,
      wait: async () => {},
      maxAttempts: 2,
      retryDelayMs: 1,
    })).rejects.toThrow('Book "missing-book" was not ready after 2 attempts.');
  });
});
