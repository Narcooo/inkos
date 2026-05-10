import { Plus } from "lucide-react";
import type { ServiceInfo } from "../../store/service";
import { serviceAccent, serviceDisplayName, serviceGlyph } from "./display";
import type { ServiceConsoleNav } from "./types";

interface ServiceProviderPanelProps {
  readonly nav: ServiceConsoleNav;
  readonly services: ReadonlyArray<ServiceInfo>;
  readonly effectiveServiceId: string;
  readonly onSelectService: (serviceId: string) => void;
}

export function ServiceProviderPanel({
  nav,
  services,
  effectiveServiceId,
  onSelectService,
}: ServiceProviderPanelProps) {
  return (
    <section className="rounded-lg border border-cyan-300/15 bg-cyan-950/[0.13] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">服务提供商</h2>
        <button
          onClick={() => nav.toServiceDetail("custom")}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-cyan-100/15 bg-slate-950/50 px-3 text-xs text-slate-300 transition hover:border-cyan-300/40"
        >
          <Plus size={14} />
          添加
        </button>
      </div>
      <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
        {services.map((svc) => {
          const active = svc.service === effectiveServiceId;
          const display = serviceDisplayName(svc.service, svc.label);
          return (
            <button
              key={svc.service}
              onClick={() => onSelectService(svc.service)}
              className={[
                "group flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition",
                active
                  ? "border-cyan-300/70 bg-cyan-400/[0.08] shadow-[0_0_28px_rgba(6,182,212,0.18)]"
                  : "border-cyan-100/10 bg-slate-900/50 hover:border-cyan-300/35 hover:bg-slate-900/80",
              ].join(" ")}
            >
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md bg-gradient-to-br ${serviceAccent(svc.service)} text-sm font-black text-slate-950 shadow-[0_10px_25px_rgba(0,0,0,0.25)]`}>
                {serviceGlyph(svc.service)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-100">{display}</span>
                <span className="mt-0.5 block truncate text-[11px] text-slate-500">{svc.service}</span>
              </span>
              <span className={[
                "inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium",
                svc.connected ? "text-emerald-300" : "text-amber-300",
              ].join(" ")}
              >
                <span className={[
                  "h-1.5 w-1.5 rounded-full",
                  svc.connected ? "bg-emerald-400" : "bg-amber-400",
                ].join(" ")}
                />
                {svc.connected ? "已连接" : "未配置"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
