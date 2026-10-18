import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProductionCapabilityRegistry } from "../harness/production-capabilities.js";
import { createBuiltInWorkProfileRegistry } from "../harness/builtin-profiles.js";
import { CreativeHarnessRuntime } from "../harness/runtime.js";
import { CreativeEpisodeStore } from "../harness/episode-store.js";
import { createCapabilityPiTools } from "../harness/pi-tools.js";
import { ResearchSearchConfigSchema } from "../models/project.js";

interface RequestRecord {
  url: string;
  headers: Headers;
  body: { method?: string; params?: { name?: string; arguments?: Record<string, unknown> }; id?: number };
}
const TOPIC = "Tang dynasty courier stations";
const SOURCE = "https://example.org/courier";
const requests: RequestRecord[] = [];
const roots: string[] = [];
const ledgers: CreativeEpisodeStore[] = [];
let fault = "";
let sse = false;
let onSearch: (() => void) | undefined;
let onFetch: (() => void) | undefined;

beforeEach(() => {
  requests.length = 0;
  fault = "";
  sse = false;
  onSearch = undefined;
  onFetch = undefined;
  vi.stubEnv("TAVILY_API_KEY", "");
  vi.stubEnv("PARALLEL_API_KEY", "must-not-be-sent");
  vi.stubEnv("CUSTOM_SEARCH_KEY", "");
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

afterEach(async () => {
  for (const ledger of ledgers.splice(0)) ledger.close();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function rpcResponse(id: number | undefined, result: unknown): Response {
  const payload = JSON.stringify({ jsonrpc: "2.0", id, result });
  return sse
    ? new Response(`event: message\ndata: ${payload}\n\n`, { headers: { "Content-Type": "text/event-stream" } })
    : Response.json(JSON.parse(payload));
}

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const body = JSON.parse(String(init?.body ?? "{}")) as RequestRecord["body"];
  requests.push({ url, body, headers: new Headers(init?.headers) });
  if (url === "https://api.tavily.com/search") return Response.json({ results: [{ title: "Courier stations", url: SOURCE, content: "Tavily overview" }] });
  if (url === SOURCE) return new Response("Directly fetched courier history");
  if (init?.method === "GET") return new Response(null, { status: 405 });
  if (body.method === "initialize") return rpcResponse(body.id, {
    protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" },
  });
  if (body.method === "notifications/initialized" || body.method === "notifications/cancelled") return new Response(null, { status: 202 });
  if (body.method === "tools/list") return rpcResponse(body.id, { tools: ["web_search", "web_fetch"].map(name => ({
    name, inputSchema: { type: "object", properties: {}, additionalProperties: true },
  })) });
  if (body.method !== "tools/call") throw new Error(`Unexpected fixture request: ${url}`);
  return toolResponse(body, init?.signal);
}

async function toolResponse(body: RequestRecord["body"], signal?: AbortSignal | null): Promise<Response> {
  const search = body.params?.name === "web_search";
  if (search) onSearch?.();
  else onFetch?.();
  if ((search && fault === "hang") || (!search && fault === "fetch-hang")) return new Promise((_resolve, reject) => {
    if (signal?.aborted) reject(signal.reason);
    else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  if (search && fault === "http") return new Response("Provider unavailable", { status: 503 });
  if (search && fault === "quota") return rpcResponse(body.id, {
    isError: true, content: [{ type: "text", text: "Anonymous search quota exceeded" }],
  });
  const data = { results: fault === "fetch" && !search ? [] : [{
    url: fault === "url" ? "javascript:alert(1)" : SOURCE,
    title: "Courier stations", excerpts: [search ? "Relay station overview" : "Couriers changed horses at relay stations."],
  }] };
  return rpcResponse(body.id, search && fault === "malformed"
    ? { content: [{ type: "text", text: "not JSON" }] }
    : { content: [{ type: "text", text: JSON.stringify(data) }], ...(search ? { structuredContent: data } : {}) });
}

async function harness(config?: unknown) {
  const root = await mkdtemp(join(tmpdir(), "inkos-search-"));
  roots.push(root);
  await mkdir(join(root, ".inkos"));
  if (config !== undefined) await writeFile(join(root, "inkos.json"), JSON.stringify({ researchSearch: config }));
  const registry = createProductionCapabilityRegistry({
    projectRoot: root, pipeline: {} as never, sessionId: "research-conversation", profileId: "workspace-default",
    work: null, language: "en", playWorldExists: false, sameSessionProposal: false, allowSystemFileRead: false,
  });
  const profiles = createBuiltInWorkProfileRegistry(root);
  const ledger = new CreativeEpisodeStore(join(root, ".inkos", "harness.sqlite"));
  ledgers.push(ledger);
  const runtime = new CreativeHarnessRuntime(root, registry, profiles, ledger);
  const handle = runtime.startEpisode({ profileId: "workspace-default" });
  const tools = createCapabilityPiTools({
    registry, profile: handle.profile,
    executeAction: (capabilityId, actionId, parameters, signal) => runtime.executeAction({
      handle, capabilityId, actionId, parameters, signal, source: "agent",
    }),
  });
  return { root, profiles, runtime, handle, tool: tools.find(tool => tool.name === "workspace__research_web")! };
}

function research(tool: Awaited<ReturnType<typeof harness>>["tool"], signal?: AbortSignal) {
  return tool.execute("research-call", { topic: TOPIC, purpose: "historical setting", depth: "quick" }, signal);
}

describe("production research search routing", () => {
  it.each([false, true])("uses anonymous Parallel through the dispatcher and saves consumed excerpts (SSE=%s)", async useSse => {
    sse = useSse;
    const { root, tool } = await harness();
    const result = await research(tool);
    expect(result.details).toMatchObject({ sources: [{ url: SOURCE, excerpt: "Couriers changed horses at relay stations." }], partialFailures: [] });
    const details = result.details as { reportPath: string };
    expect(await readFile(details.reportPath, "utf-8")).toContain("Couriers changed horses at relay stations.");
    expect(await readdir(root)).toEqual([".inkos"]);
    expect(requests.filter(r => r.body.method === "tools/call").map(r => r.body.params?.name)).toEqual(["web_search", "web_fetch"]);
    expect(requests.find(r => r.body.params?.name === "web_search")?.body.params?.arguments).toMatchObject({ objective: TOPIC, search_queries: [TOPIC] });
    expect(requests.find(r => r.body.params?.name === "web_fetch")?.body.params?.arguments).toMatchObject({ urls: [SOURCE] });
    for (const request of requests) {
      expect(request.url).toBe("https://search.parallel.ai/mcp");
      expect(request.headers.get("user-agent")).toBe("InkOS/2.0.0 (+https://github.com/Narcooo/inkos)");
      expect(request.headers.has("authorization")).toBe(false);
    }
    await research(tool);
    expect(new Set(requests.filter(r => r.body.method === "tools/call").map(r => r.body.params?.arguments?.session_id)).size).toBe(1);
  });

  it.each([
    { provider: "tavily", apiKey: "saved-key" },
    { provider: "custom", baseUrl: "https://search.example.org/search", apiKeyEnv: "CUSTOM_SEARCH_KEY" },
    { provider: "auto", apiKey: "saved-key" },
  ])("preserves configured choices without falling back on provider failure: %j", async config => {
    vi.stubEnv("CUSTOM_SEARCH_KEY", "custom-key");
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(init.body), headers: new Headers(init.headers) });
      return new Response("Configured provider failed", { status: 500 });
    }));
    const { tool } = await harness({ enabled: true, ...config });
    const result = await research(tool);
    expect(result.details).toMatchObject({ sources: [], partialFailures: [expect.stringContaining("Tavily search failed: 500")] });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(config.baseUrl ?? "https://api.tavily.com/search");
    expect(requests[0]!.headers.get("authorization")).toBe(`Bearer ${config.apiKey ?? "custom-key"}`);
  });

  it("keeps the ambient Tavily key in automatic mode, and honors an explicit Parallel override", async () => {
    vi.stubEnv("TAVILY_API_KEY", "ambient-key");
    const { tool } = await harness();
    expect((await research(tool)).details).toMatchObject({ sources: [{ url: SOURCE, excerpt: "Directly fetched courier history" }], partialFailures: [] });
    expect(requests[0]!.url).toBe("https://api.tavily.com/search");
    requests.length = 0;
    const explicit = await harness({ enabled: true, provider: "parallel", apiKey: "saved-key", baseUrl: "https://private.example.org" });
    await research(explicit.tool);
    expect(requests.every(r => r.url === "https://search.parallel.ai/mcp" && !r.headers.has("authorization"))).toBe(true);
  });

  it("does not replace a saved provider with a missing key", async () => {
    const { tool } = await harness({ enabled: true, provider: "tavily" });
    expect((await research(tool)).details).toMatchObject({ partialFailures: [expect.stringContaining("TAVILY_API_KEY not set")] });
    expect(requests).toHaveLength(0);
  });

  it("honors explicit disable even with ambient credentials", async () => {
    vi.stubEnv("TAVILY_API_KEY", "ambient-key");
    const { tool } = await harness({ enabled: false, provider: "tavily" });
    await expect(research(tool)).rejects.toThrow("disabled");
    expect(requests).toHaveLength(0);
    expect(ResearchSearchConfigSchema.parse({})).toEqual({ enabled: true, provider: "auto" });
  });

  it("enforces existing profile permissions before contacting search", async () => {
    const { profiles, runtime, handle } = await harness();
    profiles.register({ ...handle.profile, id: "no-network", capabilityIds: ["longform"] });
    const restricted = runtime.startEpisode({ profileId: "no-network" });
    await expect(runtime.executeAction({ handle: restricted, capabilityId: "workspace", actionId: "research_web", parameters: { topic: TOPIC, purpose: "setting" }, source: "agent" })).rejects.toThrow("cannot use capability");
    expect(requests).toHaveLength(0);
  });

  it.each(["quota", "http", "malformed", "url", "fetch"])("surfaces %s failures in the report without switching provider", async failure => {
    fault = failure;
    const { tool } = await harness();
    const result = await research(tool);
    expect(result.details).toMatchObject({ partialFailures: [expect.any(String)] });
    expect(requests.every(r => r.url === "https://search.parallel.ai/mcp")).toBe(true);
    if (failure === "fetch") expect(result.details).toMatchObject({ sources: [{ url: SOURCE, snippet: "Relay station overview" }] });
  });

  it.each(["hang", "fetch-hang"])("aborts in-flight %s requests and leaves no report", async stage => {
    fault = stage;
    const controller = new AbortController();
    const cancel = () => controller.abort(new Error("Author cancelled research"));
    if (stage === "hang") onSearch = cancel;
    else onFetch = cancel;
    const { root, tool } = await harness();
    await expect(research(tool, controller.signal)).rejects.toThrow("Author cancelled research");
    await expect(readdir(join(root, ".inkos", "research"))).rejects.toThrow("ENOENT");
    if (stage === "hang") expect(requests.some(r => r.body.params?.name === "web_fetch")).toBe(false);
  });

  it("rejects an already cancelled action before any network request", async () => {
    const { tool } = await harness();
    await expect(research(tool, AbortSignal.abort(new Error("Already cancelled")))).rejects.toThrow("Already cancelled");
    expect(requests).toHaveLength(0);
  });

  it.each(["hang", "fetch-hang"])("records %s deadline expiry as a partial failure", async stage => {
    fault = stage;
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(25));
    const { tool } = await harness();
    const result = await research(tool);
    expect(result.details).toMatchObject({ partialFailures: [expect.stringMatching(/timeout|timed out|aborted/i)] });
  });
});
