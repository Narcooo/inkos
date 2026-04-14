import { BaseAgent } from "./base.js";
import type { Platform, Genre } from "../models/book.js";
import type { RadarSource, PlatformRankings } from "./radar-source.js";
import { FanqieRadarSource, QidianRadarSource } from "./radar-source.js";

export interface RadarResult {
  readonly recommendations: ReadonlyArray<RadarRecommendation>;
  readonly marketSummary: string;
  readonly timestamp: string;
}

export interface RadarRecommendation {
  readonly platform: Platform;
  readonly genre: Genre;
  readonly concept: string;
  readonly confidence: number;
  readonly reasoning: string;
  readonly benchmarkTitles: ReadonlyArray<string>;
}

const DEFAULT_SOURCES: ReadonlyArray<RadarSource> = [
  new FanqieRadarSource(),
  new QidianRadarSource(),
];

function formatRankingsForPrompt(rankings: ReadonlyArray<PlatformRankings>): string {
  const sections = rankings
    .filter((r) => r.entries.length > 0)
    .map((r) => {
      const lines = r.entries.map(
        (e) => `- ${e.title}${e.author ? ` (${e.author})` : ""}${e.category ? ` [${e.category}]` : ""} ${e.extra}`,
      );
      return `### ${r.platform}\n${lines.join("\n")}`;
    });

  return sections.length > 0
    ? sections.join("\n\n")
    : "（未能获取到实时排行数据，请基于你的知识分析）";
}

export class RadarAgent extends BaseAgent {
  private readonly sources: ReadonlyArray<RadarSource>;

  constructor(
    ctx: ConstructorParameters<typeof BaseAgent>[0],
    sources?: ReadonlyArray<RadarSource>,
  ) {
    super(ctx);
    this.sources = sources ?? DEFAULT_SOURCES;
  }

  get name(): string {
    return "radar";
  }

  async scan(): Promise<RadarResult> {
    const rankings = await Promise.all(this.sources.map((s) => s.fetch()));
    const rankingsText = formatRankingsForPrompt(rankings);

    const systemPrompt = `你是一个专业的网络小说市场分析师。下面是从各平台实时抓取的排行榜数据，请基于这些真实数据分析市场趋势。

## 实时排行榜数据

${rankingsText}

分析维度：
1. 从排行榜数据中识别当前热门题材和标签
2. 分析哪些类型的作品占据榜单高位
3. 发现市场空白和机会点（榜单上缺少但有潜力的方向）
4. 风险提示（榜单上过度扎堆的题材）

输出格式必须为 JSON：
{
  "recommendations": [
    {
      "platform": "平台名",
      "genre": "题材类型",
      "concept": "一句话概念描述",
      "confidence": 0.0-1.0,
      "reasoning": "推荐理由（引用具体榜单数据）",
      "benchmarkTitles": ["对标书1", "对标书2"]
    }
  ],
  "marketSummary": "整体市场概述（基于真实榜单数据）"
}

推荐数量：3-5个，按 confidence 降序排列。`;

    const response = await this.chat(
      [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `请基于上面的实时排行榜数据，分析当前网文市场热度，给出开书建议。`,
        },
      ],
      { temperature: 0.6 },
    );

    return this.parseResult(response.content);
  }

  private parseResult(content: string): RadarResult {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Radar output format error: no JSON found");
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        recommendations: parsed.recommendations ?? [],
        marketSummary: parsed.marketSummary ?? "",
        timestamp: new Date().toISOString(),
      };
    } catch (e) {
      throw new Error(`Radar JSON parse error: ${e}`);
    }
  }
}
