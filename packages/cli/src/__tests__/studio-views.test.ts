import { beforeEach, describe, expect, it, vi } from "vitest";

function createClassList(initial: string[] = []) {
  const classes = new Set(initial);
  return {
    add: (...names: string[]) => names.forEach((name) => classes.add(name)),
    remove: (...names: string[]) => names.forEach((name) => classes.delete(name)),
    contains: (name: string) => classes.has(name),
  };
}

function createElement(initialClasses: string[] = []) {
  return {
    classList: createClassList(initialClasses),
    style: {} as Record<string, string>,
  };
}

const elements = new Map<string, ReturnType<typeof createElement>>();
const state = {
  currentView: "dashboard",
  sidebarCollapsed: false,
};

let navTabs: Array<{ dataset: { view: string }; classList: ReturnType<typeof createClassList> }> = [];
let subTabs: Array<{ dataset: { tool: string }; classList: ReturnType<typeof createClassList> }> = [];
let toolPanels: Array<ReturnType<typeof createElement>> = [];

vi.mock("../../../studio/public/js/utils.js", () => ({
  $: (id: string) => elements.get(id),
}));

vi.mock("../../../studio/public/js/state.js", () => ({
  state,
}));

describe("studio view routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    elements.clear();
    state.currentView = "dashboard";
    state.sidebarCollapsed = false;

    const dashboardView = createElement();
    const chatView = createElement();
    const editorView = createElement();
    const toolsView = createElement();
    const sidebar = createElement(["hidden"]);
    const toolExport = createElement();
    const toolAnalytics = createElement();
    toolExport.style.display = "none";
    toolAnalytics.style.display = "none";

    elements.set("main-area", {
      querySelectorAll: () => [dashboardView, chatView, editorView, toolsView],
    } as unknown as ReturnType<typeof createElement>);
    elements.set("dashboard-view", dashboardView);
    elements.set("chat-view", chatView);
    elements.set("editor-view", editorView);
    elements.set("tools-view", toolsView);
    elements.set("sidebar", sidebar);
    elements.set("tool-export", toolExport);
    elements.set("tool-analytics", toolAnalytics);

    navTabs = ["dashboard", "chat", "editor", "tools"].map((view) => ({
      dataset: { view },
      classList: createClassList(),
    }));
    subTabs = ["export", "analytics"].map((tool) => ({
      dataset: { tool },
      classList: createClassList(),
    }));
    toolPanels = [toolExport, toolAnalytics];

    vi.stubGlobal("document", {
      querySelectorAll: (selector: string) => {
        if (selector === ".nav-tab") return navTabs;
        if (selector === ".sub-tab") return subTabs;
        if (selector === ".tool-panel") return toolPanels;
        return [];
      },
      querySelector: (selector: string) => {
        const navMatch = selector.match(/\.nav-tab\[data-view="(.+)"\]/);
        if (navMatch) return navTabs.find((tab) => tab.dataset.view === navMatch[1]) ?? null;
        const subMatch = selector.match(/\.sub-tab\[data-tool="(.+)"\]/);
        if (subMatch) return subTabs.find((tab) => tab.dataset.tool === subMatch[1]) ?? null;
        return null;
      },
    });
  });

  it("routes tool subviews through the tools container instead of leaving the main area blank", async () => {
    const viewsModulePath = "../../../studio/public/js/views.js";
    const { setView } = await import(viewsModulePath);

    setView("write");

    expect(state.currentView).toBe("write");
    expect(elements.get("tools-view")!.classList.contains("active-view")).toBe(true);
    expect(elements.get("tool-export")!.classList.contains("active-view")).toBe(true);
    expect(elements.get("tool-export")!.style.display).toBe("");
    expect(navTabs.find((tab) => tab.dataset.view === "tools")!.classList.contains("active")).toBe(true);
    expect(elements.get("sidebar")!.classList.contains("hidden")).toBe(true);
  });

  it("does not open the sidebar from non-editor views", async () => {
    const viewsModulePath = "../../../studio/public/js/views.js";
    const { toggleSidebar } = await import(viewsModulePath);

    toggleSidebar();

    expect(elements.get("sidebar")!.classList.contains("hidden")).toBe(true);
    expect(state.sidebarCollapsed).toBe(false);
  });

  it("toggles the editor sidebar only while editing", async () => {
    const viewsModulePath = "../../../studio/public/js/views.js";
    const { setView, toggleSidebar } = await import(viewsModulePath);

    setView("editor");
    expect(elements.get("sidebar")!.classList.contains("hidden")).toBe(false);

    toggleSidebar();
    expect(elements.get("sidebar")!.classList.contains("hidden")).toBe(true);
    expect(state.sidebarCollapsed).toBe(true);

    toggleSidebar();
    expect(elements.get("sidebar")!.classList.contains("hidden")).toBe(false);
    expect(state.sidebarCollapsed).toBe(false);
  });
});
