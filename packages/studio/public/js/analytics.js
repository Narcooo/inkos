// InkOS Studio — Book Analytics
import { $, escapeHtml, requestJson } from "./utils.js";
import { state } from "./state.js";

export async function renderAnalytics() {
  const container = $("analytics-content");
  if (!container) return;

  const bookId = state.activeBookId;
  if (!bookId) {
    container.innerHTML = '<div class="sidebar-empty">请先选择书籍</div>';
    return;
  }

  container.innerHTML = '<div class="sidebar-empty">加载中...</div>';

  try {
    const res = await requestJson(`/api/analytics?bookId=${encodeURIComponent(bookId)}`);
    const d = res.data;

    const auditTotal = d.auditStats.approved + d.auditStats.failed + d.auditStats.pending;
    const approvedPct = auditTotal ? Math.round((d.auditStats.approved / auditTotal) * 100) : 0;
    const failedPct = auditTotal ? Math.round((d.auditStats.failed / auditTotal) * 100) : 0;
    const pendingPct = 100 - approvedPct - failedPct;

    const wordStr = d.totalWords >= 10000 ? `${(d.totalWords / 10000).toFixed(1)}万` : d.totalWords;

    // Word count distribution bar chart (CSS flex bars)
    const maxWords = Math.max(...(d.chapterWordCounts ?? []).map(c => c.words), 1);
    const barsHtml = (d.chapterWordCounts ?? []).map(c => {
      const pct = Math.round((c.words / maxWords) * 100);
      return `<div class="analytics-bar-row">
        <span class="analytics-bar-label">${escapeHtml(c.file.replace(".md", ""))}</span>
        <div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${pct}%"></div></div>
        <span class="analytics-bar-value">${c.words}</span>
      </div>`;
    }).join("");

    container.innerHTML = `
      <h3 class="font-serif">${escapeHtml(d.title)}</h3>
      <div class="analytics-stats-row">
        <div class="llm-stat-card">
          <div class="llm-stat-value">${d.totalChapters}</div>
          <div class="llm-stat-label">总章节</div>
        </div>
        <div class="llm-stat-card">
          <div class="llm-stat-value">${wordStr}</div>
          <div class="llm-stat-label">总字数</div>
        </div>
        <div class="llm-stat-card">
          <div class="llm-stat-value">${d.avgWordsPerChapter}</div>
          <div class="llm-stat-label">均章字数</div>
        </div>
      </div>

      <h4>审计状态</h4>
      <div class="llm-model-bar" style="margin-bottom:8px">
        <div class="llm-model-segment" style="width:${approvedPct}%;background:#22c55e"></div>
        <div class="llm-model-segment" style="width:${failedPct}%;background:#ef4444"></div>
        <div class="llm-model-segment" style="width:${pendingPct}%;background:#94a3b8"></div>
      </div>
      <div class="llm-model-legend">
        <span class="llm-legend-item"><span class="llm-legend-dot" style="background:#22c55e"></span>通过 (${d.auditStats.approved})</span>
        <span class="llm-legend-item"><span class="llm-legend-dot" style="background:#ef4444"></span>失败 (${d.auditStats.failed})</span>
        <span class="llm-legend-item"><span class="llm-legend-dot" style="background:#94a3b8"></span>待审 (${d.auditStats.pending})</span>
      </div>

      ${barsHtml ? `<h4 style="margin-top:20px">章节字数分布</h4><div class="analytics-bars">${barsHtml}</div>` : ""}
    `;
  } catch (err) {
    container.innerHTML = `<div class="sidebar-empty">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}
