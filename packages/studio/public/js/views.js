// InkOS Studio — View Switching
import { state } from "./state.js";
import { $ } from "./utils.js";

// Views that don't have their own nav tab (sub-views)
const SUB_VIEWS = new Set(["content", "create"]);
const TOOL_VIEW_MAP = new Map([
  ["import", "import"],
  ["upload", "import"],
  ["export", "export"],
  ["write", "export"],
  ["analytics", "analytics"],
  ["knowledge", "knowledge"],
  ["logs", "logs"],
]);

export function setView(name) {
  state.currentView = name;
  const main = $("main-area");
  const toolView = TOOL_VIEW_MAP.get(name);

  // Hide all top-level view sections
  main.querySelectorAll(":scope > section").forEach(s => s.classList.remove("active-view"));

  // Tool subviews live inside the tools container.
  if (name === "tools" || toolView) {
    activateToolsView(toolView);
  } else {
    const target = $(name + "-view");
    if (target) target.classList.add("active-view");
  }

  // Update topbar nav tab highlighting
  updateNavTabs(name);

  // Show/hide sidebar based on view
  updateSidebarVisibility(name);
}

function updateNavTabs(viewName) {
  const tabs = document.querySelectorAll(".nav-tab");
  tabs.forEach(tab => tab.classList.remove("active"));

  if (SUB_VIEWS.has(viewName)) {
    // Sub-views don't change active tab — keep current
    return;
  }

  const navView = TOOL_VIEW_MAP.has(viewName) ? "tools" : viewName;
  const activeTab = document.querySelector(`.nav-tab[data-view="${navView}"]`);
  if (activeTab) activeTab.classList.add("active");
}

function updateSidebarVisibility(viewName) {
  const sidebar = $("sidebar");
  if (!sidebar) return;

  if (viewName === "editor" && !state.sidebarCollapsed) {
    sidebar.classList.remove("hidden");
  } else {
    sidebar.classList.add("hidden");
  }
}

function activateToolsView(toolName) {
  const toolsView = $("tools-view");
  if (toolsView) toolsView.classList.add("active-view");
  if (toolName) switchToolTab(toolName);
}

// Tools sub-tab switching
export function switchToolTab(toolName) {
  // Update sub-tab buttons
  document.querySelectorAll(".sub-tab").forEach(t => t.classList.remove("active"));
  const activeSubTab = document.querySelector(`.sub-tab[data-tool="${toolName}"]`);
  if (activeSubTab) activeSubTab.classList.add("active");

  // Show/hide tool panels
  document.querySelectorAll(".tool-panel").forEach(p => {
    p.style.display = "none";
    p.classList.remove("active-view");
  });
  const panel = $("tool-" + toolName);
  if (panel) {
    panel.style.display = "";
    panel.classList.add("active-view");
  }
}

export function toggleSidebar() {
  const sidebar = $("sidebar");
  if (!sidebar) return;
  if (state.currentView !== "editor") return;

  state.sidebarCollapsed = !state.sidebarCollapsed;
  if (state.sidebarCollapsed) {
    sidebar.classList.add("hidden");
  } else {
    sidebar.classList.remove("hidden");
  }
}

// Enable/disable editor nav tab
export function setEditorTabEnabled(enabled) {
  const tab = $("nav-editor");
  if (!tab) return;
  if (enabled) {
    tab.classList.remove("disabled");
  } else {
    tab.classList.add("disabled");
  }
}
