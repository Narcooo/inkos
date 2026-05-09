import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInteractionToolsFromDeps } from "../interaction/project-tools.js";

const mockChatCompletion = vi.hoisted(() => vi.fn());
const mockChatWithTools = vi.hoisted(() => vi.fn());

vi.mock("../index.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, chatCompletion: mockChatCompletion, chatWithTools: mockChatWithTools };
});

const fakePipeline = {
  config: {
    client: {} as object,
    model: "gpt-4o",
  },
  writeNextChapter: vi.fn(),
  reviseDraft: vi.fn(),
};

const fakeState = {
  ensureControlDocuments: vi.fn(async () => {}),
  bookDir: vi.fn(() => "/tmp/books/test"),
  loadBookConfig: vi.fn(async () => undefined),
  loadChapterIndex: vi.fn(async () => []),
  saveChapterIndex: vi.fn(async () => undefined),
  listBooks: vi.fn(async () => []),
};

const MOCK_CHAT_RESPONSE = {
  content: [
    "好的，你想写都市异能，请问主角是什么类型的能力？",
    "",
    ':::field{key="title" label="书名"}',
    "都市异能",
    ":::",
  ].join("\n"),
  tokensUsed: { prompt: 5, completion: 80, total: 85 },
};

const MOCK_TOOL_RESPONSE = {
  content: "好的，已根据你的描述生成建书参数。",
  toolCalls: [
    {
      id: "call_1",
      name: "create_book",
      arguments: JSON.stringify({ title: "都市异能", genre: "urban", platform: "tomato", brief: "都市异能题材" }),
    },
  ],
};

describe("chat tool – maxTokens forwarding", () => {
  beforeEach(() => {
    mockChatCompletion.mockResolvedValue({
      content: "Hello",
      tokensUsed: { prompt: 5, completion: 10, total: 15 },
    });
    mockChatCompletion.mockClear();
  });

  it("does not pass maxTokens to chatCompletion when depth has no maxTokens set", async () => {
    const tools = createInteractionToolsFromDeps(
      fakePipeline as never,
      fakeState as never,
      {
        getChatRequestOptions: () => ({ temperature: 0.7 }),
      },
    );

    await tools.chat?.("你好", { bookId: "test-book", automationMode: "manual" });

    expect(mockChatCompletion).toHaveBeenCalledOnce();
    const options = mockChatCompletion.mock.calls[0]?.[3] as Record<string, unknown> | undefined;
    expect(options).not.toHaveProperty("maxTokens");
  });

  it("passes maxTokens to chatCompletion when depth explicitly sets it", async () => {
    const tools = createInteractionToolsFromDeps(
      fakePipeline as never,
      fakeState as never,
      {
        getChatRequestOptions: () => ({ temperature: 0.7, maxTokens: 512 }),
      },
    );

    await tools.chat?.("你好", { bookId: "test-book", automationMode: "manual" });

    expect(mockChatCompletion).toHaveBeenCalledOnce();
    const options = mockChatCompletion.mock.calls[0]?.[3] as Record<string, unknown> | undefined;
    expect(options).toHaveProperty("maxTokens", 512);
  });

  it("rethrows real chatCompletion errors instead of silently falling back", async () => {
    mockChatCompletion.mockRejectedValueOnce(new Error("provider down"));

    const tools = createInteractionToolsFromDeps(
      fakePipeline as never,
      fakeState as never,
      {
        getChatRequestOptions: () => ({ temperature: 0.7 }),
      },
    );

    await expect(
      tools.chat?.("你好", { bookId: "test-book", automationMode: "manual" }),
    ).rejects.toThrow("provider down");
  });
});

describe("developBookDraft – uses chatWithTools", () => {
  beforeEach(() => {
    mockChatWithTools.mockResolvedValue(MOCK_TOOL_RESPONSE);
    mockChatWithTools.mockClear();
  });

  it("calls chatWithTools with create_book tool and does not pass maxTokens", async () => {
    const tools = createInteractionToolsFromDeps(
      fakePipeline as never,
      fakeState as never,
    );

    await tools.developBookDraft?.("我想写都市异能", undefined);

    expect(mockChatWithTools).toHaveBeenCalledOnce();
    const options = mockChatWithTools.mock.calls[0]?.[4] as Record<string, unknown> | undefined;
    expect(options).not.toHaveProperty("maxTokens");
  });

  it("extracts tool call arguments into the creation draft", async () => {
    const tools = createInteractionToolsFromDeps(
      fakePipeline as never,
      fakeState as never,
    );

    const result = await tools.developBookDraft?.("我想写都市异能", undefined) as Record<string, unknown>;
    const interaction = (result as { __interaction: Record<string, unknown> }).__interaction;
    const details = interaction.details as Record<string, unknown>;

    expect(details.creationDraft).toEqual(expect.objectContaining({
      title: "都市异能",
      genre: "urban",
      platform: "tomato",
      blurb: "都市异能题材",
      readyToCreate: true,
    }));
    expect(details.toolCall).toEqual({
      name: "create_book",
      arguments: { title: "都市异能", genre: "urban", platform: "tomato", brief: "都市异能题材" },
    });
  });

  it("uses Studio form fields as a draft even when the model answers with a question instead of a tool call", async () => {
    mockChatWithTools.mockResolvedValueOnce({
      content: "새로운 이야기를 시작하기 위해 우선 장르를 선택해 주세요.",
      toolCalls: [],
    });
    const tools = createInteractionToolsFromDeps(
      fakePipeline as never,
      fakeState as never,
    );

    const result = await tools.developBookDraft?.([
      "아래 작품 기본 정보를 바탕으로 장르에 맞는 기초 설정 초안을 만들어줘.",
      "",
      "제목: 밤항구 찻집",
      "장르: 코지 판타지 (ko-cozy)",
      "목표 플랫폼: 카카오페이지",
      "목표 장수: 120",
      "장당 분량: 2000",
      "",
      "이야기 소개 / 핵심 설정:",
      "은퇴한 마법사가 작은 찻집을 열고 손님들의 문제를 해결한다.",
    ].join("\n"), undefined) as Record<string, unknown>;
    const interaction = (result as { __interaction: Record<string, unknown> }).__interaction;
    const details = interaction.details as Record<string, unknown>;

    expect(interaction.responseText).toContain("초안을 업데이트했습니다");
    expect(details.creationDraft).toEqual(expect.objectContaining({
      title: "밤항구 찻집",
      genre: "ko-cozy",
      platform: "카카오페이지",
      targetChapters: 120,
      chapterWordCount: 2000,
      blurb: "은퇴한 마법사가 작은 찻집을 열고 손님들의 문제를 해결한다.",
      missingFields: [],
      readyToCreate: true,
    }));
    expect(details.toolCall).toBeUndefined();
  });

  it("extracts Korean markdown table draft fields when no tool call is returned", async () => {
    mockChatWithTools.mockResolvedValueOnce({
      content: [
        "### 작품 초안",
        "| 항목 | 내용 |",
        "| :--- | :--- |",
        "| **제목 후보** | 은퇴한 대마법사의 평온한 티타임 / 마법사의 작은 숲속 찻집 |",
        "| **세계관** | 마법 전쟁 이후 평화가 찾아온 변방의 숲속 마을. |",
        "| **주인공** | 에드릭: 정체를 숨긴 은퇴 대마법사. |",
        "| **핵심 갈등** | 평온한 일상을 지키려는 마음과 과거 인연의 개입. |",
        "| **1부 방향** | 찻집 개업과 마을 주민들의 작은 사건 해결. |",
        "| **소개문** | 대륙 최강의 마법사가 숲속 찻집을 열었다. |",
      ].join("\n"),
      toolCalls: [],
    });
    const tools = createInteractionToolsFromDeps(
      fakePipeline as never,
      fakeState as never,
    );

    const result = await tools.developBookDraft?.([
      "제목: ",
      "장르: 코지 판타지 (ko-cozy)",
      "목표 플랫폼: 카카오페이지",
      "목표 장수: 120",
      "장당 분량: 2000",
    ].join("\n"), undefined) as Record<string, unknown>;
    const interaction = (result as { __interaction: Record<string, unknown> }).__interaction;
    const details = interaction.details as Record<string, unknown>;

    expect(details.creationDraft).toEqual(expect.objectContaining({
      title: "은퇴한 대마법사의 평온한 티타임",
      genre: "ko-cozy",
      worldPremise: "마법 전쟁 이후 평화가 찾아온 변방의 숲속 마을.",
      protagonist: "에드릭: 정체를 숨긴 은퇴 대마법사.",
      conflictCore: "평온한 일상을 지키려는 마음과 과거 인연의 개입.",
      volumeOutline: "찻집 개업과 마을 주민들의 작은 사건 해결.",
      blurb: "대륙 최강의 마법사가 숲속 찻집을 열었다.",
      readyToCreate: true,
    }));
  });

  it("returns fallback when no LLM is configured", async () => {
    const noLlmPipeline = {
      config: {},
      writeNextChapter: vi.fn(),
      reviseDraft: vi.fn(),
    };

    const tools = createInteractionToolsFromDeps(
      noLlmPipeline as never,
      fakeState as never,
    );

    const result = await tools.developBookDraft?.("我想写都市异能", undefined) as Record<string, unknown>;
    const interaction = (result as { __interaction: Record<string, unknown> }).__interaction;

    expect(mockChatWithTools).not.toHaveBeenCalled();
    expect(interaction.responseText).toContain("请先配置 LLM 模型");
  });
});
