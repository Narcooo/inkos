import { useEffect } from "react";
import { useServiceStore } from "../store/service";
import type { ServiceInfo } from "../store/service";
import { ServiceConfigSourceCard } from "../components/ServiceConfigSourceCard";

interface Nav {
  toDashboard: () => void;
  toServiceDetail: (id: string) => void;
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border/30 p-5 animate-pulse">
      <div className="flex items-center justify-between mb-3">
        <div className="h-4 w-24 bg-muted rounded" />
        <div className="w-2 h-2 rounded-full bg-muted" />
      </div>
      <div className="h-3 w-16 bg-muted/60 rounded" />
    </div>
  );
}

export function ServiceListPage({ nav }: { nav: Nav }) {
  const services = useServiceStore((s) => s.services);
  const loading = useServiceStore((s) => s.servicesLoading);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const refreshServices = useServiceStore((s) => s.refreshServices);

  useEffect(() => { void fetchServices(); }, [fetchServices]);

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button
          onClick={nav.toDashboard}
          className="inline-flex items-center rounded-lg border border-border/50 bg-card/60 px-3 py-1.5 font-medium text-foreground hover:bg-secondary/50 transition-colors"
        >
          首页
        </button>
        <span className="text-border">/</span>
        <span className="text-foreground">服务商管理</span>
      </div>

      <h1 className="font-serif text-2xl">服务商管理</h1>

      <ServiceConfigSourceCard onChange={() => { void refreshServices(); }} />

      <div className="grid grid-cols-2 gap-3">
        {loading
          ? Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)
          : services.map((svc) => (
              <ServiceCard
                key={svc.service}
                svc={svc}
                onClick={() => nav.toServiceDetail(svc.service)}
              />
            ))
        }
        {!loading && (
          <button
            onClick={() => nav.toServiceDetail("custom")}
            className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/40 p-5 text-muted-foreground/60 hover:border-primary/30 hover:text-muted-foreground transition-all"
          >
            <span className="text-lg leading-none">+</span>
            <span className="text-xs">自定义服务</span>
          </button>
        )}
      </div>
    </div>
  );
}

function ServiceCard({ svc, onClick }: { svc: ServiceInfo; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex flex-col gap-2 rounded-xl border p-5 text-left transition-all hover:shadow-sm",
        svc.connected
          ? "border-emerald-500/30 bg-emerald-500/[0.03]"
          : "border-dashed border-border/40",
      ].join(" ")}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">{svc.label}</span>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${svc.connected ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
      </div>
      <span className="text-xs text-muted-foreground/60">
        {svc.connected ? "已连接" : "未配置"}
      </span>
    </button>
  );
}
