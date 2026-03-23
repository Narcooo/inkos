// InkOS Studio — LLM Call Logs & Stats
import { $, escapeHtml, requestJson } from "./utils.js";

export function initLLMLogs() {
  const refreshBtn = $("llm-logs-refresh");
  if (refreshBtn) refreshBtn.addEventListener("click", () => renderLLMLogs());

  const dateInput = $("llm-logs-date");
  if (dateInput) {
    dateInput.value = new Date().toISOString().slice(0, 10);
    dateInput.addEventListener("change", () => renderLLMLogs());
  }
}

export async function renderLLMLogs() {
  const container = $("llm-logs-content");
  if (!container) return;

  const date = $("llm-logs-date")?.value || new Date().toISOString().slice(0, 10);

  // Fetch logs and stats in parallel
  const [logsRes, statsRes] = await Promise.all([
    requestJson(`/api/llm-logs?date=${encodeURIComponent(date)}`).catch(() => ({ data: [] })),
    requestJson("/api/llm-stats").catch(() => ({ data: {} })),
  ]);

  const logs = logsRes.data ?? [];
  const stats = statsRes.data ?? {};

  // Stats cards
  const statsHtml = `
    <div class="llm-stats-row">
      <div class="llm-stat-card">
        <div class="llm-stat-value">${stats.totalCalls ?? 0}</div>
        <div class="llm-stat-label">总调用</div>
      </div>
      <div class="llm-stat-card">
        <div class="llm-stat-value">${formatTokenCount(stats.totalTokens ?? 0)}</div>
        <div class="llm-stat-label">总 Token</div>
      </div>
      <div class="llm-stat-card">
        <div class="llm-stat-value">${stats.avgDurationMs ?? 0}ms</div>
        <div class="llm-stat-label">平均耗时</div>
      </div>
    </div>`;

  // Model distribution bar
  const byModel = stats.byModel ?? {};
  const totalByModel = Object.values(byModel).reduce((a, b) => a + b, 0) || 1;
  const MODEL_COLORS = ["#7c3aed", "#0e7490", "#c2410c", "#1d4ed8", "#15803d", "#b91c1c"];
  const modelBar = Object.entries(byModel).length ? `
    <div class="llm-model-bar">
      ${Object.entries(byModel).map(([model, count], i) => {
        const pct = Math.round((count / totalByModel) * 100);
        const color = MODEL_COLORS[i % MODEL_COLORS.length];
        return `<div class="llm-model-segment" style="width:${pct}%;background:${color}" title="${escapeHtml(model)}: ${count}"></div>`;
      }).join("")}
    </div>
    <div class="llm-model-legend">
      ${Object.entries(byModel).map(([model, count], i) => {
        const color = MODEL_COLORS[i % MODEL_COLORS.length];
        return `<span class="llm-legend-item"><span class="llm-legend-dot" style="background:${color}"></span>${escapeHtml(model)} (${count})</span>`;
      }).join("")}
    </div>` : "";

  // Logs table
  const tableHtml = logs.length ? `
    <table class="llm-logs-table">
      <thead>
        <tr>
          <th>时间</th><th>模型</th><th>类型</th><th>输入</th><th>输出</th><th>耗时</th><th>状态</th>
        </tr>
      </thead>
      <tbody>
        ${logs.reverse().map(l => `
          <tr class="${l.status === "error" ? "log-error" : ""}">
            <td>${escapeHtml((l.timestamp ?? "").slice(11, 19))}</td>
            <td>${escapeHtml(l.model ?? "")}</td>
            <td>${escapeHtml(l.type ?? "")}</td>
            <td>${l.inputTokens ?? 0}</td>
            <td>${l.outputTokens ?? 0}</td>
            <td>${l.durationMs ?? 0}ms</td>
            <td>${l.status === "success" ? "&#x2713;" : "&#x2717;"}</td>
          </tr>`).join("")}
      </tbody>
    </table>` : '<div class="sidebar-empty">当日暂无调用记录</div>';

  container.innerHTML = statsHtml + modelBar + tableHtml;
}

function formatTokenCount(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
