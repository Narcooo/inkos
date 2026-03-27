const http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { mkdir, readFile, readdir, stat, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { resolveCliPath, resolveCorePath } = require("./server-runtime.cjs");
const { extractProgressStages } = require("./server-progress.cjs");
const {
  buildImportRegex,
  createUploadResponse,
  ensureRuntimeDirs,
  isSafeUploadFileId,
  resolveServerPort,
} = require("./server-safety.cjs");

// ── Portable Data Path ──
// User data lives in ~/.inkos/ so exe updates never touch user data.
// Override with INKOS_PROJECT_ROOT or INKOS_REPO_ROOT env vars.

function detectRepoRoot() {
  if (process.pkg) {
    // Packaged exe: check if repo structure exists alongside exe
    const exeDir = path.dirname(process.execPath);
    const candidate = path.resolve(exeDir, "..", "..", "..");
    if (existsSync(path.join(candidate, "packages", "cli", "dist", "index.js"))) {
      return candidate;
    }
    return null; // No repo found — standalone exe mode
  }
  return path.resolve(__dirname, "..", "..");
}

const repoRoot = process.env.INKOS_REPO_ROOT
  ? path.resolve(process.env.INKOS_REPO_ROOT)
  : detectRepoRoot();

// Data directory: ~/.inkos/data (survives exe updates)
const userDataDir = path.join(os.homedir(), ".inkos", "data");
const projectRoot = process.env.INKOS_PROJECT_ROOT
  ?? (repoRoot ? path.join(repoRoot, "project") : userDataDir);

// CLI path — in pkg mode, look next to the exe; otherwise use __dirname
const exeDir = process.pkg ? path.dirname(process.execPath) : __dirname;
const cliPath = resolveCliPath({
  env: process.env,
  repoRoot,
  projectRoot,
  currentDir: exeDir,
});
const corePath = resolveCorePath({
  env: process.env,
  repoRoot,
  projectRoot,
  currentDir: exeDir,
});

// Static files: embedded snapshot next to exe, or dev path
function resolvePublicDir() {
  if (process.pkg) {
    // 1. Check for /public next to exe
    const exePublic = path.join(path.dirname(process.execPath), "public");
    if (existsSync(exePublic)) return exePublic;
    // 2. Check repo structure
    if (repoRoot) {
      const repoPublic = path.join(repoRoot, "packages", "studio", "public");
      if (existsSync(repoPublic)) return repoPublic;
    }
    // 3. Snapshot inside pkg (if assets were included)
    return path.join(__dirname, "public");
  }
  return path.join(__dirname, "public");
}
const publicDir = resolvePublicDir();

const briefPath = path.join(projectRoot, "brief.md");
const globalEnvPath = path.join(os.homedir(), ".inkos", ".env");
let coreModulePromise;

const host = process.env.HOST ?? "127.0.0.1";
const port = resolveServerPort(process.env);

const proxyEnv = {
  HTTP_PROXY: process.env.HTTP_PROXY ?? "http://127.0.0.1:7890",
  HTTPS_PROXY: process.env.HTTPS_PROXY ?? "http://127.0.0.1:7890",
};

const ALLOWED_STORY_FILES = new Set([
  "volume_outline.md", "story_bible.md", "book_rules.md",
  "current_state.md", "particle_ledger.md", "pending_hooks.md",
  "chapter_summaries.md", "subplot_board.md", "emotional_arcs.md",
  "character_matrix.md",
]);

function sendJson(res, status, data) {
  const payload = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  return "application/octet-stream";
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 2 * 1024 * 1024) {
      throw new Error("Body too large");
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw };
  }
}

function resolveNodeBin() {
  if (process.env.INKOS_NODE_PATH) {
    return process.env.INKOS_NODE_PATH;
  }

  // In non-pkg mode, always use the current Node.js
  if (!process.pkg) {
    return process.execPath;
  }

  // In pkg mode: prefer system node (handles UTF-8 args correctly),
  // fall back to bundled node.exe
  try {
    if (process.platform === "win32") {
      const output = execFileSync("where", ["node"], { encoding: "utf-8" });
      const match = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.toLowerCase().endsWith("node.exe"));
      if (match) return match;
    } else {
      const output = execFileSync("which", ["node"], { encoding: "utf-8" }).trim();
      if (output) return output;
    }
  } catch {
    // fall through
  }

  const bundledNode = path.join(path.dirname(process.execPath), "node.exe");
  if (existsSync(bundledNode)) {
    return bundledNode;
  }
  return "node";
}

async function runInkOS(args, { onStderr, onStdout } = {}) {
  if (!cliPath) {
    return {
      code: 1,
      stdout: "",
      stderr: "CLI not found. Install @actalk/inkos or run from the repo root with packages/cli built.",
    };
  }

  return new Promise((resolve) => {
    const nodeBin = resolveNodeBin();
    const child = spawn(nodeBin, [cliPath, ...args], {
      cwd: projectRoot,
      env: { ...process.env, ...proxyEnv },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (onStdout) onStdout(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (onStderr) onStderr(text);
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 0, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.on("error", (error) => {
      resolve({ code: 1, stdout: "", stderr: String(error) });
    });
  });
}

function tryParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isSafeBookId(bookId) {
  if (!bookId) return false;
  if (bookId.includes("..")) return false;
  if (bookId.includes("/") || bookId.includes("\\")) return false;
  return true;
}

function isSafeFileName(fileName) {
  if (!fileName) return false;
  if (fileName.includes("..")) return false;
  if (fileName.includes("/") || fileName.includes("\\")) return false;
  if (!fileName.toLowerCase().endsWith(".md")) return false;
  return true;
}

function resolveBookPath(bookId, ...parts) {
  if (!isSafeBookId(bookId)) return null;
  const base = path.resolve(projectRoot, "books", bookId);
  const full = path.resolve(base, ...parts);
  if (full === base) return full;
  if (!full.startsWith(base + path.sep)) return null;
  return full;
}

async function loadProjectBrief() {
  try {
    const content = await readFile(briefPath, "utf-8");
    return { exists: true, content };
  } catch {
    return { exists: false, content: "" };
  }
}

function buildCommandResponse(result) {
  const data = tryParseJson(result.stdout) ?? { error: result.stderr || result.stdout };
  return {
    ok: result.code === 0 && !data.error,
    data,
    raw: result,
  };
}

// ── Presets ──

const presetsDir = path.join(projectRoot, ".inkos", "presets");

async function listPresets() {
  try {
    await mkdir(presetsDir, { recursive: true });
    const files = await readdir(presetsDir);
    const presets = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await readFile(path.join(presetsDir, f), "utf-8");
        presets.push(JSON.parse(raw));
      } catch {}
    }
    return presets.sort((a, b) => (b.useCount ?? 0) - (a.useCount ?? 0));
  } catch {
    return [];
  }
}

async function savePreset(preset) {
  await mkdir(presetsDir, { recursive: true });
  const id = preset.id || `preset-${Date.now()}-${randomUUID().slice(0, 8)}`;
  preset.id = id;
  preset.updatedAt = new Date().toISOString();
  if (!preset.createdAt) preset.createdAt = preset.updatedAt;
  await writeFile(path.join(presetsDir, `${id}.json`), JSON.stringify(preset, null, 2), "utf-8");
  return preset;
}

async function deletePreset(id) {
  const filePath = path.join(presetsDir, `${id}.json`);
  const { unlink } = require("node:fs/promises");
  await unlink(filePath);
}

// ── LLM Logs ──

const llmLogsDir = path.join(projectRoot, ".inkos", "llm-logs");

async function appendLLMLog(entry) {
  await mkdir(llmLogsDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const logFile = path.join(llmLogsDir, `${date}.jsonl`);
  const { appendFile } = require("node:fs/promises");
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n";
  await appendFile(logFile, line, "utf-8");
}

async function readLLMLogs(date) {
  const logFile = path.join(llmLogsDir, `${date}.jsonl`);
  try {
    const raw = await readFile(logFile, "utf-8");
    return raw.trim().split("\n").filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

async function getLLMStats() {
  try {
    await mkdir(llmLogsDir, { recursive: true });
    const files = await readdir(llmLogsDir);
    const jsonlFiles = files.filter(f => f.endsWith(".jsonl")).sort().reverse().slice(0, 30);
    let totalCalls = 0, totalInputTokens = 0, totalOutputTokens = 0, totalDuration = 0;
    const byModel = {};
    const byDate = {};

    for (const f of jsonlFiles) {
      const date = f.replace(".jsonl", "");
      const logs = await readLLMLogs(date);
      byDate[date] = logs.length;
      for (const log of logs) {
        totalCalls++;
        totalInputTokens += log.inputTokens ?? 0;
        totalOutputTokens += log.outputTokens ?? 0;
        totalDuration += log.durationMs ?? 0;
        const m = log.model ?? "unknown";
        byModel[m] = (byModel[m] ?? 0) + 1;
      }
    }

    return {
      totalCalls,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      avgDurationMs: totalCalls ? Math.round(totalDuration / totalCalls) : 0,
      byModel,
      byDate,
    };
  } catch {
    return { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0, avgDurationMs: 0, byModel: {}, byDate: {} };
  }
}

// ── Fanqie Proxy ──

const FANQIE_API_URL = process.env.FANQIE_API_URL || "http://localhost:5000";

async function fanqieProxy(reqPath, options = {}) {
  const url = `${FANQIE_API_URL}${reqPath}`;
  const fetchMod = globalThis.fetch ?? (await import("node-fetch")).default;
  const res = await fetchMod(url, {
    method: options.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    ...(options.body ? { body: options.body } : {}),
  });
  return res;
}

// ── Knowledge Base ──

const knowledgeDir = path.join(projectRoot, ".inkos", "knowledge");

const ANALYSIS_DIMENSIONS = ["style", "plot", "character", "worldview", "emotion", "meme", "structure"];

async function listKnowledge() {
  try {
    await mkdir(knowledgeDir, { recursive: true });
    const dirs = await readdir(knowledgeDir);
    const items = [];
    for (const d of dirs) {
      const metaPath = path.join(knowledgeDir, d, "meta.json");
      try {
        const raw = await readFile(metaPath, "utf-8");
        items.push(JSON.parse(raw));
      } catch {}
    }
    return items;
  } catch {
    return [];
  }
}

async function getKnowledgeItem(id) {
  const itemDir = path.join(knowledgeDir, id);
  const metaPath = path.join(itemDir, "meta.json");
  const meta = JSON.parse(await readFile(metaPath, "utf-8"));
  const dimensions = {};
  for (const dim of ANALYSIS_DIMENSIONS) {
    try {
      dimensions[dim] = await readFile(path.join(itemDir, `${dim}.md`), "utf-8");
    } catch {
      dimensions[dim] = "";
    }
  }
  return { ...meta, dimensions };
}

async function deleteKnowledge(id) {
  if (!id || id.includes("..") || id.includes("/") || id.includes("\\")) throw new Error("Invalid ID");
  const itemDir = path.join(knowledgeDir, id);
  const { rm } = require("node:fs/promises");
  await rm(itemDir, { recursive: true, force: true });
}

async function getCoreModule() {
  if (!coreModulePromise) {
    if (process.pkg) {
      // pkg Node 18 can't dynamic-import ESM — use CJS bundle
      const bundlePath = path.join(path.dirname(process.execPath), "core-bundle.cjs");
      if (existsSync(bundlePath)) {
        coreModulePromise = Promise.resolve(require(bundlePath));
      } else if (corePath) {
        // Fallback: try dynamic import (works on newer pkg/Node versions)
        coreModulePromise = import(pathToFileURL(corePath).href);
      } else {
        throw new Error("InkOS core not found. Install @actalk/inkos-core or run from the repo root with packages/core built.");
      }
    } else {
      if (!corePath) {
        throw new Error("InkOS core not found. Install @actalk/inkos-core or run from the repo root with packages/core built.");
      }
      coreModulePromise = import(pathToFileURL(corePath).href);
    }
  }
  return coreModulePromise;
}

async function buildLLMTools() {
  const { createLLMClient, chatCompletion } = await getCoreModule();
  const config = await loadProjectConfig();
  return {
    config,
    client: createLLMClient(config.llm),
    chatCompletion,
  };
}

function normalizeReasoningEffort(value) {
  const effort = String(value ?? "").trim().toLowerCase();
  if (["low", "medium", "high", "xhigh"].includes(effort)) {
    return effort;
  }
  return "";
}

function extractResponsesText(response) {
  return (response.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((block) => block.type === "output_text")
    .map((block) => block.text)
    .join("");
}

async function runStudioChat(messages, options = {}) {
  const startMs = Date.now();
  const { client, config, chatCompletion } = await buildLLMTools();
  const model = String(options.model ?? "").trim() || config.llm.model;
  const requestedReasoning = normalizeReasoningEffort(options.reasoningEffort);
  let result;

  if (client.provider === "openai" && client.apiFormat === "responses" && client._openai) {
    const appliedReasoning = requestedReasoning === "xhigh" ? "high" : requestedReasoning;
    const body = {
      model,
      input: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      stream: false,
      max_output_tokens: config.llm.maxTokens ?? 8192,
    };

    if (appliedReasoning) {
      body.reasoning = { effort: appliedReasoning };
    }

    const response = await client._openai.responses.create(body);
    const content = extractResponsesText(response);
    if (!content) {
      throw new Error("LLM returned empty response");
    }

    result = {
      content,
      usage: {
        promptTokens: response.usage?.input_tokens ?? 0,
        completionTokens: response.usage?.output_tokens ?? 0,
        totalTokens: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
      },
      model,
      requestedReasoning,
      appliedReasoning,
    };
  } else {
    const response = await chatCompletion(client, model, messages, {
      maxTokens: config.llm.maxTokens ?? 8192,
    });

    result = {
      ...response,
      model,
      requestedReasoning,
      appliedReasoning: "",
    };
  }

  appendLLMLog({
    model,
    provider: client.provider,
    type: options.logType ?? "chat",
    inputTokens: result.usage?.promptTokens ?? 0,
    outputTokens: result.usage?.completionTokens ?? 0,
    durationMs: Date.now() - startMs,
    status: "success",
  }).catch(() => {});

  return result;
}

async function runStudioChatStream(messages, options, res) {
  const startMs = Date.now();
  const { client, config, chatCompletion } = await buildLLMTools();
  const model = String(options.model ?? "").trim() || config.llm.model;
  const requestedReasoning = normalizeReasoningEffort(options.reasoningEffort);
  const maxTokens = config.llm.maxTokens ?? 8192;

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const chunks = [];
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    if (client.provider === "openai" && client.apiFormat === "responses" && client._openai) {
      const appliedReasoning = requestedReasoning === "xhigh" ? "high" : requestedReasoning;
      const body = {
        model,
        input: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        max_output_tokens: maxTokens,
      };
      if (appliedReasoning) body.reasoning = { effort: appliedReasoning };

      const stream = await client._openai.responses.create(body);
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          chunks.push(event.delta);
          send({ token: event.delta, done: false });
        }
        if (event.type === "response.completed") {
          inputTokens = event.response.usage?.input_tokens ?? 0;
          outputTokens = event.response.usage?.output_tokens ?? 0;
        }
      }
    } else if (client.provider === "anthropic" && client._anthropic) {
      const systemText = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const nonSystem = messages.filter((m) => m.role !== "system");
      const thinkingBudget = config.llm.thinkingBudget ?? 0;

      const stream = await client._anthropic.messages.create({
        model,
        ...(systemText ? { system: systemText } : {}),
        messages: nonSystem.map((m) => ({ role: m.role, content: m.content })),
        ...(thinkingBudget > 0
          ? { thinking: { type: "enabled", budget_tokens: thinkingBudget } }
          : { temperature: config.llm.temperature ?? 0.7 }),
        max_tokens: maxTokens,
        stream: true,
      });
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          chunks.push(event.delta.text);
          send({ token: event.delta.text, done: false });
        }
        if (event.type === "message_start") {
          inputTokens = event.message.usage?.input_tokens ?? 0;
        }
        if (event.type === "message_delta") {
          outputTokens = event.usage?.output_tokens ?? 0;
        }
      }
    } else if (client._openai) {
      // OpenAI Chat API (default)
      const stream = await client._openai.chat.completions.create({
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: config.llm.temperature ?? 0.7,
        max_tokens: maxTokens,
        stream: true,
      });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          chunks.push(delta);
          send({ token: delta, done: false });
        }
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? 0;
          outputTokens = chunk.usage.completion_tokens ?? 0;
        }
      }
    } else {
      throw new Error("No LLM client available for streaming");
    }

    const fullText = chunks.join("");
    send({
      done: true,
      fullText,
      usage: { promptTokens: inputTokens, completionTokens: outputTokens, totalTokens: inputTokens + outputTokens },
      model,
    });
    appendLLMLog({
      model, provider: client.provider, type: "chat-stream",
      inputTokens, outputTokens, durationMs: Date.now() - startMs, status: "success",
    }).catch(() => {});
  } catch (err) {
    const partial = chunks.join("");
    send({ done: true, error: String(err.message ?? err), fullText: partial, model });
    appendLLMLog({
      model, provider: client.provider, type: "chat-stream",
      inputTokens, outputTokens, durationMs: Date.now() - startMs, status: "error", error: String(err.message ?? err),
    }).catch(() => {});
  }

  res.end();
}

async function loadProjectConfig() {
  await applyEnvFile(globalEnvPath, false);
  await applyEnvFile(path.join(projectRoot, ".env"), true);

  const raw = await readFile(path.join(projectRoot, "inkos.json"), "utf-8");
  const config = JSON.parse(raw);
  const llm = config.llm ?? {};
  const env = process.env;

  if (env.INKOS_LLM_PROVIDER) llm.provider = env.INKOS_LLM_PROVIDER;
  if (env.INKOS_LLM_BASE_URL) llm.baseUrl = env.INKOS_LLM_BASE_URL;
  if (env.INKOS_LLM_MODEL) llm.model = env.INKOS_LLM_MODEL;
  if (env.INKOS_LLM_TEMPERATURE) llm.temperature = Number.parseFloat(env.INKOS_LLM_TEMPERATURE);
  if (env.INKOS_LLM_MAX_TOKENS) llm.maxTokens = Number.parseInt(env.INKOS_LLM_MAX_TOKENS, 10);
  if (env.INKOS_LLM_THINKING_BUDGET) llm.thinkingBudget = Number.parseInt(env.INKOS_LLM_THINKING_BUDGET, 10);
  if (env.INKOS_LLM_API_FORMAT) llm.apiFormat = env.INKOS_LLM_API_FORMAT;
  llm.apiKey = env.INKOS_LLM_API_KEY ?? "";
  config.llm = llm;
  return config;
}

async function applyEnvFile(filePath, override) {
  try {
    const content = await readFile(filePath, "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;

      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (override || process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // Ignore missing env files.
  }
}

async function buildArchitect(bookId) {
  const { ArchitectAgent, createLLMClient, StateManager } = await getCoreModule();
  const config = await loadProjectConfig();
  const client = createLLMClient(config.llm);
  const state = new StateManager(projectRoot);

  return {
    architect: new ArchitectAgent({
      client,
      model: config.llm.model,
      projectRoot,
      bookId,
    }),
    state,
  };
}

function normalizeBookId(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30) || "preview-book";
}

async function readVolumeOutline(bookId) {
  const outlinePath = resolveBookPath(bookId, "story", "volume_outline.md");
  if (!outlinePath) {
    throw new Error("Invalid bookId");
  }
  const content = await readFile(outlinePath, "utf-8");
  return { content, path: outlinePath };
}

async function readChapterFile(bookId, fileName) {
  if (!isSafeFileName(fileName)) {
    throw new Error("Invalid file name");
  }
  const chapterPath = resolveBookPath(bookId, "chapters", fileName);
  if (!chapterPath) {
    throw new Error("Invalid bookId");
  }
  const content = await readFile(chapterPath, "utf-8");
  return { content, path: chapterPath };
}

async function writeChapterFile(bookId, fileName, content) {
  if (!isSafeFileName(fileName)) {
    throw new Error("Invalid file name");
  }
  const chapterPath = resolveBookPath(bookId, "chapters", fileName);
  if (!chapterPath) {
    throw new Error("Invalid bookId");
  }
  await writeFile(chapterPath, content, "utf-8");
  return { path: chapterPath, size: content.length };
}

async function generateOutlineForInput(body) {
  const now = new Date().toISOString();
  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  let externalContext = brief;

  if (body.useProjectBrief) {
    const projectBrief = await loadProjectBrief();
    if (projectBrief.content.trim()) {
      externalContext = brief
        ? `${projectBrief.content.trim()}\n\n## 补充说明\n${brief}`
        : projectBrief.content.trim();
    }
  }

  const book = {
    id: normalizeBookId(body.title ?? body.bookId ?? "preview-book"),
    title: String(body.title ?? "").trim(),
    platform: String(body.platform ?? "tomato"),
    genre: String(body.genre ?? "xuanhuan"),
    status: "outlining",
    targetChapters: Number.parseInt(String(body.targetChapters ?? "200"), 10),
    chapterWordCount: Number.parseInt(String(body.chapterWords ?? "3000"), 10),
    createdAt: now,
    updatedAt: now,
  };

  if (!book.title) {
    throw new Error("title is required");
  }

  const { architect } = await buildArchitect();
  const foundation = await architect.generateFoundation(book, externalContext);
  return {
    book,
    foundation,
  };
}

async function loadTargetContent(body) {
  const targetType = String(body.targetType ?? "outline");
  const currentContent = typeof body.currentContent === "string" ? body.currentContent : "";
  if (currentContent.trim()) {
    return {
      targetType,
      content: currentContent,
      source: "client-buffer",
    };
  }

  if (targetType === "brief") {
    const brief = await loadProjectBrief();
    return {
      targetType,
      content: brief.content,
      source: briefPath,
    };
  }

  if (targetType === "outline") {
    const bookId = String(body.bookId ?? "").trim();
    const outline = await readVolumeOutline(bookId);
    return {
      targetType,
      content: outline.content,
      source: outline.path,
    };
  }

  if (targetType === "chapter") {
    const bookId = String(body.bookId ?? "").trim();
    const file = String(body.file ?? "").trim();
    const chapter = await readChapterFile(bookId, file);
    return {
      targetType,
      content: chapter.content,
      source: chapter.path,
    };
  }

  throw new Error(`Unsupported targetType: ${targetType}`);
}

function buildChatSystemPrompt(targetType) {
  const label = targetType === "brief"
    ? "全书简报"
    : targetType === "outline"
      ? "卷纲"
      : "章节正文";

  return `你是一个高水平的中文小说策划与编辑搭子。你正在和作者一起通过聊天逐步完善${label}。

工作原则：
1. 先准确理解作者这轮要求，再在现有文本基础上迭代，不要擅自重开设定。
2. 保留已有优点：世界观、角色关系、已埋伏笔、文风方向。
3. 输出必须可直接落地，避免空泛建议。
4. 如果作者要求的是局部修改，也要返回一份“已经整合修改后的完整文本”。
5. 如果发现当前文本有明显矛盾、节奏问题、信息缺口，可以在回复里温和指出，但仍然要给出可执行版本。

请严格按以下格式输出：
=== REPLY ===
先用聊天口吻回应作者，说明你本轮做了什么、为什么这么改。

=== UPDATED_TEXT ===
给出整合本轮修改后的完整文本。

注意：
- UPDATED_TEXT 必须是完整可用文本，不要只给片段。
- 保持 Markdown 结构。
- 如果目标是章节正文，尽量保留原章节标题格式。`;
}

function parseChatSections(content, fallbackText) {
  const extract = (name) => {
    const regex = new RegExp(`=== ${name} ===\\s*([\\s\\S]*?)(?==== [A-Z_]+ ===|$)`);
    return content.match(regex)?.[1]?.trim() ?? "";
  };

  const reply = extract("REPLY") || content.trim();
  const updatedText = extract("UPDATED_TEXT") || fallbackText;
  return { reply, updatedText };
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/meta" && req.method === "GET") {
    const config = await loadProjectConfig();
    return sendJson(res, 200, {
      projectRoot,
      cliPath,
      briefPath,
      llm: {
        provider: config.llm.provider,
        baseUrl: config.llm.baseUrl,
        model: config.llm.model,
        apiFormat: config.llm.apiFormat ?? "chat",
        temperature: config.llm.temperature,
        maxTokens: config.llm.maxTokens,
        thinkingBudget: config.llm.thinkingBudget,
        reasoningEffort: config.llm.reasoningEffort,
        stream: config.llm.stream,
        disableResponseStorage: config.llm.disableResponseStorage,
      },
      proxy: proxyEnv,
    });
  }

  if (url.pathname === "/api/brief" && req.method === "GET") {
    const brief = await loadProjectBrief();
    return sendJson(res, 200, { ok: true, ...brief, path: briefPath });
  }

  if (url.pathname === "/api/brief" && req.method === "PUT") {
    const body = await readBody(req);
    const content = String(body.content ?? "");
    await writeFile(briefPath, content, "utf-8");
    return sendJson(res, 200, {
      ok: true,
      path: briefPath,
      size: content.length,
    });
  }

  if (url.pathname === "/api/outline" && req.method === "GET") {
    const bookId = url.searchParams.get("bookId");
    if (!bookId) return sendJson(res, 400, { ok: false, error: "bookId is required" });

    try {
      const outline = await readVolumeOutline(bookId);
      return sendJson(res, 200, { ok: true, ...outline });
    } catch (error) {
      return sendJson(res, 404, { ok: false, error: String(error) });
    }
  }

  if (url.pathname === "/api/outline" && req.method === "PUT") {
    const bookId = url.searchParams.get("bookId");
    if (!bookId) return sendJson(res, 400, { ok: false, error: "bookId is required" });

    const outlinePath = resolveBookPath(bookId, "story", "volume_outline.md");
    if (!outlinePath) return sendJson(res, 400, { ok: false, error: "Invalid bookId" });

    const body = await readBody(req);
    const content = String(body.content ?? "");
    await writeFile(outlinePath, content, "utf-8");
    return sendJson(res, 200, { ok: true, path: outlinePath, size: content.length });
  }

  if (url.pathname === "/api/outline-preview" && req.method === "POST") {
    const body = await readBody(req);
    const result = await generateOutlineForInput(body);
    return sendJson(res, 200, {
      ok: true,
      book: result.book,
      outline: result.foundation.volumeOutline,
      storyBible: result.foundation.storyBible,
      bookRules: result.foundation.bookRules,
    });
  }

  if (url.pathname === "/api/outline-regenerate" && req.method === "POST") {
    const body = await readBody(req);
    const bookId = String(body.bookId ?? "").trim();
    if (!bookId) return sendJson(res, 400, { ok: false, error: "bookId is required" });

    const { state } = await buildArchitect(bookId);
    const book = await state.loadBookConfig(bookId);
    const brief = typeof body.brief === "string" ? body.brief.trim() : "";
    let externalContext = brief;

    if (body.useProjectBrief) {
      const projectBrief = await loadProjectBrief();
      if (projectBrief.content.trim()) {
        externalContext = brief
          ? `${projectBrief.content.trim()}\n\n## 补充说明\n${brief}`
          : projectBrief.content.trim();
      }
    }

    const { architect } = await buildArchitect(bookId);
    const foundation = await architect.generateFoundation(book, externalContext);

    if (body.save !== false) {
      const outlinePath = resolveBookPath(bookId, "story", "volume_outline.md");
      if (!outlinePath) return sendJson(res, 400, { ok: false, error: "Invalid bookId" });
      await writeFile(outlinePath, foundation.volumeOutline, "utf-8");
    }

    return sendJson(res, 200, {
      ok: true,
      book,
      outline: foundation.volumeOutline,
      storyBible: foundation.storyBible,
      bookRules: foundation.bookRules,
    });
  }

  if (url.pathname === "/api/doctor" && req.method === "GET") {
    const result = await runInkOS(["doctor"]);
    return sendJson(res, 200, { ok: result.code === 0, ...result });
  }

  if (url.pathname === "/api/books" && req.method === "GET") {
    const result = await runInkOS(["book", "list", "--json"]);
    return sendJson(res, 200, buildCommandResponse(result));
  }

  if (url.pathname === "/api/book-stats" && req.method === "GET") {
    try {
      const booksDir = path.join(projectRoot, "books");
      const entries = existsSync(booksDir) ? await readdir(booksDir) : [];
      const stats = [];
      for (const bookId of entries) {
        if (!isSafeBookId(bookId)) continue;
        const bookDir = path.join(booksDir, bookId);
        const bookStat = await stat(bookDir).catch(() => null);
        if (!bookStat || !bookStat.isDirectory()) continue;

        let title = bookId, genre = "other", status = "active", targetChapters = 200;
        const bookJsonPath = path.join(bookDir, "book.json");
        try {
          const raw = await readFile(bookJsonPath, "utf-8");
          const cfg = JSON.parse(raw);
          title = cfg.title || bookId;
          genre = cfg.genre || "other";
          status = cfg.status || "active";
          targetChapters = cfg.targetChapters || 200;
        } catch {}

        let chapterCount = 0, totalWords = 0;
        const indexPath = path.join(bookDir, "index.json");
        try {
          const raw = await readFile(indexPath, "utf-8");
          const idx = JSON.parse(raw);
          const chapters = Array.isArray(idx) ? idx : (idx.chapters ?? []);
          chapterCount = chapters.length;
          totalWords = chapters.reduce((sum, ch) => sum + (ch.wordCount || 0), 0);
        } catch {}

        if (totalWords === 0) {
          const chapDir = path.join(bookDir, "chapters");
          try {
            const files = await readdir(chapDir);
            const mdFiles = files.filter(f => f.endsWith(".md"));
            if (chapterCount === 0) chapterCount = mdFiles.length;
            for (const f of mdFiles) {
              const content = await readFile(path.join(chapDir, f), "utf-8");
              totalWords += content.length;
            }
          } catch {}
        }

        stats.push({ id: bookId, title, genre, status, totalWords, chapterCount, targetChapters });
      }
      return sendJson(res, 200, { ok: true, data: stats });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  if (url.pathname === "/api/status" && req.method === "GET") {
    const bookId = url.searchParams.get("bookId");
    const args = ["status", ...(bookId ? [bookId] : []), "--json"];
    const result = await runInkOS(args);
    return sendJson(res, 200, buildCommandResponse(result));
  }

  if (url.pathname === "/api/chapters" && req.method === "GET") {
    const bookId = url.searchParams.get("bookId");
    if (!bookId) return sendJson(res, 400, { ok: false, error: "bookId is required" });

    const indexPath = resolveBookPath(bookId, "chapters", "index.json");
    if (!indexPath) return sendJson(res, 400, { ok: false, error: "Invalid bookId" });

    try {
      const raw = await readFile(indexPath, "utf-8");
      const data = tryParseJson(raw);
      if (!data) return sendJson(res, 500, { ok: false, error: "Invalid index.json" });
      return sendJson(res, 200, { ok: true, data });
    } catch {
      return sendJson(res, 404, { ok: false, error: "index.json not found" });
    }
  }

  if (url.pathname === "/api/book-files" && req.method === "GET") {
    const bookId = url.searchParams.get("bookId");
    if (!bookId) return sendJson(res, 400, { ok: false, error: "bookId is required" });

    const chaptersDir = resolveBookPath(bookId, "chapters");
    if (!chaptersDir) return sendJson(res, 400, { ok: false, error: "Invalid bookId" });

    try {
      const files = await readdir(chaptersDir);
      const list = files
        .filter((name) => name.toLowerCase().endsWith(".md"))
        .sort((a, b) => a.localeCompare(b, "en"));
      return sendJson(res, 200, { ok: true, files: list });
    } catch {
      return sendJson(res, 404, { ok: false, error: "chapters directory not found" });
    }
  }

  if (url.pathname === "/api/chapter" && req.method === "GET") {
    const bookId = url.searchParams.get("bookId");
    const file = url.searchParams.get("file");
    if (!bookId) return sendJson(res, 400, { ok: false, error: "bookId is required" });
    if (!file) return sendJson(res, 400, { ok: false, error: "file is required" });
    if (!isSafeFileName(file)) return sendJson(res, 400, { ok: false, error: "Invalid file name" });

    const chapterPath = resolveBookPath(bookId, "chapters", file);
    if (!chapterPath) return sendJson(res, 400, { ok: false, error: "Invalid bookId" });

    try {
      const content = await readFile(chapterPath, "utf-8");
      return sendJson(res, 200, { ok: true, file, content });
    } catch {
      return sendJson(res, 404, { ok: false, error: "chapter not found" });
    }
  }

  if (url.pathname === "/api/chapter" && req.method === "PUT") {
    const bookId = url.searchParams.get("bookId");
    const file = url.searchParams.get("file");
    if (!bookId) return sendJson(res, 400, { ok: false, error: "bookId is required" });
    if (!file) return sendJson(res, 400, { ok: false, error: "file is required" });

    try {
      const body = await readBody(req);
      const content = String(body.content ?? "");
      const saved = await writeChapterFile(bookId, file, content);
      return sendJson(res, 200, { ok: true, file, ...saved });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: String(error) });
    }
  }

  // ── Upload & Import API ──

  if (url.pathname === "/api/upload" && req.method === "POST") {
    const tmpDir = path.join(projectRoot, ".inkos-tmp", "uploads");
    await mkdir(tmpDir, { recursive: true });

    const chunks = [];
    let total = 0;
    const MAX_SIZE = 50 * 1024 * 1024;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_SIZE) return sendJson(res, 413, { ok: false, error: "File too large (max 50MB)" });
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const fileId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const ext = ".txt";
    const filePath = path.join(tmpDir, `${fileId}${ext}`);
    await writeFile(filePath, buffer);

    // Preview: detect chapters
    const text = buffer.toString("utf-8");
    const defaultPattern = /第[一二三四五六七八九十百千\d]+章\s*.*/g;
    const matches = [...text.matchAll(defaultPattern)];
    const chapterCount = matches.length;
    const firstTitle = matches[0]?.[0] ?? "(未检测到章节)";

    return sendJson(res, 200, {
      ...createUploadResponse({
        fileId,
        size: buffer.length,
        chapterCount,
        firstTitle,
        totalChars: text.length,
      }),
    });
  }

  if (url.pathname === "/api/import-chapters" && req.method === "POST") {
    const body = await readBody(req);
    const fileId = String(body.fileId ?? "").trim();
    const bookId = String(body.bookId ?? "").trim();
    const pattern = String(body.pattern ?? "第[一二三四五六七八九十百千\\d]+章\\s*.*");

    if (!fileId || !bookId) return sendJson(res, 400, { ok: false, error: "fileId and bookId required" });
    if (!isSafeBookId(bookId)) return sendJson(res, 400, { ok: false, error: "Invalid bookId" });
    if (!isSafeUploadFileId(fileId)) return sendJson(res, 400, { ok: false, error: "Invalid fileId" });

    const uploadPath = path.join(projectRoot, ".inkos-tmp", "uploads", `${fileId}.txt`);
    let text;
    try { text = await readFile(uploadPath, "utf-8"); } catch {
      return sendJson(res, 404, { ok: false, error: "Upload file not found" });
    }

    let regex;
    try {
      regex = buildImportRegex(pattern);
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
    const matches = [...text.matchAll(regex)];
    if (!matches.length) return sendJson(res, 400, { ok: false, error: "No chapters detected" });

    const chaptersDir = resolveBookPath(bookId, "chapters");
    if (!chaptersDir) return sendJson(res, 400, { ok: false, error: "Invalid bookId" });
    await mkdir(chaptersDir, { recursive: true });

    const imported = [];
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      const content = text.slice(start, end).trim();
      const num = String(i + 1).padStart(3, "0");
      const fileName = `${num}.md`;
      await writeFile(path.join(chaptersDir, fileName), content, "utf-8");
      imported.push({ file: fileName, title: matches[i][0].trim(), chars: content.length });
    }

    return sendJson(res, 200, { ok: true, imported: imported.length, chapters: imported });
  }

  // ── Revise API ──

  if (url.pathname === "/api/revise" && req.method === "POST") {
    const body = await readBody(req);
    const content = String(body.content ?? "").trim();
    const mode = String(body.mode ?? "polish");
    if (!content) return sendJson(res, 400, { ok: false, error: "content is required" });

    const MODE_PROMPTS = {
      polish: "请润色以下小说段落，只调整表达使其更流畅优美，不改变情节和设定：",
      rewrite: "请改写以下小说段落，重新组织叙事结构但保留核心情节：",
      rework: "请重写以下小说段落，从场景层面重新构建：",
      "anti-detect": "请改写以下段落，使其更像人类原创写作，降低 AI 检测率，保持内容完整：",
      "spot-fix": "请仅修复以下段落中的明显问题（逻辑矛盾、表达不当、错字），不做额外改动：",
    };
    const prompt = MODE_PROMPTS[mode] || MODE_PROMPTS.polish;

    const messages = [
      { role: "system", content: "你是一个专业的中文小说编辑。请直接输出修改后的完整文本，不要加任何解释。" },
      { role: "user", content: `${prompt}\n\n${content}` },
    ];
    const response = await runStudioChat(messages, { logType: `revise-${mode}` });
    return sendJson(res, 200, { ok: true, content: response.content, mode, usage: response.usage, model: response.model });
  }

  // ── AIGC Detection API ──

  if (url.pathname === "/api/detect" && req.method === "POST") {
    const body = await readBody(req);
    const content = String(body.content ?? "").trim();
    if (!content) return sendJson(res, 400, { ok: false, error: "content is required" });

    const messages = [
      { role: "system", content: `你是一个 AIGC 内容检测专家。请分析以下文本，判断其 AI 生成概率。
输出格式：
- aiProbability: 0-100 的整数
- reasons: 简短理由列表 (3-5条)
- suggestion: 一句话建议
请用 JSON 格式输出。` },
      { role: "user", content: content.slice(0, 4000) },
    ];
    const response = await runStudioChat(messages, { logType: "detect" });
    let parsed;
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { aiProbability: 50, reasons: ["解析失败"], suggestion: response.content };
    } catch {
      parsed = { aiProbability: 50, reasons: ["解析失败"], suggestion: response.content };
    }
    return sendJson(res, 200, { ok: true, ...parsed, usage: response.usage, model: response.model });
  }

  // ── Analytics API ──

  if (url.pathname === "/api/analytics" && req.method === "GET") {
    const bookId = url.searchParams.get("bookId") || "";
    if (!bookId) return sendJson(res, 400, { ok: false, error: "bookId is required" });

    try {
      const bookDir = resolveBookPath(bookId);
      if (!bookDir) throw new Error("Invalid bookId");
      const bookJsonPath = path.join(bookDir, "book.json");
      const bookMeta = JSON.parse(await readFile(bookJsonPath, "utf-8"));

      let chapters = [];
      const indexPath = path.join(bookDir, "index.json");
      try { chapters = JSON.parse(await readFile(indexPath, "utf-8")).chapters ?? []; } catch {}

      const chaptersDir = path.join(bookDir, "chapters");
      let totalWords = 0;
      let chapterWordCounts = [];
      try {
        const files = await readdir(chaptersDir);
        for (const f of files.filter(f => f.endsWith(".md"))) {
          const text = await readFile(path.join(chaptersDir, f), "utf-8");
          const wc = text.length;
          totalWords += wc;
          chapterWordCounts.push({ file: f, words: wc });
        }
      } catch {}

      const approved = chapters.filter(c => c.status === "approved").length;
      const failed = chapters.filter(c => c.status === "audit-failed").length;
      const pending = chapters.length - approved - failed;

      return sendJson(res, 200, {
        ok: true,
        data: {
          bookId, title: bookMeta.title ?? bookId,
          totalChapters: chapters.length, totalWords,
          avgWordsPerChapter: chapters.length ? Math.round(totalWords / chapters.length) : 0,
          auditStats: { approved, failed, pending },
          chapterWordCounts,
          status: bookMeta.status ?? "unknown",
        },
      });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: String(err) });
    }
  }

  // ── Fanqie Proxy API ──

  if (url.pathname.startsWith("/api/fanqie/") && req.method === "GET") {
    const subPath = url.pathname.replace("/api/fanqie", "");
    const qs = url.search || "";
    try {
      const upstream = await fanqieProxy(`/api${subPath}${qs}`);
      const data = await upstream.json();
      return sendJson(res, upstream.status, data);
    } catch (err) {
      return sendJson(res, 502, { ok: false, error: `Fanqie proxy error: ${err.message}` });
    }
  }

  if (url.pathname === "/api/fanqie/download" && req.method === "POST") {
    const body = await readBody(req);
    try {
      const upstream = await fanqieProxy("/api/novels", { method: "POST", body: JSON.stringify(body) });
      const data = await upstream.json();
      return sendJson(res, upstream.status, data);
    } catch (err) {
      return sendJson(res, 502, { ok: false, error: `Fanqie proxy error: ${err.message}` });
    }
  }

  // ── Knowledge Base API ──

  if (url.pathname === "/api/knowledge" && req.method === "GET") {
    const items = await listKnowledge();
    return sendJson(res, 200, { ok: true, data: items });
  }

  if (url.pathname.startsWith("/api/knowledge/") && !url.pathname.includes("/apply") && req.method === "GET") {
    const id = url.pathname.split("/").pop();
    try {
      const item = await getKnowledgeItem(id);
      return sendJson(res, 200, { ok: true, data: item });
    } catch (err) {
      return sendJson(res, 404, { ok: false, error: "Knowledge item not found" });
    }
  }

  if (url.pathname === "/api/knowledge/analyze" && req.method === "POST") {
    const body = await readBody(req);
    const title = String(body.title ?? "").trim();
    const content = String(body.content ?? "").trim();
    if (!title || !content) return sendJson(res, 400, { ok: false, error: "title and content are required" });

    const id = title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "-").replace(/-+/g, "-").slice(0, 30) || `novel-${Date.now()}`;
    const itemDir = path.join(knowledgeDir, id);
    await mkdir(itemDir, { recursive: true });

    // Save meta
    const meta = {
      id, title, author: body.author ?? "", source: body.source ?? "manual",
      analyzedAt: new Date().toISOString(), status: "analyzing",
    };
    await writeFile(path.join(itemDir, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");

    // Run analysis for each dimension (async, non-blocking)
    (async () => {
      const DIMENSION_PROMPTS = {
        style: "分析这本小说的文风特点：叙事风格、句式特点、词汇运用、修辞手法。",
        plot: "分析这本小说的情节手法：节奏控制、冲突设计、转折技巧、悬念布局。",
        character: "分析这本小说的人物塑造：角色设计、对话特点、性格刻画方法。",
        worldview: "分析这本小说的世界观设定：力量体系、世界规则、背景架构。",
        emotion: "分析这本小说的情感设计：读者情绪曲线、共鸣点、情感节奏。",
        meme: "分析这本小说中的流行梗和幽默元素：热梗运用、网文特色用语。",
        structure: "分析这本小说的结构设计：章节编排、开头结尾模式、叙事结构。",
      };
      const sampleContent = content.slice(0, 8000);

      for (const dim of ANALYSIS_DIMENSIONS) {
        try {
          const messages = [
            { role: "system", content: "你是一个专业的网文分析师。请基于提供的小说片段进行深入分析，输出 Markdown 格式。" },
            { role: "user", content: `${DIMENSION_PROMPTS[dim]}\n\n## 小说片段\n\n${sampleContent}` },
          ];
          const response = await runStudioChat(messages, { logType: "knowledge-analyze" });
          await writeFile(path.join(itemDir, `${dim}.md`), response.content, "utf-8");
        } catch (err) {
          await writeFile(path.join(itemDir, `${dim}.md`), `分析失败: ${err.message}`, "utf-8");
        }
      }
      meta.status = "done";
      meta.completedAt = new Date().toISOString();
      await writeFile(path.join(itemDir, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");
    })();

    return sendJson(res, 202, { ok: true, id, message: "Analysis started" });
  }

  if (url.pathname.startsWith("/api/knowledge/") && url.pathname.endsWith("/apply") && req.method === "POST") {
    const parts = url.pathname.split("/");
    const id = parts[parts.length - 2];
    const body = await readBody(req);
    const dimension = body.dimension ?? "style";
    try {
      const dimContent = await readFile(path.join(knowledgeDir, id, `${dimension}.md`), "utf-8");
      return sendJson(res, 200, { ok: true, dimension, content: dimContent });
    } catch {
      return sendJson(res, 404, { ok: false, error: "Dimension not found" });
    }
  }

  if (url.pathname.startsWith("/api/knowledge/") && req.method === "DELETE") {
    const id = url.pathname.split("/").pop();
    try {
      await deleteKnowledge(id);
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 404, { ok: false, error: String(err) });
    }
  }

  // ── Preset API ──

  if (url.pathname === "/api/presets" && req.method === "GET") {
    const presets = await listPresets();
    return sendJson(res, 200, { ok: true, data: presets });
  }

  if (url.pathname === "/api/presets" && req.method === "POST") {
    const body = await readBody(req);
    if (!body.name) return sendJson(res, 400, { ok: false, error: "name is required" });
    const preset = await savePreset({
      name: body.name,
      type: body.type ?? "chat",
      systemPrompt: body.systemPrompt ?? "",
      userPromptTemplate: body.userPromptTemplate ?? "",
      modelConfigId: body.modelConfigId ?? "",
      temperature: body.temperature ?? 0.7,
      maxTokens: body.maxTokens ?? 4096,
      tags: Array.isArray(body.tags) ? body.tags : [],
      useCount: 0,
      isFavorite: false,
    });
    return sendJson(res, 201, { ok: true, data: preset });
  }

  if (url.pathname.startsWith("/api/presets/") && req.method === "PUT") {
    const id = url.pathname.split("/").pop();
    const body = await readBody(req);
    body.id = id;
    const preset = await savePreset(body);
    return sendJson(res, 200, { ok: true, data: preset });
  }

  if (url.pathname.startsWith("/api/presets/") && req.method === "DELETE") {
    const id = url.pathname.split("/").pop();
    try {
      await deletePreset(id);
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      return sendJson(res, 404, { ok: false, error: "Preset not found" });
    }
  }

  // ── LLM Logs API ──

  if (url.pathname === "/api/llm-logs" && req.method === "GET") {
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    const logs = await readLLMLogs(date);
    return sendJson(res, 200, { ok: true, date, data: logs });
  }

  if (url.pathname === "/api/llm-stats" && req.method === "GET") {
    const stats = await getLLMStats();
    return sendJson(res, 200, { ok: true, data: stats });
  }

  if (url.pathname === "/api/chat-refine" && req.method === "POST") {
    const body = await readBody(req);
    const message = String(body.message ?? "").trim();
    if (!message) {
      return sendJson(res, 400, { ok: false, error: "message is required" });
    }

    const target = await loadTargetContent(body);
    const history = Array.isArray(body.history) ? body.history : [];
    const normalizedHistory = history
      .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
      .slice(-12)
      .map((item) => ({ role: item.role, content: item.content.trim() }))
      .filter((item) => item.content.length > 0);

    const targetType = target.targetType;
    const bookId = String(body.bookId ?? "").trim();
    const file = String(body.file ?? "").trim();

    const contextMessage = [
      `目标类型：${targetType}`,
      bookId ? `书籍ID：${bookId}` : "",
      file ? `章节文件：${file}` : "",
      `当前文本来源：${target.source}`,
      "",
      "## 当前文本",
      target.content || "(当前为空)",
    ].filter(Boolean).join("\n");

    const messages = [
      { role: "system", content: buildChatSystemPrompt(targetType) },
      { role: "user", content: contextMessage },
      ...normalizedHistory,
      { role: "user", content: message },
    ];

    const response = await runStudioChat(messages, {
      model: body.model,
      reasoningEffort: body.reasoningEffort,
    });
    const parsed = parseChatSections(response.content, target.content);

    return sendJson(res, 200, {
      ok: true,
      targetType,
      reply: parsed.reply,
      updatedText: parsed.updatedText,
      usage: response.usage,
      model: response.model,
      requestedReasoning: response.requestedReasoning,
      appliedReasoning: response.appliedReasoning,
    });
  }

  if (url.pathname === "/api/chat-stream" && req.method === "POST") {
    const body = await readBody(req);
    const message = String(body.message ?? "").trim();
    if (!message) {
      return sendJson(res, 400, { ok: false, error: "message is required" });
    }

    const target = await loadTargetContent(body);
    const history = Array.isArray(body.history) ? body.history : [];
    const normalizedHistory = history
      .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
      .slice(-12)
      .map((item) => ({ role: item.role, content: item.content.trim() }))
      .filter((item) => item.content.length > 0);

    const targetType = target.targetType;
    const bookId = String(body.bookId ?? "").trim();
    const file = String(body.file ?? "").trim();

    const contextMessage = [
      `目标类型：${targetType}`,
      bookId ? `书籍ID：${bookId}` : "",
      file ? `章节文件：${file}` : "",
      `当前文本来源：${target.source}`,
      "",
      "## 当前文本",
      target.content || "(当前为空)",
    ].filter(Boolean).join("\n");

    const messages = [
      { role: "system", content: buildChatSystemPrompt(targetType) },
      { role: "user", content: contextMessage },
      ...normalizedHistory,
      { role: "user", content: message },
    ];

    return runStudioChatStream(messages, {
      model: body.model,
      reasoningEffort: body.reasoningEffort,
    }, res);
  }

  if (url.pathname === "/api/predict-parallel" && req.method === "POST") {
    const body = await readBody(req);
    const prompt = String(body.prompt ?? "").trim();
    if (!prompt) return sendJson(res, 400, { ok: false, error: "prompt is required" });

    const models = Array.isArray(body.models) ? body.models : [];
    if (!models.length) return sendJson(res, 400, { ok: false, error: "models array is required" });

    const systemPrompt = String(body.systemPrompt ?? "你是一个高水平的中文小说作家。");
    const maxTokens = Number(body.maxTokens) || 4096;

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = (data) => { res.write(`data: ${JSON.stringify(data)}\n\n`); };
    const config = await loadProjectConfig();
    const { createLLMClient } = await getCoreModule();

    const tasks = models.map((modelSpec, idx) => {
      const modelName = typeof modelSpec === "string" ? modelSpec : String(modelSpec.model ?? "");
      if (!modelName) return Promise.resolve();

      return (async () => {
        send({ type: "start", idx, model: modelName });
        const chunks = [];
        try {
          const client = createLLMClient({ ...config.llm, model: modelName });
          const messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ];

          if (client.provider === "anthropic" && client._anthropic) {
            const stream = await client._anthropic.messages.create({
              model: modelName,
              system: systemPrompt,
              messages: [{ role: "user", content: prompt }],
              temperature: config.llm.temperature ?? 0.7,
              max_tokens: maxTokens,
              stream: true,
            });
            for await (const event of stream) {
              if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
                chunks.push(event.delta.text);
                send({ type: "token", idx, model: modelName, token: event.delta.text });
              }
            }
          } else if (client._openai && client.apiFormat === "responses") {
            const stream = await client._openai.responses.create({
              model: modelName,
              input: messages.map((m) => ({ role: m.role, content: m.content })),
              max_output_tokens: maxTokens,
              stream: true,
            });
            for await (const event of stream) {
              if (event.type === "response.output_text.delta") {
                chunks.push(event.delta);
                send({ type: "token", idx, model: modelName, token: event.delta });
              }
            }
          } else if (client._openai) {
            const stream = await client._openai.chat.completions.create({
              model: modelName,
              messages: messages.map((m) => ({ role: m.role, content: m.content })),
              temperature: config.llm.temperature ?? 0.7,
              max_tokens: maxTokens,
              stream: true,
            });
            for await (const chunk of stream) {
              const delta = chunk.choices[0]?.delta?.content;
              if (delta) {
                chunks.push(delta);
                send({ type: "token", idx, model: modelName, token: delta });
              }
            }
          }

          const fullText = chunks.join("");
          send({ type: "done", idx, model: modelName, fullText });
        } catch (err) {
          send({ type: "error", idx, model: modelName, error: String(err.message ?? err), partial: chunks.join("") });
        }
      })();
    });

    await Promise.allSettled(tasks);
    send({ type: "all-done" });
    return res.end();
  }

  if (url.pathname === "/api/book" && req.method === "POST") {
    const body = await readBody(req);
    const title = String(body.title ?? "").trim();
    if (!title) return sendJson(res, 400, { ok: false, error: "title is required" });

    const genre = String(body.genre ?? "xuanhuan");
    const platform = String(body.platform ?? "tomato");
    const targetChapters = String(body.targetChapters ?? "200");
    const chapterWords = String(body.chapterWords ?? "3000");

    const args = [
      "book",
      "create",
      "--title",
      title,
      "--genre",
      genre,
      "--platform",
      platform,
      "--target-chapters",
      targetChapters,
      "--chapter-words",
      chapterWords,
      "--json",
    ];

    let briefFile = "";
    const useProjectBrief = Boolean(body.useProjectBrief);
    if (useProjectBrief) {
      const projectBrief = await loadProjectBrief();
      if (projectBrief.exists && projectBrief.content.trim()) {
        briefFile = briefPath;
      }
    }

    const brief = typeof body.brief === "string" ? body.brief.trim() : "";
    if (!briefFile && brief) {
      const tmpDir = path.join(projectRoot, ".inkos-tmp");
      await mkdir(tmpDir, { recursive: true });
      briefFile = path.join(tmpDir, `brief-${Date.now()}-${randomUUID()}.md`);
      await writeFile(briefFile, brief, "utf-8");
    }

    if (briefFile) {
      args.push("--brief", briefFile);
    }

    const wantSSE = (req.headers.accept ?? "").includes("text/event-stream");

    // SSE path: stream progress from CLI stderr to the client
    let sendEvent, extractStage;
    if (wantSSE) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      extractStage = (text) => {
        const stages = extractProgressStages(text);
        if (stages.length) {
          for (const stage of stages) sendEvent("progress", { stage });
        } else {
          const trimmed = text.trim();
          if (trimmed) sendEvent("log", { text: trimmed });
        }
      };
    }

    const createResult = await runInkOS(args, wantSSE ? { onStderr: extractStage } : {});
    const createResponse = buildCommandResponse(createResult);
    if (!createResponse.ok) {
      if (wantSSE) { sendEvent("done", createResponse); return res.end(); }
      return sendJson(res, 200, createResponse);
    }

    const writeFirstChapter = Boolean(body.writeFirstChapter);
    if (!writeFirstChapter) {
      if (wantSSE) { sendEvent("done", createResponse); return res.end(); }
      return sendJson(res, 200, createResponse);
    }

    const bookId = createResponse.data?.bookId;
    if (!bookId) {
      const errResp = { ok: false, error: "Book created but no bookId was returned.", create: createResponse };
      if (wantSSE) { sendEvent("done", errResp); return res.end(); }
      return sendJson(res, 200, errResp);
    }

    if (wantSSE) sendEvent("progress", { stage: "书籍创建完成，开始写第 1 章..." });

    const writeArgs = ["write", "next", bookId, "--count", "1", "--json"];
    const firstChapterWords = String(body.firstChapterWords ?? "").trim();
    const firstChapterContext = String(body.firstChapterContext ?? "").trim();
    if (firstChapterWords) {
      writeArgs.push("--words", firstChapterWords);
    }
    if (firstChapterContext) {
      writeArgs.push("--context", firstChapterContext);
    }

    const writeResult = await runInkOS(writeArgs, wantSSE ? { onStderr: extractStage } : {});
    const writeResponse = buildCommandResponse(writeResult);
    const finalResp = {
      ok: writeResponse.ok,
      data: { ...createResponse.data, firstChapter: writeResponse.data },
      create: createResponse,
      write: writeResponse,
    };
    if (wantSSE) { sendEvent("done", finalResp); return res.end(); }
    return sendJson(res, 200, finalResp);
  }

  if (url.pathname === "/api/write-next" && req.method === "POST") {
    const body = await readBody(req);
    const bookId = String(body.bookId ?? "").trim();
    const count = String(body.count ?? "1");
    const args = ["write", "next", ...(bookId ? [bookId] : []), "--count", count, "--json"];

    if (body.words) args.push("--words", String(body.words));
    if (body.context) args.push("--context", String(body.context));

    const wantSSE = (req.headers.accept ?? "").includes("text/event-stream");
    if (!wantSSE) {
      const result = await runInkOS(args);
      return sendJson(res, 200, buildCommandResponse(result));
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sendEvent = (event, data) => {
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
    };

    const result = await runInkOS(args, {
      onStderr(text) {
        const stages = extractProgressStages(text);
        if (stages.length) {
          for (const stage of stages) sendEvent("progress", { stage });
        } else {
          const trimmed = text.trim();
          if (trimmed) sendEvent("log", { text: trimmed });
        }
      },
      onStdout(text) {
        sendEvent("content", { text });
      },
    });
    sendEvent("done", buildCommandResponse(result));
    res.end();
    return;
  }

  if (url.pathname === "/api/export" && req.method === "POST") {
    const body = await readBody(req);
    const bookId = String(body.bookId ?? "").trim();
    const format = String(body.format ?? "txt");
    const output = body.output ? String(body.output) : "";
    const approvedOnly = Boolean(body.approvedOnly);

    const args = ["export", ...(bookId ? [bookId] : []), "--format", format, "--json"];
    if (output) args.push("--output", output);
    if (approvedOnly) args.push("--approved-only");

    const result = await runInkOS(args);
    return sendJson(res, 200, buildCommandResponse(result));
  }

  // --- story-file: read/write truth files and story files ---
  if (url.pathname === "/api/story-file" && req.method === "GET") {
    const bookId = url.searchParams.get("bookId") ?? "";
    const file = url.searchParams.get("file") ?? "";
    if (!ALLOWED_STORY_FILES.has(file)) {
      return sendJson(res, 400, { ok: false, error: "File not allowed" });
    }
    const filePath = resolveBookPath(bookId, "story", file);
    if (!filePath) return sendJson(res, 400, { ok: false, error: "Invalid bookId" });
    try {
      const content = await readFile(filePath, "utf-8");
      return sendJson(res, 200, { ok: true, content, path: filePath });
    } catch {
      return sendJson(res, 404, { ok: false, error: "File not found" });
    }
  }

  if (url.pathname === "/api/story-file" && req.method === "PUT") {
    const body = await readBody(req);
    const bookId = url.searchParams.get("bookId") ?? "";
    const file = url.searchParams.get("file") ?? "";
    if (!ALLOWED_STORY_FILES.has(file)) {
      return sendJson(res, 400, { ok: false, error: "File not allowed" });
    }
    const filePath = resolveBookPath(bookId, "story", file);
    if (!filePath) return sendJson(res, 400, { ok: false, error: "Invalid bookId" });
    const content = String(body.content ?? "");
    await writeFile(filePath, content, "utf-8");
    return sendJson(res, 200, { ok: true, path: filePath, size: content.length });
  }

  // --- book-config: read book.json ---
  if (url.pathname === "/api/book-config" && req.method === "GET") {
    const bookId = url.searchParams.get("bookId") ?? "";
    const configPath = resolveBookPath(bookId, "book.json");
    if (!configPath) return sendJson(res, 400, { ok: false, error: "Invalid bookId" });
    try {
      const raw = await readFile(configPath, "utf-8");
      return sendJson(res, 200, { ok: true, config: JSON.parse(raw) });
    } catch {
      return sendJson(res, 404, { ok: false, error: "book.json not found" });
    }
  }

  // --- settings: read LLM config ---
  if (url.pathname === "/api/settings" && req.method === "GET") {
    const configPath = path.join(projectRoot, "inkos.json");
    try {
      const config = JSON.parse(await readFile(configPath, "utf-8"));
      const envPath = path.join(projectRoot, ".env");
      let hasApiKey = false;
      try {
        const env = await readFile(envPath, "utf-8");
        hasApiKey = env.includes("INKOS_LLM_API_KEY=");
      } catch {}
      return sendJson(res, 200, {
        ok: true,
        llm: config.llm ?? {},
        hasApiKey,
        language: config.language,
      });
    } catch {
      return sendJson(res, 200, { ok: true, llm: {}, hasApiKey: false });
    }
  }

  // --- settings: save LLM config ---
  if (url.pathname === "/api/settings" && req.method === "PUT") {
    const body = await readBody(req);
    const configPath = path.join(projectRoot, "inkos.json");
    let config;
    try {
      config = JSON.parse(await readFile(configPath, "utf-8"));
    } catch {
      config = { name: "inkos", version: "0.1.0", llm: {} };
    }
    const llm = config.llm ?? {};
    if (body.provider !== undefined) llm.provider = body.provider;
    if (body.baseUrl !== undefined) llm.baseUrl = body.baseUrl;
    if (body.model !== undefined) llm.model = body.model;
    if (body.temperature !== undefined) llm.temperature = Number(body.temperature);
    if (body.maxTokens !== undefined) llm.maxTokens = Number(body.maxTokens);
    if (body.apiFormat !== undefined) llm.apiFormat = body.apiFormat;
    if (body.thinkingBudget !== undefined) llm.thinkingBudget = Number(body.thinkingBudget);
    if (body.reasoningEffort !== undefined) llm.reasoningEffort = body.reasoningEffort;
    if (body.stream !== undefined) llm.stream = Boolean(body.stream);
    if (body.disableResponseStorage !== undefined) llm.disableResponseStorage = Boolean(body.disableResponseStorage);
    config.llm = llm;
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");

    // Also persist API key to .env if provided
    if (body.apiKey) {
      const envPath = path.join(projectRoot, ".env");
      let envContent = "";
      try { envContent = await readFile(envPath, "utf-8"); } catch {}
      const lines = envContent.split(/\r?\n/).filter((l) => !l.startsWith("INKOS_LLM_API_KEY="));
      lines.push(`INKOS_LLM_API_KEY="${body.apiKey}"`);
      await writeFile(envPath, lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n", "utf-8");
    }
    return sendJson(res, 200, { ok: true });
  }

  // ── Model Overrides (per-agent routing) ──

  if (url.pathname === "/api/model-overrides" && req.method === "GET") {
    const overridesPath = path.join(projectRoot, ".inkos", "model-overrides.json");
    try {
      const raw = await readFile(overridesPath, "utf-8");
      return sendJson(res, 200, { ok: true, data: JSON.parse(raw) });
    } catch {
      return sendJson(res, 200, { ok: true, data: {} });
    }
  }

  if (url.pathname === "/api/model-overrides" && req.method === "PUT") {
    const body = await readBody(req);
    const overridesDir = path.join(projectRoot, ".inkos");
    await mkdir(overridesDir, { recursive: true });
    await writeFile(path.join(overridesDir, "model-overrides.json"), JSON.stringify(body, null, 2), "utf-8");
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { ok: false, error: "Not found" });
}

async function serveStatic(req, res, url) {
  let filePath = path.join(publicDir, url.pathname);
  if (url.pathname === "/") {
    filePath = path.join(publicDir, "index.html");
  }

  if (!filePath.startsWith(publicDir)) {
    return sendText(res, 403, "Forbidden");
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
    const content = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentTypeFor(filePath),
      "Cache-Control": "no-store",
    });
    res.end(content);
  } catch {
    const fallback = path.join(publicDir, "index.html");
    try {
      const content = await readFile(fallback);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(content);
    } catch {
      sendText(res, 404, "Not found");
    }
  }
}

function openBrowser(url) {
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
      return;
    }
    if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
      return;
    }
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // ignore
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname.startsWith("/api/")) {
    try {
      await handleApi(req, res, url);
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, error: String(error) });
      } else {
        // SSE or streaming response already started — best effort close
        try { res.end(); } catch {}
      }
    }
    return;
  }

  await serveStatic(req, res, url);
});

server.on("error", (error) => {
  // eslint-disable-next-line no-console
  console.error(`InkOS Studio failed to start: ${String(error)}`);
  if (String(error).includes("EADDRINUSE")) {
    // eslint-disable-next-line no-console
    console.error(`Port ${port} is already in use. Try set PORT=8799 (or another port).`);
  }
});

async function startServer() {
  await ensureRuntimeDirs({
    projectRoot,
    homeDir: os.homedir(),
    mkdirFn: mkdir,
    pathModule: path,
  });

  server.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(`InkOS Studio running at http://${host}:${port}`);
    // eslint-disable-next-line no-console
    console.log(`Project root: ${projectRoot}`);

    const autoOpenEnv = process.env.INKOS_AUTO_OPEN;
    const shouldOpen = autoOpenEnv ? autoOpenEnv !== "0" : Boolean(process.pkg);
    if (shouldOpen) {
      openBrowser(`http://${host}:${port}`);
    }
  });
}

startServer().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(`InkOS Studio failed to initialize: ${String(error)}`);
  process.exitCode = 1;
});
