import { useState } from "react";
import { useApi } from "../hooks/use-api";
import { fetchJson } from "../hooks/use-api";
import { Eye, EyeOff, Loader2 } from "lucide-react";

interface ServiceStatus {
  readonly service: string;
  readonly label: string;
  readonly connected: boolean;
  readonly modelCount: number;
  readonly apiKey?: string;
}

interface ServicesResponse {
  readonly services: ReadonlyArray<ServiceStatus>;
}

interface TestResult {
  readonly ok: boolean;
  readonly models?: ReadonlyArray<string>;
  readonly modelCount?: number;
  readonly error?: string;
}

interface Nav {
  toServices: () => void;
}

export function ServiceDetailPage({
  serviceId,
  nav,
}: {
  serviceId: string;
  nav: Nav;
}) {
  const { data, loading, error, refetch } = useApi<ServicesResponse>("/services");

  const svc = data?.services.find((s) => s.service === serviceId);
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

  if (loading) {
    return (
      <div className="text-muted-foreground py-20 text-center text-sm">加载中...</div>
    );
  }

  if (error) {
    return (
      <div className="text-destructive py-20 text-center text-sm">加载失败：{error}</div>
    );
  }

  const handleTest = async () => {
    if (!apiKey.trim()) {
      setTestResult({ ok: false, error: "请先输入 API Key" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await fetchJson<TestResult>(
        `/services/${encodeURIComponent(serviceId)}/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: apiKey.trim() }),
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
    setSaving(true);
    setSaveMsg(null);
    try {
      if (apiKey.trim()) {
        await fetchJson(`/services/${encodeURIComponent(serviceId)}/secret`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: apiKey.trim() }),
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
      refetch();
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const models = testResult?.ok ? (testResult.models ?? []) : [];

  return (
    <div className="max-w-xl mx-auto space-y-8">
      {/* Back link */}
      <button
        onClick={nav.toServices}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        ← 返回
      </button>

      {/* Title + status */}
      <div className="flex items-center gap-3">
        <h1 className="font-serif text-3xl">{label}</h1>
        <span
          className={[
            "text-xs px-2 py-0.5 rounded-full font-medium",
            connected
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : "bg-muted text-muted-foreground",
          ].join(" ")}
        >
          {connected ? "已连接" : "未配置"}
        </span>
      </div>

      <div className="space-y-6">
        {/* Custom service extra fields */}
        {isCustom && (
          <>
            <Field label="服务名称">
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="例如：本地 Ollama"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </Field>
            <Field label="Base URL">
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </Field>
          </>
        )}

        {/* API Key */}
        <Field label="API Key">
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-10 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </Field>

        {/* Test connection */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-border hover:bg-secondary transition-colors disabled:opacity-50"
          >
            {testing && <Loader2 size={14} className="animate-spin" />}
            测试连接
          </button>

          {testResult && (
            <span
              className={[
                "text-sm",
                testResult.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
              ].join(" ")}
            >
              {testResult.ok
                ? `连接成功，找到 ${testResult.modelCount ?? models.length} 个模型`
                : (testResult.error ?? "连接失败")}
            </span>
          )}
        </div>

        {/* Model list */}
        {models.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">可用模型</p>
            <div className="rounded-lg border border-border divide-y divide-border/50 max-h-48 overflow-y-auto">
              {models.map((m: any) => (
                <div key={m.id ?? m} className="px-3 py-2 text-sm font-mono text-foreground/80">
                  {m.name ?? m.id ?? String(m)}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Advanced params */}
        <div className="space-y-4 pt-2 border-t border-border/40">
          <p className="text-sm font-medium">高级参数</p>

          <Field label="temperature">
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                className="flex-1 accent-primary"
              />
              <input
                type="number"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                min="0"
                max="2"
                step="0.05"
                className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary/40"
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
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </Field>
        </div>

        {/* Save */}
        <div className="flex items-center justify-end gap-3 pt-2">
          {saveMsg && (
            <span
              className={[
                "text-sm",
                saveMsg === "已保存" ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
              ].join(" ")}
            >
              {saveMsg}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
