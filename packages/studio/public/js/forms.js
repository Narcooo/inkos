// InkOS Studio — Create / Write / Export Forms
import { state } from "./state.js";
import { $, requestJson, runAction, showToast } from "./utils.js";
import { setView } from "./views.js";
import { buildSidebarTree } from "./sidebar.js";
import { renderDashboard } from "./dashboard.js";

export async function createBook(e, loadBooks) {
  e.preventDefault();
  const form = $("create-form");
  const fd = new FormData(form);

  await runAction("创建书籍中...", async () => {
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

    const res = await requestJson("/api/book", { method: "POST", body: JSON.stringify(body) });
    const bookId = res.data?.bookId || body.title;
    showToast(`书籍已创建: ${bookId}`);
    if (loadBooks) await loadBooks();
    setView("dashboard");
    await renderDashboard();
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
