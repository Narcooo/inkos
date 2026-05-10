import type { Dispatch, SetStateAction } from "react";
import { Bot, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Save, ShieldCheck, TestTube2, XCircle } from "lucide-react";
import type { ServiceInfo } from "../../store/service";
import type { ServiceDetailConnectionStatus, ServiceDetailModelInfo } from "../service-detail-state";
import { FieldLabel, GlassInput, Toggle } from "./components";
import { serviceAccent, serviceDisplayName, serviceGlyph } from "./display";
import type { ApiFormat } from "./types";

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
