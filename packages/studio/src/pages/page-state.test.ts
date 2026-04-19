import { describe, expect, it } from "vitest";
import {
  buildCreationDraftSummary,
  canCreateFromDraft,
  defaultChapterWordsForLanguage,
  platformOptionsForLanguage,
  pickValidValue,
  resolveDraftInstruction,
  waitForBookReady,
} from "./BookCreate";

describe("pickValidValue", () => {
  it("keeps the current value when it is still available", () => {
    expect(pickValidValue("mystery", ["mystery", "romance"])).toBe("mystery");
  });

  it("falls back to the first available value when current is blank or invalid", () => {
    expect(pickValidValue("", ["mystery", "romance"])).toBe("mystery");
    expect(pickValidValue("invalid", ["mystery", "romance"])).toBe("mystery");
    expect(pickValidValue("", [])).toBe("");
  });
});

describe("defaultChapterWordsForLanguage", () => {
  it("uses 3000 for chinese projects and 2000 for english projects", () => {
    expect(defaultChapterWordsForLanguage("zh")).toBe("3000");
    expect(defaultChapterWordsForLanguage("en")).toBe("2000");
  });
});

describe("platformOptionsForLanguage", () => {
  it("uses stable, unique values for english platform choices", () => {
    const values = platformOptionsForLanguage("en").map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toEqual(["royal-road", "kindle-unlimited", "scribble-hub", "other"]);
  });
});

describe("waitForBookReady", () => {
  it("retries until the created book becomes readable", async () => {
    let attempts = 0;

    await expect(waitForBookReady("fresh-book", {
      fetchBook: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("Book not found");
        }
      },
      fetchStatus: async () => ({ status: "creating" }),
      delayMs: 0,
      waitImpl: async () => undefined,
    })).resolves.toBeUndefined();

    expect(attempts).toBe(3);
  });

  it("keeps polling while the server still reports the book as creating", async () => {
    let attempts = 0;

    await expect(waitForBookReady("slow-book", {
      fetchBook: async () => {
        attempts += 1;
        if (attempts < 25) {
          throw new Error("Book not found");
        }
      },
      fetchStatus: async () => ({ status: "creating" }),
      delayMs: 0,
      waitImpl: async () => undefined,
    })).resolves.toBeUndefined();

    expect(attempts).toBe(25);
  });

  it("surfaces a clear timeout when the book is still being created", async () => {
    await expect(waitForBookReady("missing-book", {
      fetchBook: async () => {
        throw new Error("Book not found");
      },
      fetchStatus: async () => ({ status: "creating" }),
      maxAttempts: 2,
      delayMs: 0,
      waitImpl: async () => undefined,
    })).rejects.toThrow('Book "missing-book" is still being created. Wait a moment and refresh.');
  });

  it("prefers the server-reported create failure over a polling timeout", async () => {
    await expect(waitForBookReady("broken-book", {
      fetchBook: async () => {
        throw new Error("Book not found");
      },
      fetchStatus: async () => ({ status: "error", error: "INKOS_LLM_API_KEY not set" }),
      delayMs: 0,
      waitImpl: async () => undefined,
    })).rejects.toThrow("INKOS_LLM_API_KEY not set");
  });
});

describe("resolveDraftInstruction", () => {
  it("forces the first ideation turn through /new so an active book does not hijack the flow", () => {
    expect(resolveDraftInstruction("我想写个港风商战悬疑", false)).toBe("/new 我想写个港风商战悬疑");
    expect(resolveDraftInstruction("把世界观改成近未来港口城", true)).toBe("把世界观改成近未来港口城");
  });
});

describe("canCreateFromDraft", () => {
  it("accepts drafts explicitly marked ready", () => {
    expect(canCreateFromDraft({
      concept: "港风商战悬疑",
      readyToCreate: true,
      missingFields: [],
    })).toBe(true);
  });

  it("accepts drafts that already have the minimum creation fields", () => {
    expect(canCreateFromDraft({
      concept: "港风商战悬疑",
      title: "夜港账本",
      genre: "urban",
      targetChapters: 120,
      chapterWordCount: 2800,
      readyToCreate: false,
      missingFields: [],
    })).toBe(true);
  });

  it("rejects incomplete drafts", () => {
    expect(canCreateFromDraft({
      concept: "港风商战悬疑",
      title: "夜港账本",
      readyToCreate: false,
      missingFields: ["genre", "targetChapters"],
    })).toBe(false);
  });
});

describe("buildCreationDraftSummary", () => {
  it("surfaces the shared foundation draft in a user-facing order", () => {
    expect(buildCreationDraftSummary({
      concept: "港风商战悬疑，主角从灰产洗白。",
      title: "夜港账本",
      worldPremise: "近未来港口城，账本牵出多方势力。",
      protagonist: "林砚，水货账房出身，擅长记账和看人。",
      conflictCore: "洗白与旧债回潮的对撞。",
      volumeOutline: "卷一先查账，再暴露港口旧案。",
      blurb: "一个做灰产生意的人，准备在夜港洗白，却先被旧账拖回去。",
      nextQuestion: "卷一先查账还是先砸场？",
      missingFields: ["targetChapters"],
      readyToCreate: false,
    }, "zh")).toEqual([
      { key: "title", label: "书名", value: "夜港账本" },
      { key: "worldPremise", label: "世界观", value: "近未来港口城，账本牵出多方势力。" },
      { key: "protagonist", label: "主角", value: "林砚，水货账房出身，擅长记账和看人。" },
      { key: "conflictCore", label: "核心冲突", value: "洗白与旧债回潮的对撞。" },
      { key: "volumeOutline", label: "卷纲方向", value: "卷一先查账，再暴露港口旧案。" },
      { key: "blurb", label: "简介", value: "一个做灰产生意的人，准备在夜港洗白，却先被旧账拖回去。" },
      { key: "nextQuestion", label: "下一步", value: "卷一先查账还是先砸场？" },
    ]);
  });
});
