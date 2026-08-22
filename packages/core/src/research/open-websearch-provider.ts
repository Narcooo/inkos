import type { SearchResult } from "../utils/web-search.js";
import type { ResearchProvider } from "./provider.js";

interface OpenWebSearchErrorPayload {
  readonly code?: string;
  readonly message?: string;
  readonly details?: Record<string, unknown>;
}

interface OpenWebSearchEnvelope<T> {
  readonly status: "ok" | "error";
  readonly data: T | null;
  readonly error: OpenWebSearchErrorPayload | null;
}

interface OpenWebSearchResult {
  readonly title?: string;
  readonly url?: string;
  readonly description?: string;
}

interface OpenWebSearchResponse {
  readonly results?: ReadonlyArray<OpenWebSearchResult>;
}

interface OpenWebFetchResponse {
  readonly content?: string;
}

export interface OpenWebSearchProviderOptions {
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly engines?: ReadonlyArray<string>;
  readonly searchMode?: "request" | "auto" | "playwright";
  readonly fetchFn?: typeof fetch;
}

export class OpenWebSearchProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "OpenWebSearchProviderError";
  }
}

/** Adapter for the Apache-2.0 open-webSearch local HTTP daemon. */
export class OpenWebSearchProvider implements ResearchProvider {
  readonly id = "open-websearch";
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly engines?: ReadonlyArray<string>;
  private readonly searchMode?: "request" | "auto" | "playwright";
  private readonly fetchFn: typeof fetch;

  constructor(options: OpenWebSearchProviderOptions = {}) {
    this.endpoint = normalizeLoopbackEndpoint(options.endpoint ?? "http://127.0.0.1:3210");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.engines = options.engines;
    this.searchMode = options.searchMode;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  async search(query: string, maxResults: number): Promise<ReadonlyArray<SearchResult>> {
    const data = await this.request<OpenWebSearchResponse>("/search", {
      query,
      limit: maxResults,
      ...(this.engines?.length ? { engines: [...this.engines] } : {}),
      ...(this.searchMode ? { searchMode: this.searchMode } : {}),
    });
    return (data.results ?? [])
      .filter((result) => Boolean(result.url))
      .slice(0, maxResults)
      .map((result) => ({
        title: result.title ?? result.url ?? "",
        url: result.url ?? "",
        snippet: result.description ?? "",
      }));
  }

  async fetch(url: string, maxChars: number): Promise<string> {
    const data = await this.request<OpenWebFetchResponse>("/fetch-web", {
      url,
      maxChars,
      readability: true,
      includeLinks: false,
    });
    return (data.content ?? "").slice(0, maxChars);
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchFn(`${this.endpoint}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      throw new OpenWebSearchProviderError(
        timedOut
          ? `open-webSearch request timed out after ${this.timeoutMs}ms.`
          : `Could not connect to open-webSearch: ${error instanceof Error ? error.message : String(error)}`,
        timedOut ? "timeout" : "connection_failed",
      );
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text();
    let envelope: OpenWebSearchEnvelope<T>;
    try {
      envelope = JSON.parse(raw) as OpenWebSearchEnvelope<T>;
    } catch {
      throw new OpenWebSearchProviderError(
        "open-webSearch returned invalid JSON.",
        "invalid_json",
        response.status,
        { responsePreview: raw.slice(0, 200) },
      );
    }

    if (!response.ok || envelope.status === "error") {
      throw new OpenWebSearchProviderError(
        envelope.error?.message ?? `open-webSearch request failed with HTTP ${response.status}.`,
        envelope.error?.code ?? "daemon_error",
        response.status,
        envelope.error?.details,
      );
    }
    if (envelope.status !== "ok" || envelope.data === null) {
      throw new OpenWebSearchProviderError("open-webSearch response data is missing.", "missing_data", response.status);
    }
    return envelope.data;
  }
}

function normalizeLoopbackEndpoint(endpoint: string): string {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new OpenWebSearchProviderError("open-webSearch endpoint must be a valid URL.", "invalid_endpoint");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !["http:", "https:"].includes(parsed.protocol)
    || Boolean(parsed.username)
    || Boolean(parsed.password)
    || !["127.0.0.1", "localhost", "::1"].includes(hostname)
  ) {
    throw new OpenWebSearchProviderError(
      "open-webSearch endpoint must use HTTP(S), contain no credentials, and point to loopback.",
      "invalid_endpoint",
    );
  }
  return parsed.toString().replace(/\/+$/, "");
}
