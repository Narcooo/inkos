import type { SearchResult } from "../utils/web-search.js";

/** Minimal search/fetch contract consumed by the research workflow. */
export interface ResearchProvider {
  readonly id: string;
  search(query: string, maxResults: number): Promise<ReadonlyArray<SearchResult>>;
  fetch(url: string, maxChars: number): Promise<string>;
}

