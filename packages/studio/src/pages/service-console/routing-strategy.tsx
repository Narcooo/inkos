import { ChevronDown, GripVertical } from "lucide-react";
import { Toggle } from "./components";
import { routeOptionLabel } from "./display";
import type { RouteRow } from "./types";

interface RoutingPolicyPanelProps {
  readonly routes: ReadonlyArray<RouteRow>;
  readonly modelOptions: ReadonlyArray<string>;
  readonly updateRoute: (rowId: string, patch: Partial<RouteRow>) => void;
}

export function RoutingPolicyPanel({ routes, modelOptions, updateRoute }: RoutingPolicyPanelProps) {
  return (
    <section className="rounded-lg border border-cyan-300/15 bg-cyan-950/[0.12] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">写作任务路由策略</h2>
          <p className="mt-1 text-xs text-slate-500">为不同写作任务类型选择最合适的模型与服务商，支持优先级与回退</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">策略模板</span>
          <button className="inline-flex h-8 items-center gap-2 rounded-md border border-cyan-100/15 bg-slate-950/50 px-3 text-slate-300">
            默认策略
            <ChevronDown size={14} />
          </button>
          <button className="h-8 rounded-md border border-cyan-100/15 bg-slate-950/50 px-3 text-slate-300">管理模板</button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-cyan-100/10">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead className="bg-slate-950/45 text-xs font-medium text-slate-400">
            <tr>
              <th className="w-9 px-3 py-2 text-left" />
              <th className="px-3 py-2 text-left">任务类型</th>
              <th className="px-3 py-2 text-left">首选模型（高优先级）</th>
              <th className="px-3 py-2 text-left">备用模型（回退）</th>
              <th className="px-3 py-2 text-left">超时时间</th>
              <th className="px-3 py-2 text-left">重试次数</th>
              <th className="px-3 py-2 text-left">启用</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cyan-100/10">
            {routes.map((row) => (
              <tr key={row.id} className="bg-cyan-950/[0.06] transition hover:bg-cyan-400/[0.06]">
                <td className="px-3 py-2 text-slate-600"><GripVertical size={15} /></td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-200">{row.task}</td>
                <td className="px-3 py-2">
                  <select
                    value={row.primary}
                    onChange={(e) => updateRoute(row.id, { primary: e.target.value })}
                    className="h-8 w-full rounded-md border border-cyan-100/12 bg-slate-950/50 px-3 text-xs text-slate-200 outline-none"
                  >
                    {modelOptions.map((option) => <option key={option} value={option}>{routeOptionLabel(option)}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={row.fallback}
                    onChange={(e) => updateRoute(row.id, { fallback: e.target.value })}
                    className="h-8 w-full rounded-md border border-cyan-100/12 bg-slate-950/50 px-3 text-xs text-slate-200 outline-none"
                  >
                    {modelOptions.map((option) => <option key={option} value={option}>{routeOptionLabel(option)}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={row.timeout}
                    onChange={(e) => updateRoute(row.id, { timeout: e.target.value })}
                    className="h-8 w-20 rounded-md border border-cyan-100/12 bg-slate-950/50 px-2 text-xs text-slate-200 outline-none"
                  >
                    {["30s", "45s", "60s", "90s"].map((option) => <option key={option}>{option}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={row.retry}
                    onChange={(e) => updateRoute(row.id, { retry: e.target.value })}
                    className="h-8 w-16 rounded-md border border-cyan-100/12 bg-slate-950/50 px-2 text-xs text-slate-200 outline-none"
                  >
                    {["0", "1", "2", "3"].map((option) => <option key={option}>{option}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <Toggle checked={row.enabled} onChange={(enabled) => updateRoute(row.id, { enabled })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
