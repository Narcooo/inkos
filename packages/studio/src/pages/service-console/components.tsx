import type { InputHTMLAttributes, ReactNode } from "react";

export function MetricCard({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  return (
    <div className="rounded-lg border border-cyan-200/10 bg-cyan-950/20 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className={[
        "mt-1 font-mono text-lg",
        tone === "green" ? "text-emerald-300" : tone === "red" ? "text-red-300" : "text-slate-100",
      ].join(" ")}
      >
        {value}
      </div>
    </div>
  );
}

export function ConsoleLine({ time, path, code, ms }: { time: string; path: string; code: string; ms: string }) {
  const ok = code.startsWith("2");
  return (
    <div className="grid grid-cols-[58px_42px_1fr_42px_48px] items-center gap-2 border-b border-cyan-100/[0.04] px-2 py-1.5 font-mono text-[11px] text-slate-400 last:border-0">
      <span>{time}</span>
      <span className="text-emerald-300">POST</span>
      <span className="truncate text-slate-300">{path}</span>
      <span className={ok ? "text-emerald-300" : "text-red-300"}>{code}</span>
      <span className="text-right">{ms}</span>
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-xs font-medium text-slate-300">{children}</label>;
}

export function GlassInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "h-9 w-full rounded-md border border-cyan-100/12 bg-slate-950/50 px-3 text-sm text-slate-100 outline-none transition",
        "placeholder:text-slate-600 focus:border-cyan-300/60 focus:bg-slate-950/70 focus:shadow-[0_0_0_3px_rgba(34,211,238,0.08)]",
        props.readOnly ? "cursor-default text-slate-400" : "",
        props.className ?? "",
      ].join(" ")}
    />
  );
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={[
        "relative h-6 w-11 rounded-full border transition",
        checked
          ? "border-blue-300/50 bg-blue-500 shadow-[0_0_18px_rgba(59,130,246,0.45)]"
          : "border-slate-600 bg-slate-800",
      ].join(" ")}
    >
      <span
        className={[
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition",
          checked ? "left-5" : "left-0.5",
        ].join(" ")}
      />
    </button>
  );
}
