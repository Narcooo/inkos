import { ScrollText } from "lucide-react";
import type { SidebarNav } from "./types";

export function SidebarHeader({ nav }: { readonly nav: SidebarNav }) {
  return (
    <div className="px-5 py-5">
      <button
        onClick={nav.toDashboard}
        className="group flex w-full items-center justify-center gap-3 rounded-2xl px-2 py-2 hover:bg-card/45 transition-all duration-300 lg:justify-start"
      >
        <div className="w-10 h-10 rounded-2xl bg-[linear-gradient(135deg,oklch(0.64_0.17_242),oklch(0.72_0.13_185))] flex items-center justify-center text-white shadow-lg shadow-primary/20 group-hover:scale-105 transition-transform">
          <ScrollText size={18} />
        </div>
        <div className="hidden flex-col lg:flex">
          <span className="text-[19px] leading-none font-semibold">InkOS</span>
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold mt-1">Liquid Studio</span>
        </div>
      </button>
    </div>
  );
}
