// InkOS Studio — Utilities
import { state } from "./state.js";

export function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

export async function requestJson(url, options = {}) {
  const headers = options.body ? { "Content-Type": "application/json" } : {};
  const res = await fetch(url, { headers, ...options });
  let payload;
  try { payload = await res.json(); } catch { throw new Error(`Request failed: ${res.status}`); }
  if (!res.ok) throw new Error(payload?.error ?? `Request failed: ${res.status}`);
  return payload;
}

export function $(id) { return document.getElementById(id); }

export function showToast(message, type = "success") {
  const container = $("toast-container");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

export function setStatus(text) {
  const el = $("app-status");
  if (el) el.textContent = text;
}

export async function withBusy(message, task) {
  state.busyCount += 1;
  document.body.classList.add("is-busy");
  setStatus(message);
  try {
    return await task();
  } finally {
    state.busyCount = Math.max(0, state.busyCount - 1);
    if (state.busyCount === 0) {
      document.body.classList.remove("is-busy");
      setStatus("");
    }
  }
}

export async function runAction(message, task) {
  try {
    return await withBusy(message, task);
  } catch (err) {
    showToast(String(err.message || err), "error");
  }
}

export function autoResizeInput(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 200) + "px";
}

/**
 * Fetch SSE stream. Calls onToken for each token, returns full result on done.
 * @param {string} url
 * @param {object} body
 * @param {(token: string) => void} onToken
 * @returns {Promise<{fullText: string, usage?: object, model?: string, error?: string}>}
 */
export async function fetchSSE(url, body, onToken) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Stream failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = { fullText: "" };

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
        if (data.done) {
          result = data;
        } else if (data.token) {
          onToken(data.token);
        }
      } catch {}
    }
  }

  return result;
}
