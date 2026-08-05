import { useEffect, useState } from "react";
import {
  History,
  Lightbulb,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { TFunction } from "../hooks/use-i18n";
import { fetchJson, useApi } from "../hooks/use-api";

interface ChapterVersion {
  readonly id: string;
  readonly source: "manual" | "agent" | "revision" | "regeneration" | "restore";
  readonly createdAt: string;
  readonly characterCount: number;
}

interface ChapterWorkspace {
  readonly chapterNumber: number;
  readonly brief: string;
  readonly plan: string | null;
  readonly versions: ReadonlyArray<ChapterVersion>;
  readonly canDelete: boolean;
}

interface VersionContent {
  readonly content: string;
}

interface InspirationResult {
  readonly card: string;
}

type BusyAction = "save" | "rewrite" | "inspiration" | "restore" | "delete" | null;

export function ChapterWorkspacePanel({
  bookId,
  chapterNumber,
  t,
  onChapterChanged,
  onChapterDeleted,
}: {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly t: TFunction;
  readonly onChapterChanged: () => void;
  readonly onChapterDeleted: () => void;
}) {
  const path = `/books/${bookId}/chapters/${chapterNumber}/workspace`;
  const { data, loading, error, refetch } = useApi<ChapterWorkspace>(path);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState<BusyAction>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [inspiration, setInspiration] = useState("");
  const [versionPreview, setVersionPreview] = useState<{ id: string; content: string } | null>(null);

  useEffect(() => {
    if (data) setBrief(data.brief);
  }, [data]);

  const runAction = async (action: Exclude<BusyAction, null>, task: () => Promise<void>) => {
    setBusy(action);
    setNotice("");
    setActionError("");
    try {
      await task();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const saveBrief = () => runAction("save", async () => {
    await fetchJson(`${path}/brief`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief }),
    });
    await refetch();
    setNotice(t("reader.saved"));
  });

  const rewrite = () => runAction("rewrite", async () => {
    await fetchJson(`/books/${bookId}/rewrite/${chapterNumber}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief }),
    });
    await Promise.all([refetch(), Promise.resolve(onChapterChanged())]);
    setNotice(t("reader.rewriteComplete"));
  });

  const drawInspiration = () => runAction("inspiration", async () => {
    const result = await fetchJson<InspirationResult>(`${path}/inspiration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief }),
    });
    setInspiration(result.card);
  });

  const previewVersion = async (versionId: string) => {
    setActionError("");
    try {
      const result = await fetchJson<VersionContent>(
        `/books/${bookId}/chapters/${chapterNumber}/versions/${versionId}`,
      );
      setVersionPreview({ id: versionId, content: result.content });
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const restoreVersion = (versionId: string) => {
    if (!window.confirm(t("reader.restoreConfirm"))) return;
    void runAction("restore", async () => {
      await fetchJson(
        `/books/${bookId}/chapters/${chapterNumber}/versions/${versionId}/restore`,
        { method: "POST" },
      );
      setVersionPreview(null);
      await Promise.all([refetch(), Promise.resolve(onChapterChanged())]);
      setNotice(t("reader.restoreComplete"));
    });
  };

  const deleteChapter = () => {
    if (!window.confirm(t("reader.deleteChapterConfirm"))) return;
    void runAction("delete", async () => {
      await fetchJson(`/books/${bookId}/chapters/${chapterNumber}`, { method: "DELETE" });
      onChapterDeleted();
    });
  };

  const addInspirationToBrief = () => {
    setBrief((current) => [current.trim(), inspiration.trim()].filter(Boolean).join("\n\n"));
    setNotice("");
  };

  return (
    <section className="rounded-2xl border border-primary/20 bg-card/80 p-5 md:p-7 shadow-sm space-y-6">
      <header className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-serif font-semibold text-foreground">
            <Sparkles size={19} className="text-primary" />
            {t("reader.workspace")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("reader.workspaceHint")}</p>
        </div>
        {data?.canDelete && (
          <button
            type="button"
            onClick={deleteChapter}
            disabled={busy !== null}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs font-bold text-destructive transition-colors hover:bg-destructive hover:text-white disabled:opacity-50"
          >
            <Trash2 size={14} />
            {t("reader.deleteChapter")}
          </button>
        )}
      </header>

      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw size={15} className="animate-spin" />
          {t("common.loading")}
        </div>
      ) : (
        <>
          <label className="block space-y-2">
            <span className="text-sm font-bold text-foreground">{t("reader.chapterBrief")}</span>
            <textarea
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder={t("reader.chapterBriefPlaceholder")}
              rows={5}
              className="w-full resize-y rounded-xl border border-border/70 bg-background/70 px-4 py-3 text-sm leading-6 text-foreground outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void saveBrief()}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2 text-xs font-bold text-foreground transition hover:border-primary/30 hover:text-primary disabled:opacity-50"
            >
              <Save size={14} />
              {t("reader.saveBrief")}
            </button>
            <button
              type="button"
              onClick={() => void rewrite()}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm transition hover:brightness-105 disabled:opacity-50"
            >
              <RefreshCw size={14} className={busy === "rewrite" ? "animate-spin" : ""} />
              {busy === "rewrite" ? t("reader.rewriting") : t("reader.rewriteFromBrief")}
            </button>
            <button
              type="button"
              onClick={() => void drawInspiration()}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-2 text-xs font-bold text-amber-700 transition hover:bg-amber-500/15 dark:text-amber-300 disabled:opacity-50"
            >
              <Lightbulb size={14} />
              {busy === "inspiration" ? t("reader.drawing") : t("reader.inspiration")}
            </button>
          </div>
        </>
      )}

      {(error || actionError) && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error || actionError}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      )}

      {inspiration && (
        <article className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">{inspiration}</div>
          <button
            type="button"
            onClick={addInspirationToBrief}
            className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-amber-700 hover:text-amber-600 dark:text-amber-300"
          >
            <Lightbulb size={13} />
            {t("reader.addToBrief")}
          </button>
        </article>
      )}

      <details className="rounded-xl border border-border/60 bg-background/50 px-4 py-3">
        <summary className="cursor-pointer text-sm font-bold text-foreground">
          {t("reader.generatedPlan")}
        </summary>
        <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap font-mono text-xs leading-6 text-muted-foreground">
          {data?.plan || t("reader.noPlan")}
        </pre>
      </details>

      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <History size={15} className="text-primary" />
          {t("reader.versionHistory")}
        </h3>
        {data?.versions.length ? (
          <div className="space-y-2">
            {data.versions.map((version) => (
              <div
                key={version.id}
                className="flex flex-col gap-3 rounded-xl border border-border/60 bg-background/50 px-4 py-3 md:flex-row md:items-center md:justify-between"
              >
                <div className="text-xs text-muted-foreground">
                  <span className="font-bold text-foreground">{version.source}</span>
                  <span className="mx-2 text-border">·</span>
                  {new Date(version.createdAt).toLocaleString()}
                  <span className="mx-2 text-border">·</span>
                  {version.characterCount.toLocaleString()} {t("reader.characters")}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void previewVersion(version.id)}
                    className="rounded-lg px-3 py-1.5 text-xs font-bold text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                  >
                    {t("reader.viewVersion")}
                  </button>
                  <button
                    type="button"
                    onClick={() => restoreVersion(version.id)}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/10 disabled:opacity-50"
                  >
                    <RotateCcw size={13} />
                    {t("reader.restoreVersion")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("reader.noVersions")}</p>
        )}
      </div>

      {versionPreview && (
        <div className="rounded-xl border border-primary/15 bg-background p-4">
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-serif text-sm leading-7 text-foreground/90">
            {versionPreview.content}
          </pre>
        </div>
      )}
    </section>
  );
}
