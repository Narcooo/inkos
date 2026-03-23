// InkOS Studio — Sidebar Tree
import { state } from "./state.js";
import { $, escapeHtml, requestJson } from "./utils.js";
import { showContent } from "./content.js";

export const STORY_FILES = [
  { file: "volume_outline.md", label: "全书大纲", icon: "\ud83d\udccb", group: "outline" },
  { file: "story_bible.md", label: "故事圣经", icon: "\ud83d\udcd6", group: "outline" },
  { file: "book_rules.md", label: "书籍规则", icon: "\ud83d\udccf", group: "outline" },
];

export const TRUTH_FILES = [
  { file: "current_state.md", label: "当前状态", icon: "\ud83c\udf0d" },
  { file: "particle_ledger.md", label: "资源账本", icon: "\ud83d\udcb0" },
  { file: "pending_hooks.md", label: "伏笔钩子", icon: "\ud83c\udfa3" },
  { file: "chapter_summaries.md", label: "章节摘要", icon: "\ud83d\udcdd" },
  { file: "subplot_board.md", label: "支线进度", icon: "\ud83d\udea6" },
  { file: "emotional_arcs.md", label: "情感弧线", icon: "\u2764\ufe0f" },
  { file: "character_matrix.md", label: "角色矩阵", icon: "\ud83e\uddd1\u200d\ud83e\udd1d\u200d\ud83e\uddd1" },
];

export async function buildSidebarTree(bookId) {
  if (!bookId) return;
  const tree = $("sidebar-tree");
  tree.innerHTML = '<div class="sidebar-empty">加载中...</div>';

  let chapters = [];
  let chapterFiles = [];

  try {
    const [indexRes, filesRes] = await Promise.all([
      requestJson(`/api/chapters?bookId=${encodeURIComponent(bookId)}`).catch(() => null),
      requestJson(`/api/book-files?bookId=${encodeURIComponent(bookId)}`).catch(() => null),
    ]);

    if (indexRes?.ok && indexRes.data) {
      chapters = Array.isArray(indexRes.data) ? indexRes.data : (indexRes.data.chapters ?? []);
      state.chapterIndex = chapters;
    }
    if (filesRes?.ok && Array.isArray(filesRes.files)) {
      chapterFiles = filesRes.files;
      state.chapterFiles = chapterFiles;
    }
  } catch {}

  const chapterMap = new Map();
  for (const ch of chapters) {
    const padded = String(ch.number).padStart(3, "0");
    const possibleFiles = chapterFiles.filter(f => f.startsWith(padded));
    const file = possibleFiles[0] || `${padded}.md`;
    chapterMap.set(file, ch);
  }
  for (const f of chapterFiles) {
    if (!chapterMap.has(f)) chapterMap.set(f, null);
  }

  const sortedChapters = [...chapterMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  let html = "";

  // Outline group
  html += `<details class="tree-group" open>
    <summary>大纲 <span class="section-tag">OUTLINE</span></summary>
    <div class="tree-items">
      ${STORY_FILES.map(sf => `
        <button class="tree-node" data-type="story-file" data-book="${escapeHtml(bookId)}" data-file="${escapeHtml(sf.file)}">
          <span class="tree-node-icon">${sf.icon}</span>
          <span class="tree-node-label">${escapeHtml(sf.label)}</span>
        </button>
      `).join("")}
    </div>
  </details>`;

  // Chapters group
  html += `<details class="tree-group" open>
    <summary>章节 (${sortedChapters.length}) <span class="section-tag">CHAPTERS</span></summary>
    <div class="tree-items">
      ${sortedChapters.map(([file, meta]) => {
        const label = meta ? `第${meta.number}章: ${meta.title || "无标题"}` : file.replace(/\.md$/, "");
        const badge = meta ? statusBadge(meta.status) : "";
        return `
          <button class="tree-node" data-type="chapter" data-book="${escapeHtml(bookId)}" data-file="${escapeHtml(file)}">
            <span class="tree-node-icon">\ud83d\udcc4</span>
            <span class="tree-node-label">${escapeHtml(label)}</span>
            ${badge}
          </button>`;
      }).join("")}
    </div>
  </details>`;

  // Truth files group
  html += `<details class="tree-group" open>
    <summary>世界状态 <span class="section-tag">WORLD</span></summary>
    <div class="tree-items">
      ${TRUTH_FILES.map(tf => `
        <button class="tree-node" data-type="story-file" data-book="${escapeHtml(bookId)}" data-file="${escapeHtml(tf.file)}">
          <span class="tree-node-icon">${tf.icon}</span>
          <span class="tree-node-label">${escapeHtml(tf.label)}</span>
        </button>
      `).join("")}
    </div>
  </details>`;

  tree.innerHTML = html;

  tree.querySelectorAll(".tree-node").forEach(node => {
    node.addEventListener("click", () => {
      tree.querySelectorAll(".tree-node").forEach(n => n.classList.remove("active"));
      node.classList.add("active");
      showContent(node.dataset.type, node.dataset.book, node.dataset.file);
    });
  });
}

function statusBadge(status) {
  if (!status) return "";
  if (status === "approved") return '<span class="tree-node-badge pass">通过</span>';
  if (status === "audit-failed" || status === "rejected") return '<span class="tree-node-badge fail">失败</span>';
  if (status === "ready-for-review") return '<span class="tree-node-badge review">待审</span>';
  return "";
}
