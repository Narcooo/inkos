import { SERVICE_PRIORITY } from "./constants";

export function serviceSortScore(serviceId: string): number {
  if (serviceId.startsWith("custom:")) return SERVICE_PRIORITY.indexOf("custom");
  const score = SERVICE_PRIORITY.indexOf(serviceId as (typeof SERVICE_PRIORITY)[number]);
  return score === -1 ? SERVICE_PRIORITY.length + 1 : score;
}

export function serviceDisplayName(serviceId: string, fallback?: string): string {
  if (serviceId.startsWith("custom:")) return serviceId.slice("custom:".length) || "自定义服务";
  if (serviceId === "moonshot") return "Kimi";
  if (serviceId === "google") return "Gemini";
  return fallback ?? serviceId;
}

export function serviceGlyph(serviceId: string): string {
  if (serviceId.includes("openai")) return "◎";
  if (serviceId.includes("anthropic")) return "AI";
  if (serviceId.includes("google")) return "✦";
  if (serviceId.includes("deepseek")) return "DS";
  if (serviceId.includes("moonshot")) return "K";
  return "◇";
}

export function serviceAccent(serviceId: string): string {
  if (serviceId.includes("google")) return "from-blue-400 to-cyan-200";
  if (serviceId.includes("deepseek")) return "from-blue-500 to-indigo-400";
  if (serviceId.includes("moonshot")) return "from-zinc-100 to-zinc-400";
  if (serviceId.includes("anthropic")) return "from-neutral-300 to-slate-500";
  if (serviceId.includes("custom")) return "from-slate-100 to-cyan-300";
  return "from-cyan-200 to-sky-500";
}

export function routeOptionLabel(option: string): string {
  return option.length > 34 ? `${option.slice(0, 31)}...` : option;
}
