import { SidebarItem } from "./SidebarItem";
import type { SidebarItemSpec } from "./types";

interface SidebarNavSectionProps {
  readonly title: string;
  readonly items: ReadonlyArray<SidebarItemSpec>;
}

export function SidebarNavSection({ title, items }: SidebarNavSectionProps) {
  return (
    <div>
      <div className="px-3 mb-3 hidden lg:block">
        <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
          {title}
        </span>
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <SidebarItem
            key={item.label}
            label={item.label}
            icon={item.icon}
            active={item.active}
            onClick={item.onClick}
            badge={item.badge}
            badgeColor={item.badgeColor}
          />
        ))}
      </div>
    </div>
  );
}
