import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson } from "../hooks/use-api";

interface Forecast {
  readonly lowUsd: number | null;
  readonly baseUsd: number | null;
  readonly highUsd: number | null;
  readonly sampleSize: number;
  readonly confidence: string;
}

interface AutonomousView {
  readonly title: string;
  readonly totalChapters: number;
  readonly completedChapters: number;
  readonly nextChapter: number;
  readonly currentVolume: {
    readonly volumeId: string;
    readonly volumeNumber: number;
    readonly title: string;
    readonly startChapter: number;
    readonly endChapter: number;
    readonly chapterCount: number;
  };
  readonly currentVolumeCompleted: number;
  readonly runtimeStatus: string;
  readonly runtime?: { readonly lastError?: string; readonly phase?: string; readonly activeRole?: string; readonly activeProvider?: string | null; readonly activeModel?: string | null; readonly updatedAt?: string } | null;
  readonly roles: Record<string, string | null>;
  readonly revisionPolicy: { readonly normal: number; readonly rescue: number; readonly maximum: number };
  readonly budget: { readonly preferredUsd: number; readonly hardCapUsd: number };
  readonly economics: {
    readonly actual: { readonly providerCalls: number; readonly totalTokens: number; readonly costUsd: number | null; readonly costStatus: string };
    readonly currentVolumeForecast: Forecast;
    readonly fullBookForecast: Forecast;
    readonly currentVolumeActual: { readonly providerCalls: number; readonly totalTokens: number; readonly costUsd: number | null; readonly costStatus: string };
    readonly byRole: Readonly<Record<string, { readonly providerCalls: number; readonly promptTokens: number; readonly completionTokens: number; readonly totalTokens: number; readonly actualCostUsd: number | null }>>;
  };
  readonly runtimeBlockers: ReadonlyArray<string>;
  readonly startEnabled: boolean;
}

function money(value: number | null): string {
  return value === null ? "UNAVAILABLE" : `$${value.toFixed(4)}`;
}

function forecast(value: Forecast): string {
  return value.baseUsd === null
    ? `UNAVAILABLE · ${value.sampleSize} chapter sample · ${value.confidence}`
    : `${money(value.lowUsd)} / ${money(value.baseUsd)} / ${money(value.highUsd)} · ${value.confidence}`;
}

function chapter(value: number): string {
  return String(value).padStart(3, "0");
}

export function AutonomousProductionPanel({ bookId }: { readonly bookId: string }) {
  const [view, setView] = useState<AutonomousView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [preferred, setPreferred] = useState(15);
  const [hardCap, setHardCap] = useState(30);
  const budgetBook = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await fetchJson<AutonomousView>(`/books/${encodeURIComponent(bookId)}/autonomous-production`);
      setView(next);
      if (budgetBook.current !== bookId) {
        budgetBook.current = bookId;
        setPreferred(next.budget.preferredUsd);
        setHardCap(next.budget.hardCapUsd);
      }
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [bookId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 4_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const start = async (mode: "current-volume" | "full-book") => {
    if (pending) return;
    setPending(true);
    try {
      await fetchJson(`/books/${encodeURIComponent(bookId)}/autonomous-production/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, preferredBudgetUsd: preferred, hardCapUsd: hardCap }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  const stop = async () => {
    if (pending) return;
    setPending(true);
    try {
      await fetchJson(`/books/${encodeURIComponent(bookId)}/autonomous-production/stop`, { method: "POST" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  if (!view) {
    return <section className="rounded-2xl border border-border/40 p-5 text-sm text-muted-foreground">{error ?? "Loading bounded production…"}</section>;
  }
  const running = view.runtimeStatus === "RUNNING";
  const volume = view.currentVolume;
  const progress = Math.min(100, Math.round((view.completedChapters / view.totalChapters) * 100));

  return (
    <section data-testid="autonomous-production" className="paper-sheet rounded-2xl border border-primary/20 p-5 shadow-sm space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Bounded Autonomous Book Production</h2>
          <p className="text-sm text-muted-foreground">
            Volume {volume.volumeNumber} · {chapter(volume.startChapter)}–{chapter(volume.endChapter)} · cursor {chapter(view.nextChapter)} · full book 001–{chapter(view.totalChapters)}
          </p>
        </div>
        <span className="rounded-full border border-border/60 bg-secondary/40 px-3 py-1 text-xs font-bold">{view.runtimeStatus}</span>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
      </div>
      <div className="grid gap-3 text-sm md:grid-cols-3">
        <div><span className="text-muted-foreground">Completed</span><div className="font-semibold">{view.completedChapters}/{view.totalChapters} · volume {view.currentVolumeCompleted}/{volume.chapterCount}</div></div>
        <div><span className="text-muted-foreground">Revision policy</span><div className="font-semibold">Normal {view.revisionPolicy.normal} + Rescue {view.revisionPolicy.rescue} · third forbidden</div></div>
        <div><span className="text-muted-foreground">Current volume / full-book actual</span><div className="font-semibold">{money(view.economics.currentVolumeActual.costUsd)} / {money(view.economics.actual.costUsd)} · {view.economics.actual.totalTokens.toLocaleString()} tokens · {view.economics.actual.providerCalls} calls</div></div>
      </div>
      <div className="text-xs text-muted-foreground">Phase {view.runtime?.phase ?? view.runtimeStatus} · active role {view.runtime?.activeRole ?? "none"} · model {view.runtime?.activeModel ?? "none"} · last activity {view.runtime?.updatedAt ?? "not started"}</div>

      <div className="grid gap-3 text-xs md:grid-cols-2">
        <div className="rounded-xl bg-secondary/30 p-3"><span className="text-muted-foreground">Current volume forecast low / base / high</span><div className="mt-1 font-semibold">{forecast(view.economics.currentVolumeForecast)}</div></div>
        <div className="rounded-xl bg-secondary/30 p-3"><span className="text-muted-foreground">Full-book forecast low / base / high</span><div className="mt-1 font-semibold">{forecast(view.economics.fullBookForecast)}</div></div>
      </div>

      <div className="grid gap-2 text-xs md:grid-cols-5">
        {Object.entries(view.roles).map(([role, model]) => (
          <div key={role} className="rounded-lg border border-border/40 p-2"><span className="text-muted-foreground">{role}</span><div className="truncate font-medium" title={model ?? "NOT_CONFIGURED"}>{model ?? "NOT_CONFIGURED"}</div></div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/40">
        <table className="w-full min-w-[620px] text-left text-xs">
          <thead className="bg-secondary/40 text-muted-foreground"><tr><th className="p-2">Role</th><th className="p-2">Calls</th><th className="p-2">Input</th><th className="p-2">Output</th><th className="p-2">Total</th><th className="p-2">Actual cost</th></tr></thead>
          <tbody>{Object.entries(view.economics.byRole).map(([role, usage]) => <tr key={role} className="border-t border-border/30"><td className="p-2 font-medium">{role}</td><td className="p-2">{usage.providerCalls}</td><td className="p-2">{usage.promptTokens.toLocaleString()}</td><td className="p-2">{usage.completionTokens.toLocaleString()}</td><td className="p-2">{usage.totalTokens.toLocaleString()}</td><td className="p-2">{money(usage.actualCostUsd)}</td></tr>)}</tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted-foreground">Preferred volume budget
          <input aria-label="Preferred volume budget" type="number" min="0.01" step="0.01" value={preferred} onChange={(event) => setPreferred(Number(event.target.value))} disabled={running} className="mt-1 block w-28 rounded-lg border border-border/50 bg-background px-3 py-2 text-foreground" />
        </label>
        <label className="text-xs text-muted-foreground">Hard volume cap
          <input aria-label="Hard volume cap" type="number" min="0.02" step="0.01" value={hardCap} onChange={(event) => setHardCap(Number(event.target.value))} disabled={running} className="mt-1 block w-28 rounded-lg border border-border/50 bg-background px-3 py-2 text-foreground" />
        </label>
        <button disabled={!view.startEnabled || pending} onClick={() => void start("current-volume")} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-40">Run / Resume Current Volume</button>
        <button disabled={!view.startEnabled || pending} onClick={() => void start("full-book")} className="rounded-xl border border-primary/30 px-4 py-2.5 text-sm font-bold text-primary disabled:opacity-40">Run / Resume Full Book</button>
        {running && <button disabled={pending} onClick={() => void stop()} className="rounded-xl border border-destructive/30 px-4 py-2.5 text-sm font-bold text-destructive disabled:opacity-40">Stop after current chapter</button>}
      </div>

      {(view.runtimeBlockers.length > 0 || error || view.runtime?.lastError) && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <div className="font-bold">Runtime blockers</div>
          {view.runtimeBlockers.map((blocker) => <div key={blocker}>{blocker}</div>)}
          {(error ?? view.runtime?.lastError) && <div>{error ?? view.runtime?.lastError}</div>}
        </div>
      )}
    </section>
  );
}
