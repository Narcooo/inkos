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
      // PC 端 www.qidian.com/rank/ 被瑞数 probe.js 行为验证拦死(202 + 209B
      // 空壳挑战页),正则永远提不出书名;移动端 H5 同源榜单免验证。
      const url = "https://m.qidian.com/rank/";
      const res = await globalThis.fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; InkOS/0.1)" },
      });
      if (!res.ok) return { platform: "起点中文网", entries };
      const html = await res.text();

      // 移动端书卡 title 属性带固定后缀:<a ... title="夜无疆最新章节在线阅读" ...>
      const bookPattern = /title="([^"]+?)最新章节在线阅读"/g;
      let match: RegExpExecArray | null;
      const seen = new Set<string>();
      while ((match = bookPattern.exec(html)) !== null) {
        const title = match[1].trim();
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
