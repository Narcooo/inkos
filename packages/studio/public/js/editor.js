// InkOS Studio — Editor (Three-Column Layout)
import { state } from "./state.js";
import { $, escapeHtml, requestJson, fetchSSE, runAction, showToast, autoResizeInput } from "./utils.js";
import { renderMarkdown } from "./markdown.js";
import { setView, setEditorTabEnabled } from "./views.js";
import { STORY_FILES, TRUTH_FILES, ICON } from "./sidebar.js";
import { renderDashboard } from "./dashboard.js";
import { renderPresetList } from "./presets.js";
import { renderAnalytics } from "./analytics.js";

let currentFile = null;
let isPreview = false;
let autoSaveTimer = null;

// ── Enter / Exit Editor ──

export function openEditor(bookId) {
  state.activeBookId = bookId;
  state.chatContext.bookId = bookId;
  setEditorTabEnabled(true);
  setView("editor");

  // Set title
  const book = state.books.find(b => (b.id || b) === bookId);
  $("editor-book-title").textContent = book?.title || bookId;

  // Load trees
  loadChapterTree(bookId);
  loadWorldTree(bookId);
  loadOutlineTree(bookId);

  // Reset editor
  $("editor-textarea").value = "";
  $("editor-preview").style.display = "none";
  $("editor-textarea").style.display = "";
  $("editor-char-count").textContent = "0 字";
  isPreview = false;
  currentFile = null;
}

export function closeEditor() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  setView("dashboard");
  renderDashboard();
}

// ── Left Tabs ──

export function initEditorTabs() {
  // Left sidebar tabs
  document.querySelectorAll(".editor-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".editor-tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".editor-tab-panel").forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      const panel = $("tab-" + tab.dataset.tab);
      if (panel) panel.classList.add("active");
      if (tab.dataset.tab === "presets") renderPresetList();
    });
  });

  // Right AI panel tabs
  document.querySelectorAll(".ai-panel-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".ai-panel-tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".ai-panel").forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      const panel = $("panel-" + tab.dataset.panel);
      if (panel) panel.classList.add("active");
    });
  });

  // Editor mode buttons (topbar)
  document.querySelectorAll(".editor-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".editor-mode-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      // Future: switch between write/outline/settings views within editor
    });
  });

  // Back button
  $("editor-back").addEventListener("click", closeEditor);

  // Analytics button
  $("editor-analytics")?.addEventListener("click", () => {
    setView("analytics");
    renderAnalytics();
  });

  // AI panel toggle
  $("editor-toggle-ai").addEventListener("click", () => {
    $("editor-right").classList.toggle("open");
  });

  // Toolbar commands
  $("editor-toolbar").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cmd]");
    if (!btn) return;
    handleToolbarCmd(btn.dataset.cmd);
  });

  // Editor textarea events
  const textarea = $("editor-textarea");
  textarea.addEventListener("input", () => {
    updateCharCount();
    scheduleAutoSave();
  });

  // AI panel send
  $("ai-panel-send").addEventListener("click", sendEditorChat);
  $("ai-panel-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendEditorChat();
    }
  });

  // Continue writing
  const continueBtn = $("ai-continue-btn");
  if (continueBtn) continueBtn.addEventListener("click", continueWriting);

  // Summary generation
  const summaryBtn = $("ai-gen-summary");
  if (summaryBtn) summaryBtn.addEventListener("click", generateSummary);

  // Revise mode buttons
  document.querySelectorAll(".revise-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".revise-mode-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      triggerRevise(btn.dataset.mode);
    });
  });
}

// ── Chapter Tree ──

async function loadChapterTree(bookId) {
  const tree = $("editor-chapter-tree");
  tree.innerHTML = '<div class="sidebar-empty">加载中...</div>';

  let chapters = [];
  let chapterFiles = [];

  try {
    const [indexRes, filesRes] = await Promise.all([
      requestJson(`/api/chapters?bookId=${encodeURIComponent(bookId)}`).catch(() => null),
      requestJson(`/api/book-files?bookId=${encodeURIComponent(bookId)}`).catch(() => null),
    ]);
    if (indexRes?.ok && indexRes.data) {
      chapters = Array.isArray(indexRes.data) ? indexRes.data : (indexRes.data.chapters ?? []);
    }
    if (filesRes?.ok && Array.isArray(filesRes.files)) {
      chapterFiles = filesRes.files;
    }
  } catch {}

  const chapterMap = new Map();
  for (const ch of chapters) {
    const padded = String(ch.number).padStart(3, "0");
    const possibleFiles = chapterFiles.filter(f => f.startsWith(padded));
    chapterMap.set(possibleFiles[0] || `${padded}.md`, ch);
  }
  for (const f of chapterFiles) {
    if (!chapterMap.has(f)) chapterMap.set(f, null);
  }

  const sorted = [...chapterMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  if (!sorted.length) {
    tree.innerHTML = '<div class="sidebar-empty">暂无章节</div>';
    return;
  }

  tree.innerHTML = sorted.map(([file, meta]) => {
    const label = meta ? `第${meta.number}章: ${meta.title || ""}` : file.replace(/\.md$/, "");
    const badge = meta?.status === "approved" ? '<span class="tree-node-badge pass">&#x2713;</span>'
      : meta?.status === "audit-failed" ? '<span class="tree-node-badge fail">&#x2717;</span>'
      : "";
    return `<button class="tree-node" data-type="chapter" data-file="${escapeHtml(file)}">
      <span class="tree-node-icon">${ICON.chapter}</span>
      <span class="tree-node-label">${escapeHtml(label)}</span>
      ${badge}
    </button>`;
  }).join("");

  tree.querySelectorAll(".tree-node").forEach(node => {
    node.addEventListener("click", () => {
      tree.querySelectorAll(".tree-node").forEach(n => n.classList.remove("active"));
      node.classList.add("active");
      loadFileInEditor("chapter", state.activeBookId, node.dataset.file);
    });
  });
}

// ── World Tree (Story + Truth Files) ──

async function loadWorldTree(bookId) {
  const tree = $("editor-world-tree");
  tree.innerHTML = TRUTH_FILES.map(tf => `
    <button class="tree-node" data-type="story-file" data-file="${escapeHtml(tf.file)}">
      <span class="tree-node-icon">${tf.icon}</span>
      <span class="tree-node-label">${escapeHtml(tf.label)}</span>
    </button>
  `).join("");

  tree.querySelectorAll(".tree-node").forEach(node => {
    node.addEventListener("click", () => {
      tree.querySelectorAll(".tree-node").forEach(n => n.classList.remove("active"));
      node.classList.add("active");
      loadFileInEditor("story-file", bookId, node.dataset.file);
    });
  });
}

// ── Outline Tree (Three Levels) ──

async function loadOutlineTree(bookId) {
  const tree = $("editor-outline-tree");
  const outlineFiles = [
    { file: "story_bible.md", label: "L1 故事圣经", icon: ICON.bible },
    { file: "volume_outline.md", label: "L2 全书大纲", icon: ICON.outline },
    { file: "chapter_summaries.md", label: "L3 章节摘要", icon: ICON.summary },
    { file: "book_rules.md", label: "写作规则", icon: ICON.rules },
  ];

  tree.innerHTML = outlineFiles.map(f => `
    <button class="tree-node" data-type="story-file" data-file="${escapeHtml(f.file)}">
      <span class="tree-node-icon">${f.icon}</span>
      <span class="tree-node-label">${escapeHtml(f.label)}</span>
    </button>
  `).join("");

  tree.querySelectorAll(".tree-node").forEach(node => {
    node.addEventListener("click", () => {
      tree.querySelectorAll(".tree-node").forEach(n => n.classList.remove("active"));
      node.classList.add("active");
      loadFileInEditor("story-file", bookId, node.dataset.file);
    });
  });
}

// ── Load File into Editor ──

async function loadFileInEditor(type, bookId, file) {
  currentFile = { type, bookId, file };
  $("editor-save-status").textContent = "加载中...";

  // Update chat context
  state.chatContext = {
    targetType: type === "chapter" ? "chapter" : (file === "volume_outline.md" ? "outline" : "brief"),
    bookId,
    file,
  };

  await runAction("加载...", async () => {
    let content = "";
    if (type === "chapter") {
      const res = await requestJson(`/api/chapter?bookId=${encodeURIComponent(bookId)}&file=${encodeURIComponent(file)}`);
      content = res.content ?? "";
    } else {
      const res = await requestJson(`/api/story-file?bookId=${encodeURIComponent(bookId)}&file=${encodeURIComponent(file)}`);
      content = res.content ?? "";
    }

    $("editor-textarea").value = content;
    if (isPreview) {
      $("editor-preview").innerHTML = renderMarkdown(content);
    }
    updateCharCount();
    $("editor-save-status").textContent = "";
  });
}

// ── Save ──

function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  $("editor-save-status").textContent = "未保存";
  autoSaveTimer = setTimeout(saveCurrentFile, 3000);
}

async function saveCurrentFile() {
  if (!currentFile) return;
  const content = $("editor-textarea").value;
  $("editor-save-status").textContent = "保存中...";

  try {
    const { type, bookId, file } = currentFile;
    const endpoint = type === "chapter"
      ? `/api/chapter?bookId=${encodeURIComponent(bookId)}&file=${encodeURIComponent(file)}`
      : `/api/story-file?bookId=${encodeURIComponent(bookId)}&file=${encodeURIComponent(file)}`;
    await requestJson(endpoint, { method: "PUT", body: JSON.stringify({ content }) });
    $("editor-save-status").textContent = "已保存";
  } catch (err) {
    $("editor-save-status").textContent = "保存失败";
    showToast("保存失败: " + err.message, "error");
  }
}

// ── Toolbar ──

function handleToolbarCmd(cmd) {
  const ta = $("editor-textarea");

  if (cmd === "detect") {
    detectAIGC();
    return;
  }

  if (cmd === "preview") {
    isPreview = !isPreview;
    if (isPreview) {
      ta.style.display = "none";
      $("editor-preview").style.display = "";
      $("editor-preview").innerHTML = renderMarkdown(ta.value);
    } else {
      ta.style.display = "";
      $("editor-preview").style.display = "none";
      ta.focus();
    }
    return;
  }

  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const selected = ta.value.substring(start, end);
  let insert = "";

  if (cmd === "bold") insert = `**${selected || "粗体"}**`;
  else if (cmd === "italic") insert = `*${selected || "斜体"}*`;
  else if (cmd === "heading") insert = `\n## ${selected || "标题"}\n`;
  else if (cmd === "ul") insert = `\n- ${selected || "列表项"}\n`;
  else if (cmd === "quote") insert = `\n> ${selected || "引用"}\n`;

  if (insert) {
    ta.setRangeText(insert, start, end, "end");
    ta.focus();
    updateCharCount();
    scheduleAutoSave();
  }
}

function updateCharCount() {
  const text = $("editor-textarea").value;
  $("editor-char-count").textContent = `${text.length} 字`;
}

// ── AI Panel Chat ──

async function sendEditorChat() {
  const input = $("ai-panel-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";

  const messagesEl = $("ai-panel-messages");
  messagesEl.innerHTML += `<div class="chat-bubble chat-bubble--user"><div class="chat-bubble-content">${escapeHtml(text)}</div></div>`;
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // Create streaming bubble
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble chat-bubble--ai";
  bubble.innerHTML = '<div class="chat-bubble-content"><span class="stream-cursor"></span></div>';
  messagesEl.appendChild(bubble);
  const contentEl = bubble.querySelector(".chat-bubble-content");

  try {
    const editorContent = $("editor-textarea").value;
    const ctx = state.chatContext;
    const payload = {
      message: text,
      history: [],
      targetType: ctx.targetType || "brief",
      bookId: ctx.bookId || state.activeBookId,
      currentContent: editorContent,
      file: ctx.file || "",
    };

    let accumulated = "";
    const result = await fetchSSE("/api/chat-stream", payload, (token) => {
      accumulated += token;
      contentEl.innerHTML = renderMarkdown(accumulated) + '<span class="stream-cursor"></span>';
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });

    const fullText = result.fullText || accumulated;
    const replyMatch = fullText.match(/=== REPLY ===\s*([\s\S]*?)(?==== [A-Z_]+ ===|$)/);
    const updateMatch = fullText.match(/=== UPDATED_TEXT ===\s*([\s\S]*?)(?==== [A-Z_]+ ===|$)/);
    const reply = replyMatch?.[1]?.trim() || fullText.trim();
    const updatedText = updateMatch?.[1]?.trim() || "";

    contentEl.innerHTML = renderMarkdown(reply);

    if (updatedText) {
      state.pendingChatResult = {
        text: updatedText,
        targetType: ctx.targetType,
        bookId: ctx.bookId,
        file: ctx.file,
      };
    }
  } catch (err) {
    contentEl.innerHTML = `Error: ${escapeHtml(err.message)}`;
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Continue Writing ──

async function continueWriting() {
  const bookId = state.activeBookId;
  if (!bookId) { showToast("请先选择书籍", "warn"); return; }

  const count = Number($("ai-continue-count").value) || 1;
  const context = $("ai-continue-context").value;

  await runAction("续写中...", async () => {
    const body = { bookId, count };
    if (context) body.context = context;
    await requestJson("/api/write-next", { method: "POST", body: JSON.stringify(body) });
    showToast("续写完成");
    loadChapterTree(bookId);
  });
}

// ── Summary ──

async function generateSummary() {
  if (!currentFile) { showToast("请先打开章节", "warn"); return; }
  const content = $("editor-textarea").value;
  if (!content) { showToast("章节内容为空", "warn"); return; }

  const panel = $("panel-ai-summary").querySelector(".ai-panel-body");
  panel.innerHTML = '<p class="text-muted">生成中...</p>';

  try {
    const payload = {
      message: "请为以下内容生成简短摘要",
      history: [],
      targetType: "chapter",
      bookId: currentFile.bookId,
      currentContent: content,
      file: currentFile.file,
    };
    const res = await requestJson("/api/chat-refine", { method: "POST", body: JSON.stringify(payload) });
    panel.innerHTML = renderMarkdown(res.reply || res.content || "无结果");
  } catch (err) {
    panel.innerHTML = `<p class="text-muted">失败: ${escapeHtml(err.message)}</p>`;
  }
}

// ── Revise ──

async function triggerRevise(mode) {
  if (!currentFile) { showToast("请先打开章节", "warn"); return; }

  const resultEl = $("revise-result");
  resultEl.innerHTML = '<p class="text-muted">修订中...</p>';

  try {
    const body = {
      bookId: currentFile.bookId,
      file: currentFile.file,
      mode,
      content: $("editor-textarea").value,
    };
    const res = await requestJson("/api/revise", { method: "POST", body: JSON.stringify(body) });
    const revised = res.content || res.reply || "";
    resultEl.innerHTML = `
      <div class="revise-preview">${renderMarkdown(revised)}</div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn accent btn-sm" id="revise-accept">接受</button>
        <button class="btn ghost btn-sm" id="revise-reject">拒绝</button>
      </div>`;

    $("revise-accept")?.addEventListener("click", () => {
      $("editor-textarea").value = revised;
      updateCharCount();
      scheduleAutoSave();
      resultEl.innerHTML = '<p class="text-muted">已应用</p>';
      showToast("修订已应用");
    });
    $("revise-reject")?.addEventListener("click", () => {
      resultEl.innerHTML = '<p class="text-muted">已拒绝</p>';
    });
  } catch (err) {
    resultEl.innerHTML = `<p class="text-muted">失败: ${escapeHtml(err.message)}</p>`;
  }
}

// ── AIGC Detection ──

async function detectAIGC() {
  const content = $("editor-textarea").value;
  if (!content) { showToast("编辑器内容为空", "warn"); return; }

  const statusEl = $("editor-save-status");
  statusEl.textContent = "检测中...";

  try {
    const res = await requestJson("/api/detect", {
      method: "POST", body: JSON.stringify({ content }),
    });
    const prob = res.aiProbability ?? 50;
    const color = prob > 70 ? "#ef4444" : prob > 40 ? "#f59e0b" : "#22c55e";
    const reasons = (res.reasons ?? []).map(r => `<li>${escapeHtml(r)}</li>`).join("");

    showToast(`AI 概率: ${prob}%`, prob > 70 ? "error" : prob > 40 ? "warn" : "success");

    // Show result in a floating indicator
    let indicator = $("aigc-indicator");
    if (!indicator) {
      indicator = document.createElement("div");
      indicator.id = "aigc-indicator";
      indicator.className = "aigc-indicator";
      $("editor-center").appendChild(indicator);
    }
    indicator.innerHTML = `
      <div class="aigc-score" style="color:${color}">${prob}%</div>
      <div class="aigc-label">AI 概率</div>
      ${reasons ? `<ul class="aigc-reasons">${reasons}</ul>` : ""}
      ${res.suggestion ? `<p class="aigc-suggestion">${escapeHtml(res.suggestion)}</p>` : ""}
      <button class="btn ghost btn-xs aigc-close">&times;</button>
    `;
    indicator.style.display = "block";
    indicator.querySelector(".aigc-close")?.addEventListener("click", () => { indicator.style.display = "none"; });
    statusEl.textContent = "";
  } catch (err) {
    statusEl.textContent = "";
    showToast("检测失败: " + err.message, "error");
  }
}
