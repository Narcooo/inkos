import { describe, it, expect } from "vitest";
import {
  BookConfigSchema,
  PlatformSchema,
  GenreSchema,
  BookStatusSchema,
} from "../models/book.js";
import { ChapterMetaSchema, ChapterStatusSchema } from "../models/chapter.js";
import {
  ProjectConfigSchema,
  LLMConfigSchema,
  NotifyChannelSchema,
} from "../models/project.js";

// ---------------------------------------------------------------------------
// BookConfig
// ---------------------------------------------------------------------------

describe("BookConfigSchema", () => {
  const validBook = {
    id: "test-book-1",
    title: "Test Novel",
    platform: "tomato",
    genre: "xuanhuan",
    status: "active",
    targetChapters: 200,
    chapterWordCount: 3000,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  it("accepts a valid BookConfig", () => {
    const result = BookConfigSchema.parse(validBook);
    expect(result.id).toBe("test-book-1");
    expect(result.title).toBe("Test Novel");
    expect(result.platform).toBe("tomato");
  });

  it("applies default targetChapters and chapterWordCount", () => {
    const minimal = {
      id: "b1",
      title: "B1",
      platform: "qidian",
      genre: "xianxia",
      status: "incubating",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const result = BookConfigSchema.parse(minimal);
    expect(result.targetChapters).toBe(200);
    expect(result.chapterWordCount).toBe(3000);
  });

  it("rejects empty id", () => {
    expect(() =>
      BookConfigSchema.parse({ ...validBook, id: "" }),
    ).toThrow();
  });

  it("rejects empty title", () => {
    expect(() =>
      BookConfigSchema.parse({ ...validBook, title: "" }),
    ).toThrow();
  });

  it("rejects invalid platform", () => {
    expect(() =>
      BookConfigSchema.parse({ ...validBook, platform: "kindle" }),
    ).toThrow();
  });

  it("accepts custom genre strings", () => {
    const result = BookConfigSchema.parse({ ...validBook, genre: "romance" });
    expect(result.genre).toBe("romance");
  });

  it("rejects empty genre", () => {
    expect(() =>
      BookConfigSchema.parse({ ...validBook, genre: "" }),
    ).toThrow();
  });

  it("rejects invalid status", () => {
    expect(() =>
      BookConfigSchema.parse({ ...validBook, status: "archived" }),
    ).toThrow();
  });

  it("rejects chapterWordCount below 1000", () => {
    expect(() =>
      BookConfigSchema.parse({ ...validBook, chapterWordCount: 500 }),
    ).toThrow();
  });

  it("rejects targetChapters below 1", () => {
    expect(() =>
      BookConfigSchema.parse({ ...validBook, targetChapters: 0 }),
    ).toThrow();
  });

  it("rejects non-integer targetChapters", () => {
    expect(() =>
      BookConfigSchema.parse({ ...validBook, targetChapters: 10.5 }),
    ).toThrow();
  });

  it("rejects invalid datetime strings", () => {
    expect(() =>
      BookConfigSchema.parse({ ...validBook, createdAt: "not-a-date" }),
    ).toThrow();
  });
});

describe("PlatformSchema", () => {
  it.each(["tomato", "feilu", "qidian", "other"] as const)(
    "accepts '%s'",
    (value) => {
      expect(PlatformSchema.parse(value)).toBe(value);
    },
  );

  it("rejects unknown platform", () => {
    expect(() => PlatformSchema.parse("amazon")).toThrow();
  });
});

describe("GenreSchema", () => {
  const validGenres = [
    "xuanhuan",
    "xianxia",
    "urban",
    "horror",
    "other",
    "litrpg",
    "progression",
    "cozy",
  ] as const;

  it.each(validGenres)("accepts '%s'", (value) => {
    expect(GenreSchema.parse(value)).toBe(value);
  });

  it("rejects empty genre string", () => {
    expect(() => GenreSchema.parse("")).toThrow();
  });
});

describe("BookStatusSchema", () => {
  const validStatuses = [
    "incubating",
    "outlining",
    "active",
    "paused",
    "completed",
    "dropped",
  ] as const;

  it.each(validStatuses)("accepts '%s'", (value) => {
    expect(BookStatusSchema.parse(value)).toBe(value);
  });

  it("rejects unknown status", () => {
    expect(() => BookStatusSchema.parse("archived")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ChapterMeta
// ---------------------------------------------------------------------------

describe("ChapterMetaSchema", () => {
  const validChapter = {
    number: 1,
    title: "Chapter One",
    status: "drafted",
    wordCount: 3000,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    auditIssues: [],
  };

  it("accepts a valid ChapterMeta", () => {
    const result = ChapterMetaSchema.parse(validChapter);
    expect(result.number).toBe(1);
    expect(result.title).toBe("Chapter One");
    expect(result.status).toBe("drafted");
  });

  it("applies default wordCount of 0", () => {
    const minimal = {
      number: 5,
      title: "Ch5",
      status: "card-generated",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const result = ChapterMetaSchema.parse(minimal);
    expect(result.wordCount).toBe(0);
  });

  it("applies default empty auditIssues", () => {
    const minimal = {
      number: 1,
      title: "Ch1",
      status: "drafted",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const result = ChapterMetaSchema.parse(minimal);
    expect(result.auditIssues).toEqual([]);
  });

  it("accepts optional reviewNote", () => {
    const withNote = { ...validChapter, reviewNote: "Looks good" };
    const result = ChapterMetaSchema.parse(withNote);
    expect(result.reviewNote).toBe("Looks good");
  });

  it("omits reviewNote when not provided", () => {
    const result = ChapterMetaSchema.parse(validChapter);
    expect(result.reviewNote).toBeUndefined();
  });

  it("rejects chapter number < 1", () => {
    expect(() =>
      ChapterMetaSchema.parse({ ...validChapter, number: 0 }),
    ).toThrow();
  });

  it("rejects negative chapter number", () => {
    expect(() =>
      ChapterMetaSchema.parse({ ...validChapter, number: -1 }),
    ).toThrow();
  });

  it("rejects invalid status", () => {
    expect(() =>
      ChapterMetaSchema.parse({ ...validChapter, status: "writing" }),
    ).toThrow();
  });

  it("rejects non-integer chapter number", () => {
    expect(() =>
      ChapterMetaSchema.parse({ ...validChapter, number: 1.5 }),
    ).toThrow();
  });
});

describe("ChapterStatusSchema", () => {
  const allStatuses = [
    "card-generated",
    "drafting",
    "drafted",
    "auditing",
    "audit-passed",
    "audit-failed",
    "audit-skipped",
    "revising",
    "ready-for-review",
    "approved",
    "rejected",
    "published",
    "imported",
  ] as const;

  it.each(allStatuses)("accepts '%s'", (value) => {
    expect(ChapterStatusSchema.parse(value)).toBe(value);
  });

  it("has exactly 13 valid statuses", () => {
    expect(ChapterStatusSchema.options).toHaveLength(13);
  });

  it("rejects unknown status", () => {
    expect(() => ChapterStatusSchema.parse("editing")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ProjectConfig
// ---------------------------------------------------------------------------

describe("ProjectConfigSchema", () => {
  const validProject = {
    name: "my-project",
    version: "0.1.0" as const,
    llm: {
      provider: "anthropic" as const,
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-key",
      model: "claude-sonnet-4-5-20250514",
    },
    notify: [],
  };

  it("accepts a valid ProjectConfig", () => {
    const result = ProjectConfigSchema.parse(validProject);
    expect(result.name).toBe("my-project");
    expect(result.version).toBe("0.1.0");
  });

  it("applies default daemon config", () => {
    const result = ProjectConfigSchema.parse(validProject);
    expect(result.daemon.maxConcurrentBooks).toBe(3);
    expect(result.daemon.schedule.radarCron).toBe("0 */6 * * *");
    expect(result.daemon.schedule.writeCron).toBe("*/15 * * * *");
    expect(result.daemon.chaptersPerCycle).toBe(1);
    expect(result.daemon.maxChaptersPerDay).toBe(50);
  });

  it("applies default empty notify array", () => {
    const withoutNotify = {
      name: "p1",
      version: "0.1.0" as const,
      llm: validProject.llm,
    };
    const result = ProjectConfigSchema.parse(withoutNotify);
    expect(result.notify).toEqual([]);
  });

  it("rejects wrong version", () => {
    expect(() =>
      ProjectConfigSchema.parse({ ...validProject, version: "1.0.0" }),
    ).toThrow();
  });

  it("rejects empty project name", () => {
    expect(() =>
      ProjectConfigSchema.parse({ ...validProject, name: "" }),
    ).toThrow();
  });

  it("rejects missing LLM config", () => {
    expect(() =>
      ProjectConfigSchema.parse({ name: "p", version: "0.1.0" }),
    ).toThrow();
  });
});

describe("LLMConfigSchema", () => {
  it("accepts valid LLM config", () => {
    const result = LLMConfigSchema.parse({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-xxx",
      model: "gpt-4o",
    });
    expect(result.provider).toBe("openai");
  });

  it("rejects invalid provider", () => {
    expect(() =>
      LLMConfigSchema.parse({
        provider: "mistral",
        baseUrl: "https://api.example.com",
        apiKey: "key",
        model: "m",
      }),
    ).toThrow();
  });

  it("rejects invalid URL", () => {
    expect(() =>
      LLMConfigSchema.parse({
        provider: "custom",
        baseUrl: "not-a-url",
        apiKey: "key",
        model: "m",
      }),
    ).toThrow();
  });

  it("defaults apiKey to empty string when omitted", () => {
    const result = LLMConfigSchema.parse({
      provider: "anthropic",
      baseUrl: "https://api.example.com",
      model: "m",
    });
    expect(result.apiKey).toBe("");
  });

  it("rejects empty model", () => {
    expect(() =>
      LLMConfigSchema.parse({
        provider: "anthropic",
        baseUrl: "https://api.example.com",
        apiKey: "key",
        model: "",
      }),
    ).toThrow();
  });
});

describe("NotifyChannelSchema", () => {
  it("accepts telegram channel", () => {
    const result = NotifyChannelSchema.parse({
      type: "telegram",
      botToken: "123:ABC",
      chatId: "-100123",
    });
    expect(result.type).toBe("telegram");
  });

  it("accepts feishu channel", () => {
    const result = NotifyChannelSchema.parse({
      type: "feishu",
      webhookUrl: "https://open.feishu.cn/webhook/xxx",
    });
    expect(result.type).toBe("feishu");
  });

  it("accepts wechat-work channel", () => {
    const result = NotifyChannelSchema.parse({
      type: "wechat-work",
      webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx",
    });
    expect(result.type).toBe("wechat-work");
  });

  it("rejects telegram with missing botToken", () => {
    expect(() =>
      NotifyChannelSchema.parse({
        type: "telegram",
        chatId: "-100",
      }),
    ).toThrow();
  });

  it("rejects feishu with invalid URL", () => {
    expect(() =>
      NotifyChannelSchema.parse({
        type: "feishu",
        webhookUrl: "not-a-url",
      }),
    ).toThrow();
  });

  it("rejects unknown channel type", () => {
    expect(() =>
      NotifyChannelSchema.parse({
        type: "slack",
        webhookUrl: "https://hooks.slack.com/xxx",
      }),
    ).toThrow();
  });
});
