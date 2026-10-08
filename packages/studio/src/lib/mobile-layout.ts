/**
 * Phone-portrait layout contract for Studio.
 *
 * The app used to assume a desktop window: a fixed 260px sidebar, multi-column
 * grids and hover-revealed controls with no touch fallback. The layout itself is
 * plain CSS (Tailwind breakpoints, no resize listeners), so this module only
 * holds the class strings that several components have to agree on — keeping
 * them in one place makes the mobile contract greppable and testable.
 */

/** Drawer column width: roomier than the desktop column so labels do not truncate. */
export const SIDEBAR_DRAWER_WIDTH_CLASS = "w-[288px] max-w-[86vw]";

export interface SidebarLayout {
  /** Class list for the sidebar <aside>. */
  readonly aside: string;
  /** Backdrop class list, or null when the drawer is closed. */
  readonly scrim: string | null;
}

/**
 * Sidebar shell classes. Below `md` (768px) the aside is a fixed drawer that
 * stays translated off-screen until opened; from `md` up it is the static
 * column the desktop layout has always had.
 */
export function deriveSidebarLayout(open: boolean): SidebarLayout {
  const aside = [
    "shrink-0 border-r border-border bg-background/80 backdrop-blur-md",
    "flex flex-col h-full overflow-hidden select-none",
    "fixed inset-y-0 left-0 z-50 pb-[env(safe-area-inset-bottom)]",
    "transition-transform duration-200 ease-out",
    SIDEBAR_DRAWER_WIDTH_CLASS,
    "md:static md:z-auto md:w-[260px] md:max-w-none md:pb-0 md:translate-x-0 md:shadow-none",
    open ? "translate-x-0 shadow-2xl" : "-translate-x-full",
  ].join(" ");
  return {
    aside,
    scrim: open ? "md:hidden fixed inset-0 z-40 bg-black/45 backdrop-blur-sm" : null,
  };
}

/** Backdrop that closes the drawer by tapping outside it. */
export const SIDEBAR_SCRIM_TEST_ID = "sidebar-scrim";

/** Header control that opens the drawer; only rendered below `md`. */
export const NAV_TOGGLE_TEST_ID = "sidebar-toggle";

/**
 * Hover-revealed controls. Tailwind wraps `hover:` in `@media (hover: hover)`,
 * so on a touch screen the reveal never fires and the control stays invisible
 * and unreachable. `pointer-coarse:opacity-100` keeps such controls permanently
 * visible wherever the primary pointer cannot hover.
 */
export function revealOnCoarsePointer(group?: string): string {
  const base = "opacity-0 hover:opacity-100 pointer-coarse:opacity-100";
  return group ? `${base} group-hover/${group}:opacity-100` : base;
}

/** Touch-sized variant of a small icon control (>=40px for coarse pointers). */
export function touchTargetClass(base: string): string {
  return `h-10 w-10 sm:h-6 sm:w-6 ${base}`;
}