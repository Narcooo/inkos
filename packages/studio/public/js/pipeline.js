// InkOS Studio — Pipeline View (live streaming for create/write)
import { state } from "./state.js";
import { $, escapeHtml, showToast, streamSSE, setStatus } from "./utils.js";
import { setView } from "./views.js";
import { buildSidebarTree } from "./sidebar.js";
import { renderDashboard } from "./dashboard.js";

// ── Stage keyword mapping ──

const STAGE_MAP = [
  { id: "config",     keywords: ["保存书籍配置", "saving book config", "persisting project"] },
  { id: "architect",  keywords: ["基础设定", "foundation", "architect", "生成基础"] },
  { id: "control",    keywords: ["控制文档", "control doc", "初始化控制"] },
  { id: "snapshot",   keywords: ["快照", "snapshot", "初始快照"] },
  { id: "planner",    keywords: ["规划", "planner", "plan", "章节意图"] },
  { id: "composer",   keywords: ["组装", "composer", "compose", "运行时上下文"] },
  { id: "input",      keywords: ["准备章节输入", "prepare"] },
  { id: "writer",     keywords: ["撰写", "写作", "writer", "执笔", "创作正文", "章节草稿"] },
  { id: "settler",    keywords: ["结算", "settler", "观察", "observer", "回写", "真相文件", "提取"] },
  { id: "normalizer", keywords: ["归一化", "normaliz", "字数归一化"] },
  { id: "auditor",    keywords: ["审计", "audit"] },
  { id: "reviser",    keywords: ["修订", "修复", "revis", "spot-fix", "自动修复"] },
  { id: "validator",  keywords: ["校验", "validat", "状态校验"] },
  { id: "memory",     keywords: ["记忆", "memory", "索引", "同步记忆"] },
  { id: "persist",    keywords: ["落盘", "persist", "章节索引", "更新章节"] },
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
  card.innerHTML = `
    <span class="stage-dot"></span>
    <span class="stage-label">${escapeHtml(label)}</span>
    <span class="stage-detail"></span>
    <div class="stage-log"></div>`;
  s.appendChild(card);
}

function activateStage(stageId, detail) {
  stagesEl()?.querySelectorAll(".stage-card.active").forEach((c) => {
    c.className = "stage-card done";
  });
  const card = $(`stage-${stageId}`);
  if (!card) return;
  card.className = "stage-card active";
  const detailEl = card.querySelector(".stage-detail");
  if (detailEl && detail) detailEl.textContent = detail;
}

function appendStageLog(stageId, text) {
  const card = $(`stage-${stageId}`) || stagesEl()?.querySelector(".stage-card.active");
  if (!card) return;
  const log = card.querySelector(".stage-log");
  if (!log) return;
  const line = document.createElement("div");
  line.className = "stage-log-line";
  line.textContent = text.length > 150 ? text.slice(0, 150) + "..." : text;
  log.appendChild(line);
  // Keep only last 8 lines
  while (log.children.length > 8) log.removeChild(log.firstChild);
  log.style.display = "";
}

function appendLive(text) {
  const l = liveEl();
  if (!l) return;
  if (l.style.display === "none") l.style.display = "";
  l.textContent += text;
  l.scrollTop = l.scrollHeight;
}

function finishAllStages() {
  stagesEl()?.querySelectorAll(".stage-card.active").forEach((c) => {
    c.className = "stage-card done";
  });
}

// ── Global pipeline state ──

let pipelineRunning = false;

function setPipelineRunning(running) {
  pipelineRunning = running;
  const btn = $("pipeline-jump");
  if (btn) {
    btn.setAttribute("data-running", running ? "true" : "false");
    btn.title = running ? "正在写作 — 点击查看实况" : "写作状态：空闲";
  }
}

export function isPipelineRunning() {
  return pipelineRunning;
}

// ── Shared progress handler ──

function handleProgress(stage) {
  setStatus(stage);
  if (statusEl()) statusEl().textContent = stage;

  // Warning/detail lines go into the current stage's log
  if (stage.startsWith("⚠") || stage.startsWith("  ")) {
    const activeCard = stagesEl()?.querySelector(".stage-card.active");
    if (activeCard) {
      appendStageLog(activeCard.id?.replace("stage-", ""), stage);
    }
    return;
  }

  // Streaming telemetry updates the current stage detail
  if (stage.startsWith("流式生成中")) {
    const activeCard = stagesEl()?.querySelector(".stage-card.active");
    if (activeCard) {
      const detailEl = activeCard.querySelector(".stage-detail");
      if (detailEl) detailEl.textContent = stage;
    }
    return;
  }

  const id = matchStage(stage);
  if (id) activateStage(id, stage);
}

function handleLog(text) {
  if (statusEl()) statusEl().textContent = text;
  const activeCard = stagesEl()?.querySelector(".stage-card.active");
  if (activeCard) {
    appendStageLog(activeCard.id?.replace("stage-", ""), text);
  }
}

// ── Pipeline runners ──

export function initPipeline() {
  $("pipeline-back")?.addEventListener("click", () => {
    setView("dashboard");
    renderDashboard();
  });

  $("pipeline-jump")?.addEventListener("click", () => {
    if (pipelineRunning) {
      setView("pipeline");
    } else {
      showToast("当前没有运行中的任务", "info");
    }
  });

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

  const f = formEl();
  if (f) f.style.display = "";
}

export async function openCreatePipeline(formData, loadBooks) {
  setView("pipeline");
  const title = formData.title || "新书";
  if (titleEl()) titleEl().textContent = `创建新书: ${title}`;
  clearPipeline();

  const f = formEl();
  if (f) f.style.display = "none";

  addStageCard("config", "保存书籍配置");
  addStageCard("architect", "Architect 生成基础设定");
  addStageCard("control", "初始化控制文档");
  addStageCard("snapshot", "创建初始快照");

  if (formData.writeFirstChapter) {
    addStageCard("input", "准备章节输入");
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
  }

  if (statusEl()) statusEl().textContent = "运行中...";
  setPipelineRunning(true);

  try {
    const res = await streamSSE("/api/book", formData, {
      onProgress: handleProgress,
      onContent: appendLive,
      onLog: handleLog,
    });

    finishAllStages();

    if (res.ok === false) {
      if (statusEl()) statusEl().textContent = "创建失败";
      showToast(res.error || "创建书籍失败", "error");
      return;
    }

    const bookId = res.data?.bookId || title;
    if (statusEl()) statusEl().textContent = `✓ 创建完成: ${bookId}`;
    showToast(`书籍已创建: ${bookId}`);
    if (loadBooks) await loadBooks();
  } catch (err) {
    if (statusEl()) statusEl().textContent = "错误";
    showToast(String(err.message || err), "error");
  } finally {
    setPipelineRunning(false);
  }
}

async function runWritePipeline(bookId, { count = 1, context = "" } = {}) {
  const f = formEl();
  if (f) f.style.display = "none";

  const bookTitle = state.books.find((b) => (b.id || b) === bookId)?.title || bookId;
  if (titleEl()) titleEl().textContent = `写作: ${bookTitle}`;
  clearPipeline();

  addStageCard("input", "准备章节输入");
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
  setPipelineRunning(true);

  const body = { bookId, count };
  if (context) body.context = context;

  try {
    const res = await streamSSE("/api/write-next", body, {
      onProgress: handleProgress,
      onContent: appendLive,
      onLog: handleLog,
    });

    finishAllStages();

    if (res.ok === false) {
      if (statusEl()) statusEl().textContent = "写作失败";
      showToast(res.data?.error || res.error || "写作失败", "error");
      return;
    }

    if (statusEl()) statusEl().textContent = "✓ 写作完成";
    showToast("写作完成");

    if (state.activeBookId) await buildSidebarTree(state.activeBookId);
  } catch (err) {
    if (statusEl()) statusEl().textContent = "错误";
    showToast(String(err.message || err), "error");
  } finally {
    setPipelineRunning(false);
  }
}
