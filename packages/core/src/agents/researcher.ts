import { fetchUrl, searchWeb, type SearchResult } from "../utils/web-search.js";
import type { ResearchProvider } from "../research/provider.js";

export type ResearchPurpose = "worldbuilding" | "era" | "profession" | "market" | "fact-check" | "general";
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

export interface ResearchClaim {
  readonly text: string;
  readonly sourceIds: readonly string[];
  readonly confidence: "low" | "medium" | "high";
}

export interface ResearchReport {
  readonly summary: string;
  readonly claims: readonly ResearchClaim[];
  readonly conflicts: readonly string[];
  readonly unknowns: readonly string[];
  readonly creativeImplications: readonly string[];
  readonly sources: readonly ResearchSource[];
  readonly confidence: "low" | "medium" | "high";
  readonly queryLog: readonly string[];
  readonly partialFailures: readonly string[];
  readonly markdown: string;
}

export interface ResearchDeps {
  readonly provider?: ResearchProvider;
  readonly search?: (query: string, maxResults: number) => Promise<ReadonlyArray<SearchResult>>;
  readonly fetch?: (url: string, maxChars: number) => Promise<string>;
}

const PURPOSE_HINTS: Record<ResearchPurpose, string> = {
  worldbuilding: "世界观 背景 生活细节",
  era: "年代 背景 制度 物价 生活",
  profession: "职业 流程 术语 工作细节",
  market: "市场 趋势 受众 竞品",
  "fact-check": "事实核查 来源",
  general: "资料 参考",
};

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

  for (const query of queries.slice(0, depth.queryCount)) {
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
      excerpt = await fetch(result.url, 1800);
    } catch (error) {
      partialFailures.push(`fetch failed for "${result.url}": ${error instanceof Error ? error.message : String(error)}`);
    }
    sources.push({
      id: `S${sources.length + 1}`,
      title: result.title || result.url,
      url: result.url,
      snippet: result.snippet,
      ...(excerpt ? { excerpt: firstSentences(excerpt, 3) } : {}),
    });
  }

  const claims = sources.map((source): ResearchClaim => ({
    text: firstSentences(source.excerpt || source.snippet || source.title, 1) || source.title,
    sourceIds: [source.id],
    confidence: source.excerpt ? "medium" : "low",
  }));
  const unknowns = sources.length === 0
    ? ["No usable sources were collected. Treat this report as incomplete."]
    : partialFailures.length > 0
      ? ["Some queries or source fetches failed; verify critical facts before using them as hard canon."]
      : [];
  const confidence: ResearchReport["confidence"] = sources.length >= 3 && partialFailures.length === 0
    ? "high"
    : sources.length >= 1
      ? "medium"
      : "low";
  const report = {
    summary: `Research collected ${sources.length} source(s) for "${topic}" (${input.purpose}, ${input.depth}).`,
    claims,
    conflicts: [],
    unknowns,
    creativeImplications: buildCreativeImplications(input.purpose, sources.length),
    sources,
    confidence,
    queryLog,
    partialFailures,
  };
  return {
    ...report,
    markdown: renderResearchMarkdown(topic, input, report),
  };
}

function depthConfig(depth: ResearchDepth): { queryCount: number; maxResults: number; fetchCount: number } {
  if (depth === "deep") return { queryCount: 3, maxResults: 5, fetchCount: 6 };
  if (depth === "standard") return { queryCount: 2, maxResults: 4, fetchCount: 4 };
  return { queryCount: 1, maxResults: 3, fetchCount: 2 };
}

function buildQueries(topic: string, purpose: ResearchPurpose, depth: ResearchDepth): string[] {
  const hint = PURPOSE_HINTS[purpose];
  const queries = [`${topic} ${hint}`];
  if (depth !== "quick") queries.push(`${topic} 资料 来源`);
  if (depth === "deep") queries.push(`${topic} 争议 误区 核查`);
  return queries;
}

function firstSentences(text: string, maxSentences: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const parts = normalized.match(/[^。！？.!?]+[。！？.!?]?/g) ?? [normalized];
  return parts.slice(0, maxSentences).join("").trim().slice(0, 700);
}

function buildCreativeImplications(purpose: ResearchPurpose, sourceCount: number): string[] {
  if (sourceCount === 0) return ["Do not promote any collected item to hard story canon yet."];
  if (purpose === "profession") return ["Use workflow details and terminology as texture, but keep hard claims source-backed."];
  if (purpose === "era") return ["Use era constraints to police anachronisms in scenes, props, dialogue, and institutions."];
  if (purpose === "worldbuilding") return ["Convert verified social, material, and institutional details into scene rules rather than exposition dumps."];
  if (purpose === "market") return ["Treat market observations as positioning hints, not as story canon."];
  if (purpose === "fact-check") return ["Facts with only one source should remain soft until cross-checked."];
  return ["Use sourced details as references; unresolved points should stay out of hard canon."];
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
    `- Confidence: ${report.confidence}`,
    "",
    "## Summary",
    report.summary,
    "",
    "## Claims",
    ...(report.claims.length > 0
      ? report.claims.map((claim) => `- ${claim.text} (${claim.sourceIds.map((id) => `[${id}]`).join(", ")}, ${claim.confidence})`)
      : ["- No sourced claims collected."]),
    "",
    "## Conflicts",
    ...(report.conflicts.length > 0 ? report.conflicts.map((item) => `- ${item}`) : ["- None detected by the collection pass."]),
    "",
    "## Unknowns",
    ...(report.unknowns.length > 0 ? report.unknowns.map((item) => `- ${item}`) : ["- None recorded."]),
    "",
    "## Creative implications",
    ...report.creativeImplications.map((item) => `- ${item}`),
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
