// InkOS Studio — Settings Modal
import { state } from "./state.js";
import { $, requestJson, runAction, showToast } from "./utils.js";

const AGENTS = ["architect", "writer", "auditor", "reviser", "radar", "chapter-analyzer"];

export function openSettings() {
  $("settings-modal").style.display = "flex";
  loadSettingsData();
  loadAgentRouting();
}

export function closeSettings() {
  $("settings-modal").style.display = "none";
}

function loadSettingsData() {
  if (!state.meta) return;
  const llm = state.meta.llm ?? {};
  $("s-provider").value = llm.provider || "openai";
  $("s-baseurl").value = llm.baseUrl || "";
  $("s-model").value = llm.model || "";
  $("s-apiformat").value = llm.apiFormat || "chat";
  $("s-temperature").value = llm.temperature ?? "";
  $("s-maxtokens").value = llm.maxTokens ?? "";
  $("s-apikey").value = "";
  $("s-thinking-budget").value = llm.thinkingBudget ?? "";
  $("s-reasoning-effort").value = llm.reasoningEffort ?? "";
  $("s-stream").value = String(llm.stream ?? true);
  $("s-disable-storage").value = String(llm.disableResponseStorage ?? false);

  $("info-project-root").textContent = state.meta.projectRoot ?? "-";
  $("info-cli-path").textContent = state.meta.cliPath ?? "-";
}

async function loadAgentRouting() {
  try {
    const res = await requestJson("/api/model-overrides");
    const overrides = res.data ?? {};
    for (const agent of AGENTS) {
      const el = $(`s-agent-${agent}`);
      if (el) el.value = overrides[agent] ?? "";
    }
  } catch {}
}

export async function saveSettings(loadMeta) {
  await runAction("保存设置...", async () => {
    const body = {
      provider: $("s-provider").value,
      baseUrl: $("s-baseurl").value,
      model: $("s-model").value,
      apiFormat: $("s-apiformat").value,
      temperature: $("s-temperature").value ? Number($("s-temperature").value) : undefined,
      maxTokens: $("s-maxtokens").value ? Number($("s-maxtokens").value) : undefined,
      thinkingBudget: $("s-thinking-budget").value ? Number($("s-thinking-budget").value) : undefined,
      reasoningEffort: $("s-reasoning-effort").value || undefined,
      stream: $("s-stream").value === "true",
      disableResponseStorage: $("s-disable-storage").value === "true",
    };
    const apiKey = $("s-apikey").value.trim();
    if (apiKey) body.apiKey = apiKey;

    await requestJson("/api/settings", { method: "PUT", body: JSON.stringify(body) });

    // Save agent routing
    const overrides = {};
    for (const agent of AGENTS) {
      const val = $(`s-agent-${agent}`)?.value?.trim();
      if (val) overrides[agent] = val;
    }
    await requestJson("/api/model-overrides", { method: "PUT", body: JSON.stringify(overrides) });

    showToast("设置已保存");
    if (loadMeta) await loadMeta();
  });
}

export async function runDoctor() {
  const statusEl = $("doctor-status");
  statusEl.textContent = "检测中...";
  statusEl.className = "settings-doctor-status";

  await runAction("检测连通性...", async () => {
    const res = await requestJson("/api/doctor");
    const stdout = res.stdout ?? "";
    const exitCode = res.exitCode ?? res.code;
    if (exitCode === 0) {
      statusEl.textContent = "连通正常";
      statusEl.className = "settings-doctor-status ok";
    } else {
      statusEl.textContent = stdout || "连通失败";
      statusEl.className = "settings-doctor-status fail";
    }
  });
}
