import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { agentInstances } = vi.hoisted(() => ({
  agentInstances: [] as any[],
}));

vi.mock("@mariozechner/pi-agent-core", async () => {
  const actual = await vi.importActual<any>("@mariozechner/pi-agent-core");
  class FakeAgent {
    state: any;
    transformContext: any;
    streamFn: any;
    getApiKey: any;
    constructor(options: any) {
      this.state = {
        model: options.initialState?.model,
        systemPrompt: options.initialState?.systemPrompt,
        tools: options.initialState?.tools ?? [],
        messages: [],
      };
      this.transformContext = options.transformContext;
      this.streamFn = options.streamFn;
      this.getApiKey = options.getApiKey;
      agentInstances.push(this);
    }
    subscribe() {
      return () => {};
    }
    async prompt(userMessage: string) {
      const now = Date.now();
      this.state.messages.push({ role: "user", content: userMessage, timestamp: now });
      this.state.messages.push({
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "fake",
        usage: {
          input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: now + 1,
      });
    }
  }
  return { ...actual, Agent: FakeAgent };
});

vi.mock("@mariozechner/pi-ai", async () => {
  const actual = await vi.importActual<any>("@mariozechner/pi-ai");
  return {
    ...actual,
    streamSimple: vi.fn(),
    getEnvApiKey: vi.fn(() => "fake-key"),
    getModel: vi.fn((provider: string, id: string) => ({
      provider,
      id,
      api: "anthropic-messages",
    })),
  };
});

import { runAgentSession, evictAgentCache } from "../agent/agent-session.js";

describe("runAgentSession cache — bookId switch", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "inkos-agent-cache-"));
    await mkdir(join(projectRoot, "books", "book-a", "story"), { recursive: true });
    await writeFile(
      join(projectRoot, "books", "book-a", "story", "story_bible.md"),
      "书A 的真相",
    );
    await mkdir(join(projectRoot, "books", "book-b", "story"), { recursive: true });
    await writeFile(
      join(projectRoot, "books", "book-b", "story", "story_bible.md"),
      "书B 的真相",
    );
    agentInstances.length = 0;
  });

  afterEach(async () => {
    evictAgentCache("s1");
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("rebuilds Agent when bookId changes for same sessionId", async () => {
    const model = { provider: "x", id: "y", api: "anthropic-messages" } as any;
    const pipeline = {} as any;

    await runAgentSession(
      { sessionId: "s1", bookId: "book-a", language: "zh", pipeline, projectRoot, model },
      "earlier question about book A",
    );
    expect(agentInstances).toHaveLength(1);

    await runAgentSession(
      { sessionId: "s1", bookId: "book-b", language: "zh", pipeline, projectRoot, model },
      "new question",
    );

    expect(agentInstances).toHaveLength(2);

    const injected = await agentInstances[1].transformContext([]);
    const body = JSON.stringify(injected);
    expect(body).toContain("书B 的真相");
    expect(body).not.toContain("书A 的真相");

    // Prior conversation must be replayed into the rebuilt Agent via initialMessages,
    // not silently dropped — this is the whole reason eviction preserves messages.
    const preservedUser = agentInstances[1].state.messages.find(
      (m: any) => m.role === "user" && typeof m.content === "string" && m.content.includes("earlier question about book A"),
    );
    expect(preservedUser).toBeDefined();
  });

  it("rebuilds Agent when bookId goes from null to a real book", async () => {
    const model = { provider: "x", id: "y", api: "anthropic-messages" } as any;
    const pipeline = {} as any;

    await runAgentSession(
      { sessionId: "s1", bookId: null, language: "zh", pipeline, projectRoot, model },
      "hi",
    );
    expect(agentInstances).toHaveLength(1);

    await runAgentSession(
      { sessionId: "s1", bookId: "book-a", language: "zh", pipeline, projectRoot, model },
      "hi",
    );

    expect(agentInstances).toHaveLength(2);
    const injected = await agentInstances[1].transformContext([]);
    expect(JSON.stringify(injected)).toContain("书A 的真相");
  });

  it("treats undefined bookId as null (no spurious rebuild)", async () => {
    const model = { provider: "x", id: "y", api: "anthropic-messages" } as any;
    const pipeline = {} as any;

    await runAgentSession(
      { sessionId: "s1", bookId: null, language: "zh", pipeline, projectRoot, model },
      "hi",
    );
    expect(agentInstances).toHaveLength(1);

    // A caller passing `undefined` (e.g., `activeBookId` not set and no `?? null`
    // guard) must not cause an eviction when the cached agent already holds null.
    await runAgentSession(
      { sessionId: "s1", bookId: undefined as any, language: "zh", pipeline, projectRoot, model },
      "hi",
    );

    expect(agentInstances).toHaveLength(1);
  });

  it("reuses Agent when bookId unchanged on same sessionId", async () => {
    const model = { provider: "x", id: "y", api: "anthropic-messages" } as any;
    const pipeline = {} as any;

    await runAgentSession(
      { sessionId: "s1", bookId: "book-a", language: "zh", pipeline, projectRoot, model },
      "hi",
    );
    await runAgentSession(
      { sessionId: "s1", bookId: "book-a", language: "zh", pipeline, projectRoot, model },
      "hi2",
    );

    expect(agentInstances).toHaveLength(1);
  });
});
