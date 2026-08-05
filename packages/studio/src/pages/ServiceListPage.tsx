import { useEffect, useMemo, useState } from "react";
import { Check, Eye, EyeOff, Loader2, Plus, Search, X } from "lucide-react";
import { GROUP_ORDER, getGroupDescription, getGroupLabel, getGroupShortLabel } from "../constants/service-groups";
import { tr } from "../lib/app-language";
import { fetchJson } from "../hooks/use-api";
import { useServiceStore } from "../store/service";
import type { EndpointGroup, ServiceInfo } from "../store/service";
import { ServiceQuickLinks, getServiceQuickLinks } from "../components/ServiceQuickLinks";
import { ServiceConfigSourceCard } from "../components/ServiceConfigSourceCard";

interface Nav {
  toDashboard: () => void;
  toServiceDetail: (id: string) => void;
}

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border/30 p-5 animate-pulse">
      <div className="flex items-center justify-between mb-3">
        <div className="h-4 w-24 bg-muted rounded" />
        <div className="w-2 h-2 rounded-full bg-muted" />
      </div>
      <div className="h-3 w-16 bg-muted/60 rounded" />
    </div>
  );
}

function ServiceCard({ svc, onClick }: { svc: ServiceInfo; onClick: () => void }) {
  const quickLinks = getServiceQuickLinks(svc.service);
  return (
    <div
      className={[
        "flex min-h-[92px] flex-col gap-2 rounded-lg border p-5 text-left transition-all hover:shadow-sm",
        svc.connected
          ? "border-emerald-500/30 bg-emerald-500/[0.03]"
          : "border-dashed border-border/40",
      ].join(" ")}
    >
      <button onClick={onClick} className="flex flex-1 flex-col gap-2 text-left">
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-medium">{svc.label}</span>
          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${svc.connected ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
        </div>
        <span className="text-xs text-muted-foreground/60">
          {svc.connected ? tr("已连接", "Connected") : tr("未配置", "Not configured")}
        </span>
      </button>
      {quickLinks.length > 0 && (
        <ServiceQuickLinks serviceId={svc.service} variant="card" className="pt-1" />
      )}
    </div>
  );
}

interface CoverProviderInfo {
  readonly service: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly models: readonly string[];
  readonly connected: boolean;
}

interface CoverConfigPayload {
  readonly service: string | null;
  readonly model: string | null;
  readonly baseUrl: string | null;
  readonly providers: readonly CoverProviderInfo[];
}

function CoverConfigCard() {
  const [providers, setProviders] = useState<readonly CoverProviderInfo[]>([]);
  const [service, setService] = useState("kkaiapi");
  const [model, setModel] = useState("gpt-image-2");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "saved" | "error">("loading");
  const [message, setMessage] = useState("");

  const selected = providers.find((provider) => provider.service === service);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<CoverConfigPayload>("/cover/config")
      .then((payload) => {
        if (cancelled) return;
        setProviders(payload.providers);
        const nextService = payload.service ?? payload.providers[0]?.service ?? "kkaiapi";
        const provider = payload.providers.find((item) => item.service === nextService) ?? payload.providers[0];
        setService(nextService);
        setModel(payload.model ?? provider?.defaultModel ?? "gpt-image-2");
        setBaseUrl(payload.baseUrl ?? "");
        setStatus("idle");
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus("error");
        setMessage(error instanceof Error ? error.message : tr("读取封面配置失败", "Failed to load cover config"));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!service) return;
    let cancelled = false;
    void fetchJson<{ apiKey?: string }>(`/cover/secret/${encodeURIComponent(service)}`)
      .then((payload) => {
        if (cancelled) return;
        setApiKey(payload.apiKey ?? "");
      })
      .catch(() => {
        if (!cancelled) setApiKey("");
      });
    return () => { cancelled = true; };
  }, [service]);

  const handleServiceChange = (nextService: string) => {
    const provider = providers.find((item) => item.service === nextService);
    setService(nextService);
    setModel(provider?.defaultModel ?? "gpt-image-2");
    setBaseUrl("");
    setStatus("idle");
    setMessage("");
  };

  const handleSave = async () => {
    const provider = selected;
    if (!provider) return;
    setStatus("saving");
    setMessage("");
    try {
      await fetchJson(`/cover/secret/${encodeURIComponent(provider.service)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      await fetchJson("/cover/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: provider.service,
          model,
          ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        }),
      });
      setStatus("saved");
      setMessage(tr("封面配置已保存", "Cover config saved"));
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : tr("保存封面配置失败", "Failed to save cover config"));
    }
  };

  if (providers.length === 0 && status !== "error") return null;

  return (
    <section className="rounded-xl border border-border/50 bg-card/50 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">{tr("封面生成", "Cover generation")}</h2>
          <p className="mt-1 text-xs text-muted-foreground/70">
            {tr(
              "只配置封面通道和模型；封面尺寸由短篇封面提示词和内部默认处理。",
              "Only configures the cover provider and model; cover size is handled by the short-story cover prompt and internal defaults.",
            )}
          </p>
        </div>
        {selected?.connected && (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
            {tr("已有密钥", "Key saved")}
          </span>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1.5">
          <span className="block text-xs font-medium text-muted-foreground/70">{tr("服务", "Service")}</span>
          <select
            value={service}
            onChange={(event) => handleServiceChange(event.target.value)}
            className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
          >
            {providers.map((provider) => (
              <option key={provider.service} value={provider.service}>{provider.label}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="block text-xs font-medium text-muted-foreground/70">{tr("封面模型", "Cover model")}</span>
          <select
            value={model}
            onChange={(event) => setModel(event.target.value)}
            className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
          >
            {(selected?.models ?? [model]).map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="space-y-1.5">
        <span className="block text-xs font-medium text-muted-foreground/70">Base URL</span>
        <input
          type="url"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder={selected?.baseUrl ?? "https://example.com/v1"}
          className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono"
        />
        <span className="block text-[11px] leading-5 text-muted-foreground/55">
          {tr(
            "留空使用该服务的默认地址；自定义地址会作为封面生成 API 根路径。",
            "Leave blank to use the provider default; a custom value becomes the cover generation API root.",
          )}
        </span>
      </label>

      <label className="space-y-1.5">
        <span className="block text-xs font-medium text-muted-foreground/70">API Key</span>
        <div className="relative">
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="sk-..."
            className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 pr-10 text-sm font-mono"
          />
          <button
            type="button"
            onClick={() => setShowKey((value) => !value)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleSave}
          disabled={status === "saving" || !selected}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {status === "saving" && <Loader2 size={12} className="animate-spin" />}
          {tr("保存封面配置", "Save cover config")}
        </button>
        {message && (
          <span className={`text-xs ${status === "error" ? "text-destructive" : "text-emerald-500"}`}>
            {message}
          </span>
        )}
      </div>
    </section>
  );
}

export function ServiceListPage({ nav }: { nav: Nav }) {
  const services = useServiceStore((s) => s.services);
  const loading = useServiceStore((s) => s.servicesLoading);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const refreshServices = useServiceStore((s) => s.refreshServices);

  useEffect(() => { void fetchServices(); }, [fetchServices]);

  const [query, setQuery] = useState("");
  const [selectedGroups, setSelectedGroups] = useState<Set<EndpointGroup>>(new Set());
  const [onlyConnected, setOnlyConnected] = useState(false);

  const bankServices = useMemo(
    () => services.filter((s) => !s.service.startsWith("custom")),
    [services],
  );
  const customServices = useMemo(
    () => services.filter((s) => s.service.startsWith("custom")),
    [services],
  );

  const groupCounts = useMemo(() => {
    const counts = {} as Record<EndpointGroup, number>;
    for (const group of GROUP_ORDER) {
      counts[group] = bankServices.filter((s) => s.group === group).length;
    }
    return counts;
  }, [bankServices]);

  const connectedCount = useMemo(
    () => services.filter((s) => s.connected).length,
    [services],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bankServices.filter((svc) => {
      if (onlyConnected && !svc.connected) return false;
      if (selectedGroups.size > 0 && (!svc.group || !selectedGroups.has(svc.group))) return false;
      if (q && !svc.label.toLowerCase().includes(q) && !svc.service.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [bankServices, onlyConnected, query, selectedGroups]);

  const filteredCustom = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (selectedGroups.size > 0) return [];
    return customServices.filter((svc) => {
      if (onlyConnected && !svc.connected) return false;
      if (q && !svc.label.toLowerCase().includes(q) && !svc.service.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [customServices, onlyConnected, query, selectedGroups]);

  const byGroup = useMemo(() => {
    const map = {} as Record<EndpointGroup, ServiceInfo[]>;
    for (const group of GROUP_ORDER) map[group] = [];
    for (const svc of filtered) {
      if (svc.group) map[svc.group].push(svc);
    }
    return map;
  }, [filtered]);

  const toggleGroup = (group: EndpointGroup) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const canCreateCustom = selectedGroups.size === 0 && query.trim() === "" && !onlyConnected;
  const showCustomSection = !loading && selectedGroups.size === 0 && (filteredCustom.length > 0 || canCreateCustom);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button
          onClick={nav.toDashboard}
          className="inline-flex items-center rounded-lg border border-border/50 bg-card/60 px-3 py-1.5 font-medium text-foreground hover:bg-secondary/50 transition-colors"
        >
          {tr("首页", "Home")}
        </button>
        <span className="text-border">/</span>
        <span className="text-foreground">{tr("服务商管理", "Providers")}</span>
      </div>

      <h1 className="font-serif text-2xl">{tr("服务商管理", "Providers")}</h1>

      <ServiceConfigSourceCard onChange={() => { void refreshServices(); }} />

      <CoverConfigCard />

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tr("搜索服务商", "Search providers")}
          className="w-full rounded-lg border border-border/60 bg-background py-2 pl-9 pr-9 text-sm outline-none focus:border-primary/50"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
            aria-label={tr("清空搜索", "Clear search")}
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedGroups(new Set())}
          className={[
            "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors",
            selectedGroups.size === 0
              ? "border-foreground bg-foreground text-background"
              : "border-border/60 text-muted-foreground hover:bg-secondary/50",
          ].join(" ")}
        >
          {tr("全部", "All")} {bankServices.length}
        </button>
        {GROUP_ORDER.map((group) => {
          const selected = selectedGroups.has(group);
          return (
            <button
              key={group}
              onClick={() => toggleGroup(group)}
              className={[
                "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors",
                selected
                  ? "border-foreground bg-foreground text-background"
                  : "border-border/60 text-muted-foreground hover:bg-secondary/50",
              ].join(" ")}
            >
              {selected && <Check size={12} />}
              {getGroupShortLabel(group)} {groupCounts[group]}
            </button>
          );
        })}
        {selectedGroups.size > 0 && (
          <button
            onClick={() => setSelectedGroups(new Set())}
            className="inline-flex items-center rounded-full px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {tr("清除筛选", "Clear filters")}
          </button>
        )}
      </div>

      <label className="inline-flex cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={onlyConnected}
          onChange={(event) => setOnlyConnected(event.target.checked)}
        />
        <span>{tr("只看已连接", "Connected only")} ({connectedCount})</span>
      </label>

      <div className="h-px bg-border/30" />

      {loading && (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {!loading && GROUP_ORDER.map((group) => {
        const list = byGroup[group];
        if (!list || list.length === 0) return null;
        return (
          <section key={group} className="space-y-3">
            <div className="space-y-1">
              <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                {getGroupLabel(group)}
              </h2>
              {getGroupDescription(group) && (
                <p className="text-xs text-muted-foreground/60">
                  {getGroupDescription(group)}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {list.map((svc) => (
                <ServiceCard
                  key={svc.service}
                  svc={svc}
                  onClick={() => nav.toServiceDetail(svc.service)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {showCustomSection && (
        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
            {tr("自定义服务", "Custom services")}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {filteredCustom.map((svc) => (
              <ServiceCard
                key={svc.service}
                svc={svc}
                onClick={() => nav.toServiceDetail(svc.service)}
              />
            ))}
            {canCreateCustom && (
              <button
                onClick={() => nav.toServiceDetail("custom")}
                className="flex min-h-[92px] flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/40 p-5 text-muted-foreground/60 transition-all hover:border-primary/30 hover:text-muted-foreground"
              >
                <Plus size={18} />
                <span className="text-xs">{tr("自定义服务", "Custom service")}</span>
              </button>
            )}
          </div>
        </section>
      )}

      {!loading && filtered.length === 0 && filteredCustom.length === 0 && !canCreateCustom && (
        <div className="rounded-lg border border-dashed border-border/40 p-8 text-center text-sm text-muted-foreground">
          {tr("没有匹配的服务商", "No matching providers")}
        </div>
      )}
    </div>
  );
}
