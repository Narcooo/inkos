/**
 * Web search + URL fetch utilities.
 *
 * searchWeb(): keyless Parallel MCP, or a configured Tavily-compatible API.
 * fetchUrl(): Fetch a specific URL and return plain text.
 */

import { fetchParallel, searchParallel, type ParallelSearchOptions } from "./parallel-search.js";

export interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

export interface WebSearchOptions extends ParallelSearchOptions {
  readonly provider?: "auto" | "parallel" | "tavily" | "custom";
  readonly apiKey?: string;
  readonly apiKeyEnv?: string;
  readonly baseUrl?: string;
}

/**
 * Auto preserves configured Tavily credentials/endpoints, otherwise uses Parallel.
 * Explicit provider failures surface to the caller without switching providers.
 */
export async function searchWeb(
  query: string,
  maxResults = 5,
  options: WebSearchOptions = {},
): Promise<ReadonlyArray<SearchResult>> {
  options.signal?.throwIfAborted();
  if (resolveSearchProvider(options) === "parallel") return searchParallel(query, maxResults, options);
  const apiKey = options.apiKey
    || (options.apiKeyEnv ? process.env[options.apiKeyEnv] : undefined)
    || process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error(`${options.apiKeyEnv ?? "TAVILY_API_KEY"} not set. Configure Studio research search or set the env var to enable web search.`);
  }

  const endpoint = options.baseUrl?.trim() || "https://api.tavily.com/search";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      search_depth: "basic",
    }),
    signal: researchSignal(options.signal),
  });

  if (!res.ok) {
    throw new Error(`Tavily search failed: ${res.status} ${await res.text().catch(() => "")}`);
  }

  const data = await res.json() as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
  }));
}

export function resolveSearchProvider(options: WebSearchOptions = {}): "parallel" | "tavily" {
  if (options.provider === "parallel") return "parallel";
  if (options.provider === "tavily" || options.provider === "custom") return "tavily";
  return options.apiKey || options.apiKeyEnv || options.baseUrl || process.env.TAVILY_API_KEY
    ? "tavily"
    : "parallel";
}

export async function fetchResearchUrl(url: string, options: WebSearchOptions): Promise<string> {
  return resolveSearchProvider(options) === "parallel"
    ? fetchParallel(url, options)
    : fetchUrl(url, options.signal);
}

function researchSignal(signal?: AbortSignal): AbortSignal {
  return AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]);
}

/**
 * Fetch a URL and return its complete text content.
 * HTML is stripped to plain text. Context budgeting happens at the consumer.
 */
export async function fetchUrl(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept": "text/html, application/json, text/plain",
    },
    signal: researchSignal(signal),
  });

  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();

  if (contentType.includes("html")) {
    return text
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return text;
}
