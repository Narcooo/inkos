import { describe, expect, it, vi } from "vitest";
import {
  buildBookCreateAgentRequest,
  buildBookCreatePayload,
  buildDraftInstructionFromForm,
  buildCreationDraftSummary,
  applyCreationDraftToFormState,
  extractCreationDraftFromAssistantText,
  canCreateFromDraft,
  defaultBookCreateForm,
  defaultChapterWordsForLanguage,
  ensureBookCreateSessionId,
  hasEnoughFormForDraft,
  isBookCreateFormReady,
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

describe("book create form", () => {
  it("starts with sensible defaults for chinese projects", () => {
    expect(defaultBookCreateForm("zh")).toEqual({
      title: "",
      genre: "",
      platform: "tomato",
      targetChapters: "200",
      chapterWordCount: "3000",
      brief: "",
      styleGuide: "",
    });
  });

  it("requires title, genre, brief, and positive numeric targets before creating", () => {
    const ready = {
      ...defaultBookCreateForm("zh"),
      title: "夜港账本",
      genre: "都市悬疑",
      brief: "近未来港口城，主角查账洗白。",
    };

    expect(isBookCreateFormReady(ready)).toBe(true);
    expect(isBookCreateFormReady({ ...ready, title: "" })).toBe(false);
    expect(isBookCreateFormReady({ ...ready, brief: " " })).toBe(false);
    expect(isBookCreateFormReady({ ...ready, targetChapters: "0" })).toBe(false);
  });

  it("builds a direct create payload without dropping the story brief", () => {
    expect(buildBookCreatePayload({
      title: " 夜港账本 ",
      genre: " 都市悬疑 ",
      platform: "qidian",
      targetChapters: "120",
      chapterWordCount: "2600",
      brief: " 主角查账洗白，旧案回潮。 ",
      styleGuide: " 短句推进，多对白。 ",
    }, "zh")).toEqual({
      title: "夜港账本",
      genre: "都市悬疑",
      platform: "qidian",
      language: "zh",
      targetChapters: 120,
      chapterWordCount: 2600,
      blurb: "主角查账洗白，旧案回潮。",
      styleGuide: "短句推进，多对白。",
    });
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

describe("buildDraftInstructionFromForm", () => {
  const form = {
    ...defaultBookCreateForm("en"),
    title: "Tea House at the Last Gate",
    genre: "ko-cozy",
    platform: "kakao-page",
    targetChapters: "120",
    chapterWordCount: "2000",
    brief: "은퇴한 마법사가 작은 찻집을 열고 손님들의 문제를 해결한다.",
    styleGuide: "담백한 3인칭, 짧은 문단, 감각 묘사 중심.",
  };

  it("recognizes any user-provided book field as draft material", () => {
    expect(hasEnoughFormForDraft(form)).toBe(true);
    expect(hasEnoughFormForDraft({ ...defaultBookCreateForm("en"), title: "Only a title" })).toBe(true);
    expect(hasEnoughFormForDraft({ ...defaultBookCreateForm("en"), genre: "cozy" })).toBe(true);
    expect(hasEnoughFormForDraft({ ...defaultBookCreateForm("en"), styleGuide: "lean prose" })).toBe(true);
    expect(hasEnoughFormForDraft(defaultBookCreateForm("en"))).toBe(false);
  });

  it("builds a Korean /new instruction from the create form when the prompt box is empty", () => {
    const instruction = buildDraftInstructionFromForm({
      input: "",
      form,
      hasDraft: false,
      uiLanguage: "ko",
      genreLabel: "코지 판타지",
      platformLabel: "카카오페이지",
    });

    expect(instruction).toContain("/new ");
    expect(instruction).toContain("제목: Tea House at the Last Gate");
    expect(instruction).toContain("장르: 코지 판타지 (ko-cozy)");
    expect(instruction).toContain("은퇴한 마법사");
    expect(instruction).toContain("문체 지시:");
    expect(instruction).toContain("담백한 3인칭");
  });

  it("builds an instruction even when the form is blank and can inject a random genre", () => {
    const instruction = buildDraftInstructionFromForm({
      input: "",
      form: defaultBookCreateForm("en"),
      hasDraft: false,
      uiLanguage: "ko",
      fallbackGenreId: "ko-cozy",
      fallbackGenreLabel: "코지 판타지",
      platformLabel: "카카오페이지",
    });

    expect(instruction).toContain("/new ");
    expect(instruction).toContain("비어 있는 항목은 직접 창작해서 채워줘");
    expect(instruction).toContain("장르: 코지 판타지 (ko-cozy)");
  });

  it("keeps explicit user input as the highest priority", () => {
    expect(buildDraftInstructionFromForm({
      input: "더 따뜻하고 일상 중심으로",
      form,
      hasDraft: true,
      uiLanguage: "ko",
    })).toBe("더 따뜻하고 일상 중심으로");
  });
});

describe("applyCreationDraftToFormState", () => {
  it("fills the create form from a generated Korean draft", () => {
    const current = defaultBookCreateForm("en");

    expect(applyCreationDraftToFormState(current, {
      concept: "코지 판타지",
      title: "은퇴한 대마법사의 평온한 티타임",
      genre: "ko-cozy",
      platform: "kakao-page",
      targetChapters: 120,
      chapterWordCount: 2000,
      blurb: "대륙 최강의 마법사가 숲속 찻집을 열었다.",
      worldPremise: "마법 전쟁 이후 평화가 찾아온 변방의 숲속 마을.",
      protagonist: "정체를 숨긴 은퇴 대마법사.",
      conflictCore: "평온한 일상과 과거 인연의 개입.",
      volumeOutline: "찻집 개업과 작은 사건 해결.",
      styleGuide: "따뜻하고 담백한 3인칭.",
      missingFields: [],
      readyToCreate: true,
    }, [
      { value: "kakao-page", label: "카카오페이지" },
      { value: "other", label: "기타" },
    ])).toMatchObject({
      title: "은퇴한 대마법사의 평온한 티타임",
      genre: "ko-cozy",
      platform: "kakao-page",
      targetChapters: "120",
      chapterWordCount: "2000",
      styleGuide: "따뜻하고 담백한 3인칭.",
    });
  });
});

describe("extractCreationDraftFromAssistantText", () => {
  it("parses a Korean markdown draft table into creation fields", () => {
    const draft = extractCreationDraftFromAssistantText({
      responseText: [
        "제시해주신 SF 장르를 바탕으로 한 작품 초안입니다.",
        "### 작품 초안",
        "| 항목 | 내용 |",
        "| :--- | :--- |",
        "| **제목 후보** | 싱귤래리티의 잔상 / 코드 네임: 에덴 / 마지막 테라포밍 |",
        "| **세계관** | 인류가 궤도 엘리베이터와 우주 정거장에 거주하는 미래. |",
        "| **주인공** | 카엘: 기억 일부를 소실한 은퇴 특수 요원. |",
        "| **핵심 갈등** | 데이터 조각의 진실을 둘러싼 거대 기업과의 대립. |",
        "| **1부 방향** | 의문의 데이터 칩을 발견하고 과거의 적과 마주한다. |",
        "| **소개문** | 기억을 잃은 전직 요원에게 낡은 데이터 칩 하나가 도착한다. |",
        "| **문체** | 차갑고 절제된 3인칭, 기술 묘사는 짧게. |",
      ].join("\n"),
      concept: "SF 초안",
      genreId: "ko-sci-fi",
      platform: "kakao-page",
      targetChapters: "120",
      chapterWordCount: "2000",
    });

    expect(draft).toEqual(expect.objectContaining({
      language: "ko",
      title: "싱귤래리티의 잔상",
      genre: "ko-sci-fi",
      platform: "kakao-page",
      worldPremise: "인류가 궤도 엘리베이터와 우주 정거장에 거주하는 미래.",
      protagonist: "카엘: 기억 일부를 소실한 은퇴 특수 요원.",
      conflictCore: "데이터 조각의 진실을 둘러싼 거대 기업과의 대립.",
      volumeOutline: "의문의 데이터 칩을 발견하고 과거의 적과 마주한다.",
      blurb: "기억을 잃은 전직 요원에게 낡은 데이터 칩 하나가 도착한다.",
      styleGuide: "차갑고 절제된 3인칭, 기술 묘사는 짧게.",
      readyToCreate: true,
    }));
  });
});

describe("book create agent session", () => {
  it("includes the orphan session id in agent requests", () => {
    expect(buildBookCreateAgentRequest("/create", "123456-abcdef")).toEqual({
      instruction: "/create",
      sessionId: "123456-abcdef",
    });
  });

  it("rejects agent requests before a session is ready", () => {
    expect(() => buildBookCreateAgentRequest("/create", " ")).toThrow("Book create session is not ready.");
  });

  it("reuses a stored orphan session", async () => {
    const createSession = vi.fn();
    const setStoredSessionId = vi.fn();

    await expect(ensureBookCreateSessionId({
      getStoredSessionId: () => "123456-abcdef",
      fetchSession: async () => ({ session: { sessionId: "123456-abcdef", bookId: null } }),
      createSession,
      setStoredSessionId,
    })).resolves.toBe("123456-abcdef");

    expect(createSession).not.toHaveBeenCalled();
    expect(setStoredSessionId).not.toHaveBeenCalled();
  });

  it("replaces a stale stored session before sending agent requests", async () => {
    const clearStoredSessionId = vi.fn();
    const setStoredSessionId = vi.fn();

    await expect(ensureBookCreateSessionId({
      getStoredSessionId: () => "old-session",
      fetchSession: async () => {
        throw new Error("Session not found");
      },
      createSession: async () => ({ session: { sessionId: "123456-newone", bookId: null } }),
      clearStoredSessionId,
      setStoredSessionId,
    })).resolves.toBe("123456-newone");

    expect(clearStoredSessionId).toHaveBeenCalledOnce();
    expect(setStoredSessionId).toHaveBeenCalledWith("123456-newone");
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
