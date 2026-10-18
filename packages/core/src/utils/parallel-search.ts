import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { SearchResult } from "./web-search.js";

const ENDPOINT = "https://search.parallel.ai/mcp";
const USER_AGENT = "InkOS/2.0.0 (+https://github.com/Narcooo/inkos)";
// Direct library callers share an identity; the agent supplies its session identity.
const DEFAULT_SESSION_ID = randomUUID();
const HttpUrl = z.string().url().refine(value => /^https?:\/\//i.test(value));
const PayloadSchema = z.object({
  results: z.array(z.object({
    url: HttpUrl,
    title: z.string().nullish(),
    excerpts: z.array(z.string()),
    full_content: z.string().nullish(),
  })),
  errors: z.array(z.object({ url: z.string(), content: z.string().nullish() })).optional(),
});

export interface ParallelSearchOptions {
  readonly signal?: AbortSignal;
  readonly sessionId?: string;
}

async function callParallelTool(
  name: "web_search" | "web_fetch",
  args: Record<string, unknown>,
  options: ParallelSearchOptions,
) {
  const signal = AbortSignal.any([
    AbortSignal.timeout(15_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  signal.throwIfAborted();
  const client = new Client({ name: "inkos", version: "2.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    requestInit: { headers: { "User-Agent": USER_AGENT } },
    fetch: (input, init) => fetch(input, {
      ...init,
      signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
    }),
  });
  try {
    await client.connect(transport, { signal, timeout: 15_000 });
    const { tools } = await client.listTools({}, { signal, timeout: 15_000 });
    if (!tools.some(tool => tool.name === name)) throw new Error(`Parallel MCP does not offer ${name}.`);
    const result = CallToolResultSchema.parse(await client.callTool({
      name,
      arguments: { ...args, session_id: options.sessionId ?? DEFAULT_SESSION_ID },
    }, undefined, { signal, timeout: 15_000 }));
    const text = result.content.filter(item => item.type === "text").map(item => item.text).join("\n");
    if (result.isError) throw new Error(`Parallel ${name} failed: ${text}`);
    return PayloadSchema.parse(result.structuredContent ?? JSON.parse(text));
  } finally {
    await client.close();
  }
}

export async function searchParallel(
  query: string,
  maxResults: number,
  options: ParallelSearchOptions,
): Promise<ReadonlyArray<SearchResult>> {
  const data = await callParallelTool("web_search", { objective: query, search_queries: [query] }, options);
  return data.results.slice(0, maxResults).map(result => ({
    title: result.title ?? result.url,
    url: result.url,
    snippet: result.excerpts.join("\n\n"),
  }));
}

export async function fetchParallel(url: string, options: ParallelSearchOptions): Promise<string> {
  HttpUrl.parse(url);
  const data = await callParallelTool("web_fetch", { urls: [url] }, options);
  const result = data.results.find(result => result.url === url);
  if (!result) throw new Error(`Parallel fetch failed: ${data.errors?.[0]?.content ?? `No content returned for ${url}`}`);
  return result.full_content || result.excerpts.join("\n\n");
}
