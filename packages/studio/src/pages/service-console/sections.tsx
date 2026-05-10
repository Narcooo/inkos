import type { Dispatch, SetStateAction } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  GripVertical,
  KeyRound,
  Loader2,
  Pause,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  TestTube2,
  XCircle,
} from "lucide-react";
import type { ServiceInfo } from "../../store/service";
import type {
  ServiceDetailConnectionStatus,
  ServiceDetailModelInfo,
} from "../service-detail-state";
import { ConsoleLine, FieldLabel, GlassInput, MetricCard, Toggle } from "./components";
import { routeOptionLabel, serviceAccent, serviceDisplayName, serviceGlyph } from "./display";
import type { ApiFormat, RouteRow, ServiceConfigPayload, ServiceConsoleNav } from "./types";

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

interface ServiceConfigPanelProps {
  readonly selectedService?: ServiceInfo;
  readonly effectiveServiceId: string;
  readonly isCustom: boolean;
  readonly status: ServiceDetailConnectionStatus;
  readonly statusText: string;
  readonly detectedModel: string;
  readonly serviceName: string;
  readonly setServiceName: Dispatch<SetStateAction<string>>;
  readonly apiKey: string;
  readonly setApiKey: Dispatch<SetStateAction<string>>;
  readonly showKey: boolean;
  readonly setShowKey: Dispatch<SetStateAction<boolean>>;
  readonly baseUrl: string;
  readonly setBaseUrl: Dispatch<SetStateAction<string>>;
  readonly timeout: string;
  readonly setTimeoutValue: Dispatch<SetStateAction<string>>;
  readonly concurrency: string;
  readonly setConcurrency: Dispatch<SetStateAction<string>>;
  readonly apiFormat: ApiFormat;
  readonly setApiFormat: Dispatch<SetStateAction<ApiFormat>>;
  readonly stream: boolean;
  readonly setStream: Dispatch<SetStateAction<boolean>>;
  readonly temperature: string;
  readonly setTemperature: Dispatch<SetStateAction<string>>;
  readonly selectedModels: ReadonlyArray<ServiceDetailModelInfo>;
  readonly onTest: () => void;
  readonly onSave: () => void;
  readonly onReset: () => void;
}

export function ServiceConfigPanel(props: ServiceConfigPanelProps) {
  const {
    selectedService,
    effectiveServiceId,
    isCustom,
    status,
    statusText,
    detectedModel,
    serviceName,
    setServiceName,
    apiKey,
    setApiKey,
    showKey,
    setShowKey,
    baseUrl,
    setBaseUrl,
    timeout,
    setTimeoutValue,
    concurrency,
    setConcurrency,
    apiFormat,
    setApiFormat,
    stream,
    setStream,
    temperature,
    setTemperature,
    selectedModels,
    onTest,
    onSave,
    onReset,
  } = props;

  return (
    <section className="rounded-lg border border-cyan-300/30 bg-cyan-950/[0.11] p-4 shadow-[0_0_32px_rgba(6,182,212,0.16),inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`grid h-10 w-10 place-items-center rounded-lg bg-gradient-to-br ${serviceAccent(effectiveServiceId)} text-base font-black text-slate-950`}>
            {serviceGlyph(effectiveServiceId)}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-white">{serviceDisplayName(effectiveServiceId, selectedService?.label)}</h2>
              <span className="rounded border border-blue-300/25 bg-blue-500/10 px-1.5 py-0.5 text-[11px] text-blue-200">官方</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
              {status.state === "connected" ? <CheckCircle2 size={13} className="text-emerald-300" /> : status.state === "error" ? <XCircle size={13} className="text-red-300" /> : <ShieldCheck size={13} className="text-cyan-300" />}
              <span>{statusText}</span>
              {detectedModel ? <span className="truncate">/ {detectedModel}</span> : null}
            </div>
          </div>
        </div>
        <Toggle checked={selectedService?.connected ?? false} onChange={() => void onTest()} />
      </div>

      <div className="grid gap-4">
        <div>
          <FieldLabel>服务名称</FieldLabel>
          <GlassInput value={serviceName} onChange={(e) => setServiceName(e.target.value)} readOnly={!isCustom} />
        </div>
        <div>
          <FieldLabel>API Key</FieldLabel>
          <div className="relative">
            <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <GlassInput
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="pl-9 pr-10 font-mono"
              placeholder="输入服务 API Key"
            />
            <button
              type="button"
              onClick={() => setShowKey((value) => !value)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-cyan-200"
              aria-label={showKey ? "隐藏密钥" : "显示密钥"}
            >
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-xs">
            <span className={apiKey.trim() ? "text-emerald-300" : "text-slate-500"}>
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current" />
              {apiKey.trim() ? "密钥有效" : "等待密钥"}
            </span>
            <button onClick={onTest} className="rounded-md border border-cyan-100/15 px-3 py-1 text-slate-300 transition hover:border-cyan-300/40 hover:text-cyan-100">
              重新验证
            </button>
          </div>
        </div>
        <div>
          <FieldLabel>Base URL</FieldLabel>
          <GlassInput value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" />
          <p className="mt-1.5 text-xs text-slate-500">默认留空使用官方地址，或输入兼容的 API 地址</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <FieldLabel>超时设置（秒）</FieldLabel>
            <GlassInput value={timeout} onChange={(e) => setTimeoutValue(e.target.value)} inputMode="numeric" />
          </div>
          <div>
            <FieldLabel>并发限制</FieldLabel>
            <GlassInput value={concurrency} onChange={(e) => setConcurrency(e.target.value)} inputMode="numeric" />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <FieldLabel>API 格式</FieldLabel>
            <select
              value={apiFormat}
              onChange={(e) => setApiFormat(e.target.value as ApiFormat)}
              className="h-9 w-full rounded-md border border-cyan-100/12 bg-slate-950/50 px-3 text-sm text-slate-100 outline-none focus:border-cyan-300/60"
            >
              <option value="responses">Responses</option>
              <option value="chat">Chat</option>
            </select>
          </div>
          <div>
            <FieldLabel>流式输出</FieldLabel>
            <div className="flex h-9 items-center rounded-md border border-cyan-100/12 bg-slate-950/50 px-3">
              <Toggle checked={stream} onChange={setStream} />
            </div>
          </div>
          <div>
            <FieldLabel>Temperature</FieldLabel>
            <GlassInput value={temperature} onChange={(e) => setTemperature(e.target.value)} inputMode="decimal" />
          </div>
        </div>
        {status.state === "error" ? (
          <div className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {status.message}
          </div>
        ) : null}
        {selectedModels.length > 0 ? (
          <div className="rounded-lg border border-cyan-100/10 bg-slate-950/35 px-3 py-2">
            <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
              <Bot size={14} />
              已发现模型
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedModels.slice(0, 6).map((model) => (
                <span key={model.id} className="rounded-md border border-cyan-100/10 bg-cyan-950/30 px-2 py-1 font-mono text-[11px] text-cyan-100">
                  {model.id}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={onTest}
          disabled={status.state === "testing" || status.state === "saving"}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-blue-300/40 bg-blue-600/70 px-4 text-sm text-white transition hover:bg-blue-500 disabled:opacity-50"
        >
          {status.state === "testing" ? <Loader2 size={15} className="animate-spin" /> : <TestTube2 size={15} />}
          测试连接
        </button>
        <div className="flex gap-2">
          <button
            onClick={onReset}
            className="h-9 rounded-md border border-cyan-100/15 bg-slate-900/70 px-5 text-sm text-slate-300 transition hover:border-cyan-300/40"
          >
            取消
          </button>
          <button
            onClick={onSave}
            disabled={status.state === "testing" || status.state === "saving"}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-blue-300/40 bg-blue-600/75 px-5 text-sm text-white transition hover:bg-blue-500 disabled:opacity-50"
          >
            {status.state === "saving" ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            保存
          </button>
        </div>
      </div>
    </section>
  );
}

interface DiagnosticsPanelProps {
  readonly diagnostics: {
    readonly requestTotal: string;
    readonly successRate: string;
    readonly avgLatency: string;
    readonly errorCount: string;
  };
  readonly lastAction: string;
  readonly detectedModel: string;
  readonly configPayload: ServiceConfigPayload | null;
  readonly temperature: string;
  readonly stream: boolean;
}

export function DiagnosticsPanel({
  diagnostics,
  lastAction,
  detectedModel,
  configPayload,
  temperature,
  stream,
}: DiagnosticsPanelProps) {
  return (
    <section className="rounded-lg border border-cyan-300/20 bg-cyan-950/[0.12] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-white">实时诊断控制台</h2>
        <div className="flex items-center gap-2">
          <button className="rounded-md border border-cyan-100/15 bg-slate-950/50 px-3 py-1.5 text-xs text-slate-300 transition hover:border-cyan-300/40">清空日志</button>
          <button className="grid h-8 w-8 place-items-center rounded-md border border-cyan-100/15 bg-slate-950/50 text-slate-300 transition hover:border-cyan-300/40">
            <Pause size={14} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
        <MetricCard label="请求总数" value={diagnostics.requestTotal} />
        <MetricCard label="成功率" value={diagnostics.successRate} tone="green" />
        <MetricCard label="平均延迟" value={diagnostics.avgLatency} />
        <MetricCard label="错误数" value={diagnostics.errorCount} tone="red" />
      </div>
      <div className="mt-3 rounded-lg border border-cyan-100/10 bg-slate-950/45">
        <ConsoleLine time="14:21:33" path="/v1/chat/completions" code="200" ms="1.08s" />
        <ConsoleLine time="14:21:32" path="/v1/chat/completions" code="200" ms="0.93s" />
        <ConsoleLine time="14:21:30" path="/v1/chat/completions" code="200" ms="1.21s" />
        <ConsoleLine time="14:21:28" path="/v1/embeddings" code="200" ms="0.67s" />
        <ConsoleLine time="14:21:27" path="/v1/chat/completions" code="200" ms="1.15s" />
        <ConsoleLine time="14:21:25" path="/v1/chat/completions" code="429" ms="0.92s" />
        <ConsoleLine time="14:21:24" path="/v1/chat/completions" code="200" ms="1.31s" />
      </div>
      <div className="mt-3 overflow-hidden rounded-lg border border-cyan-100/10 bg-slate-950/55">
        <div className="flex items-center justify-between border-b border-cyan-100/10 px-3 py-2 text-xs">
          <div className="font-mono text-slate-400">最近一次请求 / {lastAction}</div>
          <span className="rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-emerald-300">200 OK</span>
        </div>
        <div className="grid grid-cols-2 border-b border-cyan-100/10 text-xs">
          <button className="bg-cyan-500/10 py-1.5 text-cyan-100">请求</button>
          <button className="py-1.5 text-slate-500">响应</button>
        </div>
        <pre className="max-h-40 overflow-auto p-3 font-mono text-[11px] leading-5 text-slate-300">{`{
  "model": "${detectedModel || configPayload?.defaultModel || "gpt-4o"}",
  "messages": [
    { "role": "system", "content": "你是一个专业写作助理..." },
    { "role": "user", "content": "请帮我扩展这段情节..." }
  ],
  "temperature": ${temperature || "0.7"},
  "stream": ${stream}
}`}</pre>
      </div>
    </section>
  );
}

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
