// InkOS Studio — Content View
import { state } from "./state.js";
import { $, escapeHtml, requestJson, runAction, showToast } from "./utils.js";
import { renderMarkdown } from "./markdown.js";
import { setView } from "./views.js";
import { STORY_FILES } from "./sidebar.js";

export async function showContent(type, bookId, file) {
  state.contentState = { type, bookId, file, content: "", isEditing: false };
  setView("content");

  $("content-body").innerHTML = '<div class="sidebar-empty">加载中...</div>';
  $("content-editor").style.display = "none";
  $("content-body").style.display = "block";
  $("save-content").style.display = "none";
  $("toggle-edit").textContent = "编辑";

  const labels = {
    "volume_outline.md": "全书大纲",
    "story_bible.md": "故事圣经",
    "book_rules.md": "书籍规则",
    "current_state.md": "当前状态",
    "particle_ledger.md": "资源账本",
    "pending_hooks.md": "伏笔钩子",
    "chapter_summaries.md": "章节摘要",
    "subplot_board.md": "支线进度",
    "emotional_arcs.md": "情感弧线",
    "character_matrix.md": "角色矩阵",
  };
  const fileLabel = labels[file] || file;
  const groupLabel = type === "chapter" ? "章节" : (STORY_FILES.some(s => s.file === file) ? "大纲" : "世界状态");
  $("content-breadcrumb").innerHTML = `${escapeHtml(bookId)} &rsaquo; ${escapeHtml(groupLabel)} &rsaquo; <span>${escapeHtml(fileLabel)}</span>`;

  state.chatContext = {
    targetType: type === "chapter" ? "chapter" : (file === "volume_outline.md" ? "outline" : "brief"),
    bookId,
    file,
  };

  await runAction("加载文件...", async () => {
    let content = "";
    if (type === "chapter") {
      const res = await requestJson(`/api/chapter?bookId=${encodeURIComponent(bookId)}&file=${encodeURIComponent(file)}`);
      content = res.content ?? "";
    } else if (type === "story-file") {
      const res = await requestJson(`/api/story-file?bookId=${encodeURIComponent(bookId)}&file=${encodeURIComponent(file)}`);
      content = res.content ?? "";
    }
    state.contentState.content = content;
    $("content-body").innerHTML = renderMarkdown(content);
  });
}

export function toggleEdit() {
  const cs = state.contentState;
  cs.isEditing = !cs.isEditing;

  if (cs.isEditing) {
    $("content-body").style.display = "none";
    $("content-editor").style.display = "block";
    $("content-editor").value = cs.content;
    $("save-content").style.display = "";
    $("toggle-edit").textContent = "预览";
    $("content-editor").focus();
  } else {
    const edited = $("content-editor").value;
    cs.content = edited;
    $("content-body").style.display = "block";
    $("content-editor").style.display = "none";
    $("content-body").innerHTML = renderMarkdown(edited);
    $("save-content").style.display = "none";
    $("toggle-edit").textContent = "编辑";
  }
}

export async function saveContent() {
  const cs = state.contentState;
  const content = $("content-editor").value;
  cs.content = content;

  await runAction("保存中...", async () => {
    if (cs.type === "chapter") {
      await requestJson(`/api/chapter?bookId=${encodeURIComponent(cs.bookId)}&file=${encodeURIComponent(cs.file)}`, {
        method: "PUT", body: JSON.stringify({ content }),
      });
    } else if (cs.type === "story-file") {
      await requestJson(`/api/story-file?bookId=${encodeURIComponent(cs.bookId)}&file=${encodeURIComponent(cs.file)}`, {
        method: "PUT", body: JSON.stringify({ content }),
      });
    }
    showToast("已保存");
  });
}

export function backToChat() {
  setView("chat");
  $("sidebar-tree").querySelectorAll(".tree-node").forEach(n => n.classList.remove("active"));
}
