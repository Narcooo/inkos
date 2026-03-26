// InkOS Studio — Sidebar Tree
import { state } from "./state.js";
import { $, escapeHtml, requestJson } from "./utils.js";
import { showContent } from "./content.js";

// SVG icon snippets for sidebar tree nodes (16x16, stroke-based)
export const ICON = {
  outline: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  bible: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>',
  rules: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  globe: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>',
  ledger: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="3" width="20" height="18" rx="2"/><line x1="8" y1="3" x2="8" y2="21"/><line x1="2" y1="9" x2="22" y2="9"/><line x1="2" y1="15" x2="22" y2="15"/></svg>',
  hook: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/></svg>',
  summary: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
  subplot: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  heart: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>',
  users: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
  chapter: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
};

export const STORY_FILES = [
  { file: "volume_outline.md", label: "全书大纲", icon: ICON.outline, group: "outline" },
  { file: "story_bible.md", label: "故事圣经", icon: ICON.bible, group: "outline" },
  { file: "book_rules.md", label: "书籍规则", icon: ICON.rules, group: "outline" },
];

export const TRUTH_FILES = [
  { file: "current_state.md", label: "当前状态", icon: ICON.globe },
  { file: "particle_ledger.md", label: "资源账本", icon: ICON.ledger },
  { file: "pending_hooks.md", label: "伏笔钩子", icon: ICON.hook },
  { file: "chapter_summaries.md", label: "章节摘要", icon: ICON.summary },
  { file: "subplot_board.md", label: "支线进度", icon: ICON.subplot },
  { file: "emotional_arcs.md", label: "情感弧线", icon: ICON.heart },
  { file: "character_matrix.md", label: "角色矩阵", icon: ICON.users },
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
            <span class="tree-node-icon">${ICON.chapter}</span>
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
