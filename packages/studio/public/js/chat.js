// InkOS Studio — Chat View
import { state } from "./state.js";
import { $, escapeHtml, requestJson, fetchSSE, autoResizeInput, showToast, runAction } from "./utils.js";
import { renderMarkdown } from "./markdown.js";
import { setView } from "./views.js";
import { openWritePipeline } from "./pipeline.js";
import { showContent } from "./content.js";

export function renderChatMessages() {
  const container = $("chat-messages");
  if (!state.chatHistory.length) {
    container.innerHTML = `
      <div class="chat-welcome">
        <div class="chat-welcome-icon">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><rect x="4" y="8" width="40" height="28" rx="6" stroke="currentColor" stroke-width="2.5"/><path d="M16 24h16M16 20h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18 36l-4 6M30 36l4 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
        </div>
        <h2>InkOS Studio</h2>
        <p>AI 小说写作工作台 &mdash; 对话优先，从这里开始</p>
      </div>`;
    return;
  }

  container.innerHTML = state.chatHistory.map((item, idx) => {
    const cls = item.role === "user" ? "chat-bubble--user" : "chat-bubble--ai";
    const meta = item.meta ? `<div class="chat-bubble-meta">${escapeHtml(item.meta)}</div>` : "";
    const contentHtml = item.role === "assistant" ? renderMarkdown(item.content) : escapeHtml(item.content);
    const actions = (item.role === "assistant" && item.hasUpdate)
      ? `<div class="chat-bubble-actions">
           <button class="btn ghost" data-apply="${idx}">应用</button>
           <button class="btn accent" data-apply-save="${idx}">应用并保存</button>
         </div>`
      : "";
    return `<div class="chat-bubble ${cls}">
      <div class="chat-bubble-content">
        ${contentHtml}
        ${meta}
        ${actions}
      </div>
    </div>`;
  }).join("");

  container.querySelectorAll("[data-apply]").forEach(btn => {
    btn.addEventListener("click", () => applyChatResult(false));
  });
  container.querySelectorAll("[data-apply-save]").forEach(btn => {
    btn.addEventListener("click", () => applyChatResult(true));
  });

  container.scrollTop = container.scrollHeight;
}

function appendStreamBubble() {
  const container = $("chat-messages");
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble chat-bubble--ai";
  bubble.id = "chat-stream-bubble";
  bubble.innerHTML = '<div class="chat-bubble-content"><span class="stream-cursor"></span></div>';
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
  return bubble.querySelector(".chat-bubble-content");
}

function removeStreamBubble() {
  const el = $("chat-stream-bubble");
  if (el) el.remove();
}

async function buildChatPayload(text) {
  const ctx = state.chatContext;
  let currentContent = "";
  const targetType = ctx.targetType || "brief";
  const bookId = ctx.bookId || state.activeBookId;

  if (targetType === "brief") {
    try { const res = await requestJson("/api/brief"); currentContent = res.content ?? ""; } catch {}
  } else if (targetType === "outline" && bookId) {
    try { const res = await requestJson(`/api/outline?bookId=${encodeURIComponent(bookId)}`); currentContent = res.content ?? ""; } catch {}
  } else if (targetType === "chapter" && bookId && ctx.file) {
    try { const res = await requestJson(`/api/chapter?bookId=${encodeURIComponent(bookId)}&file=${encodeURIComponent(ctx.file)}`); currentContent = res.content ?? ""; } catch {}
  }

  const history = state.chatHistory.slice(0, -1).map(h => ({
    role: h.role === "user" ? "user" : "assistant",
    content: h.content,
  }));

  return { message: text, history, targetType, bookId, currentContent, file: ctx.file || "" };
}

export async function sendChatMessage() {
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  autoResizeInput(input);

  state.chatHistory.push({ role: "user", content: text });
  renderChatMessages();

  const ctx = state.chatContext;
  const targetType = ctx.targetType || "brief";
  const bookId = ctx.bookId || state.activeBookId;

  try {
    const payload = await buildChatPayload(text);

    // Stream mode
    const contentEl = appendStreamBubble();
    let accumulated = "";

    const result = await fetchSSE("/api/chat-stream", payload, (token) => {
      accumulated += token;
      contentEl.innerHTML = renderMarkdown(accumulated) + '<span class="stream-cursor"></span>';
      $("chat-messages").scrollTop = $("chat-messages").scrollHeight;
    });

    removeStreamBubble();

    const fullText = result.fullText || accumulated;
    // Parse === REPLY === / === UPDATED_TEXT === sections
    const replyMatch = fullText.match(/=== REPLY ===\s*([\s\S]*?)(?==== [A-Z_]+ ===|$)/);
    const updateMatch = fullText.match(/=== UPDATED_TEXT ===\s*([\s\S]*?)(?==== [A-Z_]+ ===|$)/);
    const reply = replyMatch?.[1]?.trim() || fullText.trim();
    const updatedText = updateMatch?.[1]?.trim() || "";
    const metaStr = result.model ? `${result.model}` : "";

    state.pendingChatResult = updatedText ? { text: updatedText, targetType, bookId, file: ctx.file } : null;
    state.chatHistory.push({ role: "assistant", content: reply, meta: metaStr, hasUpdate: !!updatedText });
    renderChatMessages();
  } catch (err) {
    removeStreamBubble();
    state.chatHistory.push({ role: "assistant", content: `Error: ${err.message}`, meta: "" });
    renderChatMessages();
  }
}

async function applyChatResult(save) {
  const result = state.pendingChatResult;
  if (!result) { showToast("没有可应用的内容", "warn"); return; }

  if (result.targetType === "brief") {
    if (save) {
      await runAction("保存简报...", async () => {
        await requestJson("/api/brief", { method: "PUT", body: JSON.stringify({ content: result.text }) });
        showToast("简报已保存");
      });
    } else {
      showToast("简报内容已就绪，可在大纲面板查看");
    }
  } else if (result.targetType === "outline" && result.bookId) {
    if (save) {
      await runAction("保存卷纲...", async () => {
        await requestJson(`/api/outline?bookId=${encodeURIComponent(result.bookId)}`, { method: "PUT", body: JSON.stringify({ content: result.text }) });
        showToast("卷纲已保存");
      });
    }
  } else if (result.targetType === "chapter" && result.bookId && result.file) {
    if (save) {
      await runAction("保存章节...", async () => {
        await requestJson(`/api/chapter?bookId=${encodeURIComponent(result.bookId)}&file=${encodeURIComponent(result.file)}`, { method: "PUT", body: JSON.stringify({ content: result.text }) });
        showToast("章节已保存");
      });
    }
  }
}

export function handleQuickAction(action) {
  const bookId = state.activeBookId;
  if (action === "write-next") {
    const style = document.documentElement.getAttribute("data-style") || "ink";
    if (style === "ink" && bookId) {
      openWritePipeline(bookId);
    } else {
      if (bookId) $("write-book").value = bookId;
      setView("write");
    }
    return;
  }
  if (action === "world-state" && bookId) {
    showContent("story-file", bookId, "current_state.md");
    return;
  }
  if (action === "export") {
    if (bookId) $("export-book").value = bookId;
    setView("write");
    return;
  }
  if (action === "audit" && bookId) {
    $("chat-input").value = `请审计 ${bookId} 最新章节`;
    sendChatMessage();
    return;
  }
}
