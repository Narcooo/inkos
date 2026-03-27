// InkOS Studio — Create / Write / Export Forms
import { state } from "./state.js";
import { $, requestJson, runAction, showToast, setStatus, streamSSE } from "./utils.js";
import { setView } from "./views.js";
import { buildSidebarTree } from "./sidebar.js";
import { renderDashboard } from "./dashboard.js";

// ── Progress panel helpers ──

function showProgressPanel(panelId) {
  const panel = $(panelId);
  if (panel) panel.style.display = "";
}

function hideProgressPanel(panelId) {
  const panel = $(panelId);
  if (panel) panel.style.display = "none";
}

function appendProgressLine(logId, text, cls = "") {
  const log = $(logId);
  if (!log) return;
  const line = document.createElement("div");
  line.className = `progress-line ${cls}`.trim();
  line.textContent = text;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function clearProgressPanel(logId) {
  const log = $(logId);
  if (log) log.innerHTML = "";
}

// ── Create Book ──

export async function createBook(e, loadBooks) {
  e.preventDefault();
  const form = $("create-form");
  const fd = new FormData(form);
  const btn = form.querySelector('button[type="submit"]');

  const progressPanel = "create-progress";
  const progressLog = "create-progress-log";

  await runAction("正在创建书籍...", async () => {
    if (btn) btn.disabled = true;
    clearProgressPanel(progressLog);
    showProgressPanel(progressPanel);
    try {
      const body = {
        title: fd.get("title"),
        genre: fd.get("genre"),
        platform: fd.get("platform"),
        targetChapters: Number(fd.get("targetChapters")) || 200,
        chapterWords: Number(fd.get("chapterWords")) || 3000,
        brief: fd.get("brief") || "",
        useProjectBrief: !!form.querySelector('[name="useProjectBrief"]')?.checked,
        writeFirstChapter: !!form.querySelector('[name="writeFirstChapter"]')?.checked,
      };

      const res = await streamSSE("/api/book", body, {
        onProgress(stage) {
          setStatus(stage);
          appendProgressLine(progressLog, stage);
        },
      });

      if (res.ok === false) {
        appendProgressLine(progressLog, res.error || "创建失败", "error");
        throw new Error(res.error || "创建书籍失败");
      }

      const bookId = res.data?.bookId || body.title;
      appendProgressLine(progressLog, `书籍已创建: ${bookId}`, "done");
      showToast(`书籍已创建: ${bookId}`);
      if (loadBooks) await loadBooks();

      // Brief pause so user can see the success line
      await new Promise((r) => setTimeout(r, 800));
      hideProgressPanel(progressPanel);
      setView("dashboard");
      await renderDashboard();
    } catch (err) {
      // Keep progress panel visible on error so user can see what happened
      throw err;
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

// ── Write Next Chapter ──

export async function writeNext(e) {
  e.preventDefault();
  const form = $("write-form");
  const fd = new FormData(form);
  const btn = form.querySelector('button[type="submit"]');

  const progressPanel = "write-progress";
  const stageEl = "write-progress-stage";
  const liveEl = "write-progress-live";

  await runAction("写作中...", async () => {
    if (btn) btn.disabled = true;
    const stageNode = $(stageEl);
    const liveNode = $(liveEl);
    if (stageNode) stageNode.textContent = "准备中...";
    if (liveNode) liveNode.textContent = "";
    showProgressPanel(progressPanel);

    try {
      const body = { bookId: fd.get("bookId"), count: Number(fd.get("count")) || 1 };
      const words = fd.get("words");
      if (words) body.words = Number(words);
      const context = fd.get("context");
      if (context) body.context = context;

      const res = await streamSSE("/api/write-next", body, {
        onProgress(stage) {
          setStatus(stage);
          if (stageNode) stageNode.textContent = stage;
        },
        onContent(text) {
          // Live-stream the chapter content as it's being written
          if (liveNode) {
            liveNode.textContent += text;
            liveNode.scrollTop = liveNode.scrollHeight;
          }
        },
      });

      if (res.ok === false) {
        if (stageNode) stageNode.textContent = "写作失败";
        throw new Error(res.data?.error || res.error || "写作失败");
      }

      if (stageNode) stageNode.textContent = "写作完成";
      showToast("写作完成");

      if (state.activeBookId) await buildSidebarTree(state.activeBookId);

      // Keep the live panel visible for a moment so user can read
      await new Promise((r) => setTimeout(r, 1500));
      hideProgressPanel(progressPanel);
      setView("chat");
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

// ── Export Book ──

export async function exportBook(e) {
  e.preventDefault();
  const form = $("export-form");
  const fd = new FormData(form);

  await runAction("导出中...", async () => {
    const body = {
      bookId: fd.get("bookId"),
      format: fd.get("format"),
      output: fd.get("output") || "",
      approvedOnly: !!form.querySelector('[name="approvedOnly"]')?.checked,
    };
    await requestJson("/api/export", { method: "POST", body: JSON.stringify(body) });
    showToast("导出完成");
  });
}
