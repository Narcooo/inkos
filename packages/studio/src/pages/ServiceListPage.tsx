import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Search, X } from "lucide-react";
import { GROUP_LABELS, GROUP_ORDER, GROUP_SHORT_LABELS } from "../constants/service-groups";
import { useServiceStore } from "../store/service";
import type { EndpointGroup, ServiceInfo } from "../store/service";
import { useI18n } from "../hooks/use-i18n";

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

const SERVICE_LIST_COPY = {
  zh: {
    home: "首页",
    title: "服务商管理",
    search: "搜索服务商",
    clearSearch: "清空搜索",
    all: "全部",
    clearFilter: "清除筛选",
    onlyConnected: "只看已连接",
    connected: "已连接",
    notConfigured: "未配置",
    customServices: "自定义服务",
    customService: "自定义服务",
    noMatches: "没有匹配的服务商",
    groups: GROUP_LABELS,
    shortGroups: GROUP_SHORT_LABELS,
  },
  ko: {
    home: "홈",
    title: "모델 설정",
    search: "서비스 검색",
    clearSearch: "검색 지우기",
    all: "전체",
    clearFilter: "필터 지우기",
    onlyConnected: "연결된 항목만",
    connected: "연결됨",
    notConfigured: "설정 안 됨",
    customServices: "사용자 지정 서비스",
    customService: "사용자 지정 서비스",
    noMatches: "일치하는 서비스가 없습니다",
    groups: {
      overseas: "해외 공식",
      china: "중국 공식",
      aggregator: "통합 / 2차 API",
      local: "로컬 / 구독",
      codingPlan: "CodingPlan",
    },
    shortGroups: {
      overseas: "해외",
      china: "중국",
      aggregator: "통합",
      local: "로컬",
      codingPlan: "CodingPlan",
    },
  },
} as const;

function ServiceCard({ svc, onClick, copy }: { svc: ServiceInfo; onClick: () => void; copy: typeof SERVICE_LIST_COPY.zh | typeof SERVICE_LIST_COPY.ko }) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex min-h-[92px] flex-col gap-2 rounded-lg border p-5 text-left transition-all hover:shadow-sm",
        svc.connected
          ? "border-emerald-500/30 bg-emerald-500/[0.03]"
          : "border-dashed border-border/40",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-sm font-medium">{svc.label}</span>
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${svc.connected ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
      </div>
      <span className="text-xs text-muted-foreground/60">
        {svc.connected ? copy.connected : copy.notConfigured}
      </span>
    </button>
  );
}

export function ServiceListPage({ nav }: { nav: Nav }) {
  const { lang } = useI18n();
  const copy = lang === "ko" ? SERVICE_LIST_COPY.ko : SERVICE_LIST_COPY.zh;
  const services = useServiceStore((s) => s.services);
  const loading = useServiceStore((s) => s.servicesLoading);
  const fetchServices = useServiceStore((s) => s.fetchServices);

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
          {copy.home}
        </button>
        <span className="text-border">/</span>
        <span className="text-foreground">{copy.title}</span>
      </div>

      <h1 className="font-serif text-2xl">{copy.title}</h1>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.search}
          className="w-full rounded-lg border border-border/60 bg-background py-2 pl-9 pr-9 text-sm outline-none focus:border-primary/50"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
            aria-label={copy.clearSearch}
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
          {copy.all} {bankServices.length}
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
              {copy.shortGroups[group]} {groupCounts[group]}
            </button>
          );
        })}
        {selectedGroups.size > 0 && (
          <button
            onClick={() => setSelectedGroups(new Set())}
            className="inline-flex items-center rounded-full px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {copy.clearFilter}
          </button>
        )}
      </div>

      <label className="inline-flex cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={onlyConnected}
          onChange={(event) => setOnlyConnected(event.target.checked)}
        />
        <span>{copy.onlyConnected} ({connectedCount})</span>
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
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
              {copy.groups[group]}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {list.map((svc) => (
                <ServiceCard
                  key={svc.service}
                  svc={svc}
                  copy={copy}
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
            {copy.customServices}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {filteredCustom.map((svc) => (
              <ServiceCard
                key={svc.service}
                svc={svc}
                copy={copy}
                onClick={() => nav.toServiceDetail(svc.service)}
              />
            ))}
            {canCreateCustom && (
              <button
                onClick={() => nav.toServiceDetail("custom")}
                className="flex min-h-[92px] flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/40 p-5 text-muted-foreground/60 transition-all hover:border-primary/30 hover:text-muted-foreground"
              >
                <Plus size={18} />
                <span className="text-xs">{copy.customService}</span>
              </button>
            )}
          </div>
        </section>
      )}

      {!loading && filtered.length === 0 && filteredCustom.length === 0 && !canCreateCustom && (
        <div className="rounded-lg border border-dashed border-border/40 p-8 text-center text-sm text-muted-foreground">
          {copy.noMatches}
        </div>
      )}
    </div>
  );
}
