// InkOS Studio — Pipeline View (live streaming for create/write)
import { state } from "./state.js";
import { $, escapeHtml, showToast, streamSSE, setStatus } from "./utils.js";
import { setView } from "./views.js";
import { buildSidebarTree, renderSidebarForView } from "./sidebar.js";
import { renderDashboard } from "./dashboard.js";

// ── Stage keyword mapping ──

const STAGE_MAP = [
  { id: "config",     keywords: ["保存书籍配置", "saving book config", "persisting project"] },
  { id: "architect",  keywords: ["基础设定", "foundation", "architect", "生成基础"] },
  { id: "control",    keywords: ["控制文档", "control doc"] },
  { id: "snapshot",   keywords: ["快照", "snapshot"] },
  { id: "planner",    keywords: ["规划", "planner", "plan"] },
  { id: "composer",   keywords: ["组装", "composer", "compose", "context"] },
  { id: "writer",     keywords: ["撰写", "写作", "writer", "执笔", "创作正文"] },
  { id: "settler",    keywords: ["结算", "settler", "观察", "observer", "回写", "真相文件"] },
  { id: "normalizer", keywords: ["归一化", "normaliz", "字数"] },
  { id: "auditor",    keywords: ["审计", "audit"] },
  { id: "reviser",    keywords: ["修订", "修复", "revis", "spot-fix", "自动修复"] },
  { id: "validator",  keywords: ["校验", "validat"] },
  { id: "memory",     keywords: ["记忆", "memory", "索引"] },
  { id: "persist",    keywords: ["落盘", "persist", "章节索引"] },
];

function matchStage(text) {
  const lower = text.toLowerCase();
  for (const s of STAGE_MAP) {
    if (s.keywords.some((k) => lower.includes(k.toLowerCase()))) return s.id;
  }
  return null;
}

// ── DOM helpers ──

const stagesEl = () => $("pipeline-stages");
const liveEl = () => $("pipeline-live");
const titleEl = () => $("pipeline-title");
const statusEl = () => $("pipeline-status");
const formEl = () => $("pipeline-form");

function clearPipeline() {
  const s = stagesEl();
  const l = liveEl();
  if (s) s.innerHTML = "";
  if (l) { l.innerHTML = ""; l.style.display = "none"; }
  if (statusEl()) statusEl().textContent = "";
}

function addStageCard(id, label) {
  const s = stagesEl();
  if (!s) return;
  const card = document.createElement("div");
  card.className = "stage-card pending";
  card.id = `stage-${id}`;
  card.innerHTML = `<span class="stage-dot"></span><span class="stage-label">${escapeHtml(label)}</span><span class="stage-detail"></span>`;
  s.appendChild(card);
}

function updateStage(id, status, detail) {
  const card = $(`stage-${id}`);
  if (!card) return;
  card.className = `stage-card ${status}`;
  const detailEl = card.querySelector(".stage-detail");
  if (detailEl && detail) detailEl.textContent = detail;
}

function activateStage(stageId, detail) {
  // Set all "active" cards back to "done"
  stagesEl()?.querySelectorAll(".stage-card.active").forEach((c) => {
    c.className = "stage-card done";
  });
  updateStage(stageId, "active", detail || "");
}

function appendLive(text) {
  const l = liveEl();
  if (!l) return;
  if (l.style.display === "none") l.style.display = "";
  l.textContent += text;
  l.scrollTop = l.scrollHeight;
}

// ── Pipeline runners ──

export function initPipeline() {
  // Back button
  $("pipeline-back")?.addEventListener("click", () => {
    setView("dashboard");
    renderDashboard();
  });

  // Start write button
  $("pipeline-start")?.addEventListener("click", () => {
    const bookId = $("pipeline-book")?.value;
    if (!bookId) { showToast("请先选择书籍", "error"); return; }
    const count = Number($("pipeline-count")?.value) || 1;
    const context = $("pipeline-context")?.value?.trim() || "";
    runWritePipeline(bookId, { count, context });
  });
}

export function openWritePipeline(bookId) {
  setView("pipeline");
  if (titleEl()) titleEl().textContent = "写作实况";
  clearPipeline();

  // Populate book selector
  const select = $("pipeline-book");
  if (select) {
    select.innerHTML = state.books
      .map((b) => {
        const id = b.id || b;
        const title = b.title || id;
        return `<option value="${escapeHtml(id)}"${id === bookId ? " selected" : ""}>${escapeHtml(title)}</option>`;
      })
      .join("");
  }

  // Show form
  const f = formEl();
  if (f) f.style.display = "";
}

export async function openCreatePipeline(formData, loadBooks) {
  setView("pipeline");
  const title = formData.title || "新书";
  if (titleEl()) titleEl().textContent = `创建: ${title}`;
  clearPipeline();

  // Hide write form
  const f = formEl();
  if (f) f.style.display = "none";

  // Add stage cards
  addStageCard("config", "保存书籍配置");
  addStageCard("architect", "Architect 生成基础设定");
  addStageCard("control", "初始化控制文档");
  addStageCard("snapshot", "创建初始快照");

  if (formData.writeFirstChapter) {
    addStageCard("planner", "Planner 规划章节意图");
    addStageCard("writer", "Writer 执笔创作");
    addStageCard("settler", "Settler 状态结算");
    addStageCard("auditor", "Auditor 审计");
    addStageCard("persist", "落盘章节");
  }

  if (statusEl()) statusEl().textContent = "运行中...";

  try {
    const res = await streamSSE("/api/book", formData, {
      onProgress(stage) {
        setStatus(stage);
        if (statusEl()) statusEl().textContent = stage;
        const id = matchStage(stage);
        if (id) activateStage(id, stage);
      },
      onContent(text) {
        appendLive(text);
      },
    });

    // Mark all remaining active as done
    stagesEl()?.querySelectorAll(".stage-card.active").forEach((c) => {
      c.className = "stage-card done";
    });

    if (res.ok === false) {
      if (statusEl()) statusEl().textContent = "创建失败";
      showToast(res.error || "创建书籍失败", "error");
      return;
    }

    const bookId = res.data?.bookId || title;
    if (statusEl()) statusEl().textContent = "创建完成";
    showToast(`书籍已创建: ${bookId}`);
    if (loadBooks) await loadBooks();
  } catch (err) {
    if (statusEl()) statusEl().textContent = "错误";
    showToast(String(err.message || err), "error");
  }
}

async function runWritePipeline(bookId, { count = 1, context = "" } = {}) {
  // Hide form, show stages
  const f = formEl();
  if (f) f.style.display = "none";

  if (titleEl()) titleEl().textContent = `写作: ${state.books.find((b) => (b.id || b) === bookId)?.title || bookId}`;
  clearPipeline();

  addStageCard("planner", "Planner 规划章节意图");
  addStageCard("composer", "Composer 组装上下文");
  addStageCard("writer", "Writer 执笔创作");
  addStageCard("settler", "Settler 状态结算");
  addStageCard("normalizer", "Normalizer 字数归一化");
  addStageCard("auditor", "Auditor 审计");
  addStageCard("reviser", "Reviser 修订");
  addStageCard("validator", "Validator 校验真相文件");
  addStageCard("memory", "同步记忆索引");
  addStageCard("persist", "落盘章节");

  if (statusEl()) statusEl().textContent = "运行中...";

  const body = { bookId, count };
  if (context) body.context = context;

  try {
    const res = await streamSSE("/api/write-next", body, {
      onProgress(stage) {
        setStatus(stage);
        if (statusEl()) statusEl().textContent = stage;
        const id = matchStage(stage);
        if (id) activateStage(id, stage);
      },
      onContent(text) {
        appendLive(text);
      },
      onLog(text) {
        // Show raw log lines as stage detail
        if (statusEl()) statusEl().textContent = text;
      },
    });

    stagesEl()?.querySelectorAll(".stage-card.active").forEach((c) => {
      c.className = "stage-card done";
    });

    if (res.ok === false) {
      if (statusEl()) statusEl().textContent = "写作失败";
      showToast(res.data?.error || res.error || "写作失败", "error");
      return;
    }

    if (statusEl()) statusEl().textContent = "写作完成";
    showToast("写作完成");

    if (state.activeBookId) await buildSidebarTree(state.activeBookId);
  } catch (err) {
    if (statusEl()) statusEl().textContent = "错误";
    showToast(String(err.message || err), "error");
  }
}
