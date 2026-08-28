import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildChatPageModelGroups,
  clearBookCreateSessionId,
  filterModelGroups,
  getBookCreateSessionId,
  getChatScrollBehavior,
  getProjectChatSessionId,
  pickModelSelection,
  pickProjectChatSessionId,
  setBookCreateSessionId,
  setProjectChatSessionId,
  isChatScrollNearBottom,
  shouldShowPlayChoicePanel,
} from "./chat-page-state";

describe("book-create session localStorage helpers", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
    });
  });

  afterEach(() => {
    storage.clear();
    vi.unstubAllGlobals();
  });

  it("getBookCreateSessionId returns null when empty", () => {
    expect(getBookCreateSessionId()).toBeNull();
  });

  it("setBookCreateSessionId + get round-trips", () => {
    setBookCreateSessionId("sess-123");
    expect(getBookCreateSessionId()).toBe("sess-123");
  });

  it("setBookCreateSessionId overwrites previous value", () => {
    setBookCreateSessionId("sess-old");
    setBookCreateSessionId("sess-new");
    expect(getBookCreateSessionId()).toBe("sess-new");
  });

  it("clearBookCreateSessionId removes the key", () => {
    setBookCreateSessionId("sess-123");
    clearBookCreateSessionId();
    expect(getBookCreateSessionId()).toBeNull();
  });

  it("clearBookCreateSessionId is safe when key doesn't exist", () => {
    clearBookCreateSessionId();
    expect(getBookCreateSessionId()).toBeNull();
  });

  it("keeps project chat session separate from book-create session", () => {
    setBookCreateSessionId("book-create-session");
    setProjectChatSessionId("project-chat-session");
    expect(getBookCreateSessionId()).toBe("book-create-session");
    expect(getProjectChatSessionId()).toBe("project-chat-session");
  });
});

describe("filterModelGroups", () => {
  const grouped = [
    {
      service: "openai",
      label: "OpenAI",
      models: [
        { id: "gpt-5.4", name: "gpt-5.4" },
        { id: "gpt-4o", name: "gpt-4o" },
      ],
    },
    {
      service: "custom:gemma",
      label: "LM Studio",
      models: [
        { id: "google/gemma-4-27b-it", name: "google/gemma-4-27b-it" },
      ],
    },
  ] as const;

  it("returns all groups when search is blank", () => {
    expect(filterModelGroups(grouped, "")).toEqual(grouped);
    expect(filterModelGroups(grouped, "   ")).toEqual(grouped);
  });

  it("filters by model name and preserves only matching groups", () => {
    expect(filterModelGroups(grouped, "gemma")).toEqual([
      {
        service: "custom:gemma",
        label: "LM Studio",
        models: [{ id: "google/gemma-4-27b-it", name: "google/gemma-4-27b-it" }],
      },
    ]);
  });

  it("filters by service label", () => {
    expect(filterModelGroups(grouped, "openai")).toEqual([
      {
        service: "openai",
        label: "OpenAI",
        models: [
          { id: "gpt-5.4", name: "gpt-5.4" },
          { id: "gpt-4o", name: "gpt-4o" },
        ],
      },
    ]);
  });
});

describe("buildChatPageModelGroups", () => {
  const services = [
    { service: "openrouter", label: "OpenRouter", connected: true },
    { service: "moonshot", label: "Moonshot", connected: true },
    { service: "google", label: "Google", connected: false },
  ];
  const modelsByService = {
    openrouter: [{ id: "openrouter/auto", name: "openrouter/auto" }],
    moonshot: [{ id: "kimi-k2.5", name: "kimi-k2.5" }],
  };

  it("only includes connected services that have models", () => {
    expect(buildChatPageModelGroups(services, modelsByService).map((group) => group.service))
      .toEqual(["openrouter", "moonshot"]);
  });

  it("injects the configured default model into its service even when the bank lacks it", () => {
    const groups = buildChatPageModelGroups(services, modelsByService, {
      service: "openrouter",
      model: "google/gemini-3.7-flash",
    });
    expect(groups.find((group) => group.service === "openrouter")?.models.map((model) => model.id))
      .toEqual(["google/gemini-3.7-flash", "openrouter/auto"]);
  });

  it("still exposes a connected service that only has the configured default model", () => {
    const groups = buildChatPageModelGroups(services, { moonshot: modelsByService.moonshot }, {
      service: "openrouter",
      model: "google/gemini-3.7-flash",
    });
    expect(groups.find((group) => group.service === "openrouter")?.models.map((model) => model.id))
      .toEqual(["google/gemini-3.7-flash"]);
  });

  it("does not duplicate a default model already present in the catalog", () => {
    const groups = buildChatPageModelGroups(services, {
      openrouter: [
        { id: "google/gemini-3.7-flash", name: "google/gemini-3.7-flash" },
        { id: "openrouter/auto", name: "openrouter/auto" },
      ],
    }, {
      service: "openrouter",
      model: "Google/Gemini-3.7-Flash",
    });
    expect(groups.find((group) => group.service === "openrouter")?.models.map((model) => model.id))
      .toEqual(["google/gemini-3.7-flash", "openrouter/auto"]);
  });

  it("injects a service-less default into the first connected group", () => {
    const groups = buildChatPageModelGroups(services, modelsByService, {
      model: "google/gemini-3.7-flash",
    });
    expect(groups[0]?.models.map((model) => model.id))
      .toEqual(["google/gemini-3.7-flash", "openrouter/auto"]);
  });

  it("lets pickModelSelection keep a default that is missing from the static bank", () => {
    const preference = { service: "openrouter", model: "google/gemini-3.7-flash" };
    const groups = buildChatPageModelGroups(services, modelsByService, preference);
    expect(pickModelSelection(groups, null, null, preference)).toEqual({
      model: "google/gemini-3.7-flash",
      service: "openrouter",
    });
  });
});

describe("pickModelSelection", () => {
  const grouped = [
    {
      service: "google",
      label: "Google Gemini",
      models: [
        { id: "gemini-2.5-flash", name: "gemini-2.5-flash" },
      ],
    },
    {
      service: "moonshot",
      label: "Moonshot",
      models: [
        { id: "kimi-k2.5", name: "kimi-k2.5" },
      ],
    },
  ] as const;

  it("keeps the current selection when it is still available", () => {
    expect(pickModelSelection(grouped, "kimi-k2.5", "moonshot")).toBeNull();
  });

  it("selects the first available model when current selection is missing", () => {
    expect(pickModelSelection(grouped, "gemini-3.1-flash-image-preview", "google")).toEqual({
      model: "gemini-2.5-flash",
      service: "google",
    });
  });

  it("selects the first available model when there is no current selection", () => {
    expect(pickModelSelection(grouped, null, null)).toEqual({
      model: "gemini-2.5-flash",
      service: "google",
    });
  });

  it("prefers the configured service and model when there is no current selection", () => {
    expect(pickModelSelection(grouped, null, null, {
      service: "moonshot",
      model: "kimi-k2.5",
    })).toEqual({
      model: "kimi-k2.5",
      service: "moonshot",
    });
  });

  it("prefers the configured service even when its configured model is stale", () => {
    expect(pickModelSelection(grouped, null, null, {
      service: "moonshot",
      model: "kimi-k3",
    })).toEqual({
      model: "kimi-k2.5",
      service: "moonshot",
    });
  });

  it("keeps a valid user selection over the configured default", () => {
    expect(pickModelSelection(grouped, "gemini-2.5-flash", "google", {
      service: "moonshot",
      model: "kimi-k2.5",
    })).toBeNull();
  });

  it("returns null when no models are available", () => {
    expect(pickModelSelection([], "gemini-3.1-flash-image-preview", "google")).toBeNull();
  });
});

describe("pickProjectChatSessionId", () => {
  it("prefers the newest project chat session that already has messages", () => {
    expect(pickProjectChatSessionId([
      { sessionId: "empty-latest", messageCount: 0 },
      { sessionId: "short-fiction-session", messageCount: 3 },
      { sessionId: "older-session", messageCount: 1 },
    ])).toBe("short-fiction-session");
  });

  it("can restore the latest non-chat project session after refresh", () => {
    expect(pickProjectChatSessionId([
      { sessionId: "play-session", sessionKind: "play", messageCount: 4 },
      { sessionId: "old-chat-session", sessionKind: "chat", messageCount: 9 },
    ])).toBe("play-session");
  });

  it("falls back to the newest empty session when all sessions are empty", () => {
    expect(pickProjectChatSessionId([
      { sessionId: "empty-latest", messageCount: 0 },
      { sessionId: "empty-older", messageCount: 0 },
    ])).toBe("empty-latest");
  });

  it("returns null when there is no project chat session", () => {
    expect(pickProjectChatSessionId([])).toBeNull();
  });
});

describe("shouldShowPlayChoicePanel", () => {
  it("does not show choices outside guided Play mode", () => {
    expect(shouldShowPlayChoicePanel({ playMode: "open", choiceSetKey: "a", consumedChoiceKey: null, choiceCount: 2 })).toBe(false);
    expect(shouldShowPlayChoicePanel({ playMode: undefined, choiceSetKey: "a", consumedChoiceKey: null, choiceCount: 2 })).toBe(false);
  });

  it("shows a fresh guided choice set", () => {
    expect(shouldShowPlayChoicePanel({ playMode: "guided", choiceSetKey: "turn-1", consumedChoiceKey: null, choiceCount: 2 })).toBe(true);
  });

  it("hides a guided choice set after it has been consumed", () => {
    expect(shouldShowPlayChoicePanel({ playMode: "guided", choiceSetKey: "turn-1", consumedChoiceKey: "turn-1", choiceCount: 2 })).toBe(false);
  });

  it("shows choices again when a new tool result creates a new source key", () => {
    expect(shouldShowPlayChoicePanel({ playMode: "guided", choiceSetKey: "turn-2", consumedChoiceKey: "turn-1", choiceCount: 2 })).toBe(true);
  });
});

describe("isChatScrollNearBottom", () => {
  it("treats the bottom and near-bottom positions as pinned", () => {
    expect(isChatScrollNearBottom({ scrollTop: 900, clientHeight: 300, scrollHeight: 1200 })).toBe(true);
    expect(isChatScrollNearBottom({ scrollTop: 830, clientHeight: 300, scrollHeight: 1200 })).toBe(true);
  });

  it("does not treat a user reading older messages as pinned to the bottom", () => {
    expect(isChatScrollNearBottom({ scrollTop: 500, clientHeight: 300, scrollHeight: 1200 })).toBe(false);
  });
});

describe("getChatScrollBehavior", () => {
  it("uses instant scroll while streaming to avoid stacked smooth-scroll animations", () => {
    expect(getChatScrollBehavior(true)).toBe("auto");
  });

  it("keeps smooth scroll for non-streaming message jumps", () => {
    expect(getChatScrollBehavior(false)).toBe("smooth");
  });
});
