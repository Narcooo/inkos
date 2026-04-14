import { useApi } from "../hooks/use-api";

interface ServiceInfo {
  readonly service: string;
  readonly label: string;
  readonly connected: boolean;
  readonly modelCount: number;
}

interface ServicesResponse {
  readonly services: ReadonlyArray<ServiceInfo>;
}

interface Nav {
  toDashboard: () => void;
  toServiceDetail: (id: string) => void;
}

export function ServiceListPage({ nav }: { nav: Nav }) {
  const { data, loading, error } = useApi<ServicesResponse>("/services");

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

  const services = data?.services ?? [];

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button
          onClick={nav.toDashboard}
          className="hover:text-foreground transition-colors"
        >
          首页
        </button>
        <span className="text-border">/</span>
        <span className="text-foreground">服务商管理</span>
      </div>

      <h1 className="font-serif text-3xl">服务商管理</h1>

      <div className="grid grid-cols-2 gap-4">
        {services.map((svc) => (
          <ServiceCard
            key={svc.service}
            svc={svc}
            onClick={() => nav.toServiceDetail(svc.service)}
          />
        ))}

        {/* Add custom service card */}
        <button
          onClick={() => nav.toServiceDetail("custom")}
          className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border/50 p-6 text-muted-foreground hover:border-primary/40 hover:text-foreground transition-all min-h-[120px]"
        >
          <span className="text-2xl leading-none">+</span>
          <span className="text-sm font-medium">自定义服务</span>
        </button>
      </div>
    </div>
  );
}

function ServiceCard({
  svc,
  onClick,
}: {
  svc: ServiceInfo;
  onClick: () => void;
}) {
  const connected = svc.connected;

  return (
    <button
      onClick={onClick}
      className={[
        "flex flex-col gap-3 rounded-xl border-2 p-5 text-left transition-all hover:shadow-md",
        connected
          ? "border-emerald-500/60 bg-emerald-500/5 hover:border-emerald-500/80"
          : "border-dashed border-border/60 hover:border-border",
      ].join(" ")}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">{svc.label}</span>
        <span
          className={[
            "w-2 h-2 rounded-full shrink-0",
            connected ? "bg-emerald-500" : "bg-muted-foreground/40",
          ].join(" ")}
        />
      </div>
      <span className="text-xs text-muted-foreground">
        {connected ? `${svc.modelCount} 个模型` : "未配置"}
      </span>
    </button>
  );
}
