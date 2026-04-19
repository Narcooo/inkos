import { useState } from "react";
import { fetchJson, useApi, postApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { Wand2, Upload, BarChart3 } from "lucide-react";

interface StyleProfile {
  readonly sourceName: string;
  readonly avgSentenceLength: number;
  readonly sentenceLengthStdDev: number;
  readonly avgParagraphLength: number;
  readonly vocabularyDiversity: number;
  readonly topPatterns: ReadonlyArray<string>;
  readonly rhetoricalFeatures: ReadonlyArray<string>;
}

interface BookSummary {
  readonly id: string;
  readonly title: string;
}

interface Nav { toDashboard: () => void }

export interface StyleStatusNotice {
  readonly tone: "error" | "success" | "info";
  readonly message: string;
}

export function buildStyleStatusNotice(analyzeStatus: string, importStatus: string): StyleStatusNotice | null {
  const message = analyzeStatus.trim() || importStatus.trim();
  if (!message) return null;
  if (message.startsWith("Error:")) {
    return { tone: "error", message };
  }
  if (message.endsWith("...")) {
    return { tone: "info", message };
  }
  return { tone: "success", message };
}

export function StyleManager({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const [text, setText] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzeStatus, setAnalyzeStatus] = useState("");
  const [importBookId, setImportBookId] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const { data: booksData } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const statusNotice = buildStyleStatusNotice(analyzeStatus, importStatus);

  const handleAnalyze = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setProfile(null);
    setAnalyzeStatus("");
    try {
      const data = await fetchJson<StyleProfile>("/style/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, sourceName: sourceName || "sample" }),
      });
      setProfile(data);
    } catch (e) {
      setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const handleImport = async () => {
    if (!importBookId || !text.trim()) return;
    setImportStatus("Importing...");
    try {
      await postApi(`/books/${importBookId}/style/import`, { text, sourceName: sourceName || "sample" });
      setImportStatus("Style guide imported successfully!");
    } catch (e) {
      setImportStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span>{t("nav.style")}</span>
      </div>

      <h1 className="font-serif text-3xl flex items-center gap-3">
        <Wand2 size={28} className="text-primary" />
        {t("style.title")}
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input */}
        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2">{t("style.sourceName")}</label>
            <input
              type="text"
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder={t("style.sourceExample")}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2">{t("style.textSample")}</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              placeholder={t("style.pasteHint")}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm focus:outline-none focus:border-primary resize-none font-mono"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleAnalyze}
              disabled={!text.trim() || loading}
              className={`px-4 py-2 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30 flex items-center gap-2`}
            >
              <BarChart3 size={14} />
              {loading ? t("style.analyzing") : t("style.analyze")}
            </button>
          </div>
        </div>

        {/* Results */}
        <div className="space-y-4">
          {profile && (
            <div className={`border ${c.cardStatic} rounded-lg p-5 space-y-4`}>
              <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t("style.results")}</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-secondary/30 rounded-lg p-3">
                  <div className="text-muted-foreground text-xs">{t("style.avgSentence")}</div>
                  <div className="text-xl font-bold">{profile.avgSentenceLength.toFixed(1)}</div>
                </div>
                <div className="bg-secondary/30 rounded-lg p-3">
                  <div className="text-muted-foreground text-xs">{t("style.vocabDiversity")}</div>
                  <div className="text-xl font-bold">{(profile.vocabularyDiversity * 100).toFixed(0)}%</div>
                </div>
                <div className="bg-secondary/30 rounded-lg p-3">
                  <div className="text-muted-foreground text-xs">{t("style.avgParagraph")}</div>
                  <div className="text-xl font-bold">{profile.avgParagraphLength.toFixed(0)}</div>
                </div>
                <div className="bg-secondary/30 rounded-lg p-3">
                  <div className="text-muted-foreground text-xs">{t("style.sentenceStdDev")}</div>
                  <div className="text-xl font-bold">{profile.sentenceLengthStdDev.toFixed(1)}</div>
                </div>
              </div>
              {profile.topPatterns.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">{t("style.topPatterns")}</div>
                  <div className="flex gap-2 flex-wrap">
                    {profile.topPatterns.map((p) => (
                      <span key={p} className="px-2 py-1 text-xs bg-secondary rounded">{p}</span>
                    ))}
                  </div>
                </div>
              )}
              {profile.rhetoricalFeatures.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">{t("style.rhetoricalFeatures")}</div>
                  <div className="flex gap-2 flex-wrap">
                    {profile.rhetoricalFeatures.map((f) => (
                      <span key={f} className="px-2 py-1 text-xs bg-primary/10 text-primary rounded">{f}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Import to book */}
              <div className="border-t border-border pt-4 mt-4 space-y-3">
                <h4 className="font-semibold text-sm flex items-center gap-2">
                  <Upload size={14} />
                  {t("style.importToBook")}
                </h4>
                <select
                  value={importBookId}
                  onChange={(e) => setImportBookId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"
                >
                  <option value="">{t("style.selectBook")}</option>
                  {booksData?.books.map((b) => (
                    <option key={b.id} value={b.id}>{b.title}</option>
                  ))}
                </select>
                <button
                  onClick={handleImport}
                  disabled={!importBookId}
                  className={`px-4 py-2 text-sm rounded-lg ${c.btnSecondary} disabled:opacity-30`}
                >
                  {t("style.importGuide")}
                </button>
                {importStatus && <div className="text-xs text-muted-foreground">{importStatus}</div>}
              </div>
            </div>
          )}
          {!profile && !loading && (
            <div className={`border border-dashed ${c.cardStatic} rounded-lg p-8 text-center text-muted-foreground text-sm italic`}>
              {t("style.emptyHint")}
            </div>
          )}
        </div>
      </div>

      {statusNotice && (
        <div
          className={`px-4 py-3 rounded-lg text-sm ${
            statusNotice.tone === "error"
              ? "bg-destructive/10 text-destructive"
              : statusNotice.tone === "info"
                ? "bg-secondary text-muted-foreground"
                : "bg-emerald-500/10 text-emerald-600"
          }`}
        >
          {statusNotice.message}
        </div>
      )}
    </div>
  );
}
