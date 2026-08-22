import type {
  RadarConfig,
  XquikRadarCategory,
  XquikRadarRegion,
  XquikRadarSourceName,
} from "../models/radar.js";

export interface RankingEntry {
  readonly title: string;
  readonly author: string;
  readonly category: string;
  readonly extra: string;
}

export interface PlatformRankings {
  readonly platform: string;
  readonly entries: ReadonlyArray<RankingEntry>;
}

/**
 * Pluggable data source for the Radar agent.
 * Implement this interface to feed custom ranking/trend data
 * (e.g. from OpenClaw, custom scrapers, paid APIs).
 */
export interface RadarSource {
  readonly name: string;
  fetch(): Promise<PlatformRankings>;
}

/**
 * Wraps raw natural language text as a radar source.
 * Use this to inject external analysis (e.g. from OpenClaw) into the radar pipeline.
 */
export class TextRadarSource implements RadarSource {
  readonly name: string;
  private readonly text: string;

  constructor(text: string, name = "external") {
    this.name = name;
    this.text = text;
  }

  async fetch(): Promise<PlatformRankings> {
    return {
      platform: this.name,
      entries: [{ title: this.text, author: "", category: "", extra: "[外部分析]" }],
    };
  }
}

export interface XquikRadarSourceOptions {
  readonly apiKey: string;
  readonly category?: XquikRadarCategory;
  readonly region?: XquikRadarRegion;
  readonly hours?: number;
  readonly limit?: number;
  readonly source?: XquikRadarSourceName;
  readonly fetchImpl?: typeof fetch;
}

interface XquikRadarItem {
  readonly title: string;
  readonly description?: string;
  readonly url?: string;
  readonly score: number;
  readonly category: string;
  readonly source: string;
  readonly region: string;
  readonly publishedAt: string;
}

const XQUIK_RADAR_URL = "https://xquik.com/api/v1/radar";

export class XquikRadarSource implements RadarSource {
  readonly name = "xquik";
  private readonly apiKey: string;
  private readonly category: XquikRadarCategory;
  private readonly region: XquikRadarRegion;
  private readonly hours: number;
  private readonly limit: number;
  private readonly source?: XquikRadarSourceName;
  private readonly fetchImpl: typeof fetch;

  constructor(options: XquikRadarSourceOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new Error("Xquik radar requires an API key.");
    this.apiKey = apiKey;
    this.category = options.category ?? "entertainment";
    this.region = options.region ?? "global";
    this.hours = boundedInteger(options.hours ?? 24, "hours", 1, 72);
    this.limit = boundedInteger(options.limit ?? 30, "limit", 1, 100);
    this.source = options.source;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async fetch(): Promise<PlatformRankings> {
    const url = new URL(XQUIK_RADAR_URL);
    url.searchParams.set("category", this.category);
    url.searchParams.set("region", this.region);
    url.searchParams.set("hours", String(this.hours));
    url.searchParams.set("limit", String(this.limit));
    if (this.source) url.searchParams.set("source", this.source);

    const response = await this.fetchImpl(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "InkOS market-radar",
        "x-api-key": this.apiKey,
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`Xquik radar request failed with HTTP ${response.status}.`);
    }

    const payload = await readJsonResponse(response);
    return {
      platform: "Xquik Radar",
      entries: payload.items.map((item, index) => mapXquikRadarItem(item, index)),
    };
  }
}

export function createConfiguredRadarSources(
  config: RadarConfig,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): ReadonlyArray<RadarSource> | undefined {
  const xquik = config?.xquik;
  if (!xquik?.enabled) return undefined;
  const apiKey = env[xquik.apiKeyEnv]?.trim();
  if (!apiKey) {
    throw new Error(`${xquik.apiKeyEnv} not set. Configure it before running radar.`);
  }
  return [
    new FanqieRadarSource(),
    new QidianRadarSource(),
    new XquikRadarSource({
      apiKey,
      category: xquik.category,
      region: xquik.region,
      hours: xquik.hours,
      limit: xquik.limit,
      source: xquik.source,
    }),
  ];
}

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Xquik radar ${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

async function readJsonResponse(response: Response): Promise<{ readonly items: ReadonlyArray<unknown> }> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Xquik radar returned invalid JSON.");
  }
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new Error("Xquik radar response is missing items.");
  }
  return { items: payload.items };
}

function mapXquikRadarItem(value: unknown, index: number): RankingEntry {
  if (!isRecord(value)) throw invalidRadarItem(index);
  const description = optionalString(value.description);
  const url = optionalString(value.url);
  const item: XquikRadarItem = {
    title: requiredString(value.title, index),
    score: requiredNumber(value.score, index),
    category: requiredString(value.category, index),
    source: requiredString(value.source, index),
    region: requiredString(value.region, index),
    publishedAt: requiredString(value.publishedAt, index),
    ...(description ? { description } : {}),
    ...(url ? { url } : {}),
  };
  const details = [
    `[score=${item.score}; source=${item.source}; region=${item.region}; published=${item.publishedAt}]`,
    item.description,
    item.url,
  ].filter((part): part is string => Boolean(part));
  return {
    title: item.title,
    author: "",
    category: item.category,
    extra: details.join(" "),
  };
}

function requiredString(value: unknown, index: number): string {
  const text = optionalString(value);
  if (!text) throw invalidRadarItem(index);
  return text;
}

function requiredNumber(value: unknown, index: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalidRadarItem(index);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function invalidRadarItem(index: number): Error {
  return new Error(`Xquik radar item ${index} does not match the public contract.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Built-in sources
// ---------------------------------------------------------------------------

const FANQIE_RANK_TYPES = [
  { sideType: 10, label: "热门榜" },
  { sideType: 13, label: "黑马榜" },
] as const;

export class FanqieRadarSource implements RadarSource {
  readonly name = "fanqie";

  async fetch(): Promise<PlatformRankings> {
    const entries: RankingEntry[] = [];

    for (const { sideType, label } of FANQIE_RANK_TYPES) {
      try {
        const url = `https://api-lf.fanqiesdk.com/api/novel/channel/homepage/rank/rank_list/v2/?aid=13&limit=15&offset=0&side_type=${sideType}`;
        const res = await globalThis.fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; InkOS/0.1)" },
        });
        if (!res.ok) continue;
        const data = (await res.json()) as Record<string, unknown>;
        const list = (data as { data?: { result?: unknown[] } }).data?.result;
        if (!Array.isArray(list)) continue;

        for (const item of list) {
          const rec = item as Record<string, unknown>;
          entries.push({
            title: String(rec.book_name ?? ""),
            author: String(rec.author ?? ""),
            category: String(rec.category ?? ""),
            extra: `[${label}]`,
          });
        }
      } catch {
        // skip on network error
      }
    }

    return { platform: "番茄小说", entries };
  }
}

export class QidianRadarSource implements RadarSource {
  readonly name = "qidian";

  async fetch(): Promise<PlatformRankings> {
    const entries: RankingEntry[] = [];

    try {
      const url = "https://www.qidian.com/rank/";
      const res = await globalThis.fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      if (!res.ok) return { platform: "起点中文网", entries };
      const html = await res.text();

      const bookPattern =
        /<a[^>]*href="\/\/book\.qidian\.com\/info\/(\d+)"[^>]*>([^<]+)<\/a>/g;
      let match: RegExpExecArray | null;
      const seen = new Set<string>();
      while ((match = bookPattern.exec(html)) !== null) {
        const title = match[2].trim();
        if (title && !seen.has(title) && title.length > 1 && title.length < 30) {
          seen.add(title);
          entries.push({ title, author: "", category: "", extra: "[起点热榜]" });
        }
        if (entries.length >= 20) break;
      }
    } catch {
      // skip on network error
    }

    return { platform: "起点中文网", entries };
  }
}
