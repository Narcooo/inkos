import type { TFunction } from "../../hooks/use-i18n";

export function SidebarStatus({
  running,
  t,
}: {
  readonly running: boolean;
  readonly t: TFunction;
}) {
  if (!running) return null;

  return (
    <div className="p-4 border-t border-border/35">
      <div className="ios-card flex items-center gap-3 px-3 py-2 rounded-2xl">
        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-[11px] font-semibold text-foreground/80 uppercase tracking-wider">
          {t("nav.agentOnline")}
        </span>
      </div>
    </div>
  );
}
