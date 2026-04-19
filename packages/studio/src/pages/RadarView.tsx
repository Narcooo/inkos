import { useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { fetchJson } from "../hooks/use-api";
import { TrendingUp, Loader2, Target } from "lucide-react";

interface Recommendation {
  readonly confidence: number;
  readonly platform: string;
  readonly genre: string;
  readonly concept: string;
  readonly reasoning: string;
  readonly benchmarkTitles: ReadonlyArray<string>;
}

interface RadarResult {
  readonly marketSummary: string;
  readonly recommendations: ReadonlyArray<Recommendation>;
}

interface Nav { toDashboard: () => void }

export function RadarView({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const [result, setResult] = useState<RadarResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleScan = async () => {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const data = await fetchJson<RadarResult>("/radar/scan", { method: "POST" });
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span>{t("nav.radar")}</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="font-serif text-3xl flex items-center gap-3">
          <TrendingUp size={28} className="text-primary" />
          {t("radar.title")}
        </h1>
        <button
          onClick={handleScan}
          disabled={loading}
          className={`px-5 py-2.5 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30 flex items-center gap-2`}
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Target size={14} />}
          {loading ? t("radar.scanning") : t("radar.scan")}
        </button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {result && (
        <div className="space-y-6">
          <div className={`border ${c.cardStatic} rounded-lg p-5`}>
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">{t("radar.summary")}</h3>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{result.marketSummary}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {result.recommendations.map((rec, i) => (
              <div key={i} className={`border ${c.cardStatic} rounded-lg p-5 space-y-3`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    {rec.platform} · {rec.genre}
                  </span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    rec.confidence >= 0.7 ? "bg-emerald-500/10 text-emerald-600" :
                    rec.confidence >= 0.4 ? "bg-amber-500/10 text-amber-600" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {(rec.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-sm font-semibold">{rec.concept}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{rec.reasoning}</p>
                {rec.benchmarkTitles.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {rec.benchmarkTitles.map((bt) => (
                      <span key={bt} className="px-2 py-0.5 text-[10px] bg-secondary rounded">{bt}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!result && !loading && !error && (
        <div className={`border border-dashed ${c.cardStatic} rounded-lg p-12 text-center text-muted-foreground text-sm italic`}>
          {t("radar.emptyHint")}
        </div>
      )}
    </div>
  );
}
