// InkOS Studio — Fanqie Novel Integration
import { $, escapeHtml, requestJson, showToast } from "./utils.js";

export function initFanqie() {
  const searchBtn = $("fanqie-search-btn");
  if (searchBtn) searchBtn.addEventListener("click", searchFanqie);

  const searchInput = $("fanqie-search-input");
  if (searchInput) searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchFanqie();
  });
}

async function searchFanqie() {
  const input = $("fanqie-search-input");
  const query = input?.value?.trim();
  if (!query) return;

  const results = $("fanqie-results");
  results.innerHTML = '<div class="sidebar-empty">搜索中...</div>';

  try {
    const res = await requestJson(`/api/fanqie/search?query=${encodeURIComponent(query)}`);
    const novels = res.data ?? res.novels ?? res ?? [];
    const list = Array.isArray(novels) ? novels : [];

    if (!list.length) {
      results.innerHTML = '<div class="sidebar-empty">未找到结果</div>';
      return;
    }

    results.innerHTML = list.map(novel => `
      <div class="fanqie-card" data-id="${escapeHtml(novel.id ?? novel.book_id ?? "")}">
        <div class="fanqie-card-title">${escapeHtml(novel.title ?? novel.book_name ?? "")}</div>
        <div class="fanqie-card-meta">
          <span>${escapeHtml(novel.author ?? "")}</span>
          <span>${escapeHtml(novel.word_count ?? novel.wordCount ?? "")}</span>
        </div>
        <div class="fanqie-card-desc">${escapeHtml((novel.description ?? novel.abstract ?? "").slice(0, 100))}</div>
        <div class="fanqie-card-actions">
          <button class="btn accent btn-sm fanqie-download" type="button">下载</button>
          <button class="btn ghost btn-sm fanqie-analyze" type="button">解剖分析</button>
        </div>
      </div>
    `).join("");

    results.querySelectorAll(".fanqie-card").forEach(card => {
      const id = card.dataset.id;
      const title = card.querySelector(".fanqie-card-title")?.textContent ?? "";

      card.querySelector(".fanqie-download")?.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await requestJson("/api/fanqie/download", {
            method: "POST",
            body: JSON.stringify({ book_id: id }),
          });
          showToast("下载任务已提交");
        } catch (err) {
          showToast("下载失败: " + err.message, "error");
        }
      });

      card.querySelector(".fanqie-analyze")?.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          // Fetch chapters to get content for analysis
          const chapRes = await requestJson(`/api/fanqie/chapters/${encodeURIComponent(id)}`);
          const chapters = chapRes.data ?? chapRes.chapters ?? [];
          const sampleContent = chapters.slice(0, 5).map(c => c.content ?? c.text ?? "").join("\n\n");

          if (!sampleContent) {
            showToast("无法获取内容进行分析", "warn");
            return;
          }

          await requestJson("/api/knowledge/analyze", {
            method: "POST",
            body: JSON.stringify({ title, content: sampleContent, source: "fanqie", author: "" }),
          });
          showToast("解剖分析已启动，请在知识库中查看");
        } catch (err) {
          showToast("分析启动失败: " + err.message, "error");
        }
      });
    });
  } catch (err) {
    results.innerHTML = `<div class="sidebar-empty">搜索失败: ${escapeHtml(err.message)}</div>`;
  }
}
