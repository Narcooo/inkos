// InkOS Studio — Entry Module
import { state } from "./state.js";
import { $, escapeHtml, requestJson, autoResizeInput } from "./utils.js";
import { setView, switchToolTab, setEditorTabEnabled, toggleSidebar } from "./views.js";
import { getTheme, getStyle, toggleTheme, toggleStyle, updateThemeIcon, updateStyleLabel } from "./theme.js";
import { buildSidebarTree, renderSidebarForView } from "./sidebar.js";
import { renderChatMessages, sendChatMessage, handleQuickAction, stopChatGeneration } from "./chat.js";
import { showContent, toggleEdit, saveContent, backToChat } from "./content.js";
import { openSettings, closeSettings, saveSettings, runDoctor } from "./settings.js";
import { createBook, writeNext, exportBook } from "./forms.js";
import { renderDashboard } from "./dashboard.js";
import { openEditor, closeEditor, focusEditorForManualEdit, openEditorFile, initEditorTabs } from "./editor.js";
import { initPrediction } from "./prediction.js";
import { initPresets, renderPresetList } from "./presets.js";
import { initLLMLogs, renderLLMLogs } from "./llm-logs.js";
import { initPipeline, openWritePipeline, openCreatePipeline } from "./pipeline.js";
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
  await renderSidebarForView(state.currentView);

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
  const navOutline = $("nav-outline");
  if (navOutline) navOutline.style.display = bookId ? "" : "none";
  renderSidebarForView(state.currentView);
}

// ── Topbar Nav Tab Switching ──

function handleNavTab(viewName) {
  if (viewName === "editor") {
    const fallbackBookId = state.activeBookId || state.books[0]?.id || state.books[0];
    if (!fallbackBookId) return;
    state.activeBookId = fallbackBookId;
    state.chatContext.bookId = fallbackBookId;
    const select = $("book-select");
    if (select) select.value = fallbackBookId;
    openEditor(fallbackBookId);
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
  $("style-toggle").addEventListener("click", toggleStyle);

  // Topbar nav tabs
  document.querySelectorAll(".nav-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      if (tab.classList.contains("disabled")) return;
      handleNavTab(tab.dataset.view);
    });
  });

  // Sidebar nav buttons
  document.querySelectorAll(".sidebar-nav-btn").forEach(tab => {
    tab.addEventListener("click", () => {
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
  const editArticle = $("sidebar-edit-article");
  if (editArticle) editArticle.addEventListener("click", () => focusEditorForManualEdit());
  const navOutline = $("nav-outline");
  if (navOutline) navOutline.addEventListener("click", () => {
    const bookId = state.activeBookId;
    if (!bookId) { showToast("请先选择书籍", "warn"); return; }
    openEditorFile("story-file", bookId, "volume_outline.md");
  });

  // Chat
  $("send-chat").addEventListener("click", sendChatMessage);
  $("stop-chat").addEventListener("click", stopChatGeneration);
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

  // Create form — ink mode uses pipeline view for live streaming
  $("create-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const style = document.documentElement.getAttribute("data-style") || "ink";
    if (style === "ink") {
      const form = $("create-form");
      const fd = new FormData(form);
      openCreatePipeline({
        title: fd.get("title"),
        genre: fd.get("genre"),
        platform: fd.get("platform"),
        targetChapters: Number(fd.get("targetChapters")) || 200,
        chapterWords: Number(fd.get("chapterWords")) || 3000,
        brief: fd.get("brief") || "",
        useProjectBrief: !!form.querySelector('[name="useProjectBrief"]')?.checked,
        writeFirstChapter: !!form.querySelector('[name="writeFirstChapter"]')?.checked,
      }, loadBooks);
    } else {
      createBook(e, loadBooks);
    }
  });
  $("create-back").addEventListener("click", () => setView("dashboard"));

  // Write / export forms
  $("write-form").addEventListener("submit", writeNext);
  $("export-form").addEventListener("submit", exportBook);

  document.addEventListener("inkos:viewchange", async (e) => {
    const viewName = e.detail?.name ?? state.currentView;
    await renderSidebarForView(viewName);
  });

  document.addEventListener("inkos:stylechange", async () => {
    await renderSidebarForView(state.currentView);
  });

  document.addEventListener("inkos:toolchange", async () => {
    await renderSidebarForView("tools");
  });

  document.addEventListener("inkos:open-book", (e) => {
    const bookId = e.detail?.bookId;
    if (!bookId) return;
    state.activeBookId = bookId;
    state.chatContext.bookId = bookId;
    const select = $("book-select");
    if (select) select.value = bookId;
    openEditor(bookId);
  });

  document.addEventListener("inkos:open-editor-file", (e) => {
    const { type, bookId, file } = e.detail ?? {};
    if (!type || !bookId || !file) return;
    openEditorFile(type, bookId, file);
  });

  document.addEventListener("inkos:open-tool", async (e) => {
    const toolName = e.detail?.toolName;
    if (!toolName) return;
    setView("tools");
    switchToolTab(toolName);
    if (toolName === "analytics") renderAnalytics();
    if (toolName === "knowledge") renderKnowledgeList();
    if (toolName === "logs") renderLLMLogs();
  });

  document.addEventListener("inkos:chat-action", (e) => {
    const action = e.detail?.action;
    if (!action) return;
    handleQuickAction(action);
  });
}

// ── Boot ──

async function boot() {
  updateThemeIcon(getTheme());
  updateStyleLabel(getStyle());
  $("theme-toggle").addEventListener("click", toggleTheme);
  bindEvents();
  initEditorTabs();
  initPrediction();
  initPresets();
  initLLMLogs();
  initPipeline();
  initFanqie();
  initKnowledge();
  initUpload();

  // Start with dashboard
  setView("dashboard");
  await refreshAll();
  renderDashboard();
  await renderSidebarForView("dashboard");
}

document.addEventListener("DOMContentLoaded", boot);
