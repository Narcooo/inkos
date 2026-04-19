import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSubAgentTool } from "../agent/agent-tools.js";

describe("SubAgentParams schema", () => {
  const mockPipeline = {} as any;
  const tool = createSubAgentTool(mockPipeline, null);
  const schema = tool.parameters;
  const props = (schema as any).properties;

  it("has architect params: title, genre, platform, language, targetChapters", () => {
    expect(props.title).toBeDefined();
    expect(props.genre).toBeDefined();
    expect(props.platform).toBeDefined();
    expect(props.language).toBeDefined();
    expect(props.targetChapters).toBeDefined();
  });

  it("has writer/architect param: chapterWordCount", () => {
    expect(props.chapterWordCount).toBeDefined();
  });

  it("has reviser param: mode", () => {
    expect(props.mode).toBeDefined();
  });

  it("has exporter params: format, approvedOnly", () => {
    expect(props.format).toBeDefined();
    expect(props.approvedOnly).toBeDefined();
  });

  it("has existing params: agent, instruction, bookId, chapterNumber", () => {
    expect(props.agent).toBeDefined();
    expect(props.instruction).toBeDefined();
    expect(props.bookId).toBeDefined();
    expect(props.chapterNumber).toBeDefined();
  });

  it("all new params have description with agent scope", () => {
    expect(props.title.description).toMatch(/architect/i);
    expect(props.genre.description).toMatch(/architect/i);
    expect(props.mode.description).toMatch(/reviser/i);
    expect(props.format.description).toMatch(/exporter/i);
  });
});

describe("architect agent — BookConfig construction", () => {
  let initBookMock: ReturnType<typeof vi.fn>;
  let tool: ReturnType<typeof createSubAgentTool>;

  beforeEach(() => {
    initBookMock = vi.fn(async () => {});
    const mockPipeline = { initBook: initBookMock } as any;
    tool = createSubAgentTool(mockPipeline, null);
  });

  it("passes complete BookConfig with schema params", async () => {
    await tool.execute("tc1", {
      agent: "architect",
      instruction: "Create a xuanhuan novel",
      title: "天道独行",
      genre: "xuanhuan",
      platform: "tomato",
      language: "zh",
      targetChapters: 100,
      chapterWordCount: 4000,
    });
    expect(initBookMock).toHaveBeenCalledOnce();
    const [bookConfig, options] = initBookMock.mock.calls[0];
    expect(bookConfig.title).toBe("天道独行");
    expect(bookConfig.genre).toBe("xuanhuan");
    expect(bookConfig.platform).toBe("tomato");
    expect(bookConfig.language).toBe("zh");
    expect(bookConfig.targetChapters).toBe(100);
    expect(bookConfig.chapterWordCount).toBe(4000);
    expect(bookConfig.status).toBe("outlining");
    expect(bookConfig.createdAt).toBeDefined();
    expect(options.externalContext).toBe("Create a xuanhuan novel");
  });

  it("uses defaults when optional params are omitted", async () => {
    await tool.execute("tc2", { agent: "architect", instruction: "Create a book", title: "Test Book" });
    const [bookConfig] = initBookMock.mock.calls[0];
    expect(bookConfig.genre).toBe("general");
    expect(bookConfig.platform).toBe("other");
    expect(bookConfig.language).toBe("zh");
    expect(bookConfig.targetChapters).toBe(200);
    expect(bookConfig.chapterWordCount).toBe(3000);
  });
});

describe("writer agent — wordCount passthrough", () => {
  let writeNextChapterMock: ReturnType<typeof vi.fn>;
  let tool: ReturnType<typeof createSubAgentTool>;

  beforeEach(() => {
    writeNextChapterMock = vi.fn(async () => ({ wordCount: 3000 }));
    const mockPipeline = { writeNextChapter: writeNextChapterMock } as any;
    tool = createSubAgentTool(mockPipeline, "existing-book");
  });

  it("passes chapterWordCount as wordCount", async () => {
    await tool.execute("tc1", { agent: "writer", instruction: "Write", bookId: "my-book", chapterWordCount: 5000 });
    expect(writeNextChapterMock).toHaveBeenCalledWith("my-book", 5000);
  });

  it("passes undefined when chapterWordCount omitted", async () => {
    await tool.execute("tc2", { agent: "writer", instruction: "Write", bookId: "my-book" });
    expect(writeNextChapterMock).toHaveBeenCalledWith("my-book", undefined);
  });
});

describe("auditor agent — rich return value", () => {
  it("returns issue details with severity", async () => {
    const auditDraftMock = vi.fn(async () => ({
      chapterNumber: 3, passed: false,
      issues: [
        { severity: "warning", description: "Pacing too fast" },
        { severity: "critical", description: "Name inconsistency" },
      ],
    }));
    const tool = createSubAgentTool({ auditDraft: auditDraftMock } as any, "book");
    const result = await tool.execute("tc1", { agent: "auditor", instruction: "Audit", bookId: "my-book", chapterNumber: 3 });
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("FAILED");
    expect(text).toContain("2 issue(s)");
    expect(text).toContain("[warning]");
    expect(text).toContain("[critical]");
    expect(text).toContain("Pacing too fast");
  });
});

describe("reviser agent — mode field", () => {
  let reviseDraftMock: ReturnType<typeof vi.fn>;
  let tool: ReturnType<typeof createSubAgentTool>;

  beforeEach(() => {
    reviseDraftMock = vi.fn(async () => ({}));
    tool = createSubAgentTool({ reviseDraft: reviseDraftMock } as any, "book");
  });

  it("uses mode param directly", async () => {
    await tool.execute("tc1", { agent: "reviser", instruction: "Fix", bookId: "my-book", chapterNumber: 5, mode: "anti-detect" });
    expect(reviseDraftMock).toHaveBeenCalledWith("my-book", 5, "anti-detect");
  });

  it("defaults to spot-fix", async () => {
    await tool.execute("tc2", { agent: "reviser", instruction: "Fix", bookId: "my-book" });
    expect(reviseDraftMock).toHaveBeenCalledWith("my-book", undefined, "spot-fix");
  });
});
