import { useState, useEffect } from "react";
import { fetchJson } from "../hooks/use-api";
import { useServiceStore } from "../store/service";
import { Eye, EyeOff, Loader2, ArrowLeft } from "lucide-react";

interface TestResult {
  readonly ok: boolean;
  readonly models?: ReadonlyArray<{ id: string; name?: string }>;
  readonly modelCount?: number;
  readonly error?: string;
}

interface Nav {
  toServices: () => void;
}

// Skeleton for loading state
function DetailSkeleton() {
  return (
    <div className="max-w-xl mx-auto space-y-6 animate-pulse">
      <div className="h-4 w-16 bg-muted rounded" />
      <div className="flex items-center gap-3">
        <div className="h-7 w-40 bg-muted rounded" />
        <div className="h-5 w-14 bg-muted/60 rounded-full" />
      </div>
      <div className="space-y-4">
        <div className="h-3 w-16 bg-muted/60 rounded" />
        <div className="h-10 w-full bg-muted/40 rounded-lg" />
      </div>
      <div className="h-9 w-24 bg-muted/40 rounded-lg" />
      <div className="space-y-2 pt-4 border-t border-border/20">
        <div className="h-3 w-20 bg-muted/60 rounded" />
        <div className="h-8 w-full bg-muted/30 rounded-lg" />
        <div className="h-8 w-full bg-muted/30 rounded-lg" />
      </div>
    </div>
  );
}

export function ServiceDetailPage({
  serviceId,
  nav,
}: {
  serviceId: string;
  nav: Nav;
}) {
  const services = useServiceStore((s) => s.services);
  const loading = useServiceStore((s) => s.servicesLoading);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const fetchModels = useServiceStore((s) => s.fetchModels);
  const refreshServices = useServiceStore((s) => s.refreshServices);
  const modelsEntry = useServiceStore((s) => s.modelsByService[serviceId]);

  useEffect(() => { void fetchServices(); }, [fetchServices]);
  useEffect(() => { void fetchModels(serviceId); }, [fetchModels, serviceId]);

  const svc = services.find((s) => s.service === serviceId);
  const isCustom = serviceId === "custom";

  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [customName, setCustomName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [maxTokens, setMaxTokens] = useState("4096");

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const label = isCustom ? (customName || "自定义服务") : (svc?.label ?? serviceId);
  const connected = !isCustom && (svc?.connected ?? false);

  if (loading) return <DetailSkeleton />;

  const handleTest = async () => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      setTestResult({ ok: false, error: "请先输入 API Key" });
      return;
    }
    setApiKey(trimmedKey);
    setTesting(true);
    setTestResult(null);
    try {
      const result = await fetchJson<TestResult>(
        `/services/${encodeURIComponent(serviceId)}/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: trimmedKey }),
        },
      );
      setTestResult(result);
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : "连接失败" });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    const trimmedKey = apiKey.trim();
    setApiKey(trimmedKey);
    setSaving(true);
    setSaveMsg(null);
    try {
      if (trimmedKey) {
        await fetchJson(`/services/${encodeURIComponent(serviceId)}/secret`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: trimmedKey }),
        });
      }
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
      setSaveMsg("已保存");
      void refreshServices();
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  // Models: prefer test result (just fetched), fallback to store cache
  const models = testResult?.ok
    ? (testResult.models ?? [])
    : (modelsEntry?.models ?? []);

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Back link */}
      <button
        onClick={nav.toServices}
        className="flex items-center gap-1.5 text-sm text-muted-foreground/70 hover:text-foreground transition-colors"
      >
        <ArrowLeft size={14} />
        返回
      </button>

      {/* Title + status */}
      <div className="flex items-center gap-3">
        <h1 className="font-serif text-2xl">{label}</h1>
        {connected && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-medium">
            已连接
          </span>
        )}
      </div>

      <div className="space-y-5">
        {/* Custom service extra fields */}
        {isCustom && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="服务名称">
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="例如：本地 Ollama"
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </Field>
            <Field label="Base URL">
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </Field>
          </div>
        )}

        {/* API Key */}
        <Field label="API Key">
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 pr-10 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>

        {/* Test connection + Save — inline */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg border border-border/60 hover:bg-secondary/50 transition-colors disabled:opacity-50"
          >
            {testing && <Loader2 size={12} className="animate-spin" />}
            测试连接
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            保存
          </button>
          {testResult && (
            <span className={`text-xs ${testResult.ok ? "text-emerald-500" : "text-destructive"}`}>
              {testResult.ok
                ? `连接成功，${testResult.modelCount ?? models.length} 个模型`
                : (testResult.error ?? "连接失败")}
            </span>
          )}
          {saveMsg && (
            <span className={`text-xs ${saveMsg === "已保存" ? "text-emerald-500" : "text-destructive"}`}>
              {saveMsg}
            </span>
          )}
        </div>

        {/* Model list */}
        {models.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground/70 font-medium uppercase tracking-wider">
              可用模型（{models.length}）
            </p>
            <div className="flex gap-1.5 flex-wrap">
              {models.map((m: any) => (
                <span
                  key={m.id ?? String(m)}
                  className="text-[11px] px-2.5 py-1 rounded-md bg-emerald-500/[0.06] text-emerald-600 dark:text-emerald-400 border border-emerald-500/15"
                >
                  {m.name ?? m.id ?? String(m)}
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
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  className="flex-1 accent-primary h-1"
                />
                <input
                  type="number"
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  min="0"
                  max="2"
                  step="0.05"
                  className="w-16 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
              </div>
            </Field>

            <Field label="maxTokens">
              <input
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                min="256"
                max="200000"
                step="256"
                className="w-full rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
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
