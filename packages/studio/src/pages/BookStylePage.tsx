import { useState, useEffect, useCallback, useMemo } from "react";
import { fetchJson, postApi, useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import {
  Wand2,
  BarChart3,
  RotateCcw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Info,
} from "lucide-react";

// ── Types ──

interface ChapterSummary {
  readonly number: number;
  readonly title: string;
  readonly status?: string;
  readonly wordCount?: number;
}

interface StyleProfile {
  readonly chapterNumber: number;
  readonly title: string;
  readonly avgSentenceLength: number;
  readonly sentenceLengthStdDev: number;
  readonly avgParagraphLength: number;
  readonly vocabularyDiversity: number;
  readonly topPatterns: readonly string[];
  readonly rhetoricalFeatures: readonly string[];
  readonly wordCount: number;
}

interface CompareResult {
  readonly chapterNumber: number;
  readonly title: string;
  readonly profile: StyleProfile;
  readonly deviationFromAverage: {
    readonly avgSentenceLength: number;
    readonly sentenceLengthStdDev: number;
    readonly avgParagraphLength: number;
    readonly vocabularyDiversity: number;
  };
}

interface StyleAnomaly {
  readonly chapterNumber: number;
  readonly dimension: string;
  readonly value: number;
  readonly average: number;
  readonly deviation: number;
}

interface StyleAnalyzeResult {
  readonly chapters: readonly StyleProfile[];
  readonly comparison: readonly CompareResult[];
  readonly averageProfile: {
    readonly avgSentenceLength: number;
    readonly sentenceLengthStdDev: number;
    readonly avgParagraphLength: number;
    readonly vocabularyDiversity: number;
  } | null;
  readonly anomalies: readonly StyleAnomaly[];
  readonly failedChapters?: readonly number[];
}

interface BookConfig {
  readonly id: string;
  readonly title: string;
  readonly genre?: string;
  readonly language?: string;
}

interface Nav { toDashboard: () => void; toBook: (id: string) => void }

// ── Dimension Labels ──

const DIMENSION_LABELS: Record<string, string> = {
  avgSentenceLength: "平均句长",
  sentenceLengthStdDev: "句长标准差",
  avgParagraphLength: "平均段长",
  vocabularyDiversity: "词汇多样性",
};

const DIMENSION_UNITS: Record<string, string> = {
  avgSentenceLength: "字",
  sentenceLengthStdDev: "字",
  avgParagraphLength: "字",
  vocabularyDiversity: "%",
};

function formatDimValue(dim: string, value: number): string {
  if (dim === "vocabularyDiversity") return `${(value * 100).toFixed(0)}%`;
  return value.toFixed(1);
}

function formatDimDeviation(dim: string, value: number): string {
  const prefix = value > 0 ? "+" : "";
  if (dim === "vocabularyDiversity") return `${prefix}${(value * 100).toFixed(0)}%`;
  return `${prefix}${value.toFixed(1)}`;
}

// ── Sub-components ──

function MetricCard({
  label,
  value,
  deviation,
  unit,
  highlight,
}: {
  label: string;
  value: string;
  deviation?: string;
  unit: string;
  highlight?: "good" | "warn" | "info";
}) {
  const borderColor =
    highlight === "warn"
      ? "border-l-amber-500 bg-amber-50/50"
      : highlight === "good"
        ? "border-l-emerald-500 bg-emerald-50/50"
        : "border-l-border bg-card";
  const textColor = highlight === "warn" ? "text-amber-700" : highlight === "good" ? "text-emerald-700" : "text-foreground";

  return (
    <div className={`border-l-[3px] rounded-r-lg p-3 ${borderColor}`}>
      <div className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-bold font-mono ${textColor}`}>{value}<span className="text-xs font-normal text-muted-foreground ml-1">{unit}</span></div>
      {deviation !== undefined && (
        <div className={`text-xs font-mono mt-0.5 ${highlight === "warn" ? "text-amber-600" : "text-muted-foreground"}`}>
          偏离平均 {deviation}
        </div>
      )}
    </div>
  );
}

function ChapterSelectBar({
  chapters,
  selected,
  onChange,
}: {
  chapters: readonly ChapterSummary[];
  selected: Set<number>;
  onChange: (selected: Set<number>) => void;
}) {
  const allSelected = selected.size === chapters.length;

  const toggleAll = () => {
    if (allSelected) {
      onChange(new Set());
    } else {
      onChange(new Set(chapters.map((ch) => ch.number)));
    }
  };

  const toggleChapter = (num: number) => {
    const next = new Set(selected);
    if (next.has(num)) {
      next.delete(num);
    } else {
      next.add(num);
    }
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="accent-amber-600 w-3.5 h-3.5"
          />
          <span>全选（{chapters.length} 章）</span>
        </label>
        <span className="text-xs text-muted-foreground">
          {selected.size > 0 ? `已选 ${selected.size} 章` : "未选择"}
        </span>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {chapters.map((ch) => (
          <button
            key={ch.number}
            type="button"
            onClick={() => toggleChapter(ch.number)}
            className={`px-2 py-1 text-xs rounded-md border transition-all ${
              selected.has(ch.number)
                ? "bg-amber-100 border-amber-400 text-amber-800 font-medium"
                : "bg-card border-border/60 text-muted-foreground hover:border-amber-300"
            }`}
          >
            第{ch.number}章
          </button>
        ))}
      </div>
    </div>
  );
}

function ComparisonMatrix({
  comparison,
  averageProfile,
}: {
  comparison: readonly CompareResult[];
  averageProfile: StyleAnalyzeResult["averageProfile"];
}) {
  if (!comparison.length || !averageProfile) return null;

  const dims = ["avgSentenceLength", "sentenceLengthStdDev", "avgParagraphLength", "vocabularyDiversity"] as const;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-border/60">
            <th className="text-left py-2 pr-3 text-muted-foreground font-medium">章节</th>
            {dims.map((dim) => (
              <th key={dim} className="text-right px-2 py-2 text-muted-foreground font-medium">
                {DIMENSION_LABELS[dim]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border/40 bg-muted/30">
            <td className="py-2 pr-3 font-semibold text-foreground">平均</td>
            {dims.map((dim) => (
              <td key={dim} className="text-right px-2 py-2 font-semibold text-foreground">
                {formatDimValue(dim, averageProfile[dim])}
              </td>
            ))}
          </tr>
          {comparison.map((ch) => (
            <tr key={ch.chapterNumber} className="border-b border-border/20 hover:bg-muted/20">
              <td className="py-2 pr-3 text-muted-foreground">第{ch.chapterNumber}章</td>
              {dims.map((dim) => {
                const val = ch.profile[dim];
                const dev = ch.deviationFromAverage[dim];
                const absDev = Math.abs(dev);
                const avgVal = averageProfile[dim];
                const isAnomaly = avgVal > 0 && absDev > avgVal * 0.5;
                return (
                  <td
                    key={dim}
                    className={`text-right px-2 py-2 ${isAnomaly ? "text-amber-700 font-bold" : "text-foreground"}`}
                  >
                    {formatDimValue(dim, val)}
                    <span className={`ml-1 ${isAnomaly ? "text-amber-600" : "text-muted-foreground/60"}`}>
                      ({formatDimDeviation(dim, dev)})
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnomalyList({ anomalies, chapters }: { anomalies: readonly StyleAnomaly[]; chapters: readonly StyleProfile[] }) {
  if (!anomalies.length) {
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-600 py-4">
        <CheckCircle2 size={16} />
        <span>未检测到明显异常，所有章节文风一致。</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {anomalies.map((a, i) => {
        const ch = chapters.find((c) => c.chapterNumber === a.chapterNumber);
        const dimLabel = DIMENSION_LABELS[a.dimension] ?? a.dimension;
        const dir = a.deviation > 0 ? "偏高" : "偏低";
        return (
          <div key={i} className="border-l-[3px] border-l-amber-500 bg-amber-50/70 rounded-r-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle size={14} className="text-amber-600" />
              <span className="text-xs font-semibold font-mono px-2 py-0.5 rounded-sm bg-amber-500/10 text-amber-700">
                {dimLabel} {dir}
              </span>
              <span className="text-xs text-muted-foreground">
                第{a.chapterNumber}章
              </span>
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              {dimLabel}：{formatDimValue(a.dimension, a.value)} vs 平均 {formatDimValue(a.dimension, a.average)} · 偏离 {formatDimDeviation(a.dimension, a.deviation)}
            </div>
            {ch && (
              <div className="mt-2 text-xs text-muted-foreground/70">
                本章字数：{ch.wordCount} · 句长标准差：{ch.sentenceLengthStdDev.toFixed(1)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ChapterDetailCard({
  profile,
  averageProfile,
}: {
  profile: StyleProfile;
  averageProfile: StyleAnalyzeResult["averageProfile"];
}) {
  const isDeviant = (dim: string, val: number, avg: number | undefined) =>
    avg !== undefined && avg > 0 && Math.abs(val - avg) > avg * 0.5;

  return (
    <div className="border border-border/60 rounded-lg p-4 space-y-3">
      <h3 className="font-serif font-medium text-sm">
        第{profile.chapterNumber}章 · {profile.title}
        <span className="text-xs text-muted-foreground font-mono ml-2">({profile.wordCount} 字)</span>
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MetricCard
          label="平均句长"
          value={profile.avgSentenceLength.toFixed(1)}
          unit="字"
          deviation={
            averageProfile
              ? formatDimDeviation("avgSentenceLength", profile.avgSentenceLength - averageProfile.avgSentenceLength)
              : undefined
          }
          highlight={
            averageProfile && isDeviant("avgSentenceLength", profile.avgSentenceLength, averageProfile.avgSentenceLength)
              ? "warn"
              : undefined
          }
        />
        <MetricCard
          label="句长标准差"
          value={profile.sentenceLengthStdDev.toFixed(1)}
          unit="字"
          deviation={
            averageProfile
              ? formatDimDeviation("sentenceLengthStdDev", profile.sentenceLengthStdDev - averageProfile.sentenceLengthStdDev)
              : undefined
          }
        />
        <MetricCard
          label="平均段长"
          value={profile.avgParagraphLength.toFixed(0)}
          unit="字"
          deviation={
            averageProfile
              ? formatDimDeviation("avgParagraphLength", profile.avgParagraphLength - averageProfile.avgParagraphLength)
              : undefined
          }
          highlight={
            averageProfile && isDeviant("avgParagraphLength", profile.avgParagraphLength, averageProfile.avgParagraphLength)
              ? "warn"
              : undefined
          }
        />
        <MetricCard
          label="词汇多样性"
          value={`${(profile.vocabularyDiversity * 100).toFixed(0)}%`}
          unit=""
          deviation={
            averageProfile
              ? formatDimDeviation("vocabularyDiversity", profile.vocabularyDiversity - averageProfile.vocabularyDiversity)
              : undefined
          }
          highlight={
            averageProfile && isDeviant("vocabularyDiversity", profile.vocabularyDiversity, averageProfile.vocabularyDiversity)
              ? "warn"
              : undefined
          }
        />
      </div>
      {profile.topPatterns.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider mr-1 self-center">高频搭配：</span>
          {profile.topPatterns.map((p, i) => (
            <span key={i} className="px-1.5 py-0.5 text-[11px] bg-secondary/50 rounded font-mono text-muted-foreground">
              {p}
            </span>
          ))}
        </div>
      )}
      {profile.rhetoricalFeatures.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider mr-1 self-center">修辞特征：</span>
          {profile.rhetoricalFeatures.map((f, i) => (
            <span key={i} className="px-1.5 py-0.5 text-[11px] bg-primary/5 rounded text-primary font-medium">
              {f}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ──

export function BookStylePage({
  bookId,
  nav,
  theme,
  t,
}: {
  bookId: string;
  nav: Nav;
  theme: Theme;
  t: TFunction;
}) {
  const c = useColors(theme);
  const { data: bookData, loading: bookLoading } = useApi<{ book: BookConfig; chapters: readonly ChapterSummary[] }>(
    `/books/${bookId}`,
  );

  const [selectedChapters, setSelectedChapters] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<StyleAnalyzeResult | null>(null);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"matrix" | "anomalies" | "details">("matrix");

  // Auto-select all chapters when data loads
  useEffect(() => {
    if (bookData?.chapters) {
      setSelectedChapters(new Set(bookData.chapters.map((ch) => ch.number)));
    }
  }, [bookData?.chapters]);

  const book = bookData?.book;
  const chapters = bookData?.chapters ?? [];

  const runAnalysis = useCallback(async () => {
    if (selectedChapters.size === 0) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const data = await postApi<StyleAnalyzeResult>(`/books/${bookId}/style/analyze`, {
        chapters: [...selectedChapters],
      });
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, [bookId, selectedChapters]);

  const averageProfile = result?.averageProfile ?? null;
  const anomalies = result?.anomalies ?? [];
  const comparison = result?.comparison ?? [];

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>
          {t("bread.home")}
        </button>
        <span className="text-border">/</span>
        <button onClick={() => nav.toBook(bookId)} className={c.link}>
          {book?.title ?? bookId}
        </button>
        <span className="text-border">/</span>
        <span>文风检测</span>
      </div>

      {/* Page Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-amber-700 flex items-center justify-center text-card font-serif font-bold text-sm">
            墨
          </div>
          <div>
            <h1 className="font-serif text-2xl text-foreground">文风检测</h1>
            <p className="text-xs text-muted-foreground font-mono tracking-wide">
              {book?.title ?? "加载中…"} · {chapters.length} 章
            </p>
          </div>
        </div>
      </div>

      {/* Chapter Selection */}
      <div className="border border-border/60 rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <BarChart3 size={14} className="text-amber-600" />
          选择检测范围
        </h2>
        {bookLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={12} className="animate-spin" />
            加载章节列表…
          </div>
        ) : (
          <ChapterSelectBar chapters={chapters} selected={selectedChapters} onChange={setSelectedChapters} />
        )}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={runAnalysis}
            disabled={selectedChapters.size === 0 || loading || bookLoading}
            className={`px-4 py-2 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30 flex items-center gap-2`}
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                分析中…
              </>
            ) : (
              <>
                <Wand2 size={14} />
                开始分析
              </>
            )}
          </button>
          {result && (
            <button
              onClick={runAnalysis}
              disabled={loading}
              className="px-3 py-1.5 text-xs rounded-lg border border-border/60 text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              <RotateCcw size={12} />
              重新检测
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-3 rounded-lg text-sm bg-destructive/10 text-destructive flex items-center gap-2">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
          <Loader2 size={16} className="animate-spin" />
          分析{selectedChapters.size}章文风特征…
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <div className="space-y-6">
          {/* Tabs */}
          <div className="flex gap-1 border-b border-border/60">
            {[
              { key: "matrix" as const, label: "差异矩阵", icon: <BarChart3 size={14} /> },
              { key: "anomalies" as const, label: `异常段落 (${anomalies.length})`, icon: <AlertTriangle size={14} /> },
              { key: "details" as const, label: "各章详情", icon: <Info size={14} /> },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all ${
                  activeTab === tab.key
                    ? "border-amber-600 text-amber-700"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab: Matrix */}
          {activeTab === "matrix" && (
            <div className="border border-border/60 rounded-lg p-4">
              <h2 className="font-serif text-base text-foreground mb-4 flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-5.5 h-5.5 rounded-full bg-amber-600 text-card text-[11px] font-mono font-bold">1</span>
                文风对比差异矩阵
              </h2>
              {averageProfile && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <MetricCard label="平均句长" value={averageProfile.avgSentenceLength.toFixed(1)} unit="字" highlight="info" />
                  <MetricCard label="句长标准差" value={averageProfile.sentenceLengthStdDev.toFixed(1)} unit="字" highlight="info" />
                  <MetricCard label="平均段长" value={averageProfile.avgParagraphLength.toFixed(0)} unit="字" highlight="info" />
                  <MetricCard label="词汇多样性" value={`${(averageProfile.vocabularyDiversity * 100).toFixed(0)}%`} unit="" highlight="info" />
                </div>
              )}
              <ComparisonMatrix comparison={comparison} averageProfile={averageProfile} />
            </div>
          )}

          {/* Tab: Anomalies */}
          {activeTab === "anomalies" && (
            <div className="border border-border/60 rounded-lg p-4">
              <h2 className="font-serif text-base text-foreground mb-4 flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-5.5 h-5.5 rounded-full bg-amber-600 text-card text-[11px] font-mono font-bold">2</span>
                异常检测
                {anomalies.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 ml-2">
                    {anomalies.length} 处异常
                  </span>
                )}
              </h2>
              <AnomalyList anomalies={anomalies} chapters={result.chapters} />
            </div>
          )}

          {/* Tab: Details */}
          {activeTab === "details" && (
            <div className="space-y-4">
              <h2 className="font-serif text-base text-foreground flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-5.5 h-5.5 rounded-full bg-amber-600 text-card text-[11px] font-mono font-bold">3</span>
                各章节文风详情
              </h2>
              {result.chapters.map((profile) => (
                <ChapterDetailCard key={profile.chapterNumber} profile={profile} averageProfile={averageProfile} />
              ))}
            </div>
          )}

          {/* Failed chapters warning */}
          {result.failedChapters && result.failedChapters.length > 0 && (
            <div className="px-4 py-3 rounded-lg text-sm bg-amber-50 text-amber-700 border border-amber-200/50 flex items-center gap-2">
              <Info size={14} />
              以下章节未能加载：第{result.failedChapters.join("、")}章
            </div>
          )}

          {/* Summary footer */}
          <footer className="flex items-center justify-between text-xs text-muted-foreground pt-4 border-t border-border/60">
            <span>
              分析了 {result.chapters.length} 章 · 检测到 {anomalies.length} 处异常
            </span>
          </footer>
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <div className="border border-dashed rounded-lg p-8 text-center text-muted-foreground text-sm italic">
          选择章节后点击「开始分析」进行文风检测。
        </div>
      )}
    </div>
  );
}
