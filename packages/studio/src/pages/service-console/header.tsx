import { RefreshCw, Save } from "lucide-react";
import type { ServiceConsoleNav } from "./types";

interface PageHeaderProps {
  readonly nav: ServiceConsoleNav;
  readonly onRefresh: () => void;
  readonly onSave: () => void;
}

export function ServiceConsoleHeader({ nav, onRefresh, onSave }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-5 border-b border-cyan-300/10 bg-cyan-950/10 px-4 py-4 xl:flex-row xl:items-center xl:justify-between xl:px-6">
      <div>
        <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
          <button onClick={nav.toDashboard} className="transition hover:text-cyan-200">系统</button>
          <span>/</span>
          <span className="text-slate-300">模型服务</span>
        </div>
        <h1 className="text-xl font-semibold tracking-normal text-white md:text-2xl">模型服务与路由配置</h1>
        <p className="mt-1 text-sm text-slate-400">管理 AI 服务提供商、连接配置与写作任务路由策略</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <span>系统状态</span>
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)]" />
          <span className="font-medium text-emerald-300">良好</span>
        </div>
        <button
          onClick={onRefresh}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-cyan-100/15 bg-slate-900/80 px-4 text-sm text-slate-200 transition hover:border-cyan-300/40 hover:bg-slate-800"
        >
          <RefreshCw size={15} />
          刷新
        </button>
        <button
          onClick={onSave}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-blue-300/40 bg-blue-600/70 px-4 text-sm text-white shadow-[0_0_22px_rgba(37,99,235,0.35)] transition hover:bg-blue-500"
        >
          <Save size={15} />
          保存所有配置
        </button>
      </div>
    </div>
  );
}
