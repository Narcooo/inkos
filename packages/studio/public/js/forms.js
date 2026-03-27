// InkOS Studio — Create / Write / Export Forms
import { state } from "./state.js";
import { $, requestJson, runAction, showToast, setStatus } from "./utils.js";
import { setView } from "./views.js";
import { buildSidebarTree } from "./sidebar.js";
import { renderDashboard } from "./dashboard.js";

/**
 * Stream book creation via SSE. Shows real-time progress from Architect.
 */
function createBookSSE(body) {
  return new Promise((resolve, reject) => {
    fetch("/api/book", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
    }).then((res) => {
      if (!res.ok) {
        return res.json().catch(() => ({})).then((err) => {
          reject(new Error(err.error || `请求失败: ${res.status}`));
        });
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result = null;
      let currentEvent = "";

      function pump() {
        reader.read().then(({ done, value }) => {
          if (done) {
            resolve(result || { ok: false, error: "连接中断，未收到结果" });
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\n/);
          buffer = lines.pop();

          for (const rawLine of lines) {
            const line = rawLine.replace(/\r$/, "");
            if (!line) {
              currentEvent = "";
              continue;
            }
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (currentEvent === "progress" && data.stage) {
                  setStatus(data.stage);
                } else if (currentEvent === "done") {
                  result = data;
                }
              } catch {}
              currentEvent = "";
            }
          }

          pump();
        }).catch(reject);
      }

      pump();
    }).catch(reject);
  });
}

export async function createBook(e, loadBooks) {
  e.preventDefault();
  const form = $("create-form");
  const fd = new FormData(form);
  const btn = form.querySelector('button[type="submit"]');

  await runAction("正在创建书籍...", async () => {
    if (btn) btn.disabled = true;
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

      const res = await createBookSSE(body);
      if (res.ok === false) {
        throw new Error(res.error || "创建书籍失败");
      }
      const bookId = res.data?.bookId || body.title;
      showToast(`书籍已创建: ${bookId}`);
      if (loadBooks) await loadBooks();
      setView("dashboard");
      await renderDashboard();
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

export async function writeNext(e) {
  e.preventDefault();
  const form = $("write-form");
  const fd = new FormData(form);

  await runAction("写作中...", async () => {
    const body = { bookId: fd.get("bookId"), count: Number(fd.get("count")) || 1 };
    const words = fd.get("words");
    if (words) body.words = Number(words);
    const context = fd.get("context");
    if (context) body.context = context;

    await requestJson("/api/write-next", { method: "POST", body: JSON.stringify(body) });
    showToast("写作完成");

    if (state.activeBookId) await buildSidebarTree(state.activeBookId);
    setView("chat");
  });
}

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
