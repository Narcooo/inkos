import { useState, useEffect } from "react";
import { fetchJson } from "../hooks/use-api";
import { useServiceStore } from "../store/service";
import { Eye, EyeOff, Loader2, ArrowLeft } from "lucide-react";

interface Nav {
  toServices: () => void;
}

interface ModelInfo {
  readonly id: string;
  readonly name?: string;
}

// Unified page state
type ConnectionStatus =
  | { state: "idle" }               // No action taken yet
  | { state: "testing" }            // Test in progress
  | { state: "connected"; models: ModelInfo[] }  // Test succeeded
  | { state: "error"; message: string }          // Test failed
  | { state: "saving" }             // Save in progress
  | { state: "saved" }              // Save succeeded

function DetailSkeleton() {
  return (
    <div className="max-w-xl mx-auto space-y-6 animate-pulse">
      <div className="h-4 w-16 bg-muted rounded" />
      <div className="h-7 w-40 bg-muted rounded" />
      <div className="space-y-2"><div className="h-3 w-16 bg-muted/60 rounded" /><div className="h-10 w-full bg-muted/40 rounded-lg" /></div>
      <div className="h-9 w-24 bg-muted/40 rounded-lg" />
    </div>
  );
}

export function ServiceDetailPage({ serviceId, nav }: { serviceId: string; nav: Nav }) {
  // -- Service store --
  const services = useServiceStore((s) => s.services);
  const loading = useServiceStore((s) => s.servicesLoading);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const refreshServices = useServiceStore((s) => s.refreshServices);
  const setStoreModels = useServiceStore((s) => s.setModels);
  const clearStoreModels = useServiceStore((s) => s.clearModels);

  useEffect(() => { void fetchServices(); }, [fetchServices]);

  const svc = services.find((s) => s.service === serviceId);
  const isCustom = serviceId === "custom";

  // -- Local form state --
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [customName, setCustomName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [maxTokens, setMaxTokens] = useState("4096");

  // -- Unified connection status --
  const [status, setStatus] = useState<ConnectionStatus>({ state: "idle" });

  // Load models on mount if connected
  useEffect(() => {
    if (svc?.connected) {
      setStatus({ state: "testing" });
      fetchJson<{ models: ModelInfo[] }>(`/services/${encodeURIComponent(serviceId)}/models`)
        .then((data) => {
          const models = data.models ?? [];
          setStatus(models.length > 0
            ? { state: "connected", models }
            : { state: "idle" });
        })
        .catch(() => setStatus({ state: "idle" }));
    }
  }, [svc?.connected, serviceId]);

  const label = isCustom ? (customName || "自定义服务") : (svc?.label ?? serviceId);

  if (loading) return <DetailSkeleton />;

  // -- Derived state --
  const isConnected = status.state === "connected";
  const models = status.state === "connected" ? status.models : [];
  const isBusy = status.state === "testing" || status.state === "saving";

  // -- Handlers --
  const handleTest = async () => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      setStatus({ state: "error", message: "请先输入 API Key" });
      return;
    }
    setApiKey(trimmedKey);
    setStatus({ state: "testing" });
    try {
      const result = await fetchJson<{ ok: boolean; models?: ModelInfo[]; modelCount?: number; error?: string }>(
        `/services/${encodeURIComponent(serviceId)}/test`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: trimmedKey }) },
      );
      if (result.ok) {
        const models = result.models ?? [];
        setStatus({ state: "connected", models });
        setStoreModels(serviceId, models); // Write to global store
      } else {
        setStatus({ state: "error", message: result.error ?? "连接失败" });
        clearStoreModels(serviceId);
      }
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : "连接失败" });
    }
  };

  const handleSave = async () => {
    const trimmedKey = apiKey.trim();
    setApiKey(trimmedKey);
    setStatus({ state: "saving" });
    try {
      // Save key (empty = delete)
      await fetchJson(`/services/${encodeURIComponent(serviceId)}/secret`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: trimmedKey }),
      });
      // Save config (temperature, maxTokens, etc.)
      await fetchJson("/services/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          services: {
            [serviceId]: {
              temperature: parseFloat(temperature),
              maxTokens: parseInt(maxTokens, 10),
              ...(isCustom ? { name: customName, baseUrl } : {}),
            },
          },
        }),
      });
      setStatus({ state: "saved" });
      void refreshServices();
      // After 1.5s, transition to correct state
      setTimeout(() => {
        if (trimmedKey) {
          setStatus({ state: "testing" });
          fetchJson<{ models: ModelInfo[] }>(`/services/${encodeURIComponent(serviceId)}/models`)
            .then((data) => {
              const m = data.models ?? [];
              if (m.length > 0) {
                setStatus({ state: "connected", models: m });
                setStoreModels(serviceId, m); // Cache for chat picker
              } else {
                setStatus({ state: "idle" });
              }
            })
            .catch(() => setStatus({ state: "idle" }));
        } else {
          clearStoreModels(serviceId);
          setStatus({ state: "idle" });
        }
      }, 1500);
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : "保存失败" });
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Back */}
      <button onClick={nav.toServices} className="flex items-center gap-1.5 text-sm text-muted-foreground/70 hover:text-foreground transition-colors">
        <ArrowLeft size={14} /> 返回
      </button>

      {/* Title + status */}
      <div className="flex items-center gap-3">
        <h1 className="font-serif text-2xl">{label}</h1>
        {isConnected && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-medium">
            已连接
          </span>
        )}
      </div>

      <div className="space-y-5">
        {/* Custom fields */}
        {isCustom && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="服务名称">
              <input type="text" value={customName} onChange={(e) => setCustomName(e.target.value)}
                placeholder="例如：本地 Ollama" className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label="Base URL">
              <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1" className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono" />
            </Field>
          </div>
        )}

        {/* API Key */}
        <Field label="API Key">
          <div className="relative">
            <input
              type={showKey ? "text" : "password"} value={apiKey}
              onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..."
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 pr-10 text-sm font-mono"
            />
            <button type="button" onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors">
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>

        {/* Actions + feedback */}
        <div className="flex items-center gap-2">
          <button onClick={handleTest} disabled={isBusy}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg border border-border/60 hover:bg-secondary/50 transition-colors disabled:opacity-50">
            {status.state === "testing" && <Loader2 size={12} className="animate-spin" />}
            测试连接
          </button>
          <button onClick={handleSave} disabled={isBusy}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
            {status.state === "saving" && <Loader2 size={12} className="animate-spin" />}
            保存
          </button>
          {/* Status feedback */}
          {status.state === "connected" && (
            <span className="text-xs text-emerald-500">连接成功，{models.length} 个模型</span>
          )}
          {status.state === "error" && (
            <span className="text-xs text-destructive">{status.message}</span>
          )}
          {status.state === "saved" && (
            <span className="text-xs text-emerald-500">已保存</span>
          )}
        </div>

        {/* Models */}
        {models.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground/70 font-medium uppercase tracking-wider">
              可用模型（{models.length}）
            </p>
            <div className="flex gap-1.5 flex-wrap">
              {models.map((m) => (
                <span key={m.id} className="text-[11px] px-2.5 py-1 rounded-md bg-emerald-500/[0.06] text-emerald-600 dark:text-emerald-400 border border-emerald-500/15">
                  {m.name ?? m.id}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Advanced params */}
        <details className="group pt-2 border-t border-border/20">
          <summary className="text-xs text-muted-foreground/60 cursor-pointer select-none hover:text-muted-foreground transition-colors py-2">
            高级参数
          </summary>
          <div className="space-y-4 pt-2">
            <Field label="temperature">
              <div className="flex items-center gap-3">
                <input type="range" min="0" max="2" step="0.05" value={temperature}
                  onChange={(e) => setTemperature(e.target.value)} className="flex-1 accent-primary h-1" />
                <input type="number" value={temperature} onChange={(e) => setTemperature(e.target.value)}
                  min="0" max="2" step="0.05" className="w-16 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-right font-mono" />
              </div>
            </Field>
            <Field label="maxTokens">
              <input type="number" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)}
                min="256" max="200000" step="256" className="w-full rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs font-mono" />
            </Field>
          </div>
        </details>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs text-muted-foreground/70 font-medium">{label}</label>
      {children}
    </div>
  );
}
