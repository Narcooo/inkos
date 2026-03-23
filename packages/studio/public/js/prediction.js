// InkOS Studio — Multi-Model Parallel Prediction (抽卡)
import { state } from "./state.js";
import { $, escapeHtml, fetchSSE, showToast } from "./utils.js";
import { renderMarkdown } from "./markdown.js";

let predictionResults = [];

export function initPrediction() {
  const btn = $("prediction-generate");
  if (btn) btn.addEventListener("click", startPrediction);

  const addBtn = $("prediction-add-model");
  if (addBtn) addBtn.addEventListener("click", addModelInput);
}

function getModelInputs() {
  const container = $("prediction-models");
  if (!container) return [];
  return [...container.querySelectorAll(".prediction-model-input")].map(el => el.value.trim()).filter(Boolean);
}

function addModelInput() {
  const container = $("prediction-models");
  if (!container) return;
  const row = document.createElement("div");
  row.className = "prediction-model-row";
  row.innerHTML = `
    <input type="text" class="prediction-model-input" placeholder="模型名称 (如 gpt-4o)">
    <button type="button" class="btn ghost btn-sm prediction-remove-model">&times;</button>
  `;
  row.querySelector(".prediction-remove-model").addEventListener("click", () => row.remove());
  container.appendChild(row);
}

async function startPrediction() {
  const models = getModelInputs();
  if (!models.length) { showToast("请添加至少一个模型", "warn"); return; }

  const promptEl = $("prediction-prompt");
  const prompt = promptEl?.value?.trim();
  if (!prompt) { showToast("请输入生成提示词", "warn"); return; }

  const systemPrompt = $("prediction-system")?.value?.trim() || "你是一个高水平的中文小说作家。";

  // Initialize results
  predictionResults = models.map((model, idx) => ({
    idx, model, status: "pending", text: "", error: "",
  }));
  renderPredictionList();
  renderPredictionDetail(-1);

  // Start SSE
  const body = { prompt, models, systemPrompt, maxTokens: 4096 };
  try {
    const res = await fetch("/api/predict-parallel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          handlePredictionEvent(data);
        } catch {}
      }
    }
  } catch (err) {
    showToast("并行生成失败: " + err.message, "error");
  }
}

function handlePredictionEvent(data) {
  const r = predictionResults[data.idx];
  if (!r && data.type !== "all-done") return;

  switch (data.type) {
    case "start":
      r.status = "streaming";
      renderPredictionList();
      break;
    case "token":
      r.text += data.token;
      r.status = "streaming";
      // Update detail if this model is selected
      updatePredictionDetailIfActive(data.idx);
      renderPredictionList();
      break;
    case "done":
      r.text = data.fullText || r.text;
      r.status = "done";
      renderPredictionList();
      updatePredictionDetailIfActive(data.idx);
      break;
    case "error":
      r.error = data.error;
      r.text = data.partial || r.text;
      r.status = "error";
      renderPredictionList();
      updatePredictionDetailIfActive(data.idx);
      break;
    case "all-done":
      showToast("所有模型生成完成");
      break;
  }
}

function renderPredictionList() {
  const list = $("prediction-list");
  if (!list) return;

  list.innerHTML = predictionResults.map((r, idx) => {
    const statusIcon = r.status === "done" ? "&#x2713;"
      : r.status === "error" ? "&#x2717;"
      : r.status === "streaming" ? "&#x23F3;"
      : "&#x2022;";
    const statusClass = r.status === "done" ? "pass"
      : r.status === "error" ? "fail"
      : r.status === "streaming" ? "streaming"
      : "";
    const charCount = r.text.length;
    const preview = r.text.slice(0, 80).replace(/\n/g, " ") || "(等待中...)";

    return `
      <div class="prediction-card ${r.status === "streaming" ? "is-streaming" : ""}" data-idx="${idx}">
        <div class="prediction-card-header">
          <span class="prediction-card-model">${escapeHtml(r.model)}</span>
          <span class="prediction-card-status ${statusClass}">${statusIcon}</span>
        </div>
        <div class="prediction-card-preview">${escapeHtml(preview)}</div>
        <div class="prediction-card-meta">${charCount} 字</div>
      </div>`;
  }).join("");

  list.querySelectorAll(".prediction-card").forEach(card => {
    card.addEventListener("click", () => {
      list.querySelectorAll(".prediction-card").forEach(c => c.classList.remove("active"));
      card.classList.add("active");
      renderPredictionDetail(Number(card.dataset.idx));
    });
  });
}

function renderPredictionDetail(idx) {
  const detail = $("prediction-detail");
  if (!detail) return;

  if (idx < 0 || !predictionResults[idx]) {
    detail.innerHTML = '<div class="prediction-empty">选择左侧模型查看详情</div>';
    return;
  }

  const r = predictionResults[idx];
  const content = r.text || (r.error ? `Error: ${r.error}` : "(等待中...)");
  const cursor = r.status === "streaming" ? '<span class="stream-cursor"></span>' : "";

  detail.innerHTML = `
    <div class="prediction-detail-header">
      <strong>${escapeHtml(r.model)}</strong>
      <span>${r.text.length} 字</span>
    </div>
    <div class="prediction-detail-content">${renderMarkdown(content)}${cursor}</div>
    ${r.status === "done" ? `
      <div class="prediction-detail-actions">
        <button class="btn accent btn-sm" id="prediction-apply">应用到编辑器</button>
        <button class="btn ghost btn-sm" id="prediction-copy">复制</button>
      </div>` : ""}
    ${r.status === "error" ? `
      <div class="prediction-detail-actions">
        <button class="btn ghost btn-sm" id="prediction-retry">重试</button>
      </div>` : ""}
  `;

  const applyBtn = $("prediction-apply");
  if (applyBtn) applyBtn.addEventListener("click", () => {
    const ta = $("editor-textarea");
    if (ta) {
      ta.value = r.text;
      ta.dispatchEvent(new Event("input"));
      showToast("已应用到编辑器");
    }
  });

  const copyBtn = $("prediction-copy");
  if (copyBtn) copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(r.text).then(() => showToast("已复制"));
  });
}

function updatePredictionDetailIfActive(idx) {
  const list = $("prediction-list");
  const active = list?.querySelector(".prediction-card.active");
  if (active && Number(active.dataset.idx) === idx) {
    renderPredictionDetail(idx);
  }
}
