import { fetchUrl, searchWeb, type SearchResult } from "../utils/web-search.js";
import type { ResearchProvider } from "../research/provider.js";

export type ResearchPurpose = string;
export type ResearchDepth = "quick" | "standard" | "deep";

export interface ResearchInput {
  readonly topic: string;
  readonly purpose: ResearchPurpose;
  readonly depth: ResearchDepth;
}

export interface ResearchSource {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly excerpt?: string;
}

export interface ResearchReport {
  readonly summary: string;
  readonly sources: readonly ResearchSource[];
  readonly queryLog: readonly string[];
  readonly partialFailures: readonly string[];
  readonly markdown: string;
}

export interface ResearchDeps {
  readonly provider?: ResearchProvider;
  readonly search?: (query: string, maxResults: number) => Promise<ReadonlyArray<SearchResult>>;
  readonly fetch?: (url: string) => Promise<string>;
}

export async function runResearchReport(
  input: ResearchInput,
  deps: ResearchDeps = {},
): Promise<ResearchReport> {
  const topic = input.topic.trim();
  if (!topic) throw new Error("research topic is required.");
  const search = deps.search ?? deps.provider?.search.bind(deps.provider) ?? searchWeb;
  const fetch = deps.fetch ?? deps.provider?.fetch.bind(deps.provider) ?? fetchUrl;
  const depth = depthConfig(input.depth);
  const queries = buildQueries(topic, input.purpose, input.depth);
  const queryLog: string[] = [];
  const partialFailures: string[] = [];
  const found = new Map<string, SearchResult>();

  for (const query of queries) {
    queryLog.push(query);
    try {
      const results = await search(query, depth.maxResults);
      for (const result of results) {
        if (!result.url || found.has(result.url)) continue;
        found.set(result.url, result);
      }
    } catch (error) {
      partialFailures.push(`search failed for "${query}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const sources: ResearchSource[] = [];
  for (const result of [...found.values()].slice(0, depth.fetchCount)) {
    let excerpt: string | undefined;
    try {
      excerpt = await fetch(result.url);
    } catch (error) {
      partialFailures.push(`fetch failed for "${result.url}": ${error instanceof Error ? error.message : String(error)}`);
    }
    sources.push({
      id: `S${sources.length + 1}`,
      title: result.title || result.url,
      url: result.url,
      snippet: result.snippet,
      ...(excerpt ? { excerpt } : {}),
    });
  }

  const report = {
    summary: `Research collected ${sources.length} source(s) for "${topic}" (${input.purpose}, ${input.depth}).`,
    sources,
    queryLog,
    partialFailures,
  };
  return {
    ...report,
    markdown: renderResearchMarkdown(topic, input, report),
  };
}

function depthConfig(depth: ResearchDepth): { maxResults: number; fetchCount: number } {
  if (depth === "deep") return { maxResults: 8, fetchCount: 6 };
  if (depth === "standard") return { maxResults: 5, fetchCount: 4 };
  return { maxResults: 3, fetchCount: 2 };
}

function buildQueries(topic: string, _purpose: ResearchPurpose, _depth: ResearchDepth): string[] {
  return [topic];
}

function renderResearchMarkdown(
  topic: string,
  input: ResearchInput,
  report: Omit<ResearchReport, "markdown">,
): string {
  return [
    `# Research: ${topic}`,
    "",
    `- Purpose: ${input.purpose}`,
    `- Depth: ${input.depth}`,
    "## Summary",
    report.summary,
    "",
    "## Sources",
    ...(report.sources.length > 0
      ? report.sources.map((source) => [
          `### [${source.id}] ${source.title}`,
          source.url,
          "",
          source.excerpt || source.snippet || "",
        ].join("\n"))
      : ["No sources collected."]),
    "",
    "## Query log",
    ...report.queryLog.map((query) => `- ${query}`),
    "",
    "## Partial failures",
    ...(report.partialFailures.length > 0 ? report.partialFailures.map((item) => `- ${item}`) : ["- None."]),
    "",
  ].join("\n");
}
