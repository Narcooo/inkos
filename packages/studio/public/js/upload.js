// InkOS Studio — File Upload & Chapter Import
import { state } from "./state.js";
import { $, escapeHtml, requestJson, showToast } from "./utils.js";

let uploadState = { fileId: null, chapterCount: 0, firstTitle: "" };

export function initUpload() {
  const dropzone = $("upload-dropzone");
  if (!dropzone) return;

  dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  });

  const fileInput = $("upload-file-input");
  if (fileInput) fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) uploadFile(fileInput.files[0]);
  });

  const selectBtn = $("upload-select-btn");
  if (selectBtn) selectBtn.addEventListener("click", () => fileInput?.click());

  const importBtn = $("upload-import-btn");
  if (importBtn) importBtn.addEventListener("click", importChapters);
}

async function uploadFile(file) {
  const status = $("upload-status");
  const preview = $("upload-preview");
  status.textContent = "上传中...";
  preview.innerHTML = "";

  try {
    const res = await fetch("/api/upload", {
      method: "POST",
      body: file,
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    uploadState.fileId = data.fileId;
    uploadState.chapterCount = data.chapterCount;
    uploadState.firstTitle = data.firstTitle;

    status.textContent = `已上传: ${file.name} (${(data.size / 1024).toFixed(1)} KB)`;
    preview.innerHTML = `
      <div class="upload-preview-info">
        <div><strong>检测到章节:</strong> ${data.chapterCount}</div>
        <div><strong>首章标题:</strong> ${escapeHtml(data.firstTitle)}</div>
        <div><strong>总字数:</strong> ${data.totalChars}</div>
      </div>
      <label class="form-field">
        <span>目标书籍</span>
        <select id="upload-book-select">
          ${state.books.map(b => {
            const id = b.id || b;
            const label = b.title || id;
            return `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`;
          }).join("")}
        </select>
      </label>
      <label class="form-field">
        <span>章节分割正则</span>
        <input id="upload-pattern" type="text" value="第[一二三四五六七八九十百千\\d]+章\\s*.*" />
      </label>
      <button class="btn accent" id="upload-import-btn" type="button">导入章节</button>
    `;

    $("upload-import-btn")?.addEventListener("click", importChapters);
  } catch (err) {
    status.textContent = "上传失败: " + err.message;
  }
}

async function importChapters() {
  if (!uploadState.fileId) { showToast("请先上传文件", "warn"); return; }

  const bookId = $("upload-book-select")?.value;
  if (!bookId) { showToast("请选择目标书籍", "warn"); return; }

  const pattern = $("upload-pattern")?.value ?? "";
  const progress = $("upload-progress");
  if (progress) progress.textContent = "导入中...";

  try {
    const res = await requestJson("/api/import-chapters", {
      method: "POST",
      body: JSON.stringify({ fileId: uploadState.fileId, bookId, pattern }),
    });

    if (progress) {
      progress.innerHTML = `
        <div class="upload-success">导入完成: ${res.imported} 章</div>
        <div class="upload-chapter-list">
          ${(res.chapters ?? []).map(c => `<div class="upload-chapter-item">${escapeHtml(c.file)}: ${escapeHtml(c.title)} (${c.chars}字)</div>`).join("")}
        </div>`;
    }
    showToast(`成功导入 ${res.imported} 个章节`);
  } catch (err) {
    if (progress) progress.textContent = "导入失败: " + err.message;
    showToast("导入失败: " + err.message, "error");
  }
}
