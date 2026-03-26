// InkOS Studio — Entry Module
import { state } from "./state.js";
import { $, escapeHtml, requestJson, autoResizeInput } from "./utils.js";
import { setView, switchToolTab, setEditorTabEnabled, toggleSidebar } from "./views.js";
import { getTheme, toggleTheme, updateThemeIcon } from "./theme.js";
import { buildSidebarTree } from "./sidebar.js";
import { renderChatMessages, sendChatMessage, handleQuickAction } from "./chat.js";
import { showContent, toggleEdit, saveContent, backToChat } from "./content.js";
import { openSettings, closeSettings, saveSettings, runDoctor } from "./settings.js";
import { createBook, writeNext, exportBook } from "./forms.js";
import { renderDashboard } from "./dashboard.js";
import { openEditor, closeEditor, initEditorTabs } from "./editor.js";
import { initPrediction } from "./prediction.js";
import { initPresets, renderPresetList } from "./presets.js";
import { initLLMLogs, renderLLMLogs } from "./llm-logs.js";
import { initFanqie } from "./fanqie.js";
import { initKnowledge, renderKnowledgeList } from "./knowledge.js";
import { renderAnalytics } from "./analytics.js";
import { initUpload } from "./upload.js";

// ── Data Loading ──

async function loadMeta() {
  try { state.meta = await requestJson("/api/meta"); } catch {}
}

async function loadBooks() {
  try {
    const res = await requestJson("/api/books");
    if (res.ok && res.data) {
      state.books = Array.isArray(res.data) ? res.data : (res.data.books ?? []);
    } else {
      const raw = res.raw?.stdout ?? "";
      if (raw.trim()) {
        try {
          const parsed = JSON.parse(raw);
          state.books = Array.isArray(parsed) ? parsed : (parsed.books ?? []);
        } catch { state.books = []; }
      } else {
        state.books = [];
      }
    }
  } catch { state.books = []; }
  populateBookSelect();

  // Enable editor tab if a book is selected
  setEditorTabEnabled(!!state.activeBookId);
}

async function refreshAll() {
  await loadMeta();
  await loadBooks();
  if (state.activeBookId) {
    await buildSidebarTree(state.activeBookId);
  }
}

// ── Book Select ──

function populateBookSelect() {
  const sel = $("book-select");
  const current = state.activeBookId;
  sel.innerHTML = '<option value="">-- 选择书籍 --</option>' +
    state.books.map(b => {
      const label = b.title || b.id || b;
      const id = b.id || b;
      return `<option value="${escapeHtml(id)}" ${id === current ? "selected" : ""}>${escapeHtml(label)}</option>`;
    }).join("");

  for (const selId of ["write-book", "export-book"]) {
    const s = $(selId);
    if (!s) continue;
    s.innerHTML = state.books.map(b => {
      const id = b.id || b;
      const label = b.title || id;
      return `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`;
    }).join("");
  }
}

function onBookChange() {
  const bookId = $("book-select").value;
  state.activeBookId = bookId;
  state.chatContext.bookId = bookId;
  setEditorTabEnabled(!!bookId);
  if (bookId) {
    buildSidebarTree(bookId);
  } else {
    $("sidebar-tree").innerHTML = '<div class="sidebar-empty">选择书籍后显示导航</div>';
  }
}

// ── Topbar Nav Tab Switching ──

function handleNavTab(viewName) {
  if (viewName === "editor") {
    if (!state.activeBookId) return; // disabled state
    openEditor(state.activeBookId);
    return;
  }
  if (viewName === "tools") {
    setView("tools");
    return;
  }
  if (viewName === "dashboard") {
    setView("dashboard");
    renderDashboard();
    return;
  }
  setView(viewName);
}

// ── Event Binding ──

function bindEvents() {
  // Topbar
  $("sidebar-toggle").addEventListener("click", toggleSidebar);
  $("book-select").addEventListener("change", onBookChange);
  $("settings-btn").addEventListener("click", openSettings);

  // Topbar nav tabs
  document.querySelectorAll(".nav-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      if (tab.classList.contains("disabled")) return;
      handleNavTab(tab.dataset.view);
    });
  });

  // Tools sub-tabs
  document.querySelectorAll(".sub-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const toolName = tab.dataset.tool;
      switchToolTab(toolName);
      // Trigger data loading for specific tools
      if (toolName === "analytics") renderAnalytics();
      if (toolName === "knowledge") renderKnowledgeList();
      if (toolName === "logs") renderLLMLogs();
    });
  });

  // Settings modal
  $("settings-close").addEventListener("click", closeSettings);
  $("settings-modal").addEventListener("click", (e) => {
    if (e.target === $("settings-modal")) closeSettings();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("settings-modal").style.display !== "none") closeSettings();
  });
  $("save-settings").addEventListener("click", () => saveSettings(loadMeta));
  $("run-doctor").addEventListener("click", runDoctor);

  // Sidebar footer (create button)
  const navCreate = $("nav-create");
  if (navCreate) navCreate.addEventListener("click", () => setView("create"));

  // Chat
  $("send-chat").addEventListener("click", sendChatMessage);
  $("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
  $("chat-input").addEventListener("input", function () { autoResizeInput(this); });

  // Chat chips
  $("chat-chips").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-action]");
    if (chip) handleQuickAction(chip.dataset.action);
  });

  // Content view
  $("back-to-chat").addEventListener("click", backToChat);
  $("toggle-edit").addEventListener("click", toggleEdit);
  $("save-content").addEventListener("click", saveContent);

  // Create form
  $("create-form").addEventListener("submit", (e) => createBook(e, loadBooks));
  $("create-back").addEventListener("click", () => setView("dashboard"));

  // Write / export forms
  $("write-form").addEventListener("submit", writeNext);
  $("export-form").addEventListener("submit", exportBook);
}

// ── Boot ──

async function boot() {
  updateThemeIcon(getTheme());
  $("theme-toggle").addEventListener("click", toggleTheme);
  bindEvents();
  initEditorTabs();
  initPrediction();
  initPresets();
  initLLMLogs();
  initFanqie();
  initKnowledge();
  initUpload();

  // Start with dashboard
  setView("dashboard");
  await refreshAll();
  renderDashboard();
}

document.addEventListener("DOMContentLoaded", boot);
