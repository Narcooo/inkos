import { Pause } from "lucide-react";
import { ConsoleLine, MetricCard } from "./components";
import type { ServiceConfigPayload } from "./types";

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
