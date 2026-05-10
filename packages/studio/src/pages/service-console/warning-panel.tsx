import { AlertTriangle } from "lucide-react";
import type { ServiceInfo } from "../../store/service";
import { serviceAccent, serviceDisplayName, serviceGlyph } from "./display";

interface UnconfiguredServicesPanelProps {
  readonly services: ReadonlyArray<ServiceInfo>;
  readonly onSelectService: (serviceId: string) => void;
}

export function UnconfiguredServicesPanel({ services, onSelectService }: UnconfiguredServicesPanelProps) {
  return (
    <aside className="rounded-lg border border-amber-400/30 bg-amber-500/[0.08] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="mb-4 flex items-center gap-3">
        <AlertTriangle className="text-amber-300" size={22} />
        <div>
          <h2 className="text-base font-semibold text-amber-200">服务未配置</h2>
          <p className="mt-1 text-xs text-amber-100/55">以下服务未完成配置，可能影响相关任务的可用性</p>
        </div>
      </div>
      <div className="space-y-3">
        {services.length > 0 ? services.map((svc) => (
          <div key={svc.service} className="flex items-center gap-3 rounded-lg border border-amber-300/15 bg-slate-950/30 p-3">
            <span className={`grid h-9 w-9 place-items-center rounded-md bg-gradient-to-br ${serviceAccent(svc.service)} text-sm font-black text-slate-950`}>
              {serviceGlyph(svc.service)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-slate-100">{serviceDisplayName(svc.service, svc.label)}</div>
              <div className="text-xs text-amber-100/50">缺少 API Key</div>
            </div>
            <button
              onClick={() => onSelectService(svc.service)}
              className="rounded-md border border-amber-200/20 bg-amber-200/5 px-3 py-1.5 text-xs text-amber-100 transition hover:bg-amber-200/10"
            >
              去配置
            </button>
          </div>
        )) : (
          <div className="rounded-lg border border-emerald-300/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">
            当前服务配置完整
          </div>
        )}
        <button className="flex w-full items-center justify-between rounded-lg border border-amber-300/20 bg-amber-300/5 px-3 py-3 text-sm text-amber-200 transition hover:bg-amber-300/10">
          查看全部未配置服务
          <span>→</span>
        </button>
      </div>
    </aside>
  );
}
