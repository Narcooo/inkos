import type { SidebarItemSpec } from "./types";

export function SidebarItem({
  label,
  icon,
  active,
  onClick,
  badge,
  badgeColor,
}: SidebarItemSpec) {
  return (
    <button
      onClick={onClick}
      className={`ios-nav-item w-full group flex items-center justify-center gap-3 px-3 py-2.5 rounded-2xl text-sm transition-all duration-200 lg:justify-start ${
        active
          ? "ios-nav-item-active text-foreground font-semibold"
          : "text-foreground font-medium hover:text-foreground hover:bg-card/45"
      }`}
    >
      <span className={`transition-colors ${active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`}>
        {icon}
      </span>
      <span className="hidden flex-1 text-left lg:inline">{label}</span>
      {badge && (
        <span className={`hidden text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tight lg:inline ${badgeColor}`}>
          {badge}
        </span>
      )}
    </button>
  );
}
