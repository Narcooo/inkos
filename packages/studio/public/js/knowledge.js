// InkOS Studio — Knowledge Base (7-Dimension Book Analysis)
import { $, escapeHtml, requestJson, showToast } from "./utils.js";
import { renderMarkdown } from "./markdown.js";

const DIM_LABELS = {
  style: "文风", plot: "情节", character: "人物", worldview: "世界观",
  emotion: "情感", meme: "热梗", structure: "结构",
};

export function initKnowledge() {
  const refreshBtn = $("knowledge-refresh");
  if (refreshBtn) refreshBtn.addEventListener("click", renderKnowledgeList);

  const manualBtn = $("knowledge-manual-analyze");
  if (manualBtn) manualBtn.addEventListener("click", manualAnalyze);
}

export async function renderKnowledgeList() {
  const container = $("knowledge-list");
  if (!container) return;

  container.innerHTML = '<div class="sidebar-empty">加载中...</div>';

  try {
    const res = await requestJson("/api/knowledge");
    const items = res.data ?? [];

    if (!items.length) {
      container.innerHTML = '<div class="sidebar-empty">暂无知识库条目</div>';
      return;
    }

    container.innerHTML = items.map(item => {
      const statusIcon = item.status === "done" ? "&#x2713;" : item.status === "analyzing" ? "&#x23F3;" : "&#x2022;";
      const statusClass = item.status === "done" ? "pass" : item.status === "analyzing" ? "streaming" : "";
      return `
        <div class="knowledge-card" data-id="${escapeHtml(item.id)}">
          <div class="knowledge-card-header">
            <span class="knowledge-card-title">${escapeHtml(item.title)}</span>
            <span class="knowledge-card-status ${statusClass}">${statusIcon}</span>
          </div>
          <div class="knowledge-card-meta">
            ${item.author ? `<span>${escapeHtml(item.author)}</span>` : ""}
            <span>${escapeHtml(item.source ?? "manual")}</span>
          </div>
          <div class="knowledge-card-actions">
            <button class="btn ghost btn-xs" data-action="view">查看</button>
            <button class="btn ghost btn-xs" data-action="delete">删除</button>
          </div>
        </div>`;
    }).join("");

    container.querySelectorAll(".knowledge-card").forEach(card => {
      const id = card.dataset.id;
      card.querySelector("[data-action='view']")?.addEventListener("click", () => renderKnowledgeDetail(id));
      card.querySelector("[data-action='delete']")?.addEventListener("click", async () => {
        try {
          await requestJson(`/api/knowledge/${encodeURIComponent(id)}`, { method: "DELETE" });
          showToast("已删除");
          renderKnowledgeList();
        } catch (err) { showToast("删除失败: " + err.message, "error"); }
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="sidebar-empty">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

async function renderKnowledgeDetail(id) {
  const detail = $("knowledge-detail");
  if (!detail) return;

  detail.innerHTML = '<div class="sidebar-empty">加载中...</div>';

  try {
    const res = await requestJson(`/api/knowledge/${encodeURIComponent(id)}`);
    const item = res.data;

    const dims = item.dimensions ?? {};
    const tabBtns = Object.keys(DIM_LABELS).map((dim, i) =>
      `<button class="knowledge-dim-tab ${i === 0 ? "active" : ""}" data-dim="${dim}">${DIM_LABELS[dim]}</button>`
    ).join("");

    const tabPanels = Object.keys(DIM_LABELS).map((dim, i) =>
      `<div class="knowledge-dim-panel ${i === 0 ? "active" : ""}" data-dim="${dim}">
        ${dims[dim] ? renderMarkdown(dims[dim]) : '<p class="text-muted">暂无分析</p>'}
        <button class="btn accent btn-sm knowledge-apply-btn" data-dim="${dim}" style="margin-top:12px">应用到写作</button>
      </div>`
    ).join("");

    detail.innerHTML = `
      <div class="knowledge-detail-header">
        <h3>${escapeHtml(item.title)}</h3>
        <span class="text-muted">${escapeHtml(item.author ?? "")}</span>
      </div>
      <div class="knowledge-dim-tabs">${tabBtns}</div>
      <div class="knowledge-dim-content">${tabPanels}</div>`;

    detail.querySelectorAll(".knowledge-dim-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        detail.querySelectorAll(".knowledge-dim-tab").forEach(t => t.classList.remove("active"));
        detail.querySelectorAll(".knowledge-dim-panel").forEach(p => p.classList.remove("active"));
        tab.classList.add("active");
        const panel = detail.querySelector(`.knowledge-dim-panel[data-dim="${tab.dataset.dim}"]`);
        if (panel) panel.classList.add("active");
      });
    });

    detail.querySelectorAll(".knowledge-apply-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const res = await requestJson(`/api/knowledge/${encodeURIComponent(id)}/apply`, {
            method: "POST", body: JSON.stringify({ dimension: btn.dataset.dim }),
          });
          // Copy to AI panel input as context
          const aiInput = $("ai-panel-input");
          if (aiInput) {
            aiInput.value = `请参考以下${DIM_LABELS[btn.dataset.dim]}分析来指导写作：\n\n${res.content?.slice(0, 1000) ?? ""}`;
          }
          showToast(`已加载${DIM_LABELS[btn.dataset.dim]}分析到 AI 面板`);
        } catch (err) { showToast("应用失败: " + err.message, "error"); }
      });
    });
  } catch (err) {
    detail.innerHTML = `<div class="sidebar-empty">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

async function manualAnalyze() {
  const title = $("knowledge-manual-title")?.value?.trim();
  const content = $("knowledge-manual-content")?.value?.trim();
  if (!title || !content) { showToast("请输入标题和内容", "warn"); return; }

  try {
    await requestJson("/api/knowledge/analyze", {
      method: "POST",
      body: JSON.stringify({ title, content, source: "manual" }),
    });
    showToast("解剖分析已启动");
    $("knowledge-manual-title").value = "";
    $("knowledge-manual-content").value = "";
    setTimeout(renderKnowledgeList, 1000);
  } catch (err) {
    showToast("启动失败: " + err.message, "error");
  }
}
