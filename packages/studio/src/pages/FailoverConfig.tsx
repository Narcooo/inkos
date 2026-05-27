import { useEffect, useState } from "react";
import { fetchJson } from "../hooks/use-api";
import { useServiceStore } from "../store/service";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";

interface FailoverConfig {
  enabled: boolean;
  mode: "auto" | "manual";
  fallbacks: Array<{ service: string; model?: string; name?: string }>;
  maxAutoSwitches: number;
  retryDelayMs: number;
}

interface FailoverState {
  currentService: string;
  currentModel: string;
  enabled: boolean;
  mode: "auto" | "manual";
  fallbacks: Array<{ service: string; model?: string; name?: string }>;
}

interface FailoverEvent {
  readonly type: "model:failover";
  readonly timestamp: number;
  readonly switched: boolean;
  readonly previousService: string;
  readonly previousModel: string;
  readonly newService: string;
  readonly newModel: string;
  readonly reason: string;
  readonly requiresUserAction: boolean;
  readonly sessionId?: string;
}

export function FailoverBanner({ event }: { event: FailoverEvent | null }) {
  if (!event) return null;

  return (
    <div className="mx-auto max-w-4xl px-4 pt-3">
      <div className={`rounded-lg border p-3 ${event.switched ? "border-amber-500/30 bg-amber-500/5" : "border-destructive/30 bg-destructive/5"}`}>
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium">
              {event.switched ? "已自动切换模型" : "模型配额已达上限"}
            </p>
            <p className="text-xs text-muted-foreground">
              {event.previousService}/{event.previousModel} → {event.newService}/{event.newModel}
            </p>
            <p className="text-xs text-muted-foreground/60">{event.reason}</p>
          </div>
          {event.requiresUserAction && (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500">
              需要手动切换
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function FailoverConfigPanel() {
  const services = useServiceStore((s) => s.services);
  const modelsByService = useServiceStore((s) => s.modelsByService);
  const fetchBankModels = useServiceStore((s) => s.fetchBankModels);
  const fetchCustomModels = useServiceStore((s) => s.fetchCustomModels);
  const [config, setConfig] = useState<FailoverConfig | null>(null);
  const [state, setState] = useState<FailoverState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedServices, setExpandedServices] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchJson<FailoverConfig>("/failover/config"),
      fetchJson<FailoverState>("/failover/state"),
      fetchBankModels(),
      fetchCustomModels(),
    ])
      .then(([cfg, st]) => {
        if (cancelled) return;
        setConfig(cfg);
        setState(st);
        const expanded = new Set<string>();
        cfg.fallbacks.forEach((f) => expanded.add(f.service));
        setExpandedServices(expanded);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [fetchBankModels, fetchCustomModels]);

  if (loading) {
    return (
      <section className="rounded-xl border border-border/50 bg-card/50 p-4 space-y-3 animate-pulse">
        <div className="h-4 w-32 bg-muted rounded" />
        <div className="h-3 w-48 bg-muted/60 rounded" />
      </section>
    );
  }

  if (!config) return null;

  const connectedServices = services.filter((s) => s.connected);

  const handleToggle = async () => {
    setSaving(true);
    setMessage("");
    try {
      await fetchJson("/failover/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, enabled: !config.enabled }),
      });
      setConfig({ ...config, enabled: !config.enabled });
      setMessage("配置已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleModeChange = async (mode: "auto" | "manual") => {
    setSaving(true);
    setMessage("");
    try {
      await fetchJson("/failover/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, mode }),
      });
      setConfig({ ...config, mode });
      setMessage("配置已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const toggleServiceExpanded = (service: string) => {
    const newExpanded = new Set(expandedServices);
    if (newExpanded.has(service)) {
      newExpanded.delete(service);
    } else {
      newExpanded.add(service);
    }
    setExpandedServices(newExpanded);
  };

  const getServiceSelectedModels = (service: string): string[] => {
    return config.fallbacks.filter((f) => f.service === service).map((f) => f.model ?? "");
  };

  const handleModelToggle = (service: string, modelId: string, checked: boolean) => {
    const svc = services.find((s) => s.service === service);
    if (checked) {
      const existing = config.fallbacks.filter((f) => !(f.service === service && f.model === modelId));
      const newFallbacks = [...existing, { service, model: modelId, name: svc?.label }];
      setConfig({ ...config, fallbacks: newFallbacks });
    } else {
      setConfig({
        ...config,
        fallbacks: config.fallbacks.filter(
          (f) => !(f.service === service && f.model === modelId),
        ),
      });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      await fetchJson("/failover/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      setMessage("配置已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-border/50 bg-card/50 p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">模型故障转移</h2>
          <p className="mt-1 text-xs text-muted-foreground/70">
            当当前模型达到使用配额时，自动或手动切换到备用模型
          </p>
        </div>
        <button
          onClick={handleToggle}
          disabled={saving}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs transition-colors disabled:opacity-50 ${
            config.enabled
              ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          {config.enabled ? <Check size={12} /> : <X size={12} />}
          {config.enabled ? "已启用" : "已禁用"}
        </button>
      </div>

      {config.enabled && (
        <>
          <div className="h-px bg-border/30" />

          <div>
            <span className="block text-xs font-medium text-muted-foreground/70 mb-2">切换模式</span>
            <div className="flex gap-2">
              <button
                onClick={() => handleModeChange("auto")}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs transition-colors ${
                  config.mode === "auto"
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border/60 text-muted-foreground hover:bg-secondary/50"
                }`}
              >
                自动切换
                <p className="mt-1 text-[10px] text-muted-foreground/60">达到限额时自动切换到备用模型</p>
              </button>
              <button
                onClick={() => handleModeChange("manual")}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs transition-colors ${
                  config.mode === "manual"
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border/60 text-muted-foreground hover:bg-secondary/50"
                }`}
              >
                手动切换
                <p className="mt-1 text-[10px] text-muted-foreground/60">提示用户手动选择切换</p>
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground/70">选择备用模型</span>
              <span className="text-[10px] text-muted-foreground/40">
                已选 {config.fallbacks.length} 个
              </span>
            </div>

            {connectedServices.length === 0 && (
              <p className="text-xs text-muted-foreground/60 py-4 text-center">
                没有已连接的服务商，请先在上方配置服务商
              </p>
            )}

            <div className="space-y-2 max-h-80 overflow-y-auto rounded-lg border border-border/40">
              {connectedServices.map((svc) => {
                const isExpanded = expandedServices.has(svc.service);
                const selectedModels = getServiceSelectedModels(svc.service);
                const hasSelection = selectedModels.length > 0;
                const svcModels = modelsByService[svc.service] ?? [];

                return (
                  <div key={svc.service} className="border-b border-border/20 last:border-b-0">
                    <button
                      onClick={() => toggleServiceExpanded(svc.service)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                        hasSelection
                          ? "bg-primary/5 hover:bg-primary/10"
                          : "hover:bg-secondary/30"
                      }`}
                    >
                      <span className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}>
                        ▶
                      </span>
                      <span className="text-xs font-medium">{svc.label}</span>
                      <span className="text-[10px] text-muted-foreground/50 font-mono">
                        {svc.service}
                      </span>
                      {hasSelection && (
                        <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                          {selectedModels.length} 个模型
                        </span>
                      )}
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-2 space-y-1">
                        {svcModels.length === 0 && (
                          <p className="text-xs text-muted-foreground/60 py-2 text-center">
                            该服务商暂无可用模型
                          </p>
                        )}
                        {svcModels.map((model) => {
                          const fallbackIndex = config.fallbacks.findIndex(
                            (f) => f.service === svc.service && f.model === model.id
                          );
                          const isSelected = fallbackIndex >= 0;
                          const switchOrder = isSelected ? fallbackIndex + 1 : null;

                          return (
                            <label
                              key={model.id}
                              className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary/30 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => handleModelToggle(svc.service, model.id, e.target.checked)}
                                className="h-3.5 w-3.5 rounded border-border/60 accent-primary"
                              />
                              <span className="text-xs font-mono flex-1">{model.id}</span>
                              {switchOrder && (
                                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                                  #{switchOrder}
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {config.mode === "auto" && (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="block text-xs font-medium text-muted-foreground/70">最大自动切换次数</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={config.maxAutoSwitches}
                  onChange={(e) => setConfig({ ...config, maxAutoSwitches: Math.max(1, Math.min(20, Number.parseInt(e.target.value, 10))) })}
                  className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1.5">
                <span className="block text-xs font-medium text-muted-foreground/70">切换间隔（毫秒）</span>
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  value={config.retryDelayMs}
                  onChange={(e) => setConfig({ ...config, retryDelayMs: Math.max(1000, Number.parseInt(e.target.value, 10)) })}
                  className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
                />
              </label>
            </div>
          )}

          <div className="flex items-center justify-between">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {saving && <Loader2 size={12} className="animate-spin" />}
              保存配置
            </button>
            {message && (
              <span className="text-xs text-emerald-500">{message}</span>
            )}
          </div>
        </>
      )}

      {state?.enabled && (
        <>
          <div className="h-px bg-border/30" />
          <div className="rounded-lg bg-muted/30 p-3 space-y-1">
            <p className="text-xs font-medium text-muted-foreground/70">当前状态</p>
            <p className="text-xs text-muted-foreground">
              当前服务: <span className="font-mono">{state.currentService}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              当前模型: <span className="font-mono">{state.currentModel}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              备用模型数: <span className="font-mono">{state.fallbacks.length}</span>
            </p>
          </div>
        </>
      )}
    </section>
  );
}
