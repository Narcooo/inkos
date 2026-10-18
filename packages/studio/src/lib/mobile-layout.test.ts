import { describe, expect, it } from "vitest";
import {
  deriveSidebarLayout,
  revealOnCoarsePointer,
  touchTargetClass,
  SIDEBAR_DRAWER_WIDTH_CLASS,
} from "./mobile-layout";

describe("deriveSidebarLayout", () => {
  it("keeps the drawer off-screen until it is opened on phone widths", () => {
    const closed = deriveSidebarLayout(false);

    expect(closed.aside).toContain("fixed");
    expect(closed.aside).toContain("-translate-x-full");
    expect(closed.scrim).toBeNull();
  });

  it("slides the drawer in and shows a dismissable backdrop when open", () => {
    const open = deriveSidebarLayout(true);

    expect(open.aside).toContain("translate-x-0");
    expect(open.aside).not.toContain("-translate-x-full");
    expect(open.scrim).toContain("md:hidden");
  });

  it("restores the static desktop column from md up in both states", () => {
    for (const open of [true, false]) {
      const { aside } = deriveSidebarLayout(open);
      expect(aside).toContain("md:static");
      expect(aside).toContain("md:w-[260px]");
      expect(aside).toContain("md:translate-x-0");
    }
  });

  it("reserves a viewport-bounded drawer width", () => {
    expect(deriveSidebarLayout(false).aside).toContain(SIDEBAR_DRAWER_WIDTH_CLASS);
    expect(SIDEBAR_DRAWER_WIDTH_CLASS).toContain("max-w-[86vw]");
  });
});

describe("revealOnCoarsePointer", () => {
  it("stays visible on touch devices where hover never fires", () => {
    const classes = revealOnCoarsePointer();

    expect(classes).toContain("opacity-0");
    expect(classes).toContain("hover:opacity-100");
    expect(classes).toContain("pointer-coarse:opacity-100");
  });
});

describe("touchTargetClass", () => {
  it("grows the target on phones and keeps the dense desktop size from sm up", () => {
    const classes = touchTargetClass("rounded");

    expect(classes).toContain("h-10 w-10");
    expect(classes).toContain("sm:h-6 sm:w-6");
    expect(classes).toContain("rounded");
  });
});