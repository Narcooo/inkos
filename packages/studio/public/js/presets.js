// InkOS Studio — Preset Management
import { $, escapeHtml, requestJson, showToast } from "./utils.js";

let presets = [];
let editingPreset = null;

const PRESET_TYPES = {
  chat: "聊天", revise: "修订", continue: "续写", outline: "大纲", analyze: "分析",
};

export async function loadPresets() {
  try {
    const res = await requestJson("/api/presets");
    if (res.ok) presets = res.data ?? [];
  } catch {
    presets = [];
  }
}

export function getPresets() { return presets; }

export function initPresets() {
  const createBtn = $("preset-create-btn");
  if (createBtn) createBtn.addEventListener("click", () => openPresetEditor(null));

  const closeBtn = $("preset-editor-close");
  if (closeBtn) closeBtn.addEventListener("click", closePresetEditor);

  const saveBtn = $("preset-editor-save");
  if (saveBtn) saveBtn.addEventListener("click", savePresetFromEditor);
}

export async function renderPresetList() {
  await loadPresets();
  const container = $("preset-list");
  if (!container) return;

  if (!presets.length) {
    container.innerHTML = '<div class="sidebar-empty">暂无预设，点击上方按钮创建</div>';
    return;
  }

  container.innerHTML = presets.map(p => {
    const typeLabel = PRESET_TYPES[p.type] || p.type;
    const tags = (p.tags ?? []).map(t => `<span class="preset-tag">${escapeHtml(t)}</span>`).join("");
    const favClass = p.isFavorite ? "fav" : "";
    return `
      <div class="preset-item" data-id="${escapeHtml(p.id)}">
        <div class="preset-item-header">
          <span class="preset-item-name">${escapeHtml(p.name)}</span>
          <span class="preset-item-type">${escapeHtml(typeLabel)}</span>
        </div>
        <div class="preset-item-tags">${tags}</div>
        <div class="preset-item-footer">
          <span class="preset-item-uses">${p.useCount ?? 0} 次使用</span>
          <span class="preset-item-actions">
            <button class="btn ghost btn-xs preset-fav ${favClass}" data-action="fav" title="收藏">&#x2605;</button>
            <button class="btn ghost btn-xs" data-action="edit" title="编辑">&#x270E;</button>
            <button class="btn ghost btn-xs" data-action="delete" title="删除">&#x2715;</button>
          </span>
        </div>
      </div>`;
  }).join("");

  container.querySelectorAll(".preset-item").forEach(el => {
    const id = el.dataset.id;
    el.querySelector("[data-action='edit']")?.addEventListener("click", (e) => {
      e.stopPropagation();
      openPresetEditor(presets.find(p => p.id === id));
    });
    el.querySelector("[data-action='delete']")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await requestJson(`/api/presets/${encodeURIComponent(id)}`, { method: "DELETE" });
        showToast("已删除预设");
        renderPresetList();
      } catch (err) { showToast("删除失败: " + err.message, "error"); }
    });
    el.querySelector("[data-action='fav']")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      const preset = presets.find(p => p.id === id);
      if (!preset) return;
      preset.isFavorite = !preset.isFavorite;
      try {
        await requestJson(`/api/presets/${encodeURIComponent(id)}`, {
          method: "PUT", body: JSON.stringify(preset),
        });
        renderPresetList();
      } catch {}
    });
    el.addEventListener("click", () => applyPreset(id));
  });
}

function applyPreset(id) {
  const preset = presets.find(p => p.id === id);
  if (!preset) return;

  // Increment use count
  preset.useCount = (preset.useCount ?? 0) + 1;
  requestJson(`/api/presets/${encodeURIComponent(id)}`, {
    method: "PUT", body: JSON.stringify(preset),
  }).catch(() => {});

  // Apply to AI panel input
  const aiInput = $("ai-panel-input");
  if (aiInput && preset.userPromptTemplate) {
    const editorContent = $("editor-textarea")?.value ?? "";
    aiInput.value = preset.userPromptTemplate.replace("{{content}}", editorContent);
  }
  showToast(`已加载预设: ${preset.name}`);
}

function openPresetEditor(preset) {
  editingPreset = preset;
  const modal = $("preset-editor-modal");
  if (!modal) return;

  $("preset-editor-title").textContent = preset ? "编辑预设" : "新建预设";
  $("preset-name").value = preset?.name ?? "";
  $("preset-type").value = preset?.type ?? "chat";
  $("preset-system-prompt").value = preset?.systemPrompt ?? "";
  $("preset-user-template").value = preset?.userPromptTemplate ?? "";
  $("preset-model").value = preset?.modelConfigId ?? "";
  $("preset-temperature").value = preset?.temperature ?? 0.7;
  $("preset-max-tokens").value = preset?.maxTokens ?? 4096;
  $("preset-tags").value = (preset?.tags ?? []).join(", ");

  modal.style.display = "flex";
}

function closePresetEditor() {
  const modal = $("preset-editor-modal");
  if (modal) modal.style.display = "none";
  editingPreset = null;
}

async function savePresetFromEditor() {
  const data = {
    name: $("preset-name").value.trim(),
    type: $("preset-type").value,
    systemPrompt: $("preset-system-prompt").value,
    userPromptTemplate: $("preset-user-template").value,
    modelConfigId: $("preset-model").value.trim(),
    temperature: parseFloat($("preset-temperature").value) || 0.7,
    maxTokens: parseInt($("preset-max-tokens").value) || 4096,
    tags: $("preset-tags").value.split(",").map(s => s.trim()).filter(Boolean),
  };

  if (!data.name) { showToast("请输入预设名称", "warn"); return; }

  try {
    if (editingPreset) {
      await requestJson(`/api/presets/${encodeURIComponent(editingPreset.id)}`, {
        method: "PUT", body: JSON.stringify({ ...editingPreset, ...data }),
      });
    } else {
      await requestJson("/api/presets", { method: "POST", body: JSON.stringify(data) });
    }
    showToast(editingPreset ? "预设已更新" : "预设已创建");
    closePresetEditor();
    renderPresetList();
  } catch (err) {
    showToast("保存失败: " + err.message, "error");
  }
}
