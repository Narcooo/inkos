import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { gzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import {
  StateManager,
  PipelineRunner,
  createLLMClient,
  createLogger,
  createInteractionToolsFromDeps,
  computeAnalytics,
  loadProjectConfig,
  loadProjectSession,
  processProjectInteractionRequest,
  resolveSessionActiveBook,
  listBookSessions,
  loadBookSession,
  appendManualSessionMessages,
  createAndPersistBookSession,
  renameBookSession,
  deleteBookSession,
  migrateBookSession,
  SessionAlreadyMigratedError,
  abortAgentSession,
  runAgentSession,
  resolveServicePreset,
  resolveServiceProviderFamily,
  resolveServiceModelsBaseUrl,
  guessServiceFromBaseUrl,
  resolveServiceModel,
  loadSecrets,
  saveSecrets,
  listModelsForService,
  isApiKeyOptionalForEndpoint,
  getAllEndpoints,
  probeModelsFromUpstream,
  fetchWithProxy,
  chatCompletion,
  buildExportArtifact,
  evaluateBookQuality,
  ConsolidatorAgent,
  DetectionConfigSchema,
  ResearchSearchConfigSchema,
  InputGovernanceModeSchema,
  GLOBAL_ENV_PATH,
  COVER_PROVIDER_PRESETS,
  createPlayDB,
  PlayStore,
  buildPlayEntityImagePrompt,
  buildPlaySceneImagePrompt,
  generatePlayImage,
  readPlayImageManifest,
  readPlayImageSettings,
  writePlayImageSettings,
  type PlayImageSettings,
  Scheduler,
  coverSecretKey,
  normalizeCoverBaseUrl,
  resolveCoverProviderPreset,
  SessionKindSchema,
  isExplicitWriteChapterCommand,
  isUsablePlayInitialScene,
  isWriteNextInstruction,
  normalizeActionSource as normalizeCoreActionSource,
  normalizeActionPayload as normalizeCoreActionPayload,
  normalizePlayMode as normalizeCorePlayMode,
  normalizeRequestedIntent as normalizeCoreRequestedIntent,
  normalizeSkillIdList as normalizeCoreSkillIdList,
  inferLanguage,
  createSkillRegistry,
  loadConfiguredAgentSkills,
  parseAgentSkillDocument,
  getBuiltinPrompt,
  listBuiltinPromptPacks,
  listBuiltinPrompts,
  loadPromptPackPrompt,
  promptOverridePath,
  toPosixPath,
  type ActionPayload,
  type ActionSource,
  type AgentSkill,
  type BuiltinPrompt,
  createGenerateCoverTool,
  createInteractiveFilmCreationTool,
  createPlayStartTool,
  createScriptCreationTool,
  createShortFictionRunTool,
  createStoryboardCreationTool,
  createTranslationCreateTool,
  createSubAgentTool,
  createDraftStructureTool,
  createConnectChoiceTool,
  createRemoveNodeTool,
  createLLMTranslationModel,
  deleteLatestChapter,
  executeEditTransaction,
  listChapterVersions,
  readChapterPlanDocument,
  readChapterUserBrief,
  readChapterVersion,
  saveChapterUserBrief,
  createTranslationProjectFromFile,
  loadTranslationChapter,
  loadTranslationManifest,
  runTranslationProject,
  writeTranslationExport,
  filmLLMDepsFromClient,
  applyGraphDelta,
  loadStoryGraph,
  reviewStoryGraph,
  exportInk,
  buildPlayableHtml,
  analyzeEmotionalArcs,
  analyzePathDistribution,
  generateNodeImage,
  defaultNodeImageDeps,
  type NodeImageDeps,
  type ResolvedModel,
  type PipelineConfig,
  type PlayMode,
  type ProjectConfig,
  type LogSink,
  type LogEntry,
  type RequestedIntent,
  type SessionKind,
  type AgentSessionAttachment,
} from "@actalk/inkos-core";
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isSafeBookId } from "./safety.js";
import { ApiError } from "./errors.js";
import { buildStudioBookConfig } from "./book-create.js";
import {
  deleteStudioTaskSnapshot,
  loadStudioTaskSnapshot,
  saveStudioTaskSnapshot,
  type StudioTaskSnapshot,
} from "./task-store.js";

// -- Studio server language (read per request from the project config's `language`) --

type StudioLanguage = "zh" | "en";

function normalizeStudioLanguage(value: unknown): StudioLanguage {
  return value === "en" ? "en" : "zh";
}

function pick(lang: StudioLanguage, zh: string, en: string): string {
  return lang === "en" ? en : zh;
}

// -- Pipeline stage definitions per agent type --

interface BilingualLabel {
  readonly zh: string;
  readonly en: string;
}

const PIPELINE_STAGES: Record<string, ReadonlyArray<BilingualLabel>> = {
  writer: [
    { zh: "准备章节输入", en: "Prepare chapter input" },
    { zh: "撰写章节草稿", en: "Write chapter draft" },
    { zh: "落盘最终章节", en: "Save final chapter" },
    { zh: "生成最终真相文件", en: "Generate final truth files" },
    { zh: "校验真相文件变更", en: "Validate truth file changes" },
    { zh: "同步记忆索引", en: "Sync memory index" },
    { zh: "更新章节索引与快照", en: "Update chapter index and snapshot" },
  ],
  architect: [
    { zh: "生成基础设定", en: "Generate foundation" },
    { zh: "保存书籍配置", en: "Save book config" },
    { zh: "写入基础设定文件", en: "Write foundation files" },
    { zh: "初始化控制文档", en: "Initialize control documents" },
    { zh: "创建初始快照", en: "Create initial snapshot" },
  ],
  reviser: [
    { zh: "加载修订上下文", en: "Load revision context" },
    { zh: "修订章节", en: "Revise chapter" },
    { zh: "落盘修订结果", en: "Save revision result" },
    { zh: "更新索引与快照", en: "Update index and snapshot" },
  ],
  auditor: [{ zh: "审计章节", en: "Audit chapter" }],
};

function pipelineStages(agent: string, lang: StudioLanguage = "zh"): string[] | undefined {
  return PIPELINE_STAGES[agent]?.map((stage) => pick(lang, stage.zh, stage.en));
}

function attachmentDisposition(fileName: string): string {
  const safeAscii = fileName.replace(/[^A-Za-z0-9._-]+/g, "_") || "download";
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

const AGENT_LABELS: Record<string, BilingualLabel> = {
  architect: { zh: "建书", en: "Book setup" },
  writer: { zh: "写作", en: "Writing" },
  auditor: { zh: "审计", en: "Audit" },
  reviser: { zh: "修订", en: "Revision" },
  exporter: { zh: "导出", en: "Export" },
};
const TOOL_LABELS: Record<string, BilingualLabel> = {
  read: { zh: "读取文件", en: "Read file" },
  edit: { zh: "编辑文件", en: "Edit file" },
  grep: { zh: "搜索", en: "Search" },
  ls: { zh: "列目录", en: "List directory" },
  propose_action: { zh: "确认动作", en: "Confirm action" },
  short_fiction_run: { zh: "短篇生产", en: "Short fiction" },
  script_create: { zh: "剧本创作", en: "Script creation" },
  storyboard_create: { zh: "分镜创作", en: "Storyboard creation" },
  interactive_film_create: { zh: "互动影游", en: "Interactive film" },
  translation_create: { zh: "翻译项目", en: "Translation" },
  generate_cover: { zh: "生成封面", en: "Cover generation" },
  play_edit: { zh: "编辑互动世界", en: "Edit interactive world" },
  play_start: { zh: "启动互动世界", en: "Start interactive world" },
  play_revise: { zh: "重做互动回合", en: "Redo interactive turn" },
  play_step: { zh: "推进互动世界", en: "Advance interactive world" },
  create_narrative_forecast: { zh: "剧情多线推演", en: "Narrative forecast" },
  get_narrative_forecast: { zh: "核验剧情推演", en: "Recheck forecast" },
  select_narrative_branch: { zh: "采用候选分支", en: "Select candidate branch" },
};

function resolveToolLabel(tool: string, agent?: string, lang: StudioLanguage = "zh"): string {
  if (tool === "sub_agent" && agent) {
    const label = AGENT_LABELS[agent];
    return label ? pick(lang, label.zh, label.en) : agent;
  }
  const label = TOOL_LABELS[tool];
  return label ? pick(lang, label.zh, label.en) : tool;
}

function formatTaskElapsed(ms: number, lang: StudioLanguage): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return pick(lang, `${seconds} 秒`, `${seconds}s`);
  return pick(lang, `${minutes} 分 ${seconds} 秒`, `${minutes}m ${seconds}s`);
}

/**
 * 把正在后台运行的生产任务状态渲染成一段系统提示词附录，注入聊天 agent 的上下文。
 * 没有这段信息时，用户在任务运行期间问"在写吗"，agent 会答"没有任务在运行"。
 */
function buildRunningTaskContextBlock(task: StudioTaskSnapshot, lang: StudioLanguage): string {
  const exec = task.execution;
  const elapsed = formatTaskElapsed(Date.now() - exec.startedAt, lang);
  const status = exec.status === "processing"
    ? pick(lang, "处理中", "processing")
    : pick(lang, "运行中", "running");
  const logsTail = (exec.logs ?? []).slice(-3);
  const logsBlock = logsTail.length > 0
    ? `\n${pick(lang, "- 最近日志：", "- Recent logs:")}\n${logsTail.map((line) => `  - ${line}`).join("\n")}`
    : "";
  return pick(
    lang,
    [
      "## 后台任务状态",
      "本会话有一个正在后台运行的生产任务：",
      `- 任务：${exec.label}（${exec.tool}）`,
      `- 状态：${status}`,
      `- 已运行：${elapsed}${logsBlock}`,
      "该任务在后台独立运行，本轮对话不会打断它。用户询问任务进展时，基于以上信息如实回答。不要再次发起同类生产任务，也不要声称没有任务在运行。生产类工具已临时不可用，任务结束后恢复。",
    ].join("\n"),
    [
      "## Background task status",
      "A production task is currently running in the background of this session:",
      `- Task: ${exec.label} (${exec.tool})`,
      `- Status: ${status}`,
      `- Elapsed: ${elapsed}${logsBlock}`,
      "The task runs independently in the background; this chat turn does not interrupt it. When the user asks about its progress, answer truthfully from the information above. Do not start another production task of the same kind, and do not claim that no task is running. Production tools are temporarily unavailable and will be restored when the task finishes.",
    ].join("\n"),
  );
}

function summarizeResult(result: unknown): string {
  if (typeof result === "string") return result.slice(0, 2000);
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.content === "string") return r.content.slice(0, 2000);
    if (typeof r.text === "string") return r.text.slice(0, 2000);
  }
  return String(result).slice(0, 2000);
}

function compareServiceListItems(
  left: { readonly service: string },
  right: { readonly service: string },
): number {
  const priority = ["kkaiapi", "openrouter", "newapi", "siliconcloud"];
  const leftPriority = priority.indexOf(left.service);
  const rightPriority = priority.indexOf(right.service);
  if (leftPriority !== -1 || rightPriority !== -1) {
    return (leftPriority === -1 ? 999 : leftPriority) - (rightPriority === -1 ? 999 : rightPriority);
  }
  return 0;
}

async function buildTarArchive(sourceDir: string, packageRootName: string): Promise<Buffer> {
  const files = await listArchiveFiles(sourceDir);
  const chunks: Buffer[] = [];
  for (const file of files) {
    const payload = await readFile(join(sourceDir, file));
    const archiveName = normalizeArchivePath(join(packageRootName, file));
    chunks.push(createTarHeader(archiveName, payload.byteLength));
    chunks.push(payload);
    const padding = (512 - (payload.byteLength % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

async function listArchiveFiles(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;
    const relativePath = prefix ? join(prefix, entry.name) : entry.name;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listArchiveFiles(fullPath, relativePath));
    } else if (entry.isFile()) {
      files.push(normalizeArchivePath(relativePath));
    } else {
      const info = await stat(fullPath).catch(() => null);
      if (info?.isFile()) files.push(normalizeArchivePath(relativePath));
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function normalizeArchivePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/g, "");
}

function createTarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512, 0);
  writeTarString(header, 0, 100, name);
  writeTarOctal(header, 100, 8, 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, size);
  writeTarOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeTarString(header, 257, 6, "ustar");
  writeTarString(header, 263, 2, "00");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeTarOctal(header, 148, 8, checksum);
  return header;
}

function writeTarString(header: Buffer, offset: number, length: number, value: string): void {
  const encoded = Buffer.from(value);
  if (encoded.byteLength > length) {
    throw new Error(`Archive path is too long for tar header: ${value}`);
  }
  encoded.copy(header, offset);
}

function writeTarOctal(header: Buffer, offset: number, length: number, value: number): void {
  const text = value.toString(8).padStart(length - 1, "0").slice(-(length - 1));
  header.write(text, offset, length - 1, "ascii");
  header[offset + length - 1] = 0;
}

function isHeaderSafeApiKey(value: string): boolean {
  if (!value) return true;
  return /^[\x21-\x7E]+$/.test(value);
}

const NON_TEXT_MODEL_ID_PARTS = [
  "image",
  "embedding",
  "embed",
  "rerank",
  "tts",
  "speech",
  "audio",
  "moderation",
] as const;

const SERVICE_MODELS_PROBE_TIMEOUT_MS = 4_000;
const SERVICE_CHAT_PROBE_TIMEOUT_MS = 8_000;
// Hard ceiling for the whole /doctor connectivity probe (models + chat fallback
// loop) so the diagnostics page never spins on a slow/rate-limited upstream.
const DOCTOR_LLM_PROBE_BUDGET_MS = 9_000;
const MAX_DISCOVERED_MODELS_TO_PING = 2;
const MAX_GENERIC_FALLBACK_MODELS_TO_PING = 2;

function isTextChatModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) return false;
  return !NON_TEXT_MODEL_ID_PARTS.some((part) => normalized.includes(part));
}

function filterTextChatModels<T extends { readonly id: string }>(models: ReadonlyArray<T>): T[] {
  return models.filter((model) => isTextChatModelId(model.id));
}

function normalizeApiBookId(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_BOOK_ID", `${fieldName} must be a string`);
  }
  const bookId = value.trim();
  if (!bookId) {
    throw new ApiError(400, "INVALID_BOOK_ID", `${fieldName} cannot be blank`);
  }
  if (!isSafeBookId(bookId)) {
    throw new ApiError(400, "INVALID_BOOK_ID", `Invalid ${fieldName}: "${bookId}"`);
  }
  return bookId;
}

function nonTextModelMessage(modelId: string, lang: StudioLanguage = "zh"): string {
  return pick(
    lang,
    `模型 ${modelId} 不适合文本聊天/写作。请在模型选择器中改用文本模型，例如 gemini-2.5-flash、gemini-2.5-pro 或对应服务的 chat 模型。`,
    `Model ${modelId} is not suitable for text chat/writing. Pick a text model in the model selector, e.g. gemini-2.5-flash, gemini-2.5-pro, or the service's chat model.`,
  );
}

function extractToolError(result: unknown): string {
  if (typeof result === "string") return result.slice(0, 500);
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.content === "string") return r.content.slice(0, 500);
    if (r.content && Array.isArray(r.content)) {
      const textPart = r.content.find((c: any) => c.type === "text");
      if (textPart) return (textPart as any).text?.slice(0, 500) ?? "";
    }
  }
  return String(result).slice(0, 500);
}

function resolveProjectImageFile(root: string, rawPath: string): { readonly resolved: string; readonly contentType: string } {
  let relPath: string;
  try {
    relPath = decodeURIComponent(rawPath).replace(/^\/+/u, "");
  } catch {
    throw new ApiError(400, "INVALID_PROJECT_FILE_PATH", "Invalid project file path");
  }

  if (
    !relPath
    || relPath.includes("\0")
    || isAbsolute(relPath)
    || relPath.split(/[\\/]+/u).includes("..")
  ) {
    throw new ApiError(400, "INVALID_PROJECT_FILE_PATH", "Invalid project file path");
  }
  if (!relPath.startsWith("shorts/") && !relPath.startsWith("covers/") && !relPath.startsWith("interactive-films/")) {
    throw new ApiError(400, "INVALID_PROJECT_FILE_PATH", "Only generated shorts/, covers/, interactive-films/ images can be previewed");
  }

  const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
  const contentTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };
  const contentType = contentTypes[ext];
  if (!contentType) {
    throw new ApiError(415, "UNSUPPORTED_PROJECT_FILE_TYPE", "Unsupported project file type");
  }

  const resolved = resolve(root, relPath);
  const rel = relative(root, resolved);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new ApiError(400, "INVALID_PROJECT_FILE_PATH", "Invalid project file path");
  }
  return { resolved, contentType };
}

function normalizeProjectGeneratedPath(root: string, rawPath: string, code: string): { readonly relPath: string; readonly resolved: string } {
  let relPath: string;
  try {
    relPath = decodeURIComponent(rawPath).replace(/^\/+/u, "");
  } catch {
    throw new ApiError(400, code, "Invalid project artifact path");
  }

  if (
    !relPath
    || relPath.includes("\0")
    || isAbsolute(relPath)
    || relPath.split(/[\\/]+/u).includes("..")
  ) {
    throw new ApiError(400, code, "Invalid project artifact path");
  }

  const allowedRoots = ["dramas/", "storyboards/", "interactive-films/", "shorts/", "covers/"];
  if (!allowedRoots.some((prefix) => relPath.startsWith(prefix))) {
    throw new ApiError(400, code, "Only generated writing artifacts can be opened");
  }

  const resolved = resolve(root, relPath);
  const rel = relative(root, resolved);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new ApiError(400, code, "Invalid project artifact path");
  }

  return { relPath, resolved };
}

function resolveProjectTextArtifactFile(root: string, rawPath: string): { readonly relPath: string; readonly resolved: string; readonly contentType: string } {
  const file = normalizeProjectGeneratedPath(root, rawPath, "INVALID_PROJECT_ARTIFACT_PATH");
  const ext = file.relPath.split(".").pop()?.toLowerCase() ?? "";
  const contentTypes: Record<string, string> = {
    md: "text/markdown; charset=utf-8",
    markdown: "text/markdown; charset=utf-8",
    txt: "text/plain; charset=utf-8",
    json: "application/json; charset=utf-8",
  };
  const contentType = contentTypes[ext];
  if (!contentType) {
    throw new ApiError(415, "UNSUPPORTED_PROJECT_ARTIFACT_TYPE", "Unsupported project artifact type");
  }
  return { ...file, contentType };
}

function isLikelyFailedToolResult(exec: CollectedToolExec): boolean {
  if (exec.status === "error") return true;
  const text = `${exec.error ?? ""}\n${exec.result ?? ""}`.toLowerCase();
  return /\bfailed\b|\berror\b|失败|异常|出错/.test(text);
}

function hasSuccessfulSubAgentExec(
  execs: ReadonlyArray<CollectedToolExec>,
  agent: string,
): boolean {
  return execs.some((exec) =>
    exec.tool === "sub_agent"
    && exec.agent === agent
    && exec.status === "completed"
    && !isLikelyFailedToolResult(exec)
  );
}

function hasSuccessfulToolExec(
  execs: ReadonlyArray<CollectedToolExec>,
  tool: string,
): boolean {
  return execs.some((exec) =>
    exec.tool === tool
    && exec.status === "completed"
    && !isLikelyFailedToolResult(exec)
  );
}

function hasSuccessfulToolResult(execs: ReadonlyArray<CollectedToolExec>): boolean {
  return execs.some((exec) => exec.status === "completed" && !isLikelyFailedToolResult(exec));
}

function normalizeStudioSessionKind(value: unknown, fallback: SessionKind): SessionKind {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = SessionKindSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, "INVALID_SESSION_KIND", `Invalid sessionKind: ${String(value)}`);
  }
  return parsed.data;
}

function normalizeStudioActionSource(value: unknown): ActionSource {
  try {
    return normalizeCoreActionSource(value);
  } catch {
    throw new ApiError(400, "INVALID_ACTION_SOURCE", `Invalid actionSource: ${String(value)}`);
  }
}

function normalizeStudioRequestedIntent(value: unknown): RequestedIntent | undefined {
  try {
    return normalizeCoreRequestedIntent(value);
  } catch {
    throw new ApiError(400, "INVALID_REQUESTED_INTENT", `Invalid requestedIntent: ${String(value)}`);
  }
}

function normalizeStudioActionPayload(value: unknown): ActionPayload | undefined {
  try {
    return normalizeCoreActionPayload(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ApiError(400, "INVALID_ACTION_PAYLOAD", `Invalid actionPayload: ${message}`);
  }
}

function normalizeStudioSkillIdList(value: unknown, field: string): string[] {
  try {
    return normalizeCoreSkillIdList(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ApiError(400, "INVALID_SKILL_ID", `Invalid ${field}: ${message}`);
  }
}

function normalizeStudioSkillId(value: unknown, field = "skillId"): string {
  const [id] = normalizeStudioSkillIdList([value], field);
  if (!id) throw new ApiError(400, "INVALID_SKILL_ID", `Invalid ${field}: empty`);
  return id;
}

type StudioAgentAttachmentPayload = {
  readonly id?: string;
  readonly filename?: string;
  readonly mediaType?: string;
  readonly size?: number;
  readonly dataUrl?: string;
};

const MAX_AGENT_ATTACHMENTS = 8;
const MAX_AGENT_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_AGENT_ATTACHMENT_TEXT_CHARS = 120_000;
const MAX_TRANSLATION_UPLOAD_BYTES = 80 * 1024 * 1024;
const MAX_SKILL_IMPORT_FILES = 128;
const MAX_SKILL_IMPORT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SKILL_IMPORT_TOTAL_BYTES = 8 * 1024 * 1024;

function safeUploadFileName(value: string): string {
  const trimmed = value.trim().replace(/[/\\\0]/g, "_").replace(/\s+/g, " ");
  const safe = trimmed.replace(/[^\p{L}\p{N}._ -]+/gu, "_").slice(0, 120).trim();
  return safe || "upload";
}

function isTextAttachment(filename: string, mimeType: string): boolean {
  const lower = filename.toLowerCase();
  return mimeType.startsWith("text/")
    || [
      ".txt",
      ".md",
      ".markdown",
      ".json",
      ".csv",
      ".tsv",
      ".yaml",
      ".yml",
      ".log",
    ].some((suffix) => lower.endsWith(suffix));
}

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/s.exec(dataUrl);
  if (!match) {
    throw new ApiError(400, "INVALID_ATTACHMENT_DATA_URL", "Attachment must be a base64 data URL");
  }
  const mimeType = match[1]?.trim() || "application/octet-stream";
  return { mimeType, buffer: Buffer.from(match[2] ?? "", "base64") };
}

async function normalizeAgentAttachments(
  root: string,
  sessionId: string,
  value: unknown,
): Promise<AgentSessionAttachment[]> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ApiError(400, "INVALID_ATTACHMENTS", "attachments must be an array");
  }
  if (value.length > MAX_AGENT_ATTACHMENTS) {
    throw new ApiError(413, "TOO_MANY_ATTACHMENTS", `At most ${MAX_AGENT_ATTACHMENTS} files can be attached to one message`);
  }

  const uploadDir = join(root, ".inkos", "uploads", safeUploadFileName(sessionId));
  const out: AgentSessionAttachment[] = [];
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new ApiError(400, "INVALID_ATTACHMENT", "Each attachment must be an object");
    }
    const payload = raw as StudioAgentAttachmentPayload;
    const filename = safeUploadFileName(payload.filename || `upload-${index + 1}`);
    if (!payload.dataUrl) {
      throw new ApiError(400, "INVALID_ATTACHMENT", `Attachment ${filename} is missing dataUrl`);
    }
    const parsed = parseDataUrl(payload.dataUrl);
    const mimeType = payload.mediaType?.trim() || parsed.mimeType;
    if (parsed.buffer.byteLength > MAX_AGENT_ATTACHMENT_BYTES) {
      throw new ApiError(413, "ATTACHMENT_TOO_LARGE", `${filename} exceeds ${MAX_AGENT_ATTACHMENT_BYTES} bytes`);
    }
    await mkdir(uploadDir, { recursive: true });
    const storedName = `${Date.now()}-${index + 1}-${filename}`;
    const storedPath = join(uploadDir, storedName);
    await writeFile(storedPath, parsed.buffer);
    const relPath = toPosixPath(relative(root, storedPath));

    if (mimeType.startsWith("image/")) {
      out.push({
        id: payload.id || `${Date.now()}-${index}`,
        filename,
        mimeType,
        size: parsed.buffer.byteLength,
        storedPath: relPath,
        image: {
          data: parsed.buffer.toString("base64"),
          mimeType,
        },
      });
      continue;
    }

    if (isTextAttachment(filename, mimeType)) {
      const text = parsed.buffer.toString("utf-8");
      if (text.length > MAX_AGENT_ATTACHMENT_TEXT_CHARS) {
        throw new ApiError(413, "ATTACHMENT_TEXT_TOO_LARGE", `${filename} is too large to inject without semantic compaction`);
      }
      out.push({
        id: payload.id || `${Date.now()}-${index}`,
        filename,
        mimeType,
        size: parsed.buffer.byteLength,
        storedPath: relPath,
        text,
      });
      continue;
    }

    out.push({
      id: payload.id || `${Date.now()}-${index}`,
      filename,
      mimeType,
      size: parsed.buffer.byteLength,
      storedPath: relPath,
    });
  }
  return out;
}

async function storeTranslationUpload(
  root: string,
  payload: { readonly filename?: string; readonly dataUrl?: string },
): Promise<{ readonly storedPath: string; readonly size: number; readonly mimeType: string }> {
  const filename = safeUploadFileName(payload.filename || "translation-source");
  if (!payload.dataUrl) {
    throw new ApiError(400, "INVALID_TRANSLATION_UPLOAD", "Translation upload is missing dataUrl");
  }
  const parsed = parseDataUrl(payload.dataUrl);
  if (parsed.buffer.byteLength > MAX_TRANSLATION_UPLOAD_BYTES) {
    throw new ApiError(413, "TRANSLATION_UPLOAD_TOO_LARGE", `${filename} exceeds ${MAX_TRANSLATION_UPLOAD_BYTES} bytes`);
  }
  const uploadDir = join(root, ".inkos", "uploads", "translation");
  await mkdir(uploadDir, { recursive: true });
  const storedName = `${Date.now()}-${filename}`;
  const storedPath = join(uploadDir, storedName);
  await writeFile(storedPath, parsed.buffer);
  return {
    storedPath: toPosixPath(relative(root, storedPath)),
    size: parsed.buffer.byteLength,
    mimeType: parsed.mimeType,
  };
}

function projectSkillsDir(root: string): string {
  return join(root, ".agents", "skills");
}

function projectSkillDir(root: string, id: string): string {
  return join(projectSkillsDir(root), id);
}

function projectSkillPath(root: string, id: string): string {
  return join(projectSkillDir(root, id), "SKILL.md");
}

function toStudioSkill(skill: AgentSkill, root: string, projectSkillIds: ReadonlySet<string>) {
  const projectPath = projectSkillPath(root, skill.id);
  const isProjectFile = projectSkillIds.has(skill.id);
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    body: skill.body,
    source: isProjectFile ? "project" : skill.source,
    editable: isProjectFile,
    path: isProjectFile ? relative(root, projectPath) : undefined,
  };
}

interface StudioSkillImportFile {
  readonly path: string;
  readonly buffer: Buffer;
}

function normalizeSkillImportPath(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_SKILL_IMPORT_PATH", "Skill import file path must be a string");
  }
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (
    !normalized
    || normalized.startsWith("/")
    || /^[a-zA-Z]:\//.test(normalized)
    || normalized.includes("\0")
  ) {
    throw new ApiError(400, "INVALID_SKILL_IMPORT_PATH", `Unsafe skill import path: ${value}`);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new ApiError(400, "INVALID_SKILL_IMPORT_PATH", `Unsafe skill import path: ${value}`);
  }
  return parts.join("/");
}

function normalizeSkillImportFiles(value: unknown): {
  readonly files: ReadonlyArray<StudioSkillImportFile>;
  readonly manifestPath: string;
} {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApiError(400, "INVALID_SKILL_IMPORT", "Skill import requires at least one file");
  }
  if (value.length > MAX_SKILL_IMPORT_FILES) {
    throw new ApiError(413, "SKILL_IMPORT_TOO_MANY_FILES", `A skill may contain at most ${MAX_SKILL_IMPORT_FILES} files`);
  }

  const files: StudioSkillImportFile[] = [];
  const seenPathKeys = new Set<string>();
  let totalBytes = 0;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ApiError(400, "INVALID_SKILL_IMPORT", "Each skill import entry must be an object");
    }
    const record = item as Record<string, unknown>;
    const path = normalizeSkillImportPath(record.path);
    const pathKey = path.toLowerCase();
    if (seenPathKeys.has(pathKey)) {
      throw new ApiError(400, "INVALID_SKILL_IMPORT", `Duplicate skill import path: ${path}`);
    }
    if (typeof record.dataUrl !== "string") {
      throw new ApiError(400, "INVALID_SKILL_IMPORT", `Missing dataUrl for ${path}`);
    }
    const { buffer } = parseDataUrl(record.dataUrl);
    if (buffer.byteLength > MAX_SKILL_IMPORT_FILE_BYTES) {
      throw new ApiError(413, "SKILL_IMPORT_FILE_TOO_LARGE", `${path} exceeds ${MAX_SKILL_IMPORT_FILE_BYTES} bytes`);
    }
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_SKILL_IMPORT_TOTAL_BYTES) {
      throw new ApiError(413, "SKILL_IMPORT_TOO_LARGE", `Skill folder exceeds ${MAX_SKILL_IMPORT_TOTAL_BYTES} bytes`);
    }
    seenPathKeys.add(pathKey);
    files.push({ path, buffer });
  }

  const manifests = files.filter((file) => file.path === "SKILL.md" || file.path.endsWith("/SKILL.md"));
  if (manifests.length !== 1) {
    throw new ApiError(400, "INVALID_SKILL_IMPORT", "Skill import must contain exactly one SKILL.md");
  }
  const manifestPath = manifests[0]!.path;
  const folder = manifestPath === "SKILL.md"
    ? ""
    : manifestPath.slice(0, -"/SKILL.md".length);
  for (const file of files) {
    if (folder && !file.path.startsWith(`${folder}/`)) {
      throw new ApiError(400, "INVALID_SKILL_IMPORT_PATH", "All imported files must be inside the SKILL.md folder");
    }
  }
  return { files, manifestPath };
}

async function importStudioSkillFolder(
  root: string,
  payload: unknown,
): Promise<AgentSkill> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(400, "INVALID_SKILL_IMPORT", "Skill import payload must be an object");
  }
  const record = payload as Record<string, unknown>;
  const { files, manifestPath } = normalizeSkillImportFiles(record.files);
  const manifest = files.find((file) => file.path === manifestPath)!;
  let parsed: AgentSkill;
  try {
    parsed = parseAgentSkillDocument(manifest.buffer.toString("utf-8"), {
      skillPath: join(root, manifestPath),
      source: "project",
    });
  } catch (error) {
    throw new ApiError(
      400,
      "INVALID_SKILL_MANIFEST",
      error instanceof Error ? error.message : String(error),
    );
  }

  const targetDir = projectSkillDir(root, parsed.id);
  try {
    await access(targetDir);
    throw new ApiError(409, "SKILL_EXISTS", `Project skill already exists: ${parsed.id}`);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  await mkdir(projectSkillsDir(root), { recursive: true });
  const stagingDir = join(projectSkillsDir(root), `.import-${randomUUID()}`);
  const folder = manifestPath === "SKILL.md"
    ? ""
    : manifestPath.slice(0, -"/SKILL.md".length);
  try {
    await mkdir(stagingDir, { recursive: true });
    for (const file of files) {
      const relativePath = folder ? file.path.slice(folder.length + 1) : file.path;
      const destination = join(stagingDir, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.buffer);
    }
    await rename(stagingDir, targetDir);
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
  return { ...parsed, source: "project", baseDir: targetDir };
}

async function loadStudioSkills(root: string) {
  const configured = await loadConfiguredAgentSkills({ projectRoot: root });
  const projectSkillIds = await listProjectSkillIds(root);
  const registry = createSkillRegistry({ skills: configured.skills });
  return {
    skills: registry.listSkills().map((skill) => toStudioSkill(skill, root, projectSkillIds)),
    diagnostics: configured.diagnostics,
  };
}

async function toStudioPromptPackPrompt(root: string, prompt: BuiltinPrompt) {
  const loaded = await loadPromptPackPrompt({ promptId: prompt.id, projectRoot: root });
  const overridePath = promptOverridePath(root, prompt.id);
  return {
    id: prompt.id,
    packId: prompt.packId,
    title: prompt.title,
    defaultContent: prompt.content,
    content: loaded.content,
    source: loaded.source,
    overridden: loaded.source === "project",
    // Windows 上 relative() 产生反斜杠，这个 path 会被前端展示/断言为 posix 相对路径
    path: loaded.source === "project" ? toPosixPath(relative(root, overridePath)) : undefined,
  };
}

function normalizeStudioPromptId(value: unknown): string {
  const promptId = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!promptId || !getBuiltinPrompt(promptId)) {
    throw new ApiError(404, "PROMPT_PACK_PROMPT_NOT_FOUND", `Prompt pack prompt not found: ${String(value)}`);
  }
  return promptId;
}

async function listProjectSkillIds(root: string): Promise<Set<string>> {
  try {
    const entries = await readdir(projectSkillsDir(root), { withFileTypes: true });
    const ids = new Set<string>();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = normalizeStudioSkillId(entry.name, "skillId");
      try {
        const info = await stat(projectSkillPath(root, id));
        if (info.isFile()) ids.add(id);
      } catch {
        // Ignore incomplete project skill directories.
      }
    }
    return ids;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw error;
  }
}

function normalizeStudioPlayMode(value: unknown): PlayMode | undefined {
  try {
    return normalizeCorePlayMode(value);
  } catch {
    throw new ApiError(400, "INVALID_PLAY_MODE", `Invalid playMode: ${String(value)}`);
  }
}

// 判断"这次请求要不要把写下一章当成确认式生产任务执行"。
// 命中的三种来源（显式 write_next intent / free-text 明确写章命令 / 其它来源的
// 写作指令启发式）全部走确认式任务分支：有 taskId、AbortController、磁盘快照，
// 可中止、可在刷新后恢复。没有书或不在书籍会话时交给聊天 agent 处理。
function isWriteNextProductionRequest(args: {
  readonly instruction: string;
  readonly agentBookId: string | null | undefined;
  readonly sessionKind: SessionKind;
  readonly actionSource: ActionSource;
  readonly requestedIntent?: RequestedIntent;
}): boolean {
  if (!args.agentBookId || args.sessionKind !== "book") return false;
  if (args.requestedIntent === "write_next") return true;
  if (args.actionSource === "free-text") return isExplicitWriteChapterCommand(args.instruction);
  return isWriteNextInstruction(args.instruction);
}

type ExternalChatEditResult = {
  readonly responseText: string;
  readonly activeBookId?: string;
};

const CHAT_EDIT_WARNING = "[warning] Chat external edit requires review before continuation.";
const CHAT_EDIT_TEXT_EXTENSIONS = /\.(md|txt|json|ya?ml)$/i;
const CHAT_EDIT_ALLOWED_ROOTS = new Set(["books", "shorts", "covers", "genres"]);

function parseReplacementInstruction(instruction: string): { oldText: string; newText: string } | null {
  const inFileQuoted = instruction.match(/(?:里|里的|中|中的|里面)\s*[「“"]([\s\S]+?)[」”"]\s*(?:改成|替换成|换成)\s*[「“"]([\s\S]+?)[」”"]/);
  if (inFileQuoted?.[1] && inFileQuoted[2] !== undefined) {
    return { oldText: inFileQuoted[1], newText: inFileQuoted[2] };
  }
  const quoted = instruction.match(/(?:把|将)\s*[「“"]([\s\S]+?)[」”"]\s*(?:改成|替换成|换成)\s*[「“"]([\s\S]+?)[」”"]/);
  if (quoted?.[1] && quoted[2] !== undefined) {
    return { oldText: quoted[1], newText: quoted[2] };
  }
  const plain = instruction.match(/(?:把|将)\s+([^\s，。；;]+)\s*(?:改成|替换成|换成)\s+([^\n，。；;]+)/);
  if (plain?.[1] && plain[2] !== undefined) {
    return { oldText: plain[1], newText: plain[2].trim() };
  }
  return null;
}

function isExplicitExternalChatEditInstruction(instruction: string): boolean {
  const trimmed = instruction.trim();
  if (!trimmed) return false;
  if (/[?？]\s*$/.test(trimmed)) return false;
  if (/^(?:请问|能否|能不能|可以|可不可以|是否|是不是|怎么|怎样|为什么|如果|假如|要不要|建议|讨论)\b/u.test(trimmed)) {
    return false;
  }

  const imperative = trimmed.replace(/^(?:请|麻烦|帮我|直接|现在)\s*/u, "");
  return /^(?:第\s*\d{1,4}\s*章\s*)?(?:把|将)\s*/u.test(imperative);
}

function parseChapterNumberForEdit(instruction: string): number | null {
  const match = instruction.match(/第\s*(\d{1,4})\s*章/);
  if (!match?.[1]) return null;
  const chapterNumber = Number.parseInt(match[1], 10);
  return Number.isInteger(chapterNumber) && chapterNumber > 0 ? chapterNumber : null;
}

function parseExplicitEditPath(instruction: string): string | null {
  const match = instruction.match(/(?:把|将)\s+([^「“"\s，。；;]+?\.[A-Za-z0-9]+)\s*(?:里|里的|中|中的|里面)/);
  return match?.[1]?.trim() ?? null;
}

function countContentUnits(content: string): number {
  const stripped = content
    .replace(/^#{1,6}\s+.*$/gm, "")
    .trim();
  if (!stripped) return 0;
  if (/[\u3400-\u9fff]/.test(stripped)) {
    return stripped.replace(/\s/g, "").length;
  }
  return stripped.split(/\s+/).filter(Boolean).length;
}

function resolveExternalChatEditPath(root: string, requestedPath: string): { path: string; rel: string } {
  if (isAbsolute(requestedPath)) {
    throw new ApiError(400, "UNSUPPORTED_CHAT_EDIT_TARGET", "Chat external edits only support project-relative content paths.");
  }
  const projectRoot = resolve(root);
  const resolved = resolve(projectRoot, requestedPath);
  const rel = relative(projectRoot, resolved).replace(/\\/g, "/");
  if (!rel || rel.startsWith("../") || rel === "..") {
    throw new ApiError(400, "UNSUPPORTED_CHAT_EDIT_TARGET", "Chat external edit path escapes the project root.");
  }
  const first = rel.split("/")[0] ?? "";
  if (!CHAT_EDIT_ALLOWED_ROOTS.has(first)) {
    throw new ApiError(400, "UNSUPPORTED_CHAT_EDIT_TARGET", "Chat external edits cannot modify source code, config, or arbitrary project files.");
  }
  if (rel.includes("/.inkos/") || rel.endsWith("/.inkos") || rel.includes("/secrets") || rel.endsWith(".env")) {
    throw new ApiError(400, "UNSUPPORTED_CHAT_EDIT_TARGET", "Chat external edits cannot modify secrets or runtime internals.");
  }
  if (!CHAT_EDIT_TEXT_EXTENSIONS.test(rel)) {
    throw new ApiError(400, "UNSUPPORTED_CHAT_EDIT_TARGET", "Chat external edits only support text content files.");
  }
  return { path: resolved, rel };
}

async function findChapterFile(root: string, bookId: string, chapterNumber: number): Promise<string | null> {
  const chaptersDir = join(root, "books", bookId, "chapters");
  const padded = String(chapterNumber).padStart(4, "0");
  const files = await readdir(chaptersDir).catch(() => []);
  const match = files.find((file) => file.startsWith(`${padded}_`) && file.endsWith(".md"));
  return match ? join(chaptersDir, match) : null;
}

function parseBookChapterFromRelativePath(rel: string): { bookId: string; chapterNumber: number } | null {
  const match = rel.match(/^books\/([^/]+)\/chapters\/(\d{4})_[^/]+\.md$/);
  if (!match?.[1] || !match[2]) return null;
  const chapterNumber = Number.parseInt(match[2], 10);
  return Number.isInteger(chapterNumber) ? { bookId: match[1], chapterNumber } : null;
}

async function syncExternalChapterEdit(params: {
  readonly state: StateManager;
  readonly root: string;
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly content: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const index = [...(await params.state.loadChapterIndex(params.bookId))];
  const updated = index.map((chapter) => chapter.number === params.chapterNumber
    ? {
        ...chapter,
        status: "audit-failed" as const,
        wordCount: countContentUnits(params.content),
        updatedAt: now,
        auditIssues: [
          ...chapter.auditIssues.filter((issue) => issue !== CHAT_EDIT_WARNING),
          CHAT_EDIT_WARNING,
        ],
      }
    : chapter);
  if (updated.length > 0) {
    await params.state.saveChapterIndex(params.bookId, updated);
  }

  const runtimeDir = join(params.root, "books", params.bookId, "story", "runtime");
  const padded = String(params.chapterNumber).padStart(4, "0");
  const runtimeFiles = await readdir(runtimeDir).catch(() => []);
  await Promise.all(
    runtimeFiles
      .filter((file) => file.startsWith(`chapter-${padded}.`))
      .map((file) => rm(join(runtimeDir, file), { force: true })),
  );
}

async function tryHandleExternalChatEdit(params: {
  readonly root: string;
  readonly state: StateManager;
  readonly instruction: string;
  readonly activeBookId: string | null;
}): Promise<ExternalChatEditResult | null> {
  const replacement = parseReplacementInstruction(params.instruction);
  if (!replacement) return null;
  if (!isExplicitExternalChatEditInstruction(params.instruction)) return null;

  const explicitPath = parseExplicitEditPath(params.instruction);
  if (explicitPath) {
    const target = resolveExternalChatEditPath(params.root, explicitPath);
    const content = await readFile(target.path, "utf-8").catch((error) => {
      throw new ApiError(404, "CHAT_EDIT_TARGET_NOT_FOUND", error instanceof Error ? error.message : String(error));
    });
    const first = content.indexOf(replacement.oldText);
    if (first === -1) {
      throw new ApiError(400, "EDIT_TARGET_NOT_FOUND", "要替换的原文没有在目标文件中找到。");
    }
    if (content.indexOf(replacement.oldText, first + replacement.oldText.length) !== -1) {
      throw new ApiError(400, "EDIT_TARGET_AMBIGUOUS", "要替换的原文出现多次，请给出更具体的一段。");
    }
    const updated = content.slice(0, first) + replacement.newText + content.slice(first + replacement.oldText.length);
    await writeFile(target.path, updated, "utf-8");

    const chapterTarget = parseBookChapterFromRelativePath(target.rel);
    if (chapterTarget) {
      await syncExternalChapterEdit({
        state: params.state,
        root: params.root,
        bookId: chapterTarget.bookId,
        chapterNumber: chapterTarget.chapterNumber,
        content: updated,
      });
    }

    return {
      activeBookId: chapterTarget?.bookId ?? params.activeBookId ?? undefined,
      responseText: `已直接编辑 ${target.rel}${chapterTarget ? "，并标记为需要复核" : ""}。`,
    };
  }

  if (!params.activeBookId) return null;
  const chapterNumber = parseChapterNumberForEdit(params.instruction);
  if (!replacement || !chapterNumber) return null;

  const chapterPath = await findChapterFile(params.root, params.activeBookId, chapterNumber);
  if (!chapterPath) {
    throw new ApiError(404, "CHAPTER_NOT_FOUND", `Chapter ${chapterNumber} not found in ${params.activeBookId}`);
  }
  if (!CHAT_EDIT_TEXT_EXTENSIONS.test(chapterPath)) {
    throw new ApiError(400, "UNSUPPORTED_EDIT_TARGET", "Chat external edits only support text files.");
  }

  const content = await readFile(chapterPath, "utf-8");
  const first = content.indexOf(replacement.oldText);
  if (first === -1) {
    throw new ApiError(400, "EDIT_TARGET_NOT_FOUND", "要替换的原文没有在目标章节中找到。");
  }
  if (content.indexOf(replacement.oldText, first + replacement.oldText.length) !== -1) {
    throw new ApiError(400, "EDIT_TARGET_AMBIGUOUS", "要替换的原文出现多次，请给出更具体的一段。");
  }

  const updated = content.slice(0, first) + replacement.newText + content.slice(first + replacement.oldText.length);
  await writeFile(chapterPath, updated, "utf-8");
  await syncExternalChapterEdit({
    state: params.state,
    root: params.root,
    bookId: params.activeBookId,
    chapterNumber,
    content: updated,
  });

  return {
    activeBookId: params.activeBookId,
    responseText: `已直接编辑 ${params.activeBookId} 第 ${chapterNumber} 章，并标记为需要复核。`,
  };
}

function validateAgentActionExecution(args: {
  readonly instruction: string;
  readonly agentBookId: string | null | undefined;
  readonly requestedIntent?: RequestedIntent;
  readonly collectedToolExecs: ReadonlyArray<CollectedToolExec>;
  readonly language?: StudioLanguage;
}): string | undefined {
  const lang = args.language ?? "zh";
  const failedExec = args.collectedToolExecs.find(isLikelyFailedToolResult);
  if (failedExec) {
    const detail = failedExec.error ?? failedExec.result ?? pick(lang, "未知错误", "unknown error");
    return pick(
      lang,
      `${failedExec.label} 执行失败：${detail}`,
      `${failedExec.label} failed: ${detail}`,
    );
  }

  if (
    args.agentBookId
    && args.requestedIntent === "write_next"
    && !hasSuccessfulSubAgentExec(args.collectedToolExecs, "writer")
  ) {
    return pick(
      lang,
      "模型声称已完成下一章，但没有实际调用写作工具。请重试；如果仍失败，请检查模型是否支持工具调用。",
      "The model claimed the next chapter is done, but it never called the writing tool. Retry; if it keeps failing, check whether the model supports tool calls.",
    );
  }

  if (
    !args.agentBookId
    && args.requestedIntent === "create_book"
    && !hasSuccessfulSubAgentExec(args.collectedToolExecs, "architect")
  ) {
    return pick(
      lang,
      "已确认建书，但模型没有实际调用建书工具。请重试；如果仍失败，请检查模型是否支持工具调用。",
      "Book creation was confirmed, but the model never called the book setup tool. Retry; if it keeps failing, check whether the model supports tool calls.",
    );
  }

  if (args.requestedIntent === "short_run" && !hasSuccessfulToolExec(args.collectedToolExecs, "short_fiction_run")) {
    return pick(
      lang,
      "已确认生成短篇，但模型没有实际调用短篇生产工具。请重试；如果仍失败，请检查模型是否支持工具调用。",
      "Short fiction was confirmed, but the model never called the short fiction tool. Retry; if it keeps failing, check whether the model supports tool calls.",
    );
  }

  if (args.requestedIntent === "play_start" && !hasSuccessfulToolExec(args.collectedToolExecs, "play_start")) {
    return pick(
      lang,
      "已确认启动互动世界，但模型没有实际调用互动世界工具。请重试；如果仍失败，请检查模型是否支持工具调用。",
      "Starting the interactive world was confirmed, but the model never called the interactive world tool. Retry; if it keeps failing, check whether the model supports tool calls.",
    );
  }

  if (args.requestedIntent === "generate_cover" && !hasSuccessfulToolExec(args.collectedToolExecs, "generate_cover")) {
    return pick(
      lang,
      "已确认生成封面，但模型没有实际调用封面工具。请重试；如果仍失败，请检查模型是否支持工具调用。",
      "Cover generation was confirmed, but the model never called the cover tool. Retry; if it keeps failing, check whether the model supports tool calls.",
    );
  }

  return undefined;
}

type AgentFailureKind = "busy" | "llm" | "internal" | "unknown";

function classifyAgentFailure(message: string): AgentFailureKind {
  const text = message.trim();
  if (!text) return "unknown";
  if (/BookWriteLockError|locked by an active InkOS write|BOOK_BUSY/i.test(text)) {
    return "busy";
  }
  if (
    /API\s*返回|上游|upstream|Bad Gateway|temporarily unavailable|rate limit|quota|API Key|unauthorized|forbidden|无法连接到 API|fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|LLM returned empty response|Provider finish_reason|reasoning_content/i.test(text)
  ) {
    return "llm";
  }
  if (
    /PlannerParseError|Architect output missing|required sections|missing YAML frontmatter|frontmatter delimiters|parseMemo|Book creation artifact is incomplete|Short-hit draft is incomplete|工具执行失败|执行失败|sub_agent|tool execution|RUNTIME_STATE_DELTA|JSON parse|解析失败/i.test(text)
  ) {
    return "internal";
  }
  return "unknown";
}

function formatAgentFailure(
  message: string,
  lang: StudioLanguage = "zh",
): { readonly code: string; readonly message: string; readonly status: 409 | 500 | 502 } {
  const kind = classifyAgentFailure(message);
  if (kind === "busy") {
    return { code: "BOOK_BUSY", message, status: 409 };
  }
  if (kind === "llm") {
    return { code: "AGENT_LLM_ERROR", message, status: 502 };
  }
  if (kind === "internal") {
    return {
      code: "AGENT_INTERNAL_ERROR",
      message: pick(lang, `InkOS 内部流程错误：${message}`, `InkOS internal pipeline error: ${message}`),
      status: 500,
    };
  }
  return { code: "AGENT_ERROR", message, status: 500 };
}

function formatAgentActionFailure(
  message: string,
  lang: StudioLanguage,
): { readonly code: string; readonly message: string; readonly status: 409 | 502 } {
  const failure = formatAgentFailure(message, lang);
  return failure.code === "BOOK_BUSY"
    ? { code: failure.code, message: failure.message, status: 409 }
    : { code: "AGENT_ACTION_FAILED", message, status: 502 };
}

interface CollectedToolExec {
  id: string;
  tool: string;
  agent?: string;
  label: string;
  status: "running" | "completed" | "error";
  args?: Record<string, unknown>;
  result?: string;
  details?: unknown;
  error?: string;
  stages?: Array<{ label: string; status: "pending" | "completed" }>;
  logs?: string[];
  startedAt: number;
  completedAt?: number;
}

class ConfirmedActionExecutionError extends Error {
  readonly exec: CollectedToolExec;

  constructor(message: string, exec: CollectedToolExec, cause?: unknown) {
    super(message);
    this.name = "ConfirmedActionExecutionError";
    this.exec = exec;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

function suppressManualTextForTool(exec: CollectedToolExec): boolean {
  return exec.tool === "play_start"
    || exec.tool === "play_step"
    || exec.tool === "play_revise"
    || exec.tool === "script_create"
    || exec.tool === "storyboard_create"
    || exec.tool === "interactive_film_create";
}

function manualToolAssistantMessage(
  responseText: string,
  exec: CollectedToolExec,
  provider: string,
  model: string,
): any {
  return {
    role: "assistant",
    content: [{ type: "text", text: suppressManualTextForTool(exec) ? "" : responseText }],
    api: "anthropic-messages",
    provider,
    model,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}

function manualToolAppendOptions(sessionKind: SessionKind, exec: CollectedToolExec): {
  readonly sessionKind: SessionKind;
  readonly legacyDisplay: { readonly toolExecutions: readonly CollectedToolExec[] };
} {
  return {
    sessionKind,
    legacyDisplay: { toolExecutions: [exec] },
  };
}

function isConfirmedProductionAction(args: {
  readonly actionSource: ActionSource;
  readonly requestedIntent?: RequestedIntent;
}): boolean {
  return (args.actionSource === "button" || args.actionSource === "slash")
    && (
      args.requestedIntent === "create_book"
    || args.requestedIntent === "short_run"
    || args.requestedIntent === "script_create"
    || args.requestedIntent === "storyboard_create"
    || args.requestedIntent === "interactive_film_create"
    || args.requestedIntent === "translation_create"
    || args.requestedIntent === "play_start"
    || args.requestedIntent === "generate_cover"
    || args.requestedIntent === "draft_structure"
    || args.requestedIntent === "connect_choice"
    || args.requestedIntent === "remove_node"
    );
}

function requirePayloadText(value: string | undefined, message: string): string {
  const text = value?.trim();
  if (!text) {
    throw new ApiError(400, "CONFIRMED_ACTION_PAYLOAD_INCOMPLETE", message);
  }
  return text;
}

function toolResultText(result: unknown, lang: StudioLanguage = "zh"): string {
  const text = extractToolError(result).trim();
  return text || pick(lang, "已完成。", "Done.");
}

interface WriteNextChapterToolResult {
  // 章节写完但审稿未通过时置 true：任务卡按错误态展示，但请求仍以 200 返回结果文本。
  readonly isError?: boolean;
  readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>;
  readonly details: {
    readonly kind: "chapter_written" | "chapters_written";
    readonly bookId: string;
    readonly chapterNumber?: number;
    readonly title?: string;
    readonly wordCount?: number;
    readonly status?: string;
    readonly requestedCount?: number;
    readonly completedCount?: number;
    readonly stoppedStatus?: string;
    readonly chapters?: ReadonlyArray<{
      readonly chapterNumber: number;
      readonly title?: string;
      readonly wordCount: number;
      readonly status?: string;
    }>;
  };
}

function buildWriteNextResponseText(
  bookId: string,
  writeResult: { readonly chapterNumber: number; readonly title?: string; readonly wordCount: number; readonly status?: string },
  writeNeedsReview: boolean,
  lang: StudioLanguage,
): string {
  const zhResponseText = writeNeedsReview
    ? [
        `已为 ${bookId} 写出第 ${writeResult.chapterNumber} 章`,
        writeResult.title ? `《${writeResult.title}》` : "",
        `，字数 ${writeResult.wordCount}，但审稿未通过，状态 ${writeResult.status}，需要复核后再继续。`,
      ].join("")
    : [
        `已为 ${bookId} 完成第 ${writeResult.chapterNumber} 章`,
        writeResult.title ? `《${writeResult.title}》` : "",
        `，字数 ${writeResult.wordCount}，状态 ${writeResult.status}。`,
      ].join("");
  const enChapterRef = writeResult.title
    ? `chapter ${writeResult.chapterNumber} "${writeResult.title}"`
    : `chapter ${writeResult.chapterNumber}`;
  const enResponseText = writeNeedsReview
    ? `Wrote ${enChapterRef} for ${bookId}: ${writeResult.wordCount} words, but the review did not pass (status: ${writeResult.status}). Manual review is required before continuing.`
    : `Completed ${enChapterRef} for ${bookId}: ${writeResult.wordCount} words, status ${writeResult.status}.`;
  return pick(lang, zhResponseText, enResponseText);
}

// 写下一章的确认式任务工具：走 pipeline.runWithAbortSignal，让任务控制器的
// 中止信号传进写作流程（pipeline 在下一个检查点抛出中止错误）。
function createWriteNextChapterTool(
  pipeline: PipelineRunner,
  bookId: string,
  lang: StudioLanguage,
  chapterCount = 1,
): {
  readonly name: "sub_agent";
  readonly execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate?: (partialResult: unknown) => void,
  ) => Promise<WriteNextChapterToolResult>;
} {
  return {
    name: "sub_agent",
    async execute(_toolCallId, _params, signal, onUpdate) {
      if (chapterCount > 1) {
        onUpdate?.({
          content: [{
            type: "text",
            text: pick(
              lang,
              `正在为 ${bookId} 连续写 ${chapterCount} 章…`,
              `Writing ${chapterCount} consecutive chapters for ${bookId}...`,
            ),
          }],
        });
        const results = await pipeline.runWithAbortSignal(
          signal,
          () => pipeline.writeChapters(bookId, chapterCount, {
            onChapterComplete(result, completedCount, requestedCount) {
              onUpdate?.({
                content: [{
                  type: "text",
                  text: pick(
                    lang,
                    `第 ${completedCount}/${requestedCount} 章已落盘：第 ${result.chapterNumber} 章《${result.title}》。`,
                    `${completedCount}/${requestedCount} persisted: chapter ${result.chapterNumber} "${result.title}".`,
                  ),
                }],
              });
            },
          }),
        );
        const last = results.at(-1);
        const stoppedStatus = last?.status !== "ready-for-review" ? last?.status : undefined;
        const responseText = stoppedStatus
          ? pick(
              lang,
              `已完成 ${results.length}/${chapterCount} 章；第 ${last?.chapterNumber} 章状态为 ${stoppedStatus}，批量写作已停止，请复核后再继续。`,
              `Completed ${results.length}/${chapterCount} chapters. Chapter ${last?.chapterNumber} ended with ${stoppedStatus}, so the batch stopped for review.`,
            )
          : pick(
              lang,
              `已连续完成 ${results.length} 章（第 ${results[0]?.chapterNumber} 章至第 ${last?.chapterNumber} 章）。`,
              `Completed ${results.length} consecutive chapters (chapters ${results[0]?.chapterNumber}-${last?.chapterNumber}).`,
            );
        return {
          ...(stoppedStatus ? { isError: true } : {}),
          content: [{ type: "text", text: responseText }],
          details: {
            kind: "chapters_written",
            bookId,
            requestedCount: chapterCount,
            completedCount: results.length,
            chapters: results.map((result) => ({
              chapterNumber: result.chapterNumber,
              title: result.title,
              wordCount: result.wordCount,
              status: result.status,
            })),
            ...(stoppedStatus ? { stoppedStatus } : {}),
          },
        };
      }
      onUpdate?.({
        content: [{
          type: "text",
          text: pick(lang, `正在为 ${bookId} 写下一章…`, `Writing the next chapter for ${bookId}...`),
        }],
      });
      const writeResult = await pipeline.runWithAbortSignal(signal, () => pipeline.writeNextChapter(bookId));
      const writeNeedsReview = Boolean(writeResult.status && writeResult.status !== "ready-for-review");
      return {
        ...(writeNeedsReview ? { isError: true } : {}),
        content: [{ type: "text", text: buildWriteNextResponseText(bookId, writeResult, writeNeedsReview, lang) }],
        details: {
          kind: "chapter_written",
          bookId,
          chapterNumber: writeResult.chapterNumber,
          title: writeResult.title,
          wordCount: writeResult.wordCount,
          status: writeResult.status,
        },
      };
    },
  };
}

async function executeConfirmedProductionAction(args: {
  readonly pipeline: PipelineRunner;
  readonly root: string;
  readonly sessionId: string;
  readonly bookId: string | null;
  readonly streamSessionId: string;
  readonly instruction: string;
  readonly requestedIntent: RequestedIntent;
  readonly actionPayload?: ActionPayload;
  readonly playMode?: PlayMode;
  readonly language?: StudioLanguage;
  readonly taskId: string;
  readonly sourceRequestId?: string;
  readonly signal: AbortSignal;
  readonly onTaskChange: (exec: CollectedToolExec) => Promise<void>;
}): Promise<CollectedToolExec> {
  const lang = args.language ?? "zh";
  const id = args.taskId;
  const actionPayload = args.actionPayload;
  let tool: ReturnType<typeof createSubAgentTool>
    | ReturnType<typeof createShortFictionRunTool>
    | ReturnType<typeof createGenerateCoverTool>
    | ReturnType<typeof createScriptCreationTool>
    | ReturnType<typeof createStoryboardCreationTool>
    | ReturnType<typeof createInteractiveFilmCreationTool>
    | ReturnType<typeof createTranslationCreateTool>
    | ReturnType<typeof createPlayStartTool>
    | ReturnType<typeof createDraftStructureTool>
    | ReturnType<typeof createConnectChoiceTool>
    | ReturnType<typeof createRemoveNodeTool>
    | ReturnType<typeof createWriteNextChapterTool>;
  let params: Record<string, unknown>;
  let agent: string | undefined;

  if (args.requestedIntent === "create_book") {
    const payload = actionPayload?.createBook;
    const title = requirePayloadText(payload?.title, pick(lang, "确认建书缺少书名，请重新生成确认卡。", "The book creation confirmation is missing a title. Regenerate the confirmation card."));
    tool = createSubAgentTool(args.pipeline, null, args.root, { actionPayload });
    agent = "architect";
    params = {
      agent,
      instruction: args.instruction,
      title,
      ...(payload?.genre ? { genre: payload.genre } : {}),
      ...(payload?.platform ? { platform: payload.platform } : {}),
      ...(payload?.language ? { language: payload.language } : {}),
      ...(payload?.targetChapters ? { targetChapters: payload.targetChapters } : {}),
      ...(payload?.chapterWordCount ? { chapterWordCount: payload.chapterWordCount } : {}),
    };
  } else if (args.requestedIntent === "short_run") {
    const payload = actionPayload?.shortRun;
    const direction = payload?.direction?.trim() || args.instruction.trim();
    if (!direction) throw new ApiError(400, "CONFIRMED_ACTION_PAYLOAD_INCOMPLETE", pick(lang, "确认短篇缺少方向，请重新生成确认卡。", "The short fiction confirmation is missing a direction. Regenerate the confirmation card."));
    tool = createShortFictionRunTool(args.pipeline, args.root, { actionPayload, language: lang });
    params = {
      direction,
      ...(payload?.reference ? { reference: payload.reference } : {}),
      ...(payload?.storyId ? { storyId: payload.storyId } : {}),
      ...(payload?.chapters ? { chapters: payload.chapters } : {}),
      ...(payload?.charsPerChapter ? { charsPerChapter: payload.charsPerChapter } : {}),
      ...(payload?.cover !== undefined ? { cover: payload.cover } : {}),
    };
  } else if (args.requestedIntent === "write_next") {
    if (!args.bookId) {
      throw new ApiError(400, "BOOK_ID_REQUIRED", pick(lang, "写下一章需要先打开一本书。", "Writing the next chapter requires an active book."));
    }
    const chapterCount = actionPayload?.writeNext?.chapterCount ?? 1;
    tool = createWriteNextChapterTool(args.pipeline, args.bookId, lang, chapterCount);
    agent = "writer";
    params = { agent: "writer", bookId: args.bookId };
  } else if (args.requestedIntent === "generate_cover") {
    const payload = actionPayload?.generateCover;
    const title = requirePayloadText(payload?.title, pick(lang, "确认生成封面缺少标题，请重新生成确认卡。", "The cover generation confirmation is missing a title. Regenerate the confirmation card."));
    tool = createGenerateCoverTool(args.root, { actionPayload });
    params = {
      title,
      ...(payload?.intro ? { intro: payload.intro } : {}),
      ...(payload?.sellingPoints ? { sellingPoints: payload.sellingPoints } : {}),
      ...(payload?.coverPrompt ? { coverPrompt: payload.coverPrompt } : {}),
      ...(payload?.outputDir ? { outputDir: payload.outputDir } : {}),
    };
  } else if (args.requestedIntent === "script_create") {
    const payload = actionPayload?.scriptCreate;
    const title = requirePayloadText(payload?.title, pick(lang, "确认创建剧本缺少标题，请重新生成确认卡。", "The script creation confirmation is missing a title. Regenerate the confirmation card."));
    tool = createScriptCreationTool(args.pipeline, args.root, { actionPayload, language: lang });
    params = {
      title,
      instruction: args.instruction,
      ...(payload?.sourceKind ? { sourceKind: payload.sourceKind } : {}),
      ...(payload?.targetFormat ? { targetFormat: payload.targetFormat } : {}),
      ...(payload?.sourceText ? { sourceText: payload.sourceText } : {}),
      ...(payload?.sourcePath ? { sourcePath: payload.sourcePath } : {}),
      ...(payload?.requirements ? { requirements: payload.requirements } : {}),
      ...(payload?.episodeCount ? { episodeCount: payload.episodeCount } : {}),
      ...(payload?.episodeDuration ? { episodeDuration: payload.episodeDuration } : {}),
      ...(payload?.projectId ? { projectId: payload.projectId } : {}),
      ...(payload?.outDir ? { outDir: payload.outDir } : {}),
    };
  } else if (args.requestedIntent === "storyboard_create") {
    const payload = actionPayload?.storyboardCreate;
    const title = requirePayloadText(payload?.title, pick(lang, "确认创建分镜缺少标题，请重新生成确认卡。", "The storyboard creation confirmation is missing a title. Regenerate the confirmation card."));
    tool = createStoryboardCreationTool(args.pipeline, args.root, { actionPayload, language: lang });
    params = {
      title,
      instruction: args.instruction,
      ...(payload?.sourceKind ? { sourceKind: payload.sourceKind } : {}),
      ...(payload?.sourceText ? { sourceText: payload.sourceText } : {}),
      ...(payload?.sourcePath ? { sourcePath: payload.sourcePath } : {}),
      ...(payload?.requirements ? { requirements: payload.requirements } : {}),
      ...(payload?.visualStyle ? { visualStyle: payload.visualStyle } : {}),
      ...(payload?.aspectRatio ? { aspectRatio: payload.aspectRatio } : {}),
      ...(payload?.granularity ? { granularity: payload.granularity } : {}),
      ...(payload?.maxShots ? { maxShots: payload.maxShots } : {}),
      ...(payload?.projectId ? { projectId: payload.projectId } : {}),
      ...(payload?.outDir ? { outDir: payload.outDir } : {}),
    };
  } else if (args.requestedIntent === "interactive_film_create") {
    const payload = actionPayload?.interactiveFilmCreate;
    const title = requirePayloadText(payload?.title, pick(lang, "确认创建互动影游缺少标题，请重新生成确认卡。", "The interactive film confirmation is missing a title. Regenerate the confirmation card."));
    tool = createInteractiveFilmCreationTool(args.pipeline, args.root, { actionPayload, language: lang });
    params = {
      title,
      instruction: args.instruction,
      ...(payload?.sourceKind ? { sourceKind: payload.sourceKind } : {}),
      ...(payload?.sourceText ? { sourceText: payload.sourceText } : {}),
      ...(payload?.sourcePath ? { sourcePath: payload.sourcePath } : {}),
      ...(payload?.requirements ? { requirements: payload.requirements } : {}),
      ...(payload?.targetAudience ? { targetAudience: payload.targetAudience } : {}),
      ...(payload?.episodeCount ? { episodeCount: payload.episodeCount } : {}),
      ...(payload?.episodeDuration ? { episodeDuration: payload.episodeDuration } : {}),
      ...(payload?.budget ? { budget: payload.budget } : {}),
      ...(payload?.referenceMode ? { referenceMode: payload.referenceMode } : {}),
      ...(payload?.projectId ? { projectId: payload.projectId } : {}),
      ...(payload?.outDir ? { outDir: payload.outDir } : {}),
    };
  } else if (args.requestedIntent === "translation_create") {
    const payload = actionPayload?.translationCreate;
    const filePath = requirePayloadText(payload?.filePath, pick(lang, "确认创建翻译项目缺少文件路径，请重新生成确认卡。", "The translation confirmation is missing a file path. Regenerate the confirmation card."));
    const sourceLanguage = requirePayloadText(payload?.sourceLanguage, pick(lang, "确认创建翻译项目缺少源语言，请重新生成确认卡。", "The translation confirmation is missing a source language. Regenerate the confirmation card."));
    const targetLanguage = requirePayloadText(payload?.targetLanguage, pick(lang, "确认创建翻译项目缺少目标语言，请重新生成确认卡。", "The translation confirmation is missing a target language. Regenerate the confirmation card."));
    tool = createTranslationCreateTool(args.root, { actionPayload });
    params = {
      filePath,
      sourceLanguage,
      targetLanguage,
      ...(payload?.title ? { title: payload.title } : {}),
      ...(payload?.segmentMaxChars ? { segmentMaxChars: payload.segmentMaxChars } : {}),
    };
  } else if (args.requestedIntent === "play_start") {
    const payload = actionPayload?.playStart;
    const title = requirePayloadText(payload?.title, pick(lang, "确认启动互动世界缺少标题，请重新生成确认卡。", "The interactive world start confirmation is missing a title. Regenerate the confirmation card."));
    const fallbackScene = [payload?.premise, args.instruction].filter((part): part is string => typeof part === "string" && part.trim().length > 0).join("\n\n");
    const initialScene = isUsablePlayInitialScene(payload?.initialScene)
      ? payload?.initialScene?.trim()
      : fallbackScene.trim();
    const confirmedActionPayload: ActionPayload | undefined = actionPayload
      ? {
        ...actionPayload,
        playStart: {
          ...payload,
          title,
          ...(initialScene ? { initialScene } : {}),
        },
      }
      : undefined;
    tool = createPlayStartTool(args.pipeline, args.root, args.sessionId, args.playMode, { actionPayload: confirmedActionPayload });
    params = {
      title,
      ...(payload?.premise ? { premise: payload.premise } : {}),
      ...(payload?.worldContract ? { worldContract: payload.worldContract } : {}),
      ...(payload?.visualContract ? { visualContract: payload.visualContract } : {}),
      ...(payload?.mode ? { mode: payload.mode } : {}),
      ...(initialScene ? { initialScene } : {}),
      ...(payload?.suggestedActions ? { suggestedActions: payload.suggestedActions } : {}),
    };
  } else if (args.requestedIntent === "draft_structure") {
    const payload = actionPayload?.draftStructure;
    const projectId = payload?.projectId ?? args.bookId;
    if (!projectId) throw new ApiError(400, "INVALID_ID", "interactive-film action requires a project id (bookId)");
    const agentCtx = args.pipeline.createAgentContext("film-authoring", projectId);
    const deps = filmLLMDepsFromClient(agentCtx.client, agentCtx.model);
    tool = createDraftStructureTool(args.root, projectId, deps, lang);
    params = {
      instruction: payload?.instruction?.trim() || args.instruction,
    };
  } else if (args.requestedIntent === "connect_choice") {
    const payload = actionPayload?.connectChoice;
    if (!payload?.node) {
      throw new ApiError(400, "CONFIRMED_ACTION_PAYLOAD_INCOMPLETE", pick(lang, "确认连接选择缺少节点数据，请重新生成确认卡。", "The connect-choice confirmation is missing node data. Regenerate the confirmation card."));
    }
    const projectId = payload?.projectId ?? args.bookId;
    if (!projectId) throw new ApiError(400, "INVALID_ID", "interactive-film action requires a project id (bookId)");
    tool = createConnectChoiceTool(args.root, projectId);
    params = {
      node: payload.node,
    };
  } else if (args.requestedIntent === "remove_node") {
    const payload = actionPayload?.removeNode;
    if (!payload?.nodeId) {
      throw new ApiError(400, "CONFIRMED_ACTION_PAYLOAD_INCOMPLETE", pick(lang, "确认删除节点缺少 nodeId，请重新生成确认卡。", "The remove-node confirmation is missing a nodeId. Regenerate the confirmation card."));
    }
    const projectId = payload?.projectId ?? args.bookId;
    if (!projectId) throw new ApiError(400, "INVALID_ID", "interactive-film action requires a project id (bookId)");
    tool = createRemoveNodeTool(args.root, projectId);
    params = {
      nodeId: payload.nodeId,
    };
  } else {
    throw new ApiError(400, "UNSUPPORTED_CONFIRMED_ACTION", `Unsupported confirmed action: ${args.requestedIntent}`);
  }

  const exec: CollectedToolExec = {
    id,
    tool: tool.name,
    agent,
    label: resolveToolLabel(tool.name, agent, lang),
    status: "running",
    args: params,
    stages: agent ? pipelineStages(agent, lang)?.map(label => ({ label, status: "pending" as const })) : undefined,
    startedAt: Date.now(),
  };

  await args.onTaskChange(exec);

  // background: true 标明这是后台生产任务的工具启动（聊天轮工具不带）。
  // free-text 命中写章启发式时前端在发送时无法预知这轮会按任务执行，
  // 收到这个标记后把该轮从聊天轮重分类为任务轮。
  broadcast("tool:start", {
    sessionId: args.streamSessionId,
    id,
    tool: tool.name,
    args: params,
    stages: exec.stages?.map(stage => stage.label),
    background: true,
    ...(args.sourceRequestId ? { sourceRequestId: args.sourceRequestId } : {}),
  });

  try {
    const result = await tool.execute(
      id,
      params as never,
      args.signal,
      (partialResult: unknown) => {
        const progress = toolResultText(partialResult, lang);
        if (progress) exec.logs = [...(exec.logs ?? []), progress].slice(-80);
        void args.onTaskChange(exec).catch(() => undefined);
      },
    );
    // 工具可以在结果里带 isError=true 表示"执行完成但结果需要人工处理"
    //（如写章完成但审稿未通过）：任务卡按错误态展示，请求仍按成功返回结果文本。
    const resultIsError = Boolean((result as { isError?: boolean } | null | undefined)?.isError);
    exec.status = resultIsError ? "error" : "completed";
    exec.completedAt = Date.now();
    exec.result = toolResultText(result, lang);
    exec.details = (result as { details?: unknown } | undefined)?.details;
    exec.stages = exec.stages?.map(stage => ({ ...stage, status: "completed" as const }));
    await args.onTaskChange(exec);
    broadcast("tool:end", {
      sessionId: args.streamSessionId,
      id,
      tool: tool.name,
      result,
      details: exec.details,
      isError: resultIsError,
    });
    return exec;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result = { content: [{ type: "text", text: message }] };
    exec.status = "error";
    exec.completedAt = Date.now();
    exec.error = message;
    await args.onTaskChange(exec);
    broadcast("tool:end", {
      sessionId: args.streamSessionId,
      id,
      tool: tool.name,
      result,
      isError: true,
    });
    throw new ConfirmedActionExecutionError(message, exec, error);
  }
}

interface StudioBookListSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly chaptersWritten: number;
  readonly [key: string]: unknown;
}

// --- Event bus for SSE ---

type EventHandler = (event: string, data: unknown) => void;
const subscribers = new Set<EventHandler>();
const bookCreateStatus = new Map<string, { status: "creating" | "error"; error?: string }>();

// 内存缓存：service -> 模型列表 + 更新时间戳；避免每次 sidebar 挂载时都打真实 LLM /models
const modelListCache = new Map<string, { models: Array<{ id: string; name: string }>; at: number }>();

interface ServiceConfigEntry {
  service: string;
  name?: string;
  baseUrl?: string;
  temperature?: number;
  apiFormat?: "chat" | "responses";
  stream?: boolean;
}

type LLMConfigSource = "env" | "studio";

interface EnvConfigSummary {
  detected: boolean;
  provider: string | null;
  service?: string | null;
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
}

interface EnvConfigValues extends EnvConfigSummary {
  apiKey: string | null;
}

interface EnvConfigStatus {
  project: EnvConfigSummary;
  global: EnvConfigSummary;
  effectiveSource: "project" | "global" | null;
  runtimeUsesEnv: false;
}

interface ServiceProbeResult {
  ok: boolean;
  models: Array<{ id: string; name: string }>;
  selectedModel?: string;
  apiFormat?: "chat" | "responses";
  stream?: boolean;
  baseUrl?: string;
  modelsSource?: "api" | "fallback";
  error?: string;
}

function broadcast(event: string, data: unknown): void {
  for (const handler of subscribers) {
    handler(event, data);
  }
}

function deriveBookIdFromTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

async function completeBookExists(bookDir: string): Promise<boolean> {
  try {
    await access(join(bookDir, "book.json"));
    await access(join(bookDir, "story", "story_bible.md"));
    return true;
  } catch {
    return false;
  }
}

function resolveArchitectBookIdFromArgs(args?: Record<string, unknown>): string | null {
  if (!args || args.agent !== "architect" || args.revise === true) return null;
  if (typeof args.bookId === "string" && args.bookId.trim()) return args.bookId.trim();
  if (typeof args.title === "string" && args.title.trim()) {
    return deriveBookIdFromTitle(args.title) || null;
  }
  return null;
}

function resolveCreatedBookIdFromToolExecs(execs: ReadonlyArray<CollectedToolExec>): string | null {
  for (let i = execs.length - 1; i >= 0; i -= 1) {
    const exec = execs[i];
    if (exec.tool !== "sub_agent" || exec.agent !== "architect" || exec.status !== "completed") continue;

    const details = exec.details as { kind?: unknown; bookId?: unknown } | undefined;
    if (details?.kind === "book_created" && typeof details.bookId === "string" && details.bookId.trim()) {
      return details.bookId.trim();
    }
  }
  return null;
}

function resolveCreatedBookIdFromDetails(details: Readonly<Record<string, unknown>> | undefined): string | null {
  if (details?.kind === "book_created" && typeof details.bookId === "string" && details.bookId.trim()) {
    return details.bookId.trim();
  }
  return null;
}

async function loadStudioBookListSummary(
  state: StateManager,
  bookId: string,
): Promise<StudioBookListSummary> {
  const book = await state.loadBookConfig(bookId);
  const nextChapter = await state.getNextChapterNumber(bookId);
  return { ...book, chaptersWritten: nextChapter - 1 };
}

function isCustomServiceId(serviceId: string): boolean {
  return serviceId === "custom" || serviceId.startsWith("custom:");
}

function serviceConfigKey(entry: ServiceConfigEntry): string {
  return entry.service === "custom" ? `custom:${entry.name ?? "Custom"}` : entry.service;
}

function normalizeServiceEntry(serviceId: string, value: Record<string, unknown>): ServiceConfigEntry {
  if (serviceId.startsWith("custom:")) {
    return {
      service: "custom",
      name: decodeURIComponent(serviceId.slice("custom:".length)),
      ...(typeof value.baseUrl === "string" && value.baseUrl.length > 0 ? { baseUrl: value.baseUrl } : {}),
      ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
      ...(value.apiFormat === "chat" || value.apiFormat === "responses" ? { apiFormat: value.apiFormat } : {}),
      ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
    };
  }

  if (serviceId === "custom") {
    return {
      service: "custom",
      ...(typeof value.name === "string" && value.name.length > 0 ? { name: value.name } : {}),
      ...(typeof value.baseUrl === "string" && value.baseUrl.length > 0 ? { baseUrl: value.baseUrl } : {}),
      ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
      ...(value.apiFormat === "chat" || value.apiFormat === "responses" ? { apiFormat: value.apiFormat } : {}),
      ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
    };
  }

  return {
    service: serviceId,
    ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
    ...(value.apiFormat === "chat" || value.apiFormat === "responses" ? { apiFormat: value.apiFormat } : {}),
    ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
  };
}

function normalizeConfigSource(value: unknown): LLMConfigSource {
  return value === "studio" ? "studio" : "env";
}

function normalizeServiceConfig(raw: unknown): ServiceConfigEntry[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({
        service: typeof entry.service === "string" && entry.service.length > 0 ? entry.service : "custom",
        ...(typeof entry.name === "string" && entry.name.length > 0 ? { name: entry.name } : {}),
        ...(typeof entry.baseUrl === "string" && entry.baseUrl.length > 0 ? { baseUrl: entry.baseUrl } : {}),
        ...(typeof entry.temperature === "number" ? { temperature: entry.temperature } : {}),
        ...(entry.apiFormat === "chat" || entry.apiFormat === "responses" ? { apiFormat: entry.apiFormat } : {}),
        ...(typeof entry.stream === "boolean" ? { stream: entry.stream } : {}),
      }));
  }

  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, value]) => value && typeof value === "object")
      .map(([serviceId, value]) => normalizeServiceEntry(serviceId, value as Record<string, unknown>));
  }

  return [];
}

function mergeServiceConfig(existing: ServiceConfigEntry[], updates: ServiceConfigEntry[]): ServiceConfigEntry[] {
  const merged = new Map(existing.map((entry) => [serviceConfigKey(entry), entry]));
  for (const update of updates) {
    merged.set(serviceConfigKey(update), update);
  }
  return [...merged.values()];
}

function normalizeCoverConfig(raw: unknown): { service: string; model: string; baseUrl?: string } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const service = typeof record.service === "string" ? record.service : "";
  const preset = resolveCoverProviderPreset(service);
  if (!preset) return undefined;
  const requestedModel = typeof record.model === "string" ? record.model.trim() : "";
  const model = requestedModel && preset.models.includes(requestedModel)
    ? requestedModel
    : preset.defaultModel;
  const baseUrl = normalizeCoverBaseUrl(record.baseUrl);
  return {
    service: preset.service,
    model,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

function syncTopLevelLlmMirror(llm: Record<string, unknown>): void {
  const selectedService = typeof llm.service === "string" ? llm.service : undefined;
  if (!selectedService) return;

  const services = normalizeServiceConfig(llm.services);
  const selectedEntry = services.find((entry) => serviceConfigKey(entry) === selectedService)
    ?? (!isCustomServiceId(selectedService) ? { service: selectedService } : undefined);
  if (!selectedEntry) return;

  const preset = resolveServicePreset(selectedEntry.service);
  llm.provider = resolveServiceProviderFamily(selectedEntry.service) ?? "openai";
  llm.baseUrl = selectedEntry.baseUrl ?? preset?.baseUrl ?? "";

  const defaultModel = typeof llm.defaultModel === "string" ? llm.defaultModel.trim() : "";
  if (defaultModel) llm.model = defaultModel;
  if (selectedEntry.temperature !== undefined) llm.temperature = selectedEntry.temperature;
  if (selectedEntry.apiFormat !== undefined) llm.apiFormat = selectedEntry.apiFormat;
  if (selectedEntry.stream !== undefined) llm.stream = selectedEntry.stream;
}

async function loadRawConfig(root: string): Promise<Record<string, unknown>> {
  const configPath = join(root, "inkos.json");
  const raw = await readFile(configPath, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

async function saveRawConfig(root: string, config: Record<string, unknown>): Promise<void> {
  await writeFile(join(root, "inkos.json"), JSON.stringify(config, null, 2), "utf-8");
}

type ChapterReviewMode = "auto" | "manual";

function normalizeChapterReviewMode(mode: unknown): ChapterReviewMode {
  return mode === "manual" ? "manual" : "auto";
}

function readProjectChapterReviewMode(config: Record<string, unknown>): ChapterReviewMode {
  const writing = config.writing && typeof config.writing === "object" && !Array.isArray(config.writing)
    ? config.writing as Record<string, unknown>
    : {};
  return normalizeChapterReviewMode(writing.reviewMode);
}

function readBookChapterReviewMode(rawBook: Record<string, unknown>): ChapterReviewMode | undefined {
  const writing = rawBook.writing && typeof rawBook.writing === "object" && !Array.isArray(rawBook.writing)
    ? rawBook.writing as Record<string, unknown>
    : undefined;
  if (!writing || writing.reviewMode !== "manual" && writing.reviewMode !== "auto") return undefined;
  return writing.reviewMode;
}

async function loadRawBookConfig(root: string, bookId: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(root, "books", bookId, "book.json"), "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

async function resolveBookChapterReviewMode(root: string, bookId: string | undefined, projectMode: ChapterReviewMode): Promise<ChapterReviewMode> {
  if (!bookId || !isSafeBookId(bookId)) return projectMode;
  try {
    const rawBook = await loadRawBookConfig(root, bookId);
    return readBookChapterReviewMode(rawBook) ?? projectMode;
  } catch {
    return projectMode;
  }
}

type RevisionGateSetting = "strict" | "lenient" | "always";

function normalizeRevisionGate(gate: unknown): RevisionGateSetting {
  return gate === "lenient" || gate === "always" ? gate : "strict";
}

function readProjectRevisionGate(config: Record<string, unknown>): RevisionGateSetting {
  const writing = config.writing && typeof config.writing === "object" && !Array.isArray(config.writing)
    ? config.writing as Record<string, unknown>
    : {};
  return normalizeRevisionGate(writing.revisionGate);
}

function readBookRevisionGate(rawBook: Record<string, unknown>): RevisionGateSetting | undefined {
  const writing = rawBook.writing && typeof rawBook.writing === "object" && !Array.isArray(rawBook.writing)
    ? rawBook.writing as Record<string, unknown>
    : undefined;
  if (!writing || writing.revisionGate !== "strict" && writing.revisionGate !== "lenient" && writing.revisionGate !== "always") return undefined;
  return writing.revisionGate;
}

async function resolveBookRevisionGate(root: string, bookId: string | undefined, projectGate: RevisionGateSetting): Promise<RevisionGateSetting> {
  if (!bookId || !isSafeBookId(bookId)) return projectGate;
  try {
    const rawBook = await loadRawBookConfig(root, bookId);
    return readBookRevisionGate(rawBook) ?? projectGate;
  } catch {
    return projectGate;
  }
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function toEnvConfigSummary(values: EnvConfigValues): EnvConfigSummary {
  return {
    detected: values.detected,
    provider: values.provider,
    service: values.service ?? null,
    baseUrl: values.baseUrl,
    model: values.model,
    hasApiKey: values.hasApiKey,
  };
}

async function readEnvConfigValues(path: string): Promise<EnvConfigValues> {
  try {
    const raw = await readFile(path, "utf-8");
    const values = new Map<string, string>();

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, value] = match;
      values.set(key, unquoteEnvValue(value));
    }

    const provider = values.get("INKOS_LLM_PROVIDER") ?? null;
    const service = values.get("INKOS_LLM_SERVICE") ?? null;
    const baseUrl = values.get("INKOS_LLM_BASE_URL") ?? null;
    const model = values.get("INKOS_LLM_MODEL") ?? null;
    const apiKey = values.get("INKOS_LLM_API_KEY") ?? "";
    const detected = Boolean(provider || service || baseUrl || model || apiKey);

    return {
      detected,
      provider,
      service,
      baseUrl,
      model,
      hasApiKey: apiKey.length > 0,
      apiKey: apiKey.length > 0 ? apiKey : null,
    };
  } catch {
    return {
      detected: false,
      provider: null,
      service: null,
      baseUrl: null,
      model: null,
      hasApiKey: false,
      apiKey: null,
    };
  }
}

async function readEnvConfigStatus(root: string): Promise<EnvConfigStatus> {
  const project = await readEnvConfigValues(join(root, ".env"));
  const global = await readEnvConfigValues(GLOBAL_ENV_PATH);
  return {
    project: toEnvConfigSummary(project),
    global: toEnvConfigSummary(global),
    effectiveSource: project.detected ? "project" : global.detected ? "global" : null,
    runtimeUsesEnv: false,
  };
}

async function readEffectiveEnvConfigValues(root: string): Promise<{ source: "project" | "global"; values: EnvConfigValues } | null> {
  const project = await readEnvConfigValues(join(root, ".env"));
  if (project.detected) return { source: "project", values: project };
  const global = await readEnvConfigValues(GLOBAL_ENV_PATH);
  if (global.detected) return { source: "global", values: global };
  return null;
}

async function resolveConfiguredServiceBaseUrl(root: string, serviceId: string, inlineBaseUrl?: string): Promise<string | undefined> {
  if (inlineBaseUrl?.trim()) return inlineBaseUrl.trim();

  if (!isCustomServiceId(serviceId)) {
    return resolveServicePreset(serviceId)?.baseUrl;
  }

  try {
    const config = await loadRawConfig(root);
    const services = normalizeServiceConfig((config.llm as Record<string, unknown> | undefined)?.services);
    const matched = services.find((entry) => serviceConfigKey(entry) === serviceId);
    return matched?.baseUrl;
  } catch {
    return undefined;
  }
}

async function resolveConfiguredServiceEntry(root: string, serviceId: string): Promise<ServiceConfigEntry | undefined> {
  try {
    const config = await loadRawConfig(root);
    const services = normalizeServiceConfig((config.llm as Record<string, unknown> | undefined)?.services);
    return services.find((entry) => serviceConfigKey(entry) === serviceId);
  } catch {
    return undefined;
  }
}

function buildProbePlans(
  preferredApiFormat: "chat" | "responses" | undefined,
  preferredStream: boolean | undefined,
): Array<{ apiFormat: "chat" | "responses"; stream: boolean }> {
  const candidates: Array<{ apiFormat: "chat" | "responses"; stream: boolean }> = [];
  const seen = new Set<string>();
  const push = (apiFormat: "chat" | "responses", stream: boolean) => {
    const key = `${apiFormat}:${stream ? "1" : "0"}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ apiFormat, stream });
  };

  if (preferredApiFormat) {
    push(preferredApiFormat, preferredStream ?? false);
    if (preferredStream) push(preferredApiFormat, false);
    return candidates;
  }

  push("chat", false);
  push("responses", false);
  return candidates;
}

function buildModelCandidates(args: {
  preferredModel?: string;
  configModel?: string;
  envModel?: string | null;
  discoveredModels: Array<{ id: string; name: string }>;
  includeGenericFallbacks?: boolean;
}): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  const push = (value: string | null | undefined) => {
    if (!value || value.trim().length === 0) return;
    const id = value.trim();
    if (seen.has(id)) return;
    seen.add(id);
    candidates.push(id);
  };

  push(args.preferredModel);
  push(args.configModel);
  push(args.envModel ?? undefined);
  for (const model of args.discoveredModels.slice(0, MAX_DISCOVERED_MODELS_TO_PING)) push(model.id);
  if (args.includeGenericFallbacks === false) return candidates;
  for (const fallback of [
    "gpt-5.4",
    "gpt-4o",
    "claude-sonnet-4-6",
    "MiniMax-M2.7",
    "kimi-k2.5",
  ].slice(0, MAX_GENERIC_FALLBACK_MODELS_TO_PING)) {
    push(fallback);
  }
  return candidates;
}

function yamlScalar(value: unknown): string {
  return JSON.stringify(String(value ?? ""));
}

function radarTimestampForFilename(value: string | undefined): string {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return safeDate.toISOString().replace(/[:.]/g, "-");
}

async function saveRadarScan(root: string, result: unknown): Promise<string> {
  const radarDir = join(root, "radar");
  await mkdir(radarDir, { recursive: true });
  const timestamp = typeof result === "object" && result !== null && "timestamp" in result
    ? String((result as { timestamp?: unknown }).timestamp ?? "")
    : "";
  const fileName = `scan-${radarTimestampForFilename(timestamp)}.json`;
  const filePath = join(radarDir, fileName);
  await writeFile(filePath, JSON.stringify(result, null, 2), "utf-8");
  return filePath;
}

async function loadRadarHistory(root: string): Promise<Array<{
  readonly file: string;
  readonly timestamp: string;
  readonly marketSummary: string;
  readonly summaryPreview: string;
  readonly result: unknown;
}>> {
  const radarDir = join(root, "radar");
  let files: string[] = [];
  try {
    files = await readdir(radarDir);
  } catch {
    return [];
  }

  const scans = await Promise.all(
    files
      .filter((file) => /^scan-.+\.json$/.test(file))
      .map(async (file) => {
        try {
          const raw = await readFile(join(radarDir, file), "utf-8");
          const result = JSON.parse(raw) as { timestamp?: unknown; marketSummary?: unknown };
          const timestamp = typeof result.timestamp === "string"
            ? result.timestamp
            : file.replace(/^scan-/, "").replace(/\.json$/, "");
          const marketSummary = typeof result.marketSummary === "string" ? result.marketSummary : "";
          return {
            file,
            timestamp,
            marketSummary,
            summaryPreview: marketSummary.slice(0, 100),
            result,
          };
        } catch {
          return null;
        }
      }),
  );

  return scans
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.file.localeCompare(a.file));
}

function fallbackTextModelsForEndpoint(
  endpoint: ReturnType<typeof getAllEndpoints>[number] | undefined,
  preset: ReturnType<typeof resolveServicePreset> | undefined,
): Array<{ id: string; name: string }> {
  const endpointModels = endpoint?.models
    .filter((model) => model.enabled !== false)
    .filter((model) => isTextChatModelId(model.id))
    .map((model) => ({ id: model.id, name: model.id }))
    ?? [];
  if (endpointModels.length > 0) return endpointModels;
  return preset?.knownModels?.map((id) => ({ id, name: id })) ?? [];
}

function shouldTrustStaticModelsWhenLiveListUnavailable(endpoint: ReturnType<typeof getAllEndpoints>[number] | undefined): boolean {
  return endpoint?.group === "aggregator";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string, lang: StudioLanguage = "zh"): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(pick(lang, `${label} 超时（${timeoutMs}ms）`, `${label} timed out (${timeoutMs}ms)`))),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function formatServiceProbeError(args: {
  readonly service: string;
  readonly label?: string;
  readonly baseUrl: string;
  readonly model?: string;
  readonly apiFormat?: "chat" | "responses";
  readonly stream?: boolean;
  readonly error: string;
  readonly language?: StudioLanguage;
}): string {
  const lang = args.language ?? "zh";
  const rawDetail = args.error
    .replace(/\n\s*\(baseUrl:[\s\S]*?\)$/m, "")
    .trim();
  const upstreamDetail = rawDetail.includes("上游详情：")
    ? rawDetail
    : "";
  const protocol = args.apiFormat === "responses" ? "Responses" : "Chat / Completions";
  const streamSuffix = typeof args.stream === "boolean"
    ? pick(lang, `，${args.stream ? "流式" : "非流式"}`, `, ${args.stream ? "streaming" : "non-streaming"}`)
    : "";
  const context = [
    pick(lang, `服务商：${args.label ?? args.service}`, `Service: ${args.label ?? args.service}`),
    pick(lang, `测试模型：${args.model ?? "未确定"}`, `Test model: ${args.model ?? "undetermined"}`),
    pick(lang, `协议：${protocol}${streamSuffix}`, `Protocol: ${protocol}${streamSuffix}`),
    pick(lang, `Base URL：${args.baseUrl}`, `Base URL: ${args.baseUrl}`),
  ].join("\n");
  const upstreamPrefix = (detail: string): string =>
    pick(lang, `\n上游返回：${detail}`, `\nUpstream response: ${detail}`);

  if (args.service === "google") {
    return [
      pick(lang, "Google Gemini 测试连接失败。", "Google Gemini connection test failed."),
      context,
      "",
      pick(lang, "请优先检查：", "Check these first:"),
      pick(
        lang,
        "1. API Key 是否来自 Google AI Studio 的 Gemini API key，而不是 OAuth、Vertex AI 或其它 Google 服务凭据。",
        "1. The API Key is a Gemini API key from Google AI Studio, not an OAuth, Vertex AI, or other Google service credential.",
      ),
      pick(
        lang,
        "2. 该 key 所属项目是否已启用 Gemini API，并且没有被限制到其它 API、来源或服务。",
        "2. The key's project has the Gemini API enabled and is not restricted to other APIs, origins, or services.",
      ),
      pick(
        lang,
        "3. 当前地区/账号是否允许访问 Gemini API。",
        "3. Your region/account is allowed to access the Gemini API.",
      ),
      pick(
        lang,
        "4. 如果 key 曾经泄露，请在 AI Studio 重新生成后再保存。",
        "4. If the key was ever leaked, regenerate it in AI Studio before saving.",
      ),
      upstreamDetail ? upstreamPrefix(upstreamDetail) : "",
    ].filter(Boolean).join("\n");
  }

  if (args.service === "moonshot" || args.service === "kimiCodingPlan" || args.service === "kimicode") {
    return [
      pick(lang, `${args.label ?? args.service} 测试连接失败。`, `${args.label ?? args.service} connection test failed.`),
      context,
      "",
      pick(
        lang,
        "请优先检查模型是否可用，以及 kimi-k2.x 这类模型是否需要 temperature=1。",
        "Check first whether the model is available, and whether models like kimi-k2.x require temperature=1.",
      ),
      rawDetail ? upstreamPrefix(rawDetail) : "",
    ].filter(Boolean).join("\n");
  }

  return [
    pick(lang, `${args.label ?? args.service} 测试连接失败。`, `${args.label ?? args.service} connection test failed.`),
    context,
    "",
    pick(
      lang,
      "请检查 API Key、模型可用性、账号额度，以及协议类型是否匹配该服务商。",
      "Check the API Key, model availability, account quota, and whether the protocol type matches this service.",
    ),
    rawDetail ? upstreamPrefix(rawDetail) : "",
  ].filter(Boolean).join("\n");
}

async function fetchModelsFromServiceBaseUrl(
  serviceId: string,
  baseUrl: string,
  apiKey: string,
  proxyUrl?: string,
  lang: StudioLanguage = "zh",
): Promise<{ models: Array<{ id: string; name: string }>; error?: string; authFailed?: boolean }> {
  const endpoint = isCustomServiceId(serviceId)
    ? undefined
    : getAllEndpoints().find((ep) => ep.id === serviceId);
  const modelsBaseUrl = isCustomServiceId(serviceId)
    ? baseUrl
    : endpoint?.modelsBaseUrl ?? (endpoint ? baseUrl : resolveServiceModelsBaseUrl(serviceId) ?? baseUrl);
  const modelsUrl = modelsBaseUrl.replace(/\/$/, "") + "/models";
  try {
    const res = await fetchWithProxy(modelsUrl, {
      headers: buildBearerAuthHeaders(apiKey, lang),
      signal: AbortSignal.timeout(SERVICE_MODELS_PROBE_TIMEOUT_MS),
    }, proxyUrl);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        models: [],
        error: pick(
          lang,
          `服务商返回 ${res.status}: ${body.slice(0, 200)}`,
          `Service returned ${res.status}: ${body.slice(0, 200)}`,
        ),
        authFailed: res.status === 401 || res.status === 403,
      };
    }
    const json = await res.json() as { data?: Array<{ id: string }> };
    return {
      models: (json.data ?? []).map((m) => ({ id: m.id, name: m.id })),
    };
  } catch (error) {
    return {
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildBearerAuthHeaders(apiKey: string | undefined, lang: StudioLanguage = "zh"): Record<string, string> {
  const trimmed = apiKey?.trim() ?? "";
  if (!trimmed) return {};
  if (!/^[\x20-\x7e]+$/.test(trimmed)) {
    throw new Error(pick(
      lang,
      "API Key 只能包含英文、数字和常见 ASCII 符号，请检查是否误粘贴了中文说明。",
      "API Key may only contain ASCII letters, digits, and common symbols. Check whether you pasted explanatory text by mistake.",
    ));
  }
  return { Authorization: `Bearer ${trimmed}` };
}

async function probeServiceCapabilities(args: {
  root: string;
  service: string;
  apiKey: string;
  baseUrl: string;
  preferredApiFormat?: "chat" | "responses";
  preferredStream?: boolean;
  preferredModel?: string;
  proxyUrl?: string;
  language?: StudioLanguage;
}): Promise<ServiceProbeResult> {
  const lang = args.language ?? "zh";
  const rawConfig = await loadRawConfig(args.root).catch(() => ({} as Record<string, unknown>));
  const llm = (rawConfig.llm as Record<string, unknown> | undefined) ?? {};
  const envConfig = await readEnvConfigStatus(args.root);
  const envModel = envConfig.effectiveSource === "project"
    ? envConfig.project.model
    : envConfig.effectiveSource === "global"
      ? envConfig.global.model
      : null;

  const baseService = isCustomServiceId(args.service) ? "custom" : args.service;
  const modelsResponse = await fetchModelsFromServiceBaseUrl(baseService, args.baseUrl, args.apiKey, args.proxyUrl, lang);
  if (modelsResponse.authFailed) {
    return {
      ok: false,
      models: [],
      error: modelsResponse.error ?? pick(
        lang,
        "API Key 无效或无权访问模型列表。",
        "API Key is invalid or has no access to the model list.",
      ),
    };
  }
  const discoveredModels = modelsResponse.models;
  const endpoint = getAllEndpoints().find((ep) => ep.id === baseService);
  const preset = resolveServicePreset(baseService);
  const discoveredFirstModel =
    discoveredModels.find((model) => isTextChatModelId(model.id))?.id
    ?? discoveredModels[0]?.id;
  if (discoveredModels.length > 0) {
    if (!discoveredFirstModel || !isTextChatModelId(discoveredFirstModel)) {
      return {
        ok: false,
        models: discoveredModels,
        error: pick(
          lang,
          "模型列表可访问，但没有发现可用于文本对话的模型。",
          "The model list is reachable, but no model usable for text chat was found.",
        ),
      };
    }
    return {
      ok: true,
      models: discoveredModels,
      selectedModel: discoveredFirstModel,
      apiFormat: args.preferredApiFormat ?? "chat",
      stream: args.preferredStream ?? false,
      baseUrl: args.baseUrl,
      modelsSource: "api",
    };
  }
  if (shouldTrustStaticModelsWhenLiveListUnavailable(endpoint)) {
    const models = fallbackTextModelsForEndpoint(endpoint, preset);
    const selectedModel =
      endpoint?.checkModel && models.some((model) => model.id === endpoint.checkModel)
        ? endpoint.checkModel
        : models[0]?.id;
    if (selectedModel) {
      return {
        ok: true,
        models,
        selectedModel,
        apiFormat: args.preferredApiFormat ?? "chat",
        stream: args.preferredStream ?? false,
        baseUrl: args.baseUrl,
        modelsSource: "fallback",
      };
    }
  }
  // Prefer live /models results; if unavailable, probe with the service's own check model before global defaults.
  const serviceFirstModel =
    endpoint?.checkModel
    ?? preset?.knownModels?.[0]
    ?? endpoint?.models.find((model) => model.enabled !== false)?.id;
  const useDynamicLocalModels = baseService === "ollama" || baseService === "lmstudio";
  const useEndpointCheckModel = !useDynamicLocalModels
    && !isCustomServiceId(args.service)
    && discoveredModels.length === 0
    && Boolean(endpoint?.checkModel);
  const configService = typeof llm.service === "string" ? llm.service : undefined;
  const configModel = !useEndpointCheckModel && configService === args.service
    ? typeof llm.defaultModel === "string"
      ? llm.defaultModel
      : typeof llm.model === "string"
        ? llm.model
        : undefined
    : undefined;
  const useCustomFallbacks = false;
  const modelCandidates = buildModelCandidates({
    preferredModel: args.preferredModel ?? serviceFirstModel,
    configModel,
    envModel: useCustomFallbacks ? envModel : undefined,
    discoveredModels: useEndpointCheckModel ? [] : discoveredModels,
    includeGenericFallbacks: useCustomFallbacks,
  });

  if (modelCandidates.length === 0) {
    return {
      ok: false,
      models: [],
      error: pick(
        lang,
        "无法自动确定模型，请先填写可用模型或提供支持 /models 的服务端点。",
        "Could not determine a model automatically. Fill in an available model first, or provide a service endpoint that supports /models.",
      ),
    };
  }

  let lastError = modelsResponse.error ?? pick(lang, "自动探测失败", "Automatic probing failed");

  for (const model of modelCandidates) {
    for (const plan of buildProbePlans(args.preferredApiFormat, args.preferredStream)) {
      const client = createLLMClient({
        provider: resolveServiceProviderFamily(baseService) ?? "openai",
        service: baseService,
        configSource: "studio",
        baseUrl: args.baseUrl,
        apiKey: args.apiKey.trim(),
        model,
        temperature: 0.7,
        maxTokens: 16,
        thinkingBudget: 0,
        proxyUrl: args.proxyUrl,
        apiFormat: plan.apiFormat,
        stream: plan.stream,
      } as ProjectConfig["llm"]);

      try {
        await withTimeout(
          // A connectivity probe wants a fast pass/fail — never the transient
          // retry+backoff, which would multiply the time when the upstream is
          // rate-limiting (and make the diagnostics page hang).
          chatCompletion(client, model, [{ role: "user", content: "Reply with OK only." }], { maxTokens: 16, retry: false }),
          SERVICE_CHAT_PROBE_TIMEOUT_MS,
          "service connection test",
          lang,
        );
        const models = discoveredModels.length > 0
          ? discoveredModels
          : fallbackTextModelsForEndpoint(endpoint, preset);
        return {
          ok: true,
          models: models.length > 0 ? models : [{ id: model, name: model }],
          selectedModel: model,
          apiFormat: plan.apiFormat,
          stream: plan.stream,
          baseUrl: args.baseUrl,
          modelsSource: discoveredModels.length > 0 ? "api" : "fallback",
        };
      } catch (error) {
        lastError = formatServiceProbeError({
          service: baseService,
          label: endpoint?.label ?? preset?.label,
          baseUrl: args.baseUrl,
          model,
          apiFormat: plan.apiFormat,
          stream: plan.stream,
          error: error instanceof Error ? error.message : String(error),
          language: lang,
        });
      }
    }
  }

  return {
    ok: false,
    models: discoveredModels,
    error: lastError,
  };
}

// --- Server factory ---

export function createStudioServer(initialConfig: ProjectConfig, root: string, overrides: { readonly nodeImageGenerator?: NodeImageDeps } = {}) {
  const app = new Hono();
  const state = new StateManager(root);
  let cachedConfig = initialConfig;
  const activeConfirmedTasks = new Map<string, AbortController>();
  // 确认式生产任务的单任务名额（sessionId → taskId）。原来的检查是"await 读快照
  // → 之后才 set controller"的 check-then-act：两个并发确认请求都能通过检查，
  // 双任务同时启动、快照互相覆盖。这里在任何 await 之前同步占位，占位失败的
  // 请求直接 409；任务结束（成功/失败）后在 finally 释放。
  // 值记 taskId：controller 注册与首次快照持久化之间有多个 await 间隙，删除/
  // 中止在这个窗口内从磁盘读不到快照，必须先经内存 sessionId → taskId →
  // controller 找到刚启动的任务。
  const reservedProductionSessions = new Map<string, string>();
  // 已删除会话的 sessionId：删除会话时中止其生产任务，任务随后的错误持久化
  // 不能把快照文件重新写回来（给已删除的会话"还魂"）。同名会话重新创建时移除标记。
  const deletedSessionIds = new Set<string>();

  // 已删除会话不再追加 transcript 消息：appendManualSessionMessages 底层的
  // appendTranscriptEvents 是 mkdir + appendFile，会把已删除会话的 sessions
  // 目录条目和 transcript 文件重建出来（任务成功/失败的收尾追加正好落在删除
  // 之后）。所有手动追加统一走这个守卫。
  const appendSessionMessagesUnlessDeleted: typeof appendManualSessionMessages = async (
    projectRoot,
    sessionId,
    messages,
    input,
    options,
  ) => {
    if (deletedSessionIds.has(sessionId)) return;
    await appendManualSessionMessages(projectRoot, sessionId, messages, input, options);
  };

  const persistConfirmedTask = async (
    sessionId: string,
    requestedIntent: RequestedIntent,
    exec: CollectedToolExec,
    sourceRequestId?: string,
  ): Promise<void> => {
    if (deletedSessionIds.has(sessionId)) return;
    const snapshot: StudioTaskSnapshot = {
      version: 1,
      sessionId,
      ...(sourceRequestId ? { sourceRequestId } : {}),
      requestedIntent,
      updatedAt: Date.now(),
      execution: {
        ...exec,
        ...(exec.stages ? { stages: exec.stages.map((stage) => ({ ...stage })) } : {}),
        ...(exec.logs ? { logs: [...exec.logs] } : {}),
      },
    };
    await saveStudioTaskSnapshot(root, snapshot);
  };

  const loadReconciledTaskSnapshot = async (sessionId: string): Promise<StudioTaskSnapshot | null> => {
    const task = await loadStudioTaskSnapshot(root, sessionId);
    if (!task) return null;
    const running = task.execution.status === "running" || task.execution.status === "processing";
    if (!running || activeConfirmedTasks.has(task.execution.id)) return task;
    // running 快照但本进程没有对应的 AbortController，只可能是任务运行期间
    // server 进程退出过（正常流程里 controller 先于首次持久化进入 Map、晚于
    // 终态持久化删除）。任务本体已随旧进程消失，这里把快照改写为终态并保存，
    // 否则前端每次刷新都会恢复出一个永远运行中的任务卡，停止按钮也无法终结它。
    const lang = await currentProjectLanguage();
    const completedAt = Date.now();
    const reconciled: StudioTaskSnapshot = {
      ...task,
      updatedAt: completedAt,
      execution: {
        ...task.execution,
        status: "error",
        error: pick(
          lang,
          "任务已中断：Studio 服务在任务运行期间重启，任务未能继续。请重新发起。",
          "Task interrupted: the Studio server restarted while this task was running. Please start it again.",
        ),
        completedAt,
      },
    };
    await saveStudioTaskSnapshot(root, reconciled);
    return reconciled;
  };

  // 判断"该会话是否真有生产任务在跑"的唯一入口：
  // 对账后的快照是 running/processing，且本进程还持有对应的 AbortController。
  const findActiveRunningTask = async (sessionId: string): Promise<StudioTaskSnapshot | null> => {
    const task = await loadReconciledTaskSnapshot(sessionId);
    if (!task) return null;
    const running = task.execution.status === "running" || task.execution.status === "processing";
    return running && activeConfirmedTasks.has(task.execution.id) ? task : null;
  };

  // 找该会话正在运行的任务控制器：优先查内存（预留表 sessionId → taskId →
  // controller），磁盘快照只作回退。controller 注册与首次快照持久化之间有多个
  // await 间隙，窗口内删除/中止只靠磁盘快照会漏掉刚启动的任务。
  const findRunningTaskController = async (sessionId: string): Promise<AbortController | undefined> => {
    const reservedTaskId = reservedProductionSessions.get(sessionId);
    const reserved = reservedTaskId ? activeConfirmedTasks.get(reservedTaskId) : undefined;
    if (reserved) return reserved;
    const task = await loadReconciledTaskSnapshot(sessionId);
    return task ? activeConfirmedTasks.get(task.execution.id) : undefined;
  };

  app.use("/*", cors());

  // Structured error handler — ApiError returns typed JSON, others return 500
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status as 400);
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("LLM API key not set") || message.includes("INKOS_LLM_API_KEY not set")) {
      return c.json({ error: { code: "LLM_CONFIG_ERROR", message } }, 400);
    }
    console.error("[studio] Unexpected server error", error);
    return c.json(
      { error: { code: "INTERNAL_ERROR", message: "Unexpected server error." } },
      500,
    );
  });

  // BookId validation middleware — blocks path traversal on all book routes
  app.use("/api/v1/books/:id/*", async (c, next) => {
    const bookId = c.req.param("id");
    if (!isSafeBookId(bookId)) {
      throw new ApiError(400, "INVALID_BOOK_ID", `Invalid book ID: "${bookId}"`);
    }
    await next();
  });
  app.use("/api/v1/books/:id", async (c, next) => {
    const bookId = c.req.param("id");
    if (!isSafeBookId(bookId)) {
      throw new ApiError(400, "INVALID_BOOK_ID", `Invalid book ID: "${bookId}"`);
    }
    await next();
  });

  // Logger sink that broadcasts to SSE
  const sseSink: LogSink = {
    write(entry: LogEntry): void {
      broadcast("log", { level: entry.level, tag: entry.tag, message: entry.message });
    },
  };

  // Logger sink that prints to server terminal
  const consoleSink: LogSink = {
    write(entry: LogEntry): void {
      const prefix = `[${entry.tag}]`;
      if (entry.level === "warn") console.warn(prefix, entry.message);
      else if (entry.level === "error") console.error(prefix, entry.message);
      else console.log(prefix, entry.message);
    },
  };

  async function loadCurrentProjectConfig(
    options?: { readonly requireApiKey?: boolean },
  ): Promise<ProjectConfig> {
    const freshConfig = await loadProjectConfig(root, { ...options, consumer: "studio" });
    cachedConfig = freshConfig;
    return freshConfig;
  }

  // Read the project language fresh from inkos.json on every call, so a language
  // switch takes effect on the next request instead of being frozen at startup.
  // A missing/corrupt inkos.json means "no project language configured" -> zh.
  async function currentProjectLanguage(): Promise<StudioLanguage> {
    const raw = await loadRawConfig(root).catch(() => ({} as Record<string, unknown>));
    return normalizeStudioLanguage(raw.language);
  }

  async function buildPipelineConfig(
    overrides?: Partial<Pick<PipelineConfig, "externalContext" | "client" | "model" | "revisionGate">> & {
      readonly currentConfig?: ProjectConfig;
      readonly sessionIdForSSE?: string;
      // 确认式生产任务的 execution id。给任务构建 pipeline 时传入，该 pipeline
      // 广播的 log / llm:progress / context:compression 事件都会带上 executionId，
      // 前端据此把事件精确附加到任务卡；同会话聊天轮构建的 pipeline 不传，
      // 事件维持只带 sessionId，走"最近一张运行中卡"的回退。
      readonly executionIdForSSE?: string;
      readonly bookIdForSettings?: string;
    },
  ): Promise<PipelineConfig> {
    const currentConfig = overrides?.currentConfig ?? await loadCurrentProjectConfig();
    const projectReviewMode = readProjectChapterReviewMode(currentConfig as unknown as Record<string, unknown>);
    const chapterReviewMode = await resolveBookChapterReviewMode(root, overrides?.bookIdForSettings, projectReviewMode);
    const projectRevisionGate = readProjectRevisionGate(currentConfig as unknown as Record<string, unknown>);
    const revisionGate = await resolveBookRevisionGate(root, overrides?.bookIdForSettings, projectRevisionGate);
    const sseExecutionTag = overrides?.executionIdForSSE
      ? { executionId: overrides.executionIdForSSE }
      : {};
    const scopedSseSink: LogSink = overrides?.sessionIdForSSE
      ? {
          write(entry) {
            broadcast("log", {
              sessionId: overrides.sessionIdForSSE,
              ...sseExecutionTag,
              level: entry.level,
              tag: entry.tag,
              message: entry.message,
            });
          },
        }
      : sseSink;
    const logger = createLogger({ tag: "studio", sinks: [scopedSseSink, consoleSink] });
    return {
      client: overrides?.client ?? createLLMClient(currentConfig.llm),
      model: overrides?.model ?? currentConfig.llm.model,
      projectRoot: root,
      defaultLLMConfig: currentConfig.llm,
      foundationReviewRetries: currentConfig.foundation?.reviewRetries ?? 2,
      writingReviewRetries: currentConfig.writing?.reviewRetries ?? 1,
      chapterReviewMode,
      revisionGate: overrides?.revisionGate ?? revisionGate,
      modelOverrides: currentConfig.modelOverrides,
      notifyChannels: currentConfig.notify,
      logger,
      onContextCompression: (event) => {
        broadcast("context:compression", {
          ...(overrides?.sessionIdForSSE ? { sessionId: overrides.sessionIdForSSE } : {}),
          ...sseExecutionTag,
          ...event,
        });
      },
      onStreamProgress: (progress) => {
        broadcast("llm:progress", {
          ...(overrides?.sessionIdForSSE ? { sessionId: overrides.sessionIdForSSE } : {}),
          ...sseExecutionTag,
          status: progress.status,
          elapsedMs: progress.elapsedMs,
          totalChars: progress.totalChars,
          chineseChars: progress.chineseChars,
        });
      },
      externalContext: overrides?.externalContext,
    };
  }

  // --- Books ---

  app.get("/api/v1/books", async (c) => {
    const bookIds = await state.listBooks();
    const books = await Promise.all(bookIds.map((id) => loadStudioBookListSummary(state, id)));
    return c.json({ books });
  });

  app.get("/api/v1/books/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const book = await state.loadBookConfig(id);
      const chapters = await state.loadChapterIndex(id);
      const nextChapter = await state.getNextChapterNumber(id);
      return c.json({ book, chapters, nextChapter });
    } catch {
      return c.json({ error: `Book "${id}" not found` }, 404);
    }
  });

  // --- Genres ---

  app.get("/api/v1/genres", async (c) => {
    const { listAvailableGenres, readGenreProfile } = await import("@actalk/inkos-core");
    const rawGenres = await listAvailableGenres(root);
    const genres = await Promise.all(
      rawGenres.map(async (g) => {
        try {
          const { profile } = await readGenreProfile(root, g.id);
          return { ...g, language: profile.language ?? "zh" };
        } catch {
          return { ...g, language: "zh" };
        }
      }),
    );
    return c.json({ genres });
  });

  // --- Book Create ---

  app.post("/api/v1/books/create", async (c) => {
    const body = await c.req.json<{
      title: string;
      genre: string;
      language?: string;
      platform?: string;
      chapterWordCount?: number;
      targetChapters?: number;
      blurb?: string;
    }>();

    const now = new Date().toISOString();
    const bookConfig = buildStudioBookConfig(body, now);
    const bookId = bookConfig.id;
    const bookDir = state.bookDir(bookId);

    if (!bookId) {
      return c.json({ error: "Could not derive a valid book id from title" }, 400);
    }
    if (await completeBookExists(bookDir)) {
      return c.json({ error: `Book "${bookId}" already exists` }, 409);
    }

    broadcast("book:creating", { bookId, title: body.title });
    bookCreateStatus.set(bookId, { status: "creating" });

    const pipeline = new PipelineRunner(await buildPipelineConfig());
    const tools = createInteractionToolsFromDeps(pipeline, state);
    processProjectInteractionRequest({
      projectRoot: root,
      request: {
        intent: "create_book",
        title: body.title,
        genre: body.genre,
        language: body.language === "en" ? "en" : body.language === "zh" ? "zh" : undefined,
        platform: body.platform,
        chapterWordCount: body.chapterWordCount,
        targetChapters: body.targetChapters,
        blurb: body.blurb,
      },
      tools,
    }).then(
      async (result: {
        readonly session: { readonly activeBookId?: string };
        readonly details?: Readonly<Record<string, unknown>>;
      }) => {
        const createdBookId = resolveCreatedBookIdFromDetails(result.details);
        if (!createdBookId) {
          const error = "Book creation did not produce a completed book artifact.";
          bookCreateStatus.set(bookId, { status: "error", error });
          broadcast("book:error", { bookId, error });
          return;
        }
        if (!await completeBookExists(join(root, "books", createdBookId))) {
          const error = "Book creation artifact is incomplete on disk.";
          bookCreateStatus.set(createdBookId, { status: "error", error });
          broadcast("book:error", { bookId: createdBookId, error });
          return;
        }
        const book = await loadStudioBookListSummary(state, createdBookId).catch(() => undefined);
        bookCreateStatus.delete(createdBookId);
        broadcast("book:created", { bookId: createdBookId, ...(book ? { book } : {}) });
      },
      (e: unknown) => {
        const error = e instanceof Error ? e.message : String(e);
        bookCreateStatus.set(bookId, { status: "error", error });
        broadcast("book:error", { bookId, error });
      },
    );

    return c.json({ status: "creating", bookId });
  });

  app.get("/api/v1/books/:id/create-status", async (c) => {
    const id = c.req.param("id");
    const status = bookCreateStatus.get(id);
    if (status) {
      return c.json(status);
    }
    // No in-memory entry. On success the entry is deleted, and a long architect
    // run (or a server restart) can also drop it — so a bare 404 is ambiguous
    // ("done" vs "never existed"). Check disk: if the foundation is fully
    // written, the book really is ready; report that truthfully.
    const { isBookFoundationComplete } = await import("@actalk/inkos-core");
    if (await isBookFoundationComplete(state.bookDir(id))) {
      return c.json({ status: "ready" });
    }
    return c.json({ status: "missing" }, 404);
  });

  // --- Chapters ---

  app.get("/api/v1/books/:id/chapters/:num", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    const bookDir = state.bookDir(id);
    const chaptersDir = join(bookDir, "chapters");

    try {
      const files = await readdir(chaptersDir);
      const paddedNum = String(num).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);
      const content = await readFile(join(chaptersDir, match), "utf-8");
      return c.json({ chapterNumber: num, filename: match, content });
    } catch {
      return c.json({ error: "Chapter not found" }, 404);
    }
  });

  app.get("/api/v1/books/:id/chapters/:num/workspace", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    if (!Number.isInteger(num) || num < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    try {
      const bookDir = state.bookDir(id);
      const [brief, plan, versions, index] = await Promise.all([
        readChapterUserBrief(bookDir, num),
        readChapterPlanDocument(bookDir, num),
        listChapterVersions(bookDir, num),
        state.loadChapterIndex(id),
      ]);
      const latestChapter = index.reduce((latest, chapter) => Math.max(latest, chapter.number), 0);
      return c.json({
        chapterNumber: num,
        brief,
        plan,
        versions,
        canDelete: num === latestChapter,
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.put("/api/v1/books/:id/chapters/:num/workspace/brief", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    const body: { brief?: unknown } = await c.req.json<{ brief?: unknown }>().catch(() => ({}));
    if (!Number.isInteger(num) || num < 1 || typeof body.brief !== "string") {
      return c.json({ error: "A valid chapter number and brief string are required" }, 400);
    }
    try {
      await saveChapterUserBrief(state.bookDir(id), num, body.brief);
      return c.json({ ok: true, chapterNumber: num, brief: body.brief.trim() });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/chapters/:num/workspace/inspiration", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    const body: { brief?: unknown } = await c.req.json<{ brief?: unknown }>().catch(() => ({}));
    if (!Number.isInteger(num) || num < 1 || (body.brief !== undefined && typeof body.brief !== "string")) {
      return c.json({ error: "A valid chapter number and optional brief string are required" }, 400);
    }
    try {
      const bookDir = state.bookDir(id);
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(num).padStart(4, "0");
      const chapterFile = files.find((file) => file.startsWith(paddedNum) && file.endsWith(".md"));
      if (!chapterFile) {
        return c.json({ error: "Chapter not found" }, 404);
      }
      const [chapter, persistedBrief, plan, book, pipelineConfig] = await Promise.all([
        readFile(join(chaptersDir, chapterFile), "utf-8"),
        readChapterUserBrief(bookDir, num),
        readChapterPlanDocument(bookDir, num),
        state.loadBookConfig(id),
        buildPipelineConfig({ bookIdForSettings: id }),
      ]);
      const language = book.language === "en" ? "en" : "zh";
      const requestedBrief = typeof body.brief === "string" ? body.brief.trim() : "";
      const response = await chatCompletion(
        pipelineConfig.client,
        pipelineConfig.model,
        [
          {
            role: "system",
            content: language === "en"
              ? [
                  "You are a fiction editor generating one optional inspiration card for a chapter rewrite.",
                  "Offer a concrete alternative beat, evidence/action detail, and ending turn that fit the supplied canon.",
                  "Do not rewrite the chapter, modify canon, or claim any file was changed.",
                  "Return only a short, readable Markdown card.",
                ].join("\n")
              : [
                  "你是小说编辑，只为本章重写生成一张可选的灵感卡。",
                  "给出一个符合现有设定的具体替代场面、证据或行动细节，以及章尾转折。",
                  "不要代写整章，不要改写既成事实，也不要声称已经修改文件。",
                  "只返回简短、可读的 Markdown 灵感卡。",
                ].join("\n"),
          },
          {
            role: "user",
            content: [
              language === "en" ? `Book: ${book.title}` : `书名：${book.title}`,
              language === "en" ? `Chapter: ${num}` : `章节：第${num}章`,
              requestedBrief || persistedBrief
                ? `${language === "en" ? "Current user brief" : "当前用户提示"}:\n${requestedBrief || persistedBrief}`
                : "",
              plan ? `${language === "en" ? "Generated chapter plan" : "系统章节计划"}:\n${plan}` : "",
              `${language === "en" ? "Current chapter" : "当前章节"}:\n${chapter}`,
            ].filter(Boolean).join("\n\n"),
          },
        ],
        { temperature: 0.9, maxTokens: 600 },
      );
      const card = response.content.trim();
      if (!card) {
        throw new Error("The model returned an empty inspiration card");
      }
      return c.json({ chapterNumber: num, card });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.get("/api/v1/books/:id/chapters/:num/versions/:versionId", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    try {
      const content = await readChapterVersion(
        state.bookDir(id),
        num,
        c.req.param("versionId"),
      );
      return c.json({ chapterNumber: num, versionId: c.req.param("versionId"), content });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 404);
    }
  });

  app.post("/api/v1/books/:id/chapters/:num/versions/:versionId/restore", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    const releaseLock = await state.acquireBookLock(id);
    try {
      const fullText = await readChapterVersion(
        state.bookDir(id),
        num,
        c.req.param("versionId"),
      );
      const result = await executeEditTransaction(
        {
          bookDir: (bookId) => state.bookDir(bookId),
          loadChapterIndex: (bookId) => state.loadChapterIndex(bookId),
          saveChapterIndex: (bookId, index) => state.saveChapterIndex(bookId, index),
        },
        {
          kind: "chapter-replace",
          bookId: id,
          chapterNumber: num,
          fullText,
          versionSource: "restore",
        },
      );
      broadcast("chapter:restored", { bookId: id, chapterNumber: num });
      return c.json({ ok: true, chapterNumber: num, versionId: c.req.param("versionId"), result });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    } finally {
      await releaseLock();
    }
  });

  app.delete("/api/v1/books/:id/chapters/:num", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    const releaseLock = await state.acquireBookLock(id);
    try {
      const result = await deleteLatestChapter(state, id, { chapterNumber: num });
      broadcast("chapter:deleted", { bookId: id, chapterNumber: result.deletedChapter });
      return c.json({ ok: true, ...result });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    } finally {
      await releaseLock();
    }
  });

  // --- Chapter Save ---

  app.put("/api/v1/books/:id/chapters/:num", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    const { content } = await c.req.json<{ content: string }>();

    const releaseLock = await state.acquireBookLock(id);
    try {
      const result = await executeEditTransaction(
        {
          bookDir: (bookId) => state.bookDir(bookId),
          loadChapterIndex: (bookId) => state.loadChapterIndex(bookId),
          saveChapterIndex: (bookId, index) => state.saveChapterIndex(bookId, index),
        },
        {
          kind: "chapter-replace",
          bookId: id,
          chapterNumber: num,
          fullText: content,
          versionSource: "manual",
        },
      );
      return c.json({ ok: true, chapterNumber: num, result });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    } finally {
      await releaseLock();
    }
  });

  // --- Truth files ---

  // Flat-file whitelist — the pre-Phase-5 story root files plus dev's legacy
  // editor targets (author_intent / current_focus / volume_outline).
  //
  // Phase 5 cleanup #3 moved the authoritative YAML frontmatter + outline prose
  // into story/outline/ and character sheets into story/roles/. `story_bible.md`
  // and `book_rules.md` now exist only as compat pointer shims — we still allow
  // reading them so legacy books keep rendering, but the server-side writer
  // (write_truth_file) no longer accepts them as edit targets.
  const TRUTH_FLAT_FILES = [
    "author_intent.md", "current_focus.md",
    "story_bible.md", "book_rules.md", "volume_outline.md", "current_state.md",
    "particle_ledger.md", "pending_hooks.md", "chapter_summaries.md",
    "subplot_board.md", "emotional_arcs.md", "character_matrix.md",
    "style_guide.md", "parent_canon.md", "fanfic_canon.md",
  ];

  // Authoritative Phase 5 paths — prose outline + role sheets live under
  // dedicated subdirectories of story/. The full path (relative to story/) is
  // matched literally here. `节奏原则.md` / `rhythm_principles.md` is optional
  // after Phase 5 consolidation (rhythm lives in volume_map's closing paragraph);
  // the entries stay whitelisted for legacy books and manual overrides.
  const TRUTH_OUTLINE_FILES = [
    "outline/story_frame.md",
    "outline/volume_map.md",
    "outline/节奏原则.md",
    "outline/rhythm_principles.md",
  ];

  // Pointer shims that the runtime no longer treats as authoritative. The
  // GET handler tags them with `legacy: true` so the UI can surface that the
  // edits won't land where the user expects.
  const LEGACY_SHIM_FILES = new Set(["story_bible.md", "book_rules.md"]);
  const RUNTIME_DIAGNOSTIC_FILE_RE = /^runtime\/chapter-\d{4}\.(?:intent\.md|plan\.md|context\.json|rule-stack\.yaml|trace\.json)$/;

  /**
   * Validate a requested truth-file path:
   *   1. Must be one of the declared flat files, an outline/* allow-listed
   *      entry, a runtime chapter trace file, or a roles/**\/*.md file under
   *      主要角色/ | 次要角色/.
   *   2. Must resolve to a path inside bookDir/story/ (no `..`, no absolute
   *      paths, no traversal via the tier-name segment).
   */
  function resolveTruthFilePath(bookDir: string, file: string): string | null {
    // Reject absolute paths, traversal, null bytes outright.
    if (!file || file.includes("\0") || isAbsolute(file) || file.includes("..")) {
      return null;
    }

    // Phase hotfix 3: accept both Chinese and English locale role dirs so
    // English-layout books (roles/major, roles/minor) are reachable through
    // Studio. The runtime reader (utils/outline-paths.ts:75) already scans
    // both — Studio used to drop English books to read-only.
    const allowed =
      TRUTH_FLAT_FILES.includes(file)
      || TRUTH_OUTLINE_FILES.includes(file)
      || RUNTIME_DIAGNOSTIC_FILE_RE.test(file)
      || /^roles\/(主要角色|次要角色|major|minor)\/[^/]+\.md$/.test(file);

    if (!allowed) return null;

    const storyDir = resolve(bookDir, "story");
    const resolved = resolve(storyDir, file);
    const relativePath = relative(storyDir, resolved);
    if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      return null;
    }
    return resolved;
  }

  async function fileExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  // Use `:file{.+}` wildcard so nested paths (outline/..., roles/.../...) match.
  app.get("/api/v1/books/:id/truth/:file{.+}", async (c) => {
    const file = c.req.param("file");
    const id = c.req.param("id");

    const bookDir = state.bookDir(id);
    const resolved = resolveTruthFilePath(bookDir, file);
    if (!resolved) {
      return c.json({ error: "Invalid truth file" }, 400);
    }

    // Phase 5: new-layout books keep the authoritative prose under outline/.
    // A legacy book may only have story_bible.md / book_rules.md on disk —
    // we still serve those for read-only display, but flag them so the UI
    // can warn users their edits won't reach the runtime.
    // Hotfix: only tag as legacy when the book actually HAS the new layout.
    // Pre-Phase-5 books use story_bible/book_rules as the authoritative source.
    const { isNewLayoutBook, tryParseBookRulesFrontmatter } = await import("@actalk/inkos-core");
    const legacy = LEGACY_SHIM_FILES.has(file) && await isNewLayoutBook(bookDir);

    try {
      const content = await readFile(resolved, "utf-8");
      // Files like outline/story_frame.md carry a YAML frontmatter block of
      // structured fields (protagonist / genreLock / prohibitions / ...). Parse
      // it here so the UI can render those as friendly cards instead of dumping
      // raw YAML at the reader. `content` stays raw so the editor round-trips it
      // unchanged; `body` is the prose with the frontmatter stripped.
      const parsed = tryParseBookRulesFrontmatter(content);
      const structured = parsed ? { frontmatter: parsed.rules, body: parsed.body } : {};
      const runtimeDiagnostic = RUNTIME_DIAGNOSTIC_FILE_RE.test(file);
      return c.json({
        file,
        content,
        ...structured,
        ...(legacy ? { legacy: true } : {}),
        ...(runtimeDiagnostic ? { readonly: true, readonlyReason: "runtime-diagnostic" } : {}),
      });
    } catch {
      const runtimeDiagnostic = RUNTIME_DIAGNOSTIC_FILE_RE.test(file);
      return c.json({
        file,
        content: null,
        ...(legacy ? { legacy: true } : {}),
        ...(runtimeDiagnostic ? { readonly: true, readonlyReason: "runtime-diagnostic" } : {}),
      });
    }
  });

  // --- Analytics ---

  app.get("/api/v1/books/:id/analytics", async (c) => {
    const id = c.req.param("id");
    try {
      const chapters = await state.loadChapterIndex(id);
      return c.json(computeAnalytics(id, chapters));
    } catch {
      return c.json({ error: `Book "${id}" not found` }, 404);
    }
  });

  // --- Actions ---

  app.post("/api/v1/books/:id/write-next", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ wordCount?: number }>().catch(() => ({ wordCount: undefined }));

    broadcast("write:start", { bookId: id });

    // Fire and forget — progress/completion/errors pushed via SSE
    const pipeline = new PipelineRunner(await buildPipelineConfig({ bookIdForSettings: id }));
    pipeline.writeNextChapter(id, body.wordCount).then(
      (result) => {
        broadcast("write:complete", { bookId: id, chapterNumber: result.chapterNumber, status: result.status, title: result.title, wordCount: result.wordCount });
      },
      (e) => {
        broadcast("write:error", { bookId: id, error: e instanceof Error ? e.message : String(e) });
      },
    );

    return c.json({ status: "writing", bookId: id });
  });

  app.post("/api/v1/books/:id/draft", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ wordCount?: number; context?: string }>().catch(() => ({ wordCount: undefined, context: undefined }));

    broadcast("draft:start", { bookId: id });

    const pipeline = new PipelineRunner(await buildPipelineConfig());
    pipeline.writeDraft(id, body.context, body.wordCount).then(
      (result) => {
        broadcast("draft:complete", { bookId: id, chapterNumber: result.chapterNumber, title: result.title, wordCount: result.wordCount });
      },
      (e) => {
        broadcast("draft:error", { bookId: id, error: e instanceof Error ? e.message : String(e) });
      },
    );

    return c.json({ status: "drafting", bookId: id });
  });

  app.get("/api/v1/books/:id/eval", async (c) => {
    const id = c.req.param("id");
    const chapters = c.req.query("chapters");
    try {
      return c.json(await evaluateBookQuality({ state, bookId: id, chapters }));
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/consolidate", async (c) => {
    const id = c.req.param("id");
    try {
      const pipelineConfig = await buildPipelineConfig();
      const consolidator = new ConsolidatorAgent({
        client: pipelineConfig.client,
        model: pipelineConfig.model,
        projectRoot: root,
      });
      const result = await consolidator.consolidate(state.bookDir(id));
      broadcast("consolidate:complete", { bookId: id, ...result });
      return c.json(result);
    } catch (e) {
      broadcast("consolidate:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/plan", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ context?: string }>().catch(() => ({ context: undefined }));
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      return c.json(await pipeline.planChapter(id, body.context));
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/compose", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ context?: string }>().catch(() => ({ context: undefined }));
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      return c.json(await pipeline.composeChapter(id, body.context));
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/repair-state/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      const result = await pipeline.repairChapterState(id, chapterNum);
      broadcast("repair-state:complete", { bookId: id, chapter: chapterNum });
      return c.json(result);
    } catch (e) {
      broadcast("repair-state:error", { bookId: id, chapter: chapterNum, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/foundation/revise", async (c) => {
    const id = c.req.param("id");
    const { feedback } = await c.req.json<{ feedback?: string }>().catch(() => ({ feedback: undefined }));
    if (!feedback?.trim()) {
      return c.json({ error: "feedback is required" }, 400);
    }
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      await pipeline.reviseFoundation(id, feedback.trim());
      broadcast("foundation:revised", { bookId: id });
      return c.json({ ok: true });
    } catch (e) {
      broadcast("foundation:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/chapters/:num/approve", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);

    try {
      const index = await state.loadChapterIndex(id);
      const updated = index.map((ch) =>
        ch.number === num ? { ...ch, status: "approved" as const } : ch,
      );
      await state.saveChapterIndex(id, updated);
      return c.json({ ok: true, chapterNumber: num, status: "approved" });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/chapters/:num/reject", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);

    try {
      const index = await state.loadChapterIndex(id);
      const target = index.find((ch) => ch.number === num);
      if (!target) {
        return c.json({ error: `Chapter ${num} not found` }, 404);
      }

      const rollbackTarget = num - 1;
      const discarded = await state.rollbackToChapter(id, rollbackTarget);
      return c.json({
        ok: true,
        chapterNumber: num,
        status: "rejected",
        rolledBackTo: rollbackTarget,
        discarded,
      });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- SSE ---

  app.get("/api/v1/events", (c) => {
    return streamSSE(c, async (stream) => {
      const handler: EventHandler = (event, data) => {
        stream.writeSSE({ event, data: JSON.stringify(data) });
      };
      subscribers.add(handler);
      await stream.writeSSE({ event: "ping", data: "" });
      const sessionId = c.req.query("sessionId");
      if (sessionId) {
        const task = await loadReconciledTaskSnapshot(sessionId);
        if (task) await stream.writeSSE({ event: "task:snapshot", data: JSON.stringify(task) });
      }

      // Keep alive
      const keepAlive = setInterval(() => {
        stream.writeSSE({ event: "ping", data: "" });
      }, 30000);

      stream.onAbort(() => {
        subscribers.delete(handler);
        clearInterval(keepAlive);
      });

      // Block until aborted
      await new Promise(() => {});
    });
  });

  // --- Model discovery ---

  app.get("/api/v1/services", async (c) => {
    const secrets = await loadSecrets(root);
    const endpoints = getAllEndpoints().filter((ep) => ep.id !== "custom");
    let configuredServices: ReturnType<typeof normalizeServiceConfig> = [];
    try {
      const config = await loadRawConfig(root);
      configuredServices = normalizeServiceConfig(
        (config.llm as Record<string, unknown> | undefined)?.services,
      );
    } catch { /* no config file */ }
    const configuredBankServices = new Set(
      configuredServices
        .filter((service) => service.service !== "custom")
        .map((service) => service.service),
    );

    // Fast: only check connection status from secrets, no external API calls.
    const services = endpoints.map((ep) => {
      const apiKeyOptional = isApiKeyOptionalForEndpoint({
        provider: resolveServiceProviderFamily(ep.id) ?? "openai",
        baseUrl: resolveServicePreset(ep.id)?.baseUrl ?? ep.baseUrl,
      });
      return {
        service: ep.id,
        label: ep.label,
        group: ep.group,
        apiKeyOptional,
        connected: Boolean(secrets.services[ep.id]?.apiKey)
          || (apiKeyOptional && configuredBankServices.has(ep.id)),
      };
    }).sort(compareServiceListItems);

    // Add custom services from inkos.json
    for (const svc of configuredServices) {
      if (svc.service === "custom") {
        const secretKey = `custom:${svc.name}`;
        const apiKeyOptional = isApiKeyOptionalForEndpoint({
          provider: "openai",
          baseUrl: svc.baseUrl,
        });
        services.push({
          service: secretKey,
          label: svc.name ?? "Custom",
          group: undefined,
          apiKeyOptional,
          connected: Boolean(secrets.services[secretKey]?.apiKey) || apiKeyOptional,
        });
      }
    }

    return c.json({ services });
  });

  app.get("/api/v1/services/config", async (c) => {
    const config = await loadRawConfig(root);
    const llm = (config.llm as Record<string, unknown> | undefined) ?? {};
    const services = normalizeServiceConfig(llm.services);
    const envConfig = await readEnvConfigStatus(root);
    return c.json({
      services,
      service: typeof llm.service === "string" ? llm.service : null,
      defaultModel: llm.defaultModel ?? null,
      configSource: "studio" satisfies LLMConfigSource,
      storedConfigSource: normalizeConfigSource(llm.configSource),
      envConfig,
    });
  });

  app.post("/api/v1/services/config/import-env", async (c) => {
    const env = await readEffectiveEnvConfigValues(root);
    if (!env || !env.values.apiKey) {
      return c.json({
        error: pick(
          await currentProjectLanguage(),
          "未检测到可导入的 LLM 环境变量配置，或缺少 INKOS_LLM_API_KEY。",
          "No importable LLM environment variable configuration was detected, or INKOS_LLM_API_KEY is missing.",
        ),
      }, 400);
    }

    const config = await loadRawConfig(root);
    config.llm = config.llm ?? {};
    const llm = config.llm as Record<string, unknown>;
    const existingServices = normalizeServiceConfig(llm.services);
    const explicitService = env.values.service?.trim();
    const guessedService = env.values.baseUrl ? guessServiceFromBaseUrl(env.values.baseUrl) : null;
    const service = explicitService || guessedService || "custom";

    const entry: ServiceConfigEntry = service === "custom"
      ? {
          service: "custom",
          name: "Env LLM",
          ...(env.values.baseUrl ? { baseUrl: env.values.baseUrl } : {}),
        }
      : { service };
    const serviceKey = serviceConfigKey(entry);

    llm.services = mergeServiceConfig(existingServices, [entry]);
    llm.service = serviceKey;
    llm.configSource = "studio";
    if (env.values.model) llm.defaultModel = env.values.model;
    syncTopLevelLlmMirror(llm);

    const secrets = await loadSecrets(root);
    secrets.services[serviceKey] = { apiKey: env.values.apiKey };
    await saveSecrets(root, secrets);
    await saveRawConfig(root, config);

    return c.json({
      ok: true,
      source: env.source,
      service: serviceKey,
      defaultModel: env.values.model ?? null,
    });
  });

  app.put("/api/v1/services/config", async (c) => {
    const body = await c.req.json<{ services?: unknown; defaultModel?: string; configSource?: LLMConfigSource; service?: string }>();
    const config = await loadRawConfig(root);
    config.llm = config.llm ?? {};
    const llm = config.llm as Record<string, unknown>;
    if (body.services !== undefined) {
      const existingServices = normalizeServiceConfig(llm.services);
      const incomingServices = normalizeServiceConfig(body.services);
      llm.services = mergeServiceConfig(existingServices, incomingServices);
    }
    if (body.defaultModel !== undefined) {
      llm.defaultModel = body.defaultModel;
    }
    if (body.configSource === "env") {
      return c.json({
        error: pick(
          await currentProjectLanguage(),
          "Studio 运行时不支持切换到 env；env 只在 CLI/daemon/部署运行时作为覆盖层使用。",
          "The Studio runtime does not support switching to env; env only acts as an override layer in the CLI/daemon/deployment runtimes.",
        ),
      }, 400);
    }
    if (body.configSource !== undefined) {
      llm.configSource = normalizeConfigSource(body.configSource);
    }
    if (body.service !== undefined) {
      llm.service = body.service;
    }
    syncTopLevelLlmMirror(llm);
    await saveRawConfig(root, config);
    return c.json({ ok: true });
  });

  app.get("/api/v1/cover/config", async (c) => {
    const config = await loadRawConfig(root);
    const llm = (config.llm as Record<string, unknown> | undefined) ?? {};
    const cover = normalizeCoverConfig(llm.cover);
    const secrets = await loadSecrets(root);
    const keyFor = (service: string): boolean =>
      Boolean(secrets.services[coverSecretKey(service)]?.apiKey || secrets.services[service]?.apiKey);
    // "Configured" = a cover service is selected AND has a key, OR a cover
    // endpoint is provided via env (the CLI/power-user path). This is the gate
    // for the Play auto-illustration toggles.
    const envConfigured = Boolean(
      (process.env.INKOS_COVER_BASE_URL || process.env.INKOS_COVER_ENDPOINT)
      && (process.env.INKOS_COVER_API_KEY || keyFor("kkaiapi")),
    );
    const configured = Boolean(cover?.service && keyFor(cover.service)) || envConfigured;
    return c.json({
      service: cover?.service ?? null,
      model: cover?.model ?? null,
      baseUrl: cover?.baseUrl ?? null,
      configured,
      providers: COVER_PROVIDER_PRESETS.map((provider) => ({
        service: provider.service,
        label: provider.label,
        baseUrl: provider.baseUrl,
        defaultModel: provider.defaultModel,
        models: provider.models,
        connected: keyFor(provider.service),
      })),
    });
  });

  app.put("/api/v1/cover/config", async (c) => {
    const body = await c.req.json<{ service?: string; model?: string; baseUrl?: string }>();
    const preset = resolveCoverProviderPreset(body.service);
    if (!preset) {
      return c.json({ error: "Unsupported cover service" }, 400);
    }
    const model = typeof body.model === "string" && preset.models.includes(body.model)
      ? body.model
      : preset.defaultModel;
    const requestedBaseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
    const baseUrl = normalizeCoverBaseUrl(requestedBaseUrl);
    if (requestedBaseUrl && !baseUrl) {
      return c.json({
        error: pick(
          await currentProjectLanguage(),
          "封面 Base URL 必须是有效的 HTTP(S) 地址，且不能包含账号、查询参数或锚点。",
          "Cover Base URL must be a valid HTTP(S) URL without credentials, query parameters, or fragments.",
        ),
      }, 400);
    }

    const config = await loadRawConfig(root);
    config.llm = config.llm ?? {};
    const llm = config.llm as Record<string, unknown>;
    llm.cover = {
      service: preset.service,
      model,
      ...(baseUrl ? { baseUrl } : {}),
    };
    await saveRawConfig(root, config);
    return c.json({ ok: true, service: preset.service, model, baseUrl: baseUrl ?? null });
  });

  app.get("/api/v1/cover/secret/:service", async (c) => {
    const service = c.req.param("service");
    if (!resolveCoverProviderPreset(service)) {
      return c.json({ error: "Unsupported cover service" }, 400);
    }
    const secrets = await loadSecrets(root);
    return c.json({ apiKey: secrets.services[coverSecretKey(service)]?.apiKey ?? "" });
  });

  app.put("/api/v1/cover/secret/:service", async (c) => {
    const service = c.req.param("service");
    if (!resolveCoverProviderPreset(service)) {
      return c.json({ error: "Unsupported cover service" }, 400);
    }
    const body = await c.req.json<{ apiKey?: string }>();
    const trimmedKey = body.apiKey?.trim() ?? "";
    if (trimmedKey && !isHeaderSafeApiKey(trimmedKey)) {
      return c.json({
        error: pick(
          await currentProjectLanguage(),
          "API Key 包含不能放入 HTTP Authorization header 的字符，请只粘贴原始密钥。",
          "API Key contains characters that cannot go into an HTTP Authorization header. Paste only the raw key.",
        ),
      }, 400);
    }

    const secrets = await loadSecrets(root);
    const key = coverSecretKey(service);
    if (trimmedKey) {
      secrets.services[key] = { apiKey: trimmedKey };
    } else {
      delete secrets.services[key];
    }
    await saveSecrets(root, secrets);
    return c.json({ ok: true, service });
  });

  app.delete("/api/v1/services/:service", async (c) => {
    const service = c.req.param("service");
    const config = await loadRawConfig(root);
    const llm = (config.llm as Record<string, unknown> | undefined) ?? {};
    const existingServices = normalizeServiceConfig(llm.services);
    const nextServices = existingServices.filter((entry) => serviceConfigKey(entry) !== service);

    if (!config.llm) config.llm = {};
    const nextLlm = config.llm as Record<string, unknown>;
    nextLlm.services = nextServices;
    if (nextLlm.service === service) {
      delete nextLlm.service;
      delete nextLlm.defaultModel;
    }
    await saveRawConfig(root, config);

    const secrets = await loadSecrets(root);
    delete secrets.services[service];
    await saveSecrets(root, secrets);
    modelListCache.clear();
    return c.json({ ok: true, service });
  });

  app.post("/api/v1/services/:service/test", async (c) => {
    const service = c.req.param("service");
    const { apiKey, baseUrl, apiFormat, stream } = await c.req.json<{
      apiKey: string;
      baseUrl?: string;
      apiFormat?: "chat" | "responses";
      stream?: boolean;
    }>();

    const language = await currentProjectLanguage();
    const resolvedBaseUrl = await resolveConfiguredServiceBaseUrl(root, service, baseUrl);
    if (!resolvedBaseUrl) {
      return c.json({
        ok: false,
        error: pick(language, `未知服务商: ${service}`, `Unknown service: ${service}`),
      }, 400);
    }

    const baseService = isCustomServiceId(service) ? "custom" : service;
    const apiKeyOptional = isApiKeyOptionalForEndpoint({
      provider: resolveServiceProviderFamily(baseService) ?? "openai",
      baseUrl: resolvedBaseUrl,
    });
    if (!apiKey?.trim() && !apiKeyOptional) {
      return c.json({
        ok: false,
        error: pick(language, "API Key 不能为空", "API Key must not be empty"),
      }, 400);
    }

    const rawConfig = await loadRawConfig(root).catch(() => ({} as Record<string, unknown>));
    const llm = (rawConfig.llm as Record<string, unknown> | undefined) ?? {};
    const probe = await probeServiceCapabilities({
      root,
      service,
      apiKey: apiKey?.trim() ?? "",
      baseUrl: resolvedBaseUrl,
      preferredApiFormat: apiFormat,
      preferredStream: stream,
      proxyUrl: typeof llm.proxyUrl === "string" ? llm.proxyUrl : undefined,
      language,
    });

    // B12: 升级响应 shape 为 { probe, chat, ... }，同时保留老字段供 UI 过渡期兼容
    const connectionFailed = pick(language, "连接失败", "Connection failed");
    const probeStatus = {
      ok: probe.ok,
      models: probe.models?.length ?? 0,
      ...(probe.ok ? {} : { error: probe.error ?? connectionFailed }),
    };

    if (!probe.ok) {
      return c.json({
        ok: false,
        error: probe.error ?? connectionFailed,
        probe: probeStatus,
        chat: null,
      }, 400);
    }

    return c.json({
      ok: true,
      modelCount: probe.models.length,
      models: probe.models,
      selectedModel: probe.selectedModel,
      detected: {
        apiFormat: probe.apiFormat,
        stream: probe.stream,
        baseUrl: probe.baseUrl,
        modelsSource: probe.modelsSource,
      },
      // B12 新字段：两步验证状态
      probe: probeStatus,
      chat: null,  // probeServiceCapabilities 本身只做 probe，chat hello 在 Studio 的 follow-up 调用里单独触发
    });
  });

  app.put("/api/v1/services/:service/secret", async (c) => {
    const service = c.req.param("service");
    const { apiKey } = await c.req.json<{ apiKey: string }>();
    const secrets = await loadSecrets(root);
    const trimmedKey = apiKey?.trim() ?? "";
    if (trimmedKey) {
      if (!isHeaderSafeApiKey(trimmedKey)) {
        return c.json({
          ok: false,
          error: pick(
            await currentProjectLanguage(),
            "API Key 只能包含可放进 HTTP Authorization header 的非空白 ASCII 字符；请不要粘贴连接失败提示或诊断文本。",
            "API Key may only contain non-whitespace ASCII characters that fit in an HTTP Authorization header; do not paste connection failure hints or diagnostic text.",
          ),
        }, 400);
      }
      secrets.services[service] = { apiKey: trimmedKey };
    } else {
      delete secrets.services[service];
    }
    await saveSecrets(root, secrets);
    return c.json({ ok: true });
  });

  app.get("/api/v1/services/:service/secret", async (c) => {
    const service = c.req.param("service");
    const secrets = await loadSecrets(root);
    return c.json({
      apiKey: secrets.services[service]?.apiKey ?? "",
    });
  });

  app.get("/api/v1/services/models", async (c) => {
    const secrets = await loadSecrets(root);
    const endpoints = getAllEndpoints()
      .filter((ep) => ep.id !== "custom" && Boolean(secrets.services[ep.id]?.apiKey));

    const groups = endpoints.map((ep) => ({
      service: ep.id,
      label: ep.label,
      models: ep.models
        .filter((m) => m.enabled !== false)
        .filter((m) => isTextChatModelId(m.id))
        .map((m) => ({
          id: m.id,
          name: m.id,
          ...(typeof m.maxOutput === "number" ? { maxOutput: m.maxOutput } : {}),
          ...(m.contextWindowTokens > 0 ? { contextWindow: m.contextWindowTokens } : {}),
        })),
    }));

    return c.json({ groups });
  });

  app.get("/api/v1/services/models/custom", async (c) => {
    const secrets = await loadSecrets(root);
    let config: Record<string, unknown> = {};
    try {
      config = await loadRawConfig(root);
    } catch {
      // no config file
    }

    const customs = normalizeServiceConfig((config.llm as Record<string, unknown> | undefined)?.services)
      .filter((s) => s.service === "custom")
      .map((s) => ({
        id: `custom:${s.name ?? "Custom"}`,
        baseUrl: s.baseUrl ?? "",
        label: s.name ?? "Custom",
      }))
      .filter((s) => s.baseUrl && Boolean(secrets.services[s.id]?.apiKey));

    const groups = await Promise.all(customs.map(async (s) => ({
      service: s.id,
      label: s.label,
      models: filterTextChatModels(
        await probeModelsFromUpstream(s.baseUrl, secrets.services[s.id].apiKey, 10_000),
      ),
    })));

    return c.json({ groups });
  });

  app.get("/api/v1/services/:service/models", async (c) => {
    const service = c.req.param("service");
    const refresh = c.req.query("refresh") === "1";
    const secrets = await loadSecrets(root);
    const apiKey = c.req.query("apiKey") || secrets.services[service]?.apiKey || "";

    const resolvedBaseUrl = await resolveConfiguredServiceBaseUrl(root, service);
    const baseService = isCustomServiceId(service) ? "custom" : service;
    const apiKeyOptional = isApiKeyOptionalForEndpoint({
      provider: resolveServiceProviderFamily(baseService) ?? "openai",
      baseUrl: resolvedBaseUrl,
    });

    // No key = no models, except local/self-hosted endpoints such as Ollama.
    if (!apiKey && !apiKeyOptional) return c.json({ models: [] });

    // Cache by service + resolved baseUrl + apiKey fingerprint; valid for 10 min unless ?refresh=1
    const cacheKey = `${service}::${resolvedBaseUrl ?? ""}::${apiKey.slice(-8)}`;
    if (!refresh) {
      const cached = modelListCache.get(cacheKey);
      if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
        return c.json({ models: cached.models });
      }
    }

    // B13: 走 listModelsForService 走 live probe + bank 交叉，返回带元数据的 models
    const enriched = await listModelsForService(
      isCustomServiceId(service) ? "custom" : service,
      apiKey,
      isCustomServiceId(service) ? resolvedBaseUrl ?? undefined : undefined,
    );
    const models = filterTextChatModels(enriched).map((m) => ({
      id: m.id,
      name: m.name,
      ...(m.maxOutput !== undefined ? { maxOutput: m.maxOutput } : {}),
      ...(m.contextWindow > 0 ? { contextWindow: m.contextWindow } : {}),
    }));
    modelListCache.set(cacheKey, { models, at: Date.now() });
    return c.json({ models });
  });

  // --- Project info ---

  app.get("/api/v1/project", async (c) => {
    let currentConfig: ProjectConfig;
    let raw: Record<string, unknown>;
    try {
      currentConfig = await loadCurrentProjectConfig({ requireApiKey: false });
      // Check if language was explicitly set in inkos.json (not just the schema default)
      raw = JSON.parse(await readFile(join(root, "inkos.json"), "utf-8")) as Record<string, unknown>;
    } catch (error) {
      throw new ApiError(
        500,
        "PROJECT_CONFIG_INVALID",
        `Failed to load inkos.json: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const languageExplicit = "language" in raw && raw.language !== "";

    return c.json({
      name: currentConfig.name,
      language: currentConfig.language,
      languageExplicit,
      model: currentConfig.llm.model,
      provider: currentConfig.llm.provider,
      baseUrl: currentConfig.llm.baseUrl,
      stream: currentConfig.llm.stream,
      temperature: currentConfig.llm.temperature,
    });
  });

  app.get("/api/v1/skills", async (c) => {
    const result = await loadStudioSkills(root);
    return c.json(result);
  });

  app.get("/api/v1/prompt-packs", async (c) => {
    const prompts = await Promise.all(
      listBuiltinPrompts().map((prompt) => toStudioPromptPackPrompt(root, prompt)),
    );
    return c.json({
      packs: listBuiltinPromptPacks(),
      prompts,
    });
  });

  app.put("/api/v1/prompt-packs/:promptId", async (c) => {
    const promptId = normalizeStudioPromptId(c.req.param("promptId"));
    const payload = await c.req.json().catch(() => {
      throw new ApiError(400, "INVALID_PROMPT_PACK_PAYLOAD", "Prompt pack payload must be JSON");
    });
    const content = payload && typeof payload === "object" && "content" in payload
      ? (payload as { readonly content?: unknown }).content
      : undefined;
    if (typeof content !== "string") {
      throw new ApiError(400, "INVALID_PROMPT_PACK_PAYLOAD", "content must be a string");
    }

    const file = promptOverridePath(root, promptId);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, "utf-8");
    const prompt = listBuiltinPrompts().find((item) => item.id === promptId);
    return c.json({ prompt: await toStudioPromptPackPrompt(root, prompt!) });
  });

  app.delete("/api/v1/prompt-packs/:promptId", async (c) => {
    const promptId = normalizeStudioPromptId(c.req.param("promptId"));
    const file = promptOverridePath(root, promptId);
    await rm(file, { force: true });
    const prompt = listBuiltinPrompts().find((item) => item.id === promptId);
    return c.json({ prompt: await toStudioPromptPackPrompt(root, prompt!) });
  });

  app.post("/api/v1/skills/import", async (c) => {
    const payload = await c.req.json().catch(() => {
      throw new ApiError(400, "INVALID_SKILL_IMPORT", "Skill import payload must be JSON");
    });
    const skill = await importStudioSkillFolder(root, payload);
    return c.json({ skill: toStudioSkill(skill, root, new Set([skill.id])) });
  });

  app.delete("/api/v1/skills/:skillId", async (c) => {
    const id = normalizeStudioSkillId(c.req.param("skillId"), "skillId");
    try {
      await access(projectSkillPath(root, id));
    } catch {
      throw new ApiError(404, "SKILL_NOT_FOUND", `Project skill not found: ${id}`);
    }
    await rm(projectSkillDir(root, id), { recursive: true, force: true });
    return c.json({ ok: true });
  });

  app.get("/api/v1/project/files/:file{.+}", async (c) => {
    const file = resolveProjectImageFile(root, c.req.param("file"));

    try {
      const content = await readFile(file.resolved);
      return new Response(content, {
        headers: {
          "Content-Type": file.contentType,
          "Cache-Control": "no-store",
        },
      });
    } catch {
      return c.notFound();
    }
  });

  app.get("/api/v1/project/artifacts/:file{.+}", async (c) => {
    const file = resolveProjectTextArtifactFile(root, c.req.param("file"));

    try {
      const content = await readFile(file.resolved, "utf-8");
      return c.json({
        path: file.relPath,
        content,
        contentType: file.contentType,
        size: Buffer.byteLength(content, "utf-8"),
      });
    } catch {
      return c.notFound();
    }
  });

  app.put("/api/v1/project/artifacts/:file{.+}", async (c) => {
    const file = resolveProjectTextArtifactFile(root, c.req.param("file"));
    const body = await c.req.json<unknown>().catch(() => null);
    const content = body && typeof body === "object" && "content" in body
      ? (body as { readonly content?: unknown }).content
      : undefined;
    if (typeof content !== "string") {
      throw new ApiError(400, "INVALID_PROJECT_ARTIFACT_BODY", "content must be a string");
    }

    await mkdir(dirname(file.resolved), { recursive: true });
    await writeFile(file.resolved, content, "utf-8");
    return c.json({
      ok: true,
      path: file.relPath,
      contentType: file.contentType,
      size: Buffer.byteLength(content, "utf-8"),
    });
  });

  // --- Config editing ---

  app.put("/api/v1/project", async (c) => {
    const updates = await c.req.json<Record<string, unknown>>();
    const configPath = join(root, "inkos.json");
    try {
      const raw = await readFile(configPath, "utf-8");
      const existing = JSON.parse(raw);
      // Merge LLM settings
      if (updates.temperature !== undefined) {
        existing.llm.temperature = updates.temperature;
      }
      if (updates.stream !== undefined) {
        existing.llm.stream = updates.stream;
      }
      if (updates.language === "zh" || updates.language === "en") {
        existing.language = updates.language;
      }
      const { writeFile: writeFileFs } = await import("node:fs/promises");
      await writeFileFs(configPath, JSON.stringify(existing, null, 2), "utf-8");
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get("/api/v1/project/input-governance-mode", async (c) => {
    const raw = JSON.parse(await readFile(join(root, "inkos.json"), "utf-8"));
    return c.json({ mode: raw.inputGovernanceMode === "legacy" ? "legacy" : "v2" });
  });

  app.put("/api/v1/project/input-governance-mode", async (c) => {
    const { mode } = await c.req.json<{ mode?: unknown }>();
    const parsed = InputGovernanceModeSchema.safeParse(mode);
    if (!parsed.success) {
      return c.json({ error: "mode must be legacy or v2" }, 400);
    }
    const configPath = join(root, "inkos.json");
    const raw = JSON.parse(await readFile(configPath, "utf-8"));
    raw.inputGovernanceMode = parsed.data;
    const { writeFile: writeFileFs } = await import("node:fs/promises");
    await writeFileFs(configPath, JSON.stringify(raw, null, 2), "utf-8");
    return c.json({ ok: true, mode: parsed.data });
  });

  app.get("/api/v1/project/detection", async (c) => {
    const raw = JSON.parse(await readFile(join(root, "inkos.json"), "utf-8"));
    return c.json({ detection: raw.detection ?? null });
  });

  app.put("/api/v1/project/detection", async (c) => {
    const { detection } = await c.req.json<{ detection?: unknown }>();
    const configPath = join(root, "inkos.json");
    const raw = JSON.parse(await readFile(configPath, "utf-8"));
    if (detection === null) {
      delete raw.detection;
    } else {
      const parsed = DetectionConfigSchema.safeParse(detection);
      if (!parsed.success) {
        return c.json({ error: parsed.error.issues.map((issue) => issue.message).join("; ") }, 400);
      }
      raw.detection = parsed.data;
    }
    const { writeFile: writeFileFs } = await import("node:fs/promises");
    await writeFileFs(configPath, JSON.stringify(raw, null, 2), "utf-8");
    return c.json({ ok: true, detection: raw.detection ?? null });
  });

  // --- Truth files browser ---

  app.get("/api/v1/books/:id/truth", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);
    const storyDir = join(bookDir, "story");

    async function listDir(subdir: string): Promise<string[]> {
      try {
        const entries = await readdir(join(storyDir, subdir));
        return entries.filter((f) => f.endsWith(".md") || f.endsWith(".json") || f.endsWith(".yaml"));
      } catch {
        return [];
      }
    }

    // Hotfix: only tag shim files as legacy when the book has the new layout.
    const { isNewLayoutBook } = await import("@actalk/inkos-core");
    const newLayout = await isNewLayoutBook(bookDir);

    async function describe(relPath: string): Promise<{ readonly name: string; readonly size: number; readonly preview: string; readonly legacy?: true; readonly readonly?: true; readonly readonlyReason?: string } | null> {
      try {
        const content = await readFile(join(storyDir, relPath), "utf-8");
        const isShim = LEGACY_SHIM_FILES.has(relPath) && newLayout;
        const isRuntimeDiagnostic = RUNTIME_DIAGNOSTIC_FILE_RE.test(relPath);
        const entry: { readonly name: string; readonly size: number; readonly preview: string; readonly legacy?: true; readonly readonly?: true; readonly readonlyReason?: string } =
          isShim
            ? { name: relPath, size: content.length, preview: content.slice(0, 200), legacy: true }
            : isRuntimeDiagnostic
              ? { name: relPath, size: content.length, preview: content.slice(0, 200), readonly: true, readonlyReason: "runtime-diagnostic" }
              : { name: relPath, size: content.length, preview: content.slice(0, 200) };
        return entry;
      } catch {
        return null;
      }
    }

    try {
      // Flat story/ files (legacy + runtime logs)
      const flatFiles = (await listDir(".")).filter((f) => !f.startsWith("outline") && !f.startsWith("roles"));
      // Phase 5 outline/ files
      const outlineFiles = (await listDir("outline")).map((f) => `outline/${f}`);
      // Phase 5 roles/主要角色 + roles/次要角色, plus Phase hotfix 3
      // English-locale equivalents so en-language books are visible.
      const majorRolesZh = (await listDir("roles/主要角色")).map((f) => `roles/主要角色/${f}`);
      const minorRolesZh = (await listDir("roles/次要角色")).map((f) => `roles/次要角色/${f}`);
      const majorRolesEn = (await listDir("roles/major")).map((f) => `roles/major/${f}`);
      const minorRolesEn = (await listDir("roles/minor")).map((f) => `roles/minor/${f}`);
      const runtimeFiles = (await listDir("runtime"))
        .map((f) => `runtime/${f}`)
        .filter((f) => RUNTIME_DIAGNOSTIC_FILE_RE.test(f));

      const all = [
        ...flatFiles,
        ...outlineFiles,
        ...majorRolesZh,
        ...minorRolesZh,
        ...majorRolesEn,
        ...minorRolesEn,
        ...runtimeFiles,
      ];
      const described = await Promise.all(all.map(describe));
      const result = described.filter((x): x is NonNullable<typeof x> => x !== null);
      return c.json({ files: result });
    } catch {
      return c.json({ files: [] });
    }
  });

  // --- Daemon control ---

  let schedulerInstance: Scheduler | null = null;

  app.get("/api/v1/daemon", (c) => {
    return c.json({
      running: schedulerInstance?.isRunning ?? false,
    });
  });

  app.post("/api/v1/daemon/start", async (c) => {
    if (schedulerInstance?.isRunning) {
      return c.json({ error: "Daemon already running" }, 400);
    }
    try {
      const currentConfig = await loadCurrentProjectConfig();
      const scheduler = new Scheduler({
        ...(await buildPipelineConfig()),
        radarCron: currentConfig.daemon.schedule.radarCron,
        writeCron: currentConfig.daemon.schedule.writeCron,
        maxConcurrentBooks: currentConfig.daemon.maxConcurrentBooks,
        chaptersPerCycle: currentConfig.daemon.chaptersPerCycle,
        retryDelayMs: currentConfig.daemon.retryDelayMs,
        cooldownAfterChapterMs: currentConfig.daemon.cooldownAfterChapterMs,
        maxChaptersPerDay: currentConfig.daemon.maxChaptersPerDay,
        onChapterComplete: (bookId, chapter, status) => {
          broadcast("daemon:chapter", { bookId, chapter, status });
        },
        onError: (bookId, error) => {
          broadcast("daemon:error", { bookId, error: error.message });
        },
      });
      schedulerInstance = scheduler;
      broadcast("daemon:started", {});
      void scheduler.start().catch((e) => {
        const error = e instanceof Error ? e : new Error(String(e));
        if (schedulerInstance === scheduler) {
          scheduler.stop();
          schedulerInstance = null;
          broadcast("daemon:stopped", {});
        }
        broadcast("daemon:error", { bookId: "scheduler", error: error.message });
      });
      return c.json({ ok: true, running: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/daemon/stop", (c) => {
    if (!schedulerInstance?.isRunning) {
      return c.json({ error: "Daemon not running" }, 400);
    }
    schedulerInstance.stop();
    schedulerInstance = null;
    broadcast("daemon:stopped", {});
    return c.json({ ok: true, running: false });
  });

  // --- Logs ---

  app.get("/api/v1/logs", async (c) => {
    const logPath = join(root, "inkos.log");
    try {
      const content = await readFile(logPath, "utf-8");
      const lines = content.trim().split("\n").slice(-100);
      const entries = lines.map((line) => {
        try { return JSON.parse(line); } catch { return { message: line }; }
      });
      return c.json({ entries });
    } catch {
      return c.json({ entries: [] });
    }
  });

  // --- Agent chat ---

  app.get("/api/v1/interaction/session", async (c) => {
    const session = await loadProjectSession(root);
    const activeBookId = await resolveSessionActiveBook(root, session);
    return c.json({
      session: activeBookId && session.activeBookId !== activeBookId
        ? { ...session, activeBookId }
        : session,
      activeBookId,
    });
  });

  // Play worlds are created and advanced by the play_start / play_step agent
  // tools (worldId === sessionId). The HUD only needs to read a run's state,
  // so just the run-detail endpoint remains; the old save-slot list/create
  // endpoints were only used by the removed standalone play page.
  app.get("/api/v1/play/runs/:worldId/:runId", async (c) => {
    const worldId = normalizeApiBookId(c.req.param("worldId"), "worldId") ?? "default-world";
    const runId = normalizeApiBookId(c.req.param("runId"), "runId") ?? "default-run";
    const store = new PlayStore(root);
    const db = createPlayDB(store.runDir(worldId, runId));
    const [transcript, currentState, world] = await Promise.all([
      store.readTranscript(worldId, runId),
      store.loadCurrentState(worldId, runId).catch(() => null),
      store.loadWorld(worldId).catch(() => null),
    ]);
    const graph = db.snapshot();
    db.close?.();

    // Merge generated illustrations (decoupled sidecar) onto entities so the
    // HUD can render portraits/stills without touching the event-sourced graph.
    const runDir = store.runDir(worldId, runId);
    const [manifest, imageSettings] = await Promise.all([
      readPlayImageManifest(runDir),
      readPlayImageSettings(runDir),
    ]);
    const imageUrlFor = (file?: string): string | undefined =>
      file ? `/api/v1/play/runs/${encodeURIComponent(worldId)}/${encodeURIComponent(runId)}/images/${encodeURIComponent(file)}` : undefined;
    const sceneImageUrls = Object.fromEntries(
      Object.entries(manifest)
        .filter(([key, entry]) => key.startsWith("scene-turn-") && entry.status === "ready" && entry.file)
        .map(([key, entry]) => [key, imageUrlFor(entry.file)]),
    );
    const entitiesWithImages = (graph.entities ?? []).map((entity: { id: string }) => {
      const entry = manifest[entity.id];
      return entry?.status === "ready" && entry.file
        ? { ...entity, imageUrl: imageUrlFor(entry.file) }
        : entity;
    });

    // Illustration of the current moment, if one was generated for this turn.
    const sceneTurn = (currentState as { turn?: number } | null)?.turn ?? 0;
    const sceneEntry = manifest[`scene-turn-${sceneTurn}`];
    const sceneImageUrl = sceneEntry?.status === "ready" ? imageUrlFor(sceneEntry.file) : undefined;

    return c.json({
      worldId,
      runId,
      title: world?.title ?? null,
      transcript,
      currentState,
      graph: { ...graph, entities: entitiesWithImages },
      imageSettings,
      sceneImageUrls,
      ...(sceneImageUrl ? { sceneImageUrl } : {}),
    });
  });

  // --- Interactive-world illustration (Play auto-config images) ---

  app.put("/api/v1/play/runs/:worldId/:runId/image-settings", async (c) => {
    const worldId = normalizeApiBookId(c.req.param("worldId"), "worldId") ?? "default-world";
    const runId = normalizeApiBookId(c.req.param("runId"), "runId") ?? "default-run";
    const body = await c.req.json<Partial<PlayImageSettings>>().catch(() => ({} as Partial<PlayImageSettings>));
    const settings: PlayImageSettings = {
      actors: Boolean(body.actors),
      moments: Boolean(body.moments),
      inventory: Boolean(body.inventory),
    };
    const runDir = new PlayStore(root).runDir(worldId, runId);
    await writePlayImageSettings(runDir, settings);
    return c.json({ ok: true, imageSettings: settings });
  });

  app.post("/api/v1/play/runs/:worldId/:runId/generate-image", async (c) => {
    const worldId = normalizeApiBookId(c.req.param("worldId"), "worldId") ?? "default-world";
    const runId = normalizeApiBookId(c.req.param("runId"), "runId") ?? "default-run";
    type GenerateImageBody = {
      target: "entity" | "scene";
      entityId?: string;
      sceneText?: string;
      sceneKey?: string;
    };
    const body = await c.req.json<GenerateImageBody>().catch(() => ({ target: "entity" } as GenerateImageBody));

    const store = new PlayStore(root);
    const runDir = store.runDir(worldId, runId);
    const [world, currentState] = await Promise.all([
      store.loadWorld(worldId).catch(() => null),
      store.loadCurrentState(worldId, runId).catch(() => null),
    ]);
    const worldContext = world
      ? {
        premise: world.premise,
        worldContract: world.worldContract,
        visualContract: world.visualContract,
      }
      : undefined;

    let key: string;
    let prompt: string;
    if (body.target === "scene") {
      // The current moment defaults to the rendered scene projection so the UI
      // can offer a one-tap "illustrate this moment" without re-sending prose.
      const sceneText = (
        (body.sceneText ?? "").trim()
        || (await store.readProjection(worldId, runId, "projections/scene.md").catch(() => "")).trim()
      );
      if (!sceneText) return c.json({ error: "no current scene to illustrate" }, 400);
      key = body.sceneKey?.trim() || `scene-turn-${(currentState as { turn?: number } | null)?.turn ?? 0}`;
      prompt = buildPlaySceneImagePrompt(sceneText, worldContext);
    } else {
      const entityId = body.entityId?.trim();
      if (!entityId) return c.json({ error: "entityId is required for an entity image" }, 400);
      const db = createPlayDB(runDir);
      const graph = db.snapshot();
      db.close?.();
      const entity = (graph.entities ?? []).find((e: { id: string }) => e.id === entityId) as
        | { id: string; type: string; label: string; summary?: string }
        | undefined;
      if (!entity) return c.json({ error: `entity not found: ${entityId}` }, 404);
      key = entity.id;
      prompt = buildPlayEntityImagePrompt(entity, worldContext);
    }

    try {
      const entry = await generatePlayImage({ root, runDir, key, prompt });
      const url = entry.status === "ready" && entry.file
        ? `/api/v1/play/runs/${encodeURIComponent(worldId)}/${encodeURIComponent(runId)}/images/${encodeURIComponent(entry.file)}`
        : undefined;
      return c.json({ key, ok: entry.status === "ready", ...entry, ...(url ? { url } : {}) });
    } catch (e) {
      // Resolution failure = cover API not configured.
      return c.json({ error: e instanceof Error ? e.message : String(e), needsCoverConfig: true }, 400);
    }
  });

  app.get("/api/v1/play/runs/:worldId/:runId/images/:file", async (c) => {
    const worldId = normalizeApiBookId(c.req.param("worldId"), "worldId") ?? "default-world";
    const runId = normalizeApiBookId(c.req.param("runId"), "runId") ?? "default-run";
    const file = c.req.param("file");
    if (!file || file.includes("/") || file.includes("..") || file.includes("\0")) {
      return c.json({ error: "Invalid image file" }, 400);
    }
    const runDir = new PlayStore(root).runDir(worldId, runId);
    try {
      const { readFile: readFileFs } = await import("node:fs/promises");
      const content = await readFileFs(join(runDir, "images", file));
      const ext = file.split(".").pop()?.toLowerCase() ?? "";
      const contentType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
      return new Response(content, { headers: { "Content-Type": contentType } });
    } catch {
      return c.notFound();
    }
  });

  // -- Per-book session endpoints --

  app.get("/api/v1/sessions", async (c) => {
    const bookId = c.req.query("bookId");
    const sessions = await listBookSessions(root, bookId === undefined ? null : bookId === "null" ? null : bookId);
    return c.json({ sessions });
  });

  app.get("/api/v1/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await loadBookSession(root, sessionId);
    if (!session) return c.json({ error: "Session not found" }, 404);
    const task = await loadReconciledTaskSnapshot(sessionId);
    return c.json({ session, ...(task ? { task } : {}) });
  });

  app.post("/api/v1/sessions", async (c) => {
    const body = await c.req.json<{ bookId?: string | null; sessionId?: string; sessionKind?: string; playMode?: string }>().catch(() => ({}));
    const bookId = normalizeApiBookId((body as { bookId?: unknown }).bookId, "bookId");
    const sessionKind = normalizeStudioSessionKind(
      (body as { sessionKind?: unknown }).sessionKind,
      bookId ? "book" : "chat",
    );
    const playMode = normalizeStudioPlayMode((body as { playMode?: unknown }).playMode);
    const sessionId = (body as { sessionId?: string }).sessionId;
    // sessionId 只允许 timestamp-random 格式；防止注入任意文件名
    const safeSessionId = sessionId && /^[0-9]+-[a-z0-9]+$/.test(sessionId) ? sessionId : undefined;
    const session = await createAndPersistBookSession(
      root,
      bookId,
      safeSessionId,
      sessionKind,
      ...(playMode ? [{ playMode }] as const : []),
    );
    // 客户端可以用同一个 sessionId 重新创建会话：移除删除标记，
    // 让新会话的生产任务可以正常持久化快照。
    deletedSessionIds.delete(session.sessionId);
    return c.json({ session });
  });

  app.put("/api/v1/sessions/:sessionId/play-mode", async (c) => {
    const body = await c.req.json<{ playMode?: string }>().catch(() => ({}));
    const playMode = normalizeStudioPlayMode((body as { playMode?: unknown }).playMode);
    if (!playMode) {
      throw new ApiError(400, "INVALID_PLAY_MODE", "playMode is required");
    }
    const existing = await loadBookSession(root, c.req.param("sessionId"));
    if (!existing) return c.json({ error: "Session not found" }, 404);
    const session = await createAndPersistBookSession(
      root,
      existing.bookId,
      existing.sessionId,
      existing.sessionKind,
      { playMode },
    );
    return c.json({ session });
  });

  app.put("/api/v1/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json<{ title?: string }>().catch(() => ({}) as { title?: string });
    const title = body.title?.trim();
    if (!title) {
      throw new ApiError(400, "INVALID_SESSION_TITLE", "Session title is required");
    }

    const session = await renameBookSession(root, sessionId, title);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }
    return c.json({ session });
  });

  app.delete("/api/v1/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    // 先标记删除，再中止任务：任务被中止后的错误持久化会检查这个标记，
    // 不会把已删除会话的快照文件重建出来。
    deletedSessionIds.add(sessionId);
    const controller = await findRunningTaskController(sessionId);
    controller?.abort();
    await Promise.all([
      deleteBookSession(root, sessionId),
      deleteStudioTaskSnapshot(root, sessionId),
    ]);
    return c.json({ ok: true });
  });

  app.post("/api/v1/sessions/:sessionId/abort", async (c) => {
    const sessionId = c.req.param("sessionId");
    // scope=chat 只中止当前聊天轮（agent loop），不动后台生产任务的控制器；
    // 默认 all 维持旧行为：聊天轮和生产任务一起停。
    const body = await c.req.json<{ scope?: unknown }>().catch(() => ({} as { scope?: unknown }));
    const scope = body.scope === "chat" ? "chat" : "all";
    let taskAborted = false;
    if (scope === "all") {
      const controller = await findRunningTaskController(sessionId);
      controller?.abort();
      taskAborted = Boolean(controller);
    }
    const aborted = abortAgentSession(root, sessionId) || taskAborted;
    broadcast("agent:aborted", { sessionId, aborted });
    return c.json({ ok: true, aborted });
  });

  app.post("/api/v1/agent", async (c) => {
    const {
      instruction,
      activeBookId,
      sessionId: reqSessionId,
      clientRequestId: reqClientRequestId,
      sessionKind: reqSessionKind,
      actionSource: reqActionSource,
      requestedIntent: reqRequestedIntent,
      actionPayload: reqActionPayload,
      requestedSkills: reqRequestedSkills,
      disabledSkills: reqDisabledSkills,
      attachments: reqAttachments,
      playMode: reqPlayMode,
      model: reqModel,
      service: reqService,
    } = await c.req.json<{
      instruction: string;
      activeBookId?: string;
      sessionId?: string;
      clientRequestId?: unknown;
      sessionKind?: string;
      actionSource?: string;
      requestedIntent?: string;
      actionPayload?: unknown;
      requestedSkills?: unknown;
      disabledSkills?: unknown;
      attachments?: unknown;
      playMode?: string;
      model?: string;
      service?: string;
    }>();
    const sessionId = reqSessionId;
    if (!instruction?.trim()) {
      return c.json({ error: "No instruction provided" }, 400);
    }
    if (!sessionId?.trim()) {
      throw new ApiError(400, "SESSION_ID_REQUIRED", "sessionId is required");
    }
    const sourceRequestId = typeof reqClientRequestId === "string" && reqClientRequestId.trim()
      ? reqClientRequestId.trim().slice(0, 128)
      : undefined;
    const language = await currentProjectLanguage();
    if (reqModel && !isTextChatModelId(reqModel)) {
      const message = nonTextModelMessage(reqModel, language);
      return c.json({ error: message, response: message }, 400);
    }

    const actionSource = normalizeStudioActionSource(reqActionSource);
    const requestedIntent = normalizeStudioRequestedIntent(reqRequestedIntent);
    const actionPayload = normalizeStudioActionPayload(reqActionPayload);
    const requestedSkills = normalizeStudioSkillIdList(reqRequestedSkills, "requestedSkills");
    const disabledSkills = normalizeStudioSkillIdList(reqDisabledSkills, "disabledSkills");
    const attachments = await normalizeAgentAttachments(root, sessionId, reqAttachments);
    const playMode = normalizeStudioPlayMode(reqPlayMode);

    broadcast("agent:start", { instruction, activeBookId, sessionId, actionSource, requestedIntent, requestedSkills, attachments: attachments.length });

    try {
      // Load config + create LLM client (pipeline created after model resolution)
      const config = await loadCurrentProjectConfig({ requireApiKey: false });
      const client = createLLMClient(config.llm);

      const loadedBookSession = await loadBookSession(root, sessionId);
      if (!loadedBookSession) {
        throw new ApiError(404, "SESSION_NOT_FOUND", `Session not found: ${sessionId}`);
      }
      let bookSession = loadedBookSession;
      const requestedActiveBookId = normalizeApiBookId(activeBookId, "activeBookId");
      const persistedBookId = normalizeApiBookId(bookSession.bookId, "session.bookId");
      if (
        requestedActiveBookId
        && persistedBookId
        && persistedBookId !== requestedActiveBookId
      ) {
        throw new ApiError(
          409,
          "SESSION_BOOK_MISMATCH",
          `Session ${bookSession.sessionId} is bound to ${persistedBookId}, not ${requestedActiveBookId}`,
        );
      }
      const agentBookId = requestedActiveBookId ?? persistedBookId;
      const sessionKind = normalizeStudioSessionKind(
        reqSessionKind,
        bookSession.sessionKind ?? (agentBookId ? "book" : "chat"),
      );
      if (bookSession.sessionKind !== sessionKind || (playMode && bookSession.playMode !== playMode)) {
        const updatedSession = await createAndPersistBookSession(
          root,
          bookSession.bookId,
          bookSession.sessionId,
          sessionKind,
          ...(playMode ? [{ playMode }] as const : []),
        );
        bookSession = updatedSession;
      }
      let activeBookConfig: { readonly language?: string } | null = null;
      if (agentBookId && sessionKind !== "interactive-film-authoring") {
        try {
          activeBookConfig = await state.loadBookConfig(agentBookId);
        } catch {
          throw new ApiError(404, "BOOK_NOT_FOUND", `Book not found: ${agentBookId}`);
        }
      }
      const configLanguage = config.language === "en" ? "en" : "zh";
      const bookLanguage = activeBookConfig?.language === "en" ? "en" : activeBookConfig?.language === "zh" ? "zh" : undefined;
      const requestedLanguage = actionPayload?.shortRun?.language ?? actionPayload?.createBook?.language;
      const surfaceLanguage = agentBookId
        ? (bookLanguage ?? configLanguage)
        : (requestedLanguage ?? inferLanguage(instruction));
      const streamSessionId = loadedBookSession.sessionId;
      const titleBeforeRun = bookSession.title;
      let sessionTitleBroadcasted = false;
      const refreshBookSessionFromTranscript = async (): Promise<void> => {
        // 会话已删除：磁盘上没有 transcript 可刷，也不该再广播它的标题。
        if (deletedSessionIds.has(bookSession.sessionId)) return;
        const refreshed = await loadBookSession(root, bookSession.sessionId);
        if (refreshed) {
          bookSession = refreshed;
        }
        if (!sessionTitleBroadcasted && titleBeforeRun === null && bookSession.title) {
          broadcast("session:title", { sessionId: bookSession.sessionId, title: bookSession.title });
          sessionTitleBroadcasted = true;
        }
      };

      const externalEdit = requestedIntent === "edit_artifact" || sessionKind === "edit"
        ? await tryHandleExternalChatEdit({
            root,
            state,
            instruction,
            activeBookId: agentBookId,
          })
        : null;
      if (externalEdit) {
        await appendSessionMessagesUnlessDeleted(root, bookSession.sessionId, [{
          role: "assistant",
          content: [{ type: "text", text: externalEdit.responseText }],
          api: "anthropic-messages",
          provider: config.llm.provider,
          model: config.llm.model,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: Date.now(),
        }], instruction, { sessionKind });
        await refreshBookSessionFromTranscript();
        broadcast("agent:complete", { instruction, activeBookId: externalEdit.activeBookId, sessionId: bookSession.sessionId, sessionKind });
        return c.json({
          response: externalEdit.responseText,
          session: {
            sessionId: bookSession.sessionId,
            sessionKind,
            ...(externalEdit.activeBookId ? { activeBookId: externalEdit.activeBookId } : {}),
          },
        });
      }

      // Resolve model — multi-service resolution
      let resolvedModel: ResolvedModel["model"] | undefined;
      let resolvedApiKey: string | undefined;

      if (reqService && reqModel) {
        // 1. Frontend explicitly selected a service+model — fail loudly if no key
        try {
          const configuredEntry = await resolveConfiguredServiceEntry(root, reqService);
          const resolved = await resolveServiceModel(
            reqService,
            reqModel,
            root,
            await resolveConfiguredServiceBaseUrl(root, reqService),
            configuredEntry?.apiFormat,
          );
          resolvedModel = resolved.model;
          resolvedApiKey = resolved.apiKey;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          if (/API key/i.test(msg)) {
            return c.json({
              error: pick(language, `请先为 ${reqService} 配置 API Key`, `Configure an API Key for ${reqService} first`),
              response: pick(
                language,
                `请先在模型配置中为 ${reqService} 填写 API Key，然后再试。`,
                `Fill in an API Key for ${reqService} in the model settings, then try again.`,
              ),
            }, 400);
          }
          throw e;
        }
      }

      if (!resolvedModel) {
        // 2. Try defaultModel from new config format
        const rawConfig = config.llm as unknown as Record<string, unknown>;
        const defaultModel = rawConfig.defaultModel as string | undefined;
        const servicesArr = normalizeServiceConfig(rawConfig.services);
        const firstService = servicesArr[0];
        if (firstService?.service && defaultModel && isTextChatModelId(defaultModel)) {
          try {
            const resolved = await resolveServiceModel(
              serviceConfigKey(firstService),
              defaultModel,
              root,
              firstService.baseUrl,
              firstService.apiFormat,
            );
            resolvedModel = resolved.model;
            resolvedApiKey = resolved.apiKey;
          } catch { /* fall through */ }
        }
      }

      if (!resolvedModel) {
        // 3. Try first connected service from secrets
        const secrets = await loadSecrets(root);
        for (const [svcName, svcData] of Object.entries(secrets.services)) {
          if (svcData?.apiKey) {
            try {
              const models = await listModelsForService(svcName, svcData.apiKey);
              const textModels = filterTextChatModels(models);
              if (textModels.length > 0) {
                const configuredEntry = await resolveConfiguredServiceEntry(root, svcName);
                const resolved = await resolveServiceModel(
                  svcName,
                  textModels[0].id,
                  root,
                  await resolveConfiguredServiceBaseUrl(root, svcName),
                  configuredEntry?.apiFormat,
                );
                resolvedModel = resolved.model;
                resolvedApiKey = resolved.apiKey;
                break;
              }
            } catch { /* try next */ }
          }
        }
      }

      if (!resolvedModel) {
        // 4. Legacy fallback: use createLLMClient
        resolvedModel = client._piModel
          ? client._piModel
          : { provider: config.llm.provider ?? "anthropic", modelId: config.llm.model } as any;
        resolvedApiKey = client._apiKey;
      }

      const model = resolvedModel!;
      const agentApiKey = resolvedApiKey;
      const configuredEntry = reqService ? await resolveConfiguredServiceEntry(root, reqService) : undefined;

      // Create pipeline with resolved model (so sub_agent tools use the frontend-selected model)
      // Don't spread config.llm — its baseUrl/provider belong to the old service.
      // Let createLLMClient resolve baseUrl from the service preset.
      const pipelineClient = (reqService && reqModel && resolvedModel)
        ? createLLMClient({
            ...config.llm,
            service: configuredEntry?.service ?? reqService,
            model: reqModel,
            apiKey: resolvedApiKey ?? "",
            ...(configuredEntry?.apiFormat ? { apiFormat: configuredEntry.apiFormat } : {}),
            ...(configuredEntry?.stream !== undefined ? { stream: configuredEntry.stream } : {}),
            baseUrl: configuredEntry?.baseUrl ?? "",
          } as any)
        : client;
      // 确认式生产任务的 intent：写下一章的各种触发方式（quick-action 按钮、
      // free-text 明确写章命令、写作指令启发式）统一归一成 write_next，与其它
      // button/slash 确认的生产 intent 走同一条任务分支，获得 taskId、
      // AbortController、磁盘快照与单任务闸门。
      const confirmedIntent: RequestedIntent | undefined = isWriteNextProductionRequest({ instruction, agentBookId, sessionKind, actionSource, requestedIntent })
        ? "write_next"
        : requestedIntent && isConfirmedProductionAction({ actionSource, requestedIntent })
          ? requestedIntent
          : undefined;
      // 任务的 execution id 在构建 pipeline 之前生成并传入 executionIdForSSE：
      // 该 pipeline 广播的进度事件（log / llm:progress / context:compression）
      // 由此带上任务 id。同会话并行聊天轮的 pipeline 是另一次请求单独构建的、
      // 不带这个 id，前端才能把任务日志与聊天轮工具日志分开归属。
      const confirmedTaskId = confirmedIntent ? `direct-${confirmedIntent}-${randomUUID()}` : undefined;

      const pipeline = new PipelineRunner(await buildPipelineConfig({
        client: pipelineClient,
        model: reqModel ?? config.llm.model,
        currentConfig: config,
        sessionIdForSSE: bookSession.sessionId,
        bookIdForSettings: activeBookId ?? undefined,
        ...(confirmedTaskId ? { executionIdForSSE: confirmedTaskId } : {}),
      }));

      if (confirmedIntent && confirmedTaskId) {
        const productionTaskBusyResponse = () => {
          const message = pick(
            surfaceLanguage,
            "当前会话已有一个生产任务在运行，请等它完成，或先用停止按钮结束它，再发起新任务。",
            "A production task is already running in this session. Wait for it to finish, or stop it first, then start a new task.",
          );
          return c.json({
            error: { code: "PRODUCTION_TASK_ALREADY_RUNNING", message },
            response: message,
          }, 409);
        };

        // task-store 每会话只有一个任务快照，不支持并发生产任务。
        // 名额必须在任何 await 之前同步预留：并发的第二个确认请求在这里 409，
        // 不会与第一个请求一起通过后面的快照检查（check-then-act 竞态）。
        // 预留键固定为此刻的 sessionId：后面 bookSession 可能因建书迁移被重新
        // 赋值，finally 释放的必须是当初预留的那个键。
        const reservedSessionId = bookSession.sessionId;
        if (reservedProductionSessions.has(reservedSessionId)) {
          return productionTaskBusyResponse();
        }
        reservedProductionSessions.set(reservedSessionId, confirmedTaskId);

        const taskId = confirmedTaskId;
        const taskController = new AbortController();
        activeConfirmedTasks.set(taskId, taskController);
        let pendingBookId: string | null = null;
        try {
          // 预留成功后再走快照检查：本进程的任务都会占预留名额，这里防的是
          // 旧进程遗留的运行中快照（loadReconciledTaskSnapshot 会把它对账成
          // 终态）等边界情况，保证不覆盖一个仍被认为在运行的任务。
          const runningTask = await findActiveRunningTask(bookSession.sessionId);
          if (runningTask) {
            return productionTaskBusyResponse();
          }

          pendingBookId = confirmedIntent === "create_book" && actionPayload?.createBook?.title
            ? deriveBookIdFromTitle(actionPayload.createBook.title)
            : null;
          if (pendingBookId) {
            bookCreateStatus.set(pendingBookId, { status: "creating" });
            broadcast("book:creating", {
              bookId: pendingBookId,
              title: actionPayload?.createBook?.title ?? pendingBookId,
              sessionId: streamSessionId,
            });
          }

          // 任务开始前先把用户指令作为 user 消息写进 transcript：任务运行期间
          // 刷新页面时，用户气泡能从 transcript 恢复；并行聊天随后写入的消息
          // 也会按真实时间排在指令之后。完成/失败路径只追加助手工具消息
          //（instruction 传空字符串），指令不会写第二遍。
          await appendSessionMessagesUnlessDeleted(root, bookSession.sessionId, [{
            role: "user",
            content: instruction,
            timestamp: Date.now(),
          }], instruction, { sessionKind });

          const exec = await executeConfirmedProductionAction({
            pipeline,
            root,
            sessionId: bookSession.sessionId,
            bookId: agentBookId,
            streamSessionId,
            instruction,
            requestedIntent: confirmedIntent,
            actionPayload,
            language: surfaceLanguage,
            taskId,
            sourceRequestId,
            signal: taskController.signal,
            onTaskChange: (taskExec) => persistConfirmedTask(
              bookSession.sessionId,
              confirmedIntent,
              taskExec,
              sourceRequestId,
            ),
            ...(playMode ? { playMode } : {}),
          });

          let createdBookId: string | null = null;
          if (exec.tool === "sub_agent" && exec.agent === "architect" && exec.status === "completed") {
            createdBookId = resolveCreatedBookIdFromToolExecs([exec]);
            if (createdBookId) {
              try {
                const migratedSession = await migrateBookSession(root, bookSession.sessionId, createdBookId);
                if (migratedSession) {
                  bookSession = migratedSession;
                }
              } catch (e) {
                if (!(e instanceof SessionAlreadyMigratedError)) {
                  throw e;
                }
              }
              const book = await loadStudioBookListSummary(state, createdBookId).catch(() => undefined);
              bookCreateStatus.delete(createdBookId);
              broadcast("book:created", {
                bookId: createdBookId,
                sessionId: bookSession.sessionId,
                ...(book ? { book } : {}),
              });
            }
          }

          const responseText = exec.result ?? pick(surfaceLanguage, "已完成。", "Done.");
          const responseForUser = suppressManualTextForTool(exec) ? "" : responseText;
          // 指令已在任务开始时写入 transcript，这里只补助手工具消息。
          await appendSessionMessagesUnlessDeleted(root, bookSession.sessionId, [
            manualToolAssistantMessage(
              responseText,
              exec,
              configuredEntry?.service ?? reqService ?? config.llm.provider,
              reqModel ?? config.llm.model,
            ),
          ], "", manualToolAppendOptions(sessionKind, exec));
          await refreshBookSessionFromTranscript();
          broadcast("agent:complete", { instruction, activeBookId: createdBookId ?? agentBookId, sessionId: bookSession.sessionId, sessionKind });
          return c.json({
            response: responseForUser,
            details: { toolExecutions: [exec] },
            session: {
              sessionId: bookSession.sessionId,
              sessionKind,
              ...(createdBookId ?? agentBookId ? { activeBookId: createdBookId ?? agentBookId } : {}),
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const failure = formatAgentActionFailure(message, surfaceLanguage);
          if (pendingBookId) {
            bookCreateStatus.set(pendingBookId, { status: "error", error: message });
            broadcast("book:error", { bookId: pendingBookId, sessionId: streamSessionId, error: message });
          }
          if (error instanceof ConfirmedActionExecutionError) {
            // 指令已在任务开始时写入 transcript，失败时同样只补助手工具消息。
            await appendSessionMessagesUnlessDeleted(root, bookSession.sessionId, [
              manualToolAssistantMessage(
                message,
                error.exec,
                configuredEntry?.service ?? reqService ?? config.llm.provider,
                reqModel ?? config.llm.model,
              ),
            ], "", manualToolAppendOptions(sessionKind, error.exec)).catch(() => undefined);
            await refreshBookSessionFromTranscript().catch(() => undefined);
          }
          broadcast("agent:error", { instruction, activeBookId: agentBookId, sessionId: bookSession.sessionId, sessionKind, error: message });
          return c.json({
            error: { code: failure.code, message: failure.message },
            response: failure.message,
          }, failure.status);
        } finally {
          activeConfirmedTasks.delete(taskId);
          reservedProductionSessions.delete(reservedSessionId);
        }
      }

      // The surface agent should speak the user's language, not just the project default.
      // Pre-commitment surfaces (chat / play / short / book-create, no book yet) infer it
      // from the instruction; committed book/edit sessions keep the configured language.
      // Without this, an English request on a zh-default project gets Chinese replies — and
      // a Chinese play world, because play_start then infers from the rewritten premise.
      // Run pi-agent session
      // 后台生产任务与聊天并行时，把任务状态注入 agent 的系统提示词，
      // 让模型知道任务仍在运行、能回答进度、且不会重复发起同类任务；
      // 同时传 suppressProductionTools 在 host 层剔除会修改书籍/产物的
      // 生产工具（提示词只是软约束）。
      const backgroundTask = await findActiveRunningTask(bookSession.sessionId);
      const collectedToolExecs: CollectedToolExec[] = [];
      const result = await runAgentSession(
        {
          model,
          apiKey: agentApiKey,
          pipeline,
          ...(backgroundTask
            ? {
                backgroundTaskContext: buildRunningTaskContextBlock(backgroundTask, surfaceLanguage),
                suppressProductionTools: true,
              }
            : {}),
          projectRoot: root,
          bookId: agentBookId,
          sessionKind,
          playMode,
          actionSource,
          requestedIntent,
          actionPayload,
          requestedSkills,
          disabledSkills,
          attachments,
          sessionId: bookSession.sessionId,
          language: surfaceLanguage,
          onContextCompression: (event) => {
            broadcast("context:compression", {
              sessionId: streamSessionId,
              ...event,
            });
          },
          onEvent: (event) => {
            if (event.type === "message_update") {
              const ame = event.assistantMessageEvent;
              if (ame.type === "text_delta") {
                broadcast("draft:delta", { sessionId: streamSessionId, text: ame.delta });
              } else if (ame.type === "thinking_delta") {
                broadcast("thinking:delta", { sessionId: streamSessionId, text: (ame as any).delta });
              } else if (ame.type === "thinking_start") {
                broadcast("thinking:start", { sessionId: streamSessionId });
              } else if (ame.type === "thinking_end") {
                broadcast("thinking:end", { sessionId: streamSessionId });
              }
            }
            if (event.type === "tool_execution_start") {
              const args = event.args as Record<string, unknown> | undefined;
              const agent = event.toolName === "sub_agent" ? (args?.agent as string | undefined) : undefined;
              const stages = agent ? (pipelineStages(agent, language) ?? []) : [];

              collectedToolExecs.push({
                id: event.toolCallId,
                tool: event.toolName,
                agent,
                label: resolveToolLabel(event.toolName, agent, language),
                status: "running",
                args,
                stages: stages.length > 0
                  ? stages.map(l => ({ label: l, status: "pending" as const }))
                  : undefined,
                startedAt: Date.now(),
              });

              if (!agentBookId && event.toolName === "sub_agent" && agent === "architect") {
                const bookId = resolveArchitectBookIdFromArgs(args);
                if (bookId) {
                  const title = typeof args?.title === "string" && args.title.trim()
                    ? args.title.trim()
                    : bookId;
                  bookCreateStatus.set(bookId, { status: "creating" });
                  broadcast("book:creating", { bookId, title, sessionId: streamSessionId });
                }
              }

              broadcast("tool:start", {
                sessionId: streamSessionId,
                id: event.toolCallId,
                tool: event.toolName,
                args,
                stages,
              });
            }
            if (event.type === "tool_execution_end") {
              const exec = collectedToolExecs.find(t => t.id === event.toolCallId);
              if (exec) {
                exec.status = event.isError ? "error" : "completed";
                exec.completedAt = Date.now();
                exec.stages = exec.stages?.map(s => ({ ...s, status: "completed" as const }));
                if (event.isError) exec.error = extractToolError(event.result);
                else exec.result = summarizeResult(event.result);
                exec.details = (event.result as { details?: unknown } | undefined)?.details;
                if (
                  event.isError &&
                  !agentBookId &&
                  exec.tool === "sub_agent" &&
                  exec.agent === "architect"
                ) {
                  const bookId = resolveArchitectBookIdFromArgs(exec.args);
                  if (bookId) {
                    const error = exec.error ?? "Book creation failed";
                    bookCreateStatus.set(bookId, { status: "error", error });
                    broadcast("book:error", { bookId, sessionId: streamSessionId, error });
                  }
                }
              }
              broadcast("tool:end", {
                sessionId: streamSessionId,
                id: event.toolCallId,
                tool: event.toolName,
                result: event.result,
                details: exec?.details,
                isError: event.isError,
              });
            }
          },
        },
        instruction,
      );

      if (result.responseText) {
        const actionExecutionError = validateAgentActionExecution({
          instruction,
          agentBookId,
          requestedIntent,
          collectedToolExecs,
          language,
        });
        if (actionExecutionError) {
          return c.json({
            error: { code: "AGENT_ACTION_NOT_EXECUTED", message: actionExecutionError },
            response: actionExecutionError,
          }, 502);
        }
      }

      let broadcastedCreatedBookId: string | null = null;
      const finalizeCreatedBook = async (): Promise<string | null> => {
        if (agentBookId) return null;
        const createdBookId = resolveCreatedBookIdFromToolExecs(collectedToolExecs);
        if (!createdBookId) return null;
        if (broadcastedCreatedBookId === createdBookId) return createdBookId;
        if (!await completeBookExists(join(root, "books", createdBookId))) {
          const error = "Book creation artifact is incomplete on disk.";
          bookCreateStatus.set(createdBookId, { status: "error", error });
          broadcast("book:error", { bookId: createdBookId, sessionId: bookSession.sessionId, error });
          return null;
        }

        try {
          const migratedSession = await migrateBookSession(root, bookSession.sessionId, createdBookId);
          if (migratedSession) {
            bookSession = migratedSession;
          }
        } catch (e) {
          if (!(e instanceof SessionAlreadyMigratedError)) {
            throw e;
          }
        }

        const book = await loadStudioBookListSummary(state, createdBookId).catch(() => undefined);
        bookCreateStatus.delete(createdBookId);
        broadcast("book:created", {
          bookId: createdBookId,
          sessionId: bookSession.sessionId,
          ...(book ? { book } : {}),
        });
        broadcastedCreatedBookId = createdBookId;
        return createdBookId;
      };

      if (!result.responseText) {
        if (hasSuccessfulToolExec(collectedToolExecs, "propose_action")) {
          await refreshBookSessionFromTranscript();
          broadcast("agent:complete", { instruction, activeBookId, sessionId: bookSession.sessionId, sessionKind });
          return c.json({
            response: "",
            session: {
              sessionId: bookSession.sessionId,
              sessionKind,
              ...(bookSession.bookId ? { activeBookId: bookSession.bookId } : {}),
            },
            details: { toolExecutions: collectedToolExecs },
          });
        }

        if (result.errorMessage) {
          if (resolveCreatedBookIdFromToolExecs(collectedToolExecs)) {
            await finalizeCreatedBook();
          }
          const failure = formatAgentFailure(result.errorMessage, language);
          return c.json({
            error: { code: failure.code, message: failure.message },
            response: failure.message,
          }, failure.status);
        }

        const actionExecutionError = validateAgentActionExecution({
          instruction,
          agentBookId,
          requestedIntent,
          collectedToolExecs,
          language,
        });
        if (actionExecutionError) {
          return c.json({
            error: { code: "AGENT_ACTION_NOT_EXECUTED", message: actionExecutionError },
            response: actionExecutionError,
          }, 502);
        }

        await refreshBookSessionFromTranscript();
        const createdBookId = await finalizeCreatedBook();
        if (requestedIntent || createdBookId || hasSuccessfulToolResult(collectedToolExecs)) {
          const responseSessionKind = bookSession.sessionKind ?? sessionKind;
          broadcast("agent:complete", { instruction, activeBookId, sessionId: bookSession.sessionId, sessionKind: responseSessionKind });
          return c.json({
            response: "",
            session: {
              sessionId: bookSession.sessionId,
              sessionKind: responseSessionKind,
              ...(createdBookId ?? bookSession.bookId ? { activeBookId: createdBookId ?? bookSession.bookId } : {}),
            },
          });
        }

        const emptyMessage = pick(
          language,
          "模型未返回文本内容。请检查协议类型（chat/responses）、流式开关或上游服务兼容性。",
          "The model returned no text content. Check the protocol type (chat/responses), the streaming switch, or upstream service compatibility.",
        );
        if (resolveCreatedBookIdFromToolExecs(collectedToolExecs)) {
          await finalizeCreatedBook();
        }
        return c.json({
          error: { code: "AGENT_EMPTY_RESPONSE", message: emptyMessage },
          response: emptyMessage,
        }, 502);
      }
      await refreshBookSessionFromTranscript();
      await finalizeCreatedBook();

      const responseSessionKind = bookSession.sessionKind ?? sessionKind;
      broadcast("agent:complete", { instruction, activeBookId, sessionId: bookSession.sessionId, sessionKind: responseSessionKind });

      return c.json({
        response: result.responseText,
        session: {
          sessionId: bookSession.sessionId,
          sessionKind: responseSessionKind,
          ...(bookSession.bookId ? { activeBookId: bookSession.bookId } : {}),
        },
      });
    } catch (e) {
      if (e instanceof ApiError) {
        throw e;
      }
      if (e instanceof SessionAlreadyMigratedError) {
        const migratedMessage = e instanceof Error ? e.message : String(e);
        throw new ApiError(409, "SESSION_ALREADY_MIGRATED", migratedMessage);
      }
      const msg = e instanceof Error ? e.message : String(e);
      broadcast("agent:error", { instruction, activeBookId, sessionId, sessionKind: reqSessionKind, error: msg });

      // Agent busy — return 429 with user-friendly message
      if (/already processing|prompt.*queue/i.test(msg)) {
        return c.json({
          error: {
            code: "AGENT_BUSY",
            message: pick(language, "正在处理中，请等待当前操作完成", "Still processing. Wait for the current operation to finish"),
          },
          response: pick(
            language,
            "正在处理中，请等待当前操作完成后再发送。",
            "Still processing. Wait for the current operation to finish before sending again.",
          ),
        }, 429);
      }

      const failure = formatAgentFailure(msg, language);
      return c.json(
        { error: { code: failure.code, message: failure.message } },
        failure.status,
      );
    }
  });

  // --- Language setup ---

  app.post("/api/v1/project/language", async (c) => {
    const { language } = await c.req.json<{ language: "zh" | "en" }>();
    const configPath = join(root, "inkos.json");
    try {
      const raw = await readFile(configPath, "utf-8");
      const existing = JSON.parse(raw);
      existing.language = language;
      const { writeFile: writeFileFs } = await import("node:fs/promises");
      await writeFileFs(configPath, JSON.stringify(existing, null, 2), "utf-8");
      return c.json({ ok: true, language });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Audit ---

  app.post("/api/v1/books/:id/audit/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const bookDir = state.bookDir(id);

    broadcast("audit:start", { bookId: id, chapter: chapterNum });
    try {
      const book = await state.loadBookConfig(id);
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNum).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const content = await readFile(join(chaptersDir, match), "utf-8");
      const currentConfig = await loadCurrentProjectConfig();
      const { ContinuityAuditor } = await import("@actalk/inkos-core");
      const auditor = new ContinuityAuditor({
        client: createLLMClient(currentConfig.llm),
        model: currentConfig.llm.model,
        projectRoot: root,
        bookId: id,
      });
      const result = await auditor.auditChapter(bookDir, content, chapterNum, book.genre);
      broadcast("audit:complete", { bookId: id, chapter: chapterNum, passed: result.passed });
      return c.json(result);
    } catch (e) {
      broadcast("audit:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Revise ---

  app.post("/api/v1/books/:id/revise/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const bookDir = state.bookDir(id);
    const body = await c.req
      .json<{ mode?: string; brief?: string }>()
      .catch(() => ({ mode: "spot-fix", brief: undefined }));

    broadcast("revise:start", { bookId: id, chapter: chapterNum });
    try {
      const book = await state.loadBookConfig(id);
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNum).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const pipeline = new PipelineRunner(await buildPipelineConfig({
        externalContext: body.brief,
        bookIdForSettings: id,
      }));
      const normalizedMode = body.mode ?? "spot-fix";
      const result = await pipeline.reviseDraft(
        id,
        chapterNum,
        normalizedMode as "polish" | "rewrite" | "rework" | "spot-fix" | "anti-detect",
      );
      broadcast("revise:complete", { bookId: id, chapter: chapterNum });
      return c.json(result);
    } catch (e) {
      broadcast("revise:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Export ---

  app.get("/api/v1/books/:id/export", async (c) => {
    const id = c.req.param("id");
    const format = (c.req.query("format") ?? "txt") as string;
    const approvedOnly = c.req.query("approvedOnly") === "true";

    try {
      const artifact = await buildExportArtifact(state, id, {
        format: format as "txt" | "md" | "epub",
        approvedOnly,
      });
      const responseBody = typeof artifact.payload === "string"
        ? artifact.payload
        : new Uint8Array(artifact.payload);
      return new Response(responseBody, {
        headers: {
          "Content-Type": artifact.contentType,
          "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
        },
      });
    } catch {
      return c.json({ error: "Export failed" }, 500);
    }
  });

  // --- Export to file (save to project dir) ---

  app.post("/api/v1/books/:id/export-save", async (c) => {
    const id = c.req.param("id");
    const { format, approvedOnly } = await c.req.json<{ format?: string; approvedOnly?: boolean }>().catch(() => ({ format: "txt", approvedOnly: false }));
    const fmt = format ?? "txt";

    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      const tools = createInteractionToolsFromDeps(pipeline, state);
      const bookDir = state.bookDir(id);
      const outputPath = join(bookDir, `${id}.${fmt === "epub" ? "epub" : fmt}`);
      const result = await processProjectInteractionRequest({
        projectRoot: root,
        request: {
          intent: "export_book",
          bookId: id,
          format: fmt as "txt" | "md" | "epub",
          approvedOnly,
          outputPath,
        },
        tools,
        activeBookId: id,
      });
      return c.json({
        ok: true,
        path: (result.details?.outputPath as string | undefined) ?? outputPath,
        format: fmt,
        chapters: (result.details?.chaptersExported as number | undefined) ?? 0,
      });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Genre detail + copy ---

  app.get("/api/v1/genres/:id", async (c) => {
    const genreId = c.req.param("id");
    try {
      const { readGenreProfile } = await import("@actalk/inkos-core");
      const { profile, body } = await readGenreProfile(root, genreId);
      return c.json({ profile, body });
    } catch (e) {
      return c.json({ error: String(e) }, 404);
    }
  });

  app.post("/api/v1/genres/:id/copy", async (c) => {
    const genreId = c.req.param("id");
    if (/[/\\\0]/.test(genreId) || genreId.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${genreId}"`);
    }
    try {
      const { getBuiltinGenresDir } = await import("@actalk/inkos-core");
      const { mkdir: mkdirFs, copyFile } = await import("node:fs/promises");
      const builtinDir = getBuiltinGenresDir();
      const projectGenresDir = join(root, "genres");
      await mkdirFs(projectGenresDir, { recursive: true });
      await copyFile(join(builtinDir, `${genreId}.md`), join(projectGenresDir, `${genreId}.md`));
      return c.json({ ok: true, path: `genres/${genreId}.md` });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Model overrides ---

  app.get("/api/v1/project/model-overrides", async (c) => {
    const raw = JSON.parse(await readFile(join(root, "inkos.json"), "utf-8"));
    return c.json({ overrides: raw.modelOverrides ?? {} });
  });

  app.put("/api/v1/project/model-overrides", async (c) => {
    const { overrides } = await c.req.json<{ overrides: Record<string, unknown> }>();
    const configPath = join(root, "inkos.json");
    const raw = JSON.parse(await readFile(configPath, "utf-8"));
    raw.modelOverrides = overrides;
    const { writeFile: writeFileFs } = await import("node:fs/promises");
    await writeFileFs(configPath, JSON.stringify(raw, null, 2), "utf-8");
    return c.json({ ok: true });
  });

  // --- Global default model ---

  app.get("/api/v1/project/default-model", async (c) => {
    const raw = await loadRawConfig(root);
    const llm = raw.llm && typeof raw.llm === "object" && !Array.isArray(raw.llm)
      ? raw.llm as Record<string, unknown>
      : {};
    return c.json({
      service: typeof llm.service === "string" ? llm.service : null,
      defaultModel: typeof llm.defaultModel === "string" && llm.defaultModel.trim()
        ? llm.defaultModel
        : typeof llm.model === "string" && llm.model.trim()
          ? llm.model
          : null,
    });
  });

  app.put("/api/v1/project/default-model", async (c) => {
    const body = await c.req.json<{ defaultModel?: string; service?: string }>();
    const defaultModel = typeof body.defaultModel === "string" ? body.defaultModel.trim() : "";
    if (!defaultModel) return c.json({ error: "defaultModel is required" }, 400);
    const raw = await loadRawConfig(root);
    raw.llm = raw.llm && typeof raw.llm === "object" && !Array.isArray(raw.llm) ? raw.llm : {};
    const llm = raw.llm as Record<string, unknown>;
    llm.defaultModel = defaultModel;
    if (typeof body.service === "string" && body.service.trim()) {
      llm.service = body.service.trim();
    }
    syncTopLevelLlmMirror(llm);
    await saveRawConfig(root, raw);
    return c.json({
      ok: true,
      service: typeof llm.service === "string" ? llm.service : null,
      defaultModel,
    });
  });

  // --- Research search provider ---

  app.get("/api/v1/project/research-search", async (c) => {
    const raw = await loadRawConfig(root);
    return c.json({ researchSearch: ResearchSearchConfigSchema.parse(raw.researchSearch ?? {}) });
  });

  app.put("/api/v1/project/research-search", async (c) => {
    const body = await c.req.json<{ researchSearch?: unknown }>();
    const researchSearch = ResearchSearchConfigSchema.parse(body.researchSearch ?? {});
    const raw = await loadRawConfig(root);
    raw.researchSearch = researchSearch;
    await saveRawConfig(root, raw);
    return c.json({ ok: true, researchSearch });
  });

  // --- Chapter review mode (C4a: auto pipeline vs manual checkpoint) ---

  app.get("/api/v1/project/chapter-review-mode", async (c) => {
    const raw = await loadRawConfig(root);
    return c.json({ mode: readProjectChapterReviewMode(raw) });
  });

  app.put("/api/v1/project/chapter-review-mode", async (c) => {
    const { mode } = await c.req.json<{ mode?: string }>();
    const next = normalizeChapterReviewMode(mode);
    const raw = await loadRawConfig(root);
    raw.writing = { ...(raw.writing ?? {}), reviewMode: next };
    await saveRawConfig(root, raw);
    return c.json({ ok: true, mode: next });
  });

  app.get("/api/v1/books/:id/chapter-review-mode", async (c) => {
    const bookId = c.req.param("id");
    if (!isSafeBookId(bookId)) return c.json({ error: "Invalid book id" }, 400);
    try {
      const [projectConfig, rawBook] = await Promise.all([
        loadRawConfig(root),
        loadRawBookConfig(root, bookId),
      ]);
      const projectMode = readProjectChapterReviewMode(projectConfig);
      const bookMode = readBookChapterReviewMode(rawBook);
      return c.json({
        mode: bookMode ?? projectMode,
        bookMode: bookMode ?? null,
        projectMode,
      });
    } catch {
      return c.json({ error: `Book "${bookId}" not found` }, 404);
    }
  });

  app.put("/api/v1/books/:id/chapter-review-mode", async (c) => {
    const bookId = c.req.param("id");
    if (!isSafeBookId(bookId)) return c.json({ error: "Invalid book id" }, 400);
    const { mode } = await c.req.json<{ mode?: string }>();
    const rawBookPath = join(root, "books", bookId, "book.json");
    try {
      const [projectConfig, rawBook] = await Promise.all([
        loadRawConfig(root),
        loadRawBookConfig(root, bookId),
      ]);
      const projectMode = readProjectChapterReviewMode(projectConfig);
      if (mode === "inherit") {
        const writing = rawBook.writing && typeof rawBook.writing === "object" && !Array.isArray(rawBook.writing)
          ? { ...(rawBook.writing as Record<string, unknown>) }
          : {};
        delete writing.reviewMode;
        rawBook.writing = Object.keys(writing).length > 0 ? writing : undefined;
      } else {
        rawBook.writing = {
          ...(rawBook.writing && typeof rawBook.writing === "object" && !Array.isArray(rawBook.writing) ? rawBook.writing as Record<string, unknown> : {}),
          reviewMode: normalizeChapterReviewMode(mode),
        };
      }
      await writeFile(rawBookPath, JSON.stringify(rawBook, null, 2), "utf-8");
      const bookMode = readBookChapterReviewMode(rawBook);
      return c.json({
        ok: true,
        mode: bookMode ?? projectMode,
        bookMode: bookMode ?? null,
        projectMode,
      });
    } catch {
      return c.json({ error: `Book "${bookId}" not found` }, 404);
    }
  });

  // --- Notify channels ---

  app.get("/api/v1/project/notify", async (c) => {
    const raw = JSON.parse(await readFile(join(root, "inkos.json"), "utf-8"));
    return c.json({ channels: raw.notify ?? [] });
  });

  app.put("/api/v1/project/notify", async (c) => {
    const { channels } = await c.req.json<{ channels: unknown[] }>();
    const configPath = join(root, "inkos.json");
    const raw = JSON.parse(await readFile(configPath, "utf-8"));
    raw.notify = channels;
    const { writeFile: writeFileFs } = await import("node:fs/promises");
    await writeFileFs(configPath, JSON.stringify(raw, null, 2), "utf-8");
    return c.json({ ok: true });
  });

  // --- AIGC Detection ---

  app.post("/api/v1/books/:id/detect/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const bookDir = state.bookDir(id);

    try {
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNum).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const content = await readFile(join(chaptersDir, match), "utf-8");
      const { analyzeAITells } = await import("@actalk/inkos-core");
      const result = analyzeAITells(content);
      return c.json({ chapterNumber: chapterNum, ...result });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Truth file edit ---

  app.put("/api/v1/books/:id/truth/:file{.+}", async (c) => {
    const id = c.req.param("id");
    const file = c.req.param("file");
    const bookDir = state.bookDir(id);
    const resolved = resolveTruthFilePath(bookDir, file);
    if (!resolved) {
      return c.json({ error: "Invalid truth file" }, 400);
    }
    // Legacy pointer shims are read-only in new-layout books: writing
    // story_bible.md or book_rules.md does nothing at runtime (the pipeline
    // reads outline/ instead). For pre-Phase-5 books these ARE authoritative.
    if (LEGACY_SHIM_FILES.has(file)) {
      const { isNewLayoutBook } = await import("@actalk/inkos-core");
      if (await isNewLayoutBook(bookDir)) {
        return c.json(
          { error: "Legacy compat shim; edit outline/story_frame.md instead" },
          400,
        );
      }
    }
    if (RUNTIME_DIAGNOSTIC_FILE_RE.test(file)) {
      return c.json({ error: "Runtime diagnostic files are read-only" }, 400);
    }
    const { content } = await c.req.json<{ content: string }>();
    const { writeFile: writeFileFs, mkdir: mkdirFs } = await import("node:fs/promises");
    const { dirname: dirnameFs } = await import("node:path");
    await mkdirFs(dirnameFs(resolved), { recursive: true });
    await writeFileFs(resolved, content, "utf-8");
    return c.json({ ok: true });
  });

  // =============================================
  // NEW ENDPOINTS — CLI parity
  // =============================================

  // --- Book Delete ---

  app.delete("/api/v1/books/:id", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);
    try {
      const { rm } = await import("node:fs/promises");
      await rm(bookDir, { recursive: true, force: true });
      broadcast("book:deleted", { bookId: id });
      return c.json({ ok: true, bookId: id });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Book Update ---

  app.put("/api/v1/books/:id", async (c) => {
    const id = c.req.param("id");
    const updates = await c.req.json<{
      chapterWordCount?: number;
      targetChapters?: number;
      status?: string;
      language?: string;
    }>();
    try {
      const book = await state.loadBookConfig(id);
      const updated = {
        ...book,
        ...(updates.chapterWordCount !== undefined ? { chapterWordCount: Number(updates.chapterWordCount) } : {}),
        ...(updates.targetChapters !== undefined ? { targetChapters: Number(updates.targetChapters) } : {}),
        ...(updates.status !== undefined ? { status: updates.status as typeof book.status } : {}),
        ...(updates.language !== undefined ? { language: updates.language as "zh" | "en" } : {}),
        updatedAt: new Date().toISOString(),
      };
      await state.saveBookConfig(id, updated);
      return c.json({ ok: true, book: updated });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Write Rewrite (specific chapter) ---

  app.post("/api/v1/books/:id/rewrite/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const body: { brief?: string } = await c.req
      .json<{ brief?: string }>()
      .catch(() => ({}));

    broadcast("rewrite:start", { bookId: id, chapter: chapterNum });
    try {
      if (Object.prototype.hasOwnProperty.call(body, "brief")) {
        await saveChapterUserBrief(state.bookDir(id), chapterNum, body.brief ?? "");
      }
      const pipeline = new PipelineRunner(await buildPipelineConfig({
        externalContext: body.brief,
        revisionGate: "always",
        bookIdForSettings: id,
      }));
      const result = await pipeline.reviseDraft(id, chapterNum, "rework");
      broadcast("rewrite:complete", {
        bookId: id,
        chapterNumber: result.chapterNumber,
        wordCount: result.wordCount,
        status: result.status,
      });
      return c.json({ status: "complete", bookId: id, chapter: chapterNum, result });
    } catch (e) {
      broadcast("rewrite:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/resync/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const body: { brief?: string } = await c.req
      .json<{ brief?: string }>()
      .catch(() => ({}));

    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig({
        externalContext: body.brief,
      }));
      const result = await pipeline.resyncChapterArtifacts(id, chapterNum);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Detect All chapters ---

  app.post("/api/v1/books/:id/detect-all", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);

    try {
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const mdFiles = files.filter((f) => f.endsWith(".md") && /^\d{4}/.test(f)).sort();
      const { analyzeAITells } = await import("@actalk/inkos-core");

      const results = await Promise.all(
        mdFiles.map(async (f) => {
          const num = parseInt(f.slice(0, 4), 10);
          const content = await readFile(join(chaptersDir, f), "utf-8");
          const result = analyzeAITells(content);
          return { chapterNumber: num, filename: f, ...result };
        }),
      );
      return c.json({ bookId: id, results });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Detect Stats ---

  app.get("/api/v1/books/:id/detect/stats", async (c) => {
    const id = c.req.param("id");
    try {
      const { loadDetectionHistory, analyzeDetectionInsights } = await import("@actalk/inkos-core");
      const bookDir = state.bookDir(id);
      const history = await loadDetectionHistory(bookDir);
      const insights = analyzeDetectionInsights(history);
      return c.json(insights);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Genre Create ---

  app.post("/api/v1/genres/create", async (c) => {
    const body = await c.req.json<{
      id: string; name: string; language?: string;
      chapterTypes?: string[]; fatigueWords?: string[];
      numericalSystem?: boolean; powerScaling?: boolean; eraResearch?: boolean;
      pacingRule?: string; satisfactionTypes?: string[]; auditDimensions?: number[];
      body?: string;
    }>();

    if (!body.id || !body.name) {
      return c.json({ error: "id and name are required" }, 400);
    }
    if (/[/\\\0]/.test(body.id) || body.id.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${body.id}"`);
    }

    const { writeFile: writeFileFs, mkdir: mkdirFs } = await import("node:fs/promises");
    const genresDir = join(root, "genres");
    await mkdirFs(genresDir, { recursive: true });

    const frontmatter = [
      "---",
      `name: ${yamlScalar(body.name)}`,
      `id: ${yamlScalar(body.id)}`,
      `language: ${yamlScalar(body.language ?? "zh")}`,
      `chapterTypes: ${JSON.stringify(body.chapterTypes ?? [])}`,
      `fatigueWords: ${JSON.stringify(body.fatigueWords ?? [])}`,
      `numericalSystem: ${body.numericalSystem ?? false}`,
      `powerScaling: ${body.powerScaling ?? false}`,
      `eraResearch: ${body.eraResearch ?? false}`,
      `pacingRule: ${yamlScalar(body.pacingRule ?? "")}`,
      `satisfactionTypes: ${JSON.stringify(body.satisfactionTypes ?? [])}`,
      `auditDimensions: ${JSON.stringify(body.auditDimensions ?? [])}`,
      "---",
      "",
      body.body ?? "",
    ].join("\n");

    await writeFileFs(join(genresDir, `${body.id}.md`), frontmatter, "utf-8");
    return c.json({ ok: true, id: body.id });
  });

  // --- Genre Edit ---

  app.put("/api/v1/genres/:id", async (c) => {
    const genreId = c.req.param("id");
    if (/[/\\\0]/.test(genreId) || genreId.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${genreId}"`);
    }

    const body = await c.req.json<{ profile: Record<string, unknown>; body: string }>();
    const { writeFile: writeFileFs, mkdir: mkdirFs } = await import("node:fs/promises");
    const genresDir = join(root, "genres");
    await mkdirFs(genresDir, { recursive: true });

    const p = body.profile;
    const frontmatter = [
      "---",
      `name: ${yamlScalar(p.name ?? genreId)}`,
      `id: ${yamlScalar(p.id ?? genreId)}`,
      `language: ${yamlScalar(p.language ?? "zh")}`,
      `chapterTypes: ${JSON.stringify(p.chapterTypes ?? [])}`,
      `fatigueWords: ${JSON.stringify(p.fatigueWords ?? [])}`,
      `numericalSystem: ${p.numericalSystem ?? false}`,
      `powerScaling: ${p.powerScaling ?? false}`,
      `eraResearch: ${p.eraResearch ?? false}`,
      `pacingRule: ${yamlScalar(p.pacingRule ?? "")}`,
      `satisfactionTypes: ${JSON.stringify(p.satisfactionTypes ?? [])}`,
      `auditDimensions: ${JSON.stringify(p.auditDimensions ?? [])}`,
      "---",
      "",
      body.body ?? "",
    ].join("\n");

    await writeFileFs(join(genresDir, `${genreId}.md`), frontmatter, "utf-8");
    return c.json({ ok: true, id: genreId });
  });

  // --- Genre Delete (project-level only) ---

  app.delete("/api/v1/genres/:id", async (c) => {
    const genreId = c.req.param("id");
    if (/[/\\\0]/.test(genreId) || genreId.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${genreId}"`);
    }

    const filePath = join(root, "genres", `${genreId}.md`);
    try {
      const { rm } = await import("node:fs/promises");
      await rm(filePath);
      return c.json({ ok: true, id: genreId });
    } catch (e) {
      return c.json({ error: `Genre "${genreId}" not found in project` }, 404);
    }
  });

  // --- Style Analyze ---

  app.post("/api/v1/style/analyze", async (c) => {
    const { text, sourceName } = await c.req.json<{ text: string; sourceName: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    try {
      const { analyzeStyle } = await import("@actalk/inkos-core");
      const profile = analyzeStyle(text, sourceName ?? "unknown");
      return c.json(profile);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Style Import to Book ---

  app.post("/api/v1/books/:id/style/import", async (c) => {
    const id = c.req.param("id");
    const { text, sourceName } = await c.req.json<{ text: string; sourceName: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    broadcast("style:start", { bookId: id });
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      const result = await pipeline.generateStyleGuide(id, text, sourceName ?? "unknown");
      broadcast("style:complete", { bookId: id });
      return c.json({ ok: true, result });
    } catch (e) {
      broadcast("style:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Import Chapters ---

  app.post("/api/v1/books/:id/import/chapters", async (c) => {
    const id = c.req.param("id");
    const { text, splitRegex } = await c.req.json<{ text: string; splitRegex?: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    broadcast("import:start", { bookId: id, type: "chapters" });
    try {
      const { splitChapters } = await import("@actalk/inkos-core");
      const chapters = [...splitChapters(text, splitRegex)];

      const pipeline = new PipelineRunner(await buildPipelineConfig());
      const result = await pipeline.importChapters({ bookId: id, chapters });
      broadcast("import:complete", { bookId: id, type: "chapters", count: result.importedCount });
      return c.json(result);
    } catch (e) {
      broadcast("import:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Import Canon ---

  app.post("/api/v1/books/:id/import/canon", async (c) => {
    const id = c.req.param("id");
    const { fromBookId } = await c.req.json<{ fromBookId: string }>();
    if (!fromBookId) return c.json({ error: "fromBookId is required" }, 400);

    broadcast("import:start", { bookId: id, type: "canon" });
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      await pipeline.importCanon(id, fromBookId);
      broadcast("import:complete", { bookId: id, type: "canon" });
      return c.json({ ok: true });
    } catch (e) {
      broadcast("import:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Fanfic Init ---

  app.post("/api/v1/fanfic/init", async (c) => {
    const body = await c.req.json<{
      title: string; sourceText: string; sourceName?: string;
      mode?: string; genre?: string; platform?: string;
      targetChapters?: number; chapterWordCount?: number; language?: string;
    }>();
    if (!body.title || !body.sourceText) {
      return c.json({ error: "title and sourceText are required" }, 400);
    }

    const now = new Date().toISOString();
    const bookId = body.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "-").replace(/-+/g, "-").slice(0, 30);

    const bookConfig = {
      id: bookId,
      title: body.title,
      platform: (body.platform ?? "other") as "other",
      genre: (body.genre ?? "other") as "xuanhuan",
      status: "outlining" as const,
      targetChapters: body.targetChapters ?? 100,
      chapterWordCount: body.chapterWordCount ?? 3000,
      fanficMode: (body.mode ?? "canon") as "canon",
      ...(body.language ? { language: body.language as "zh" | "en" } : {}),
      createdAt: now,
      updatedAt: now,
    };

    broadcast("fanfic:start", { bookId, title: body.title });
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      await pipeline.initFanficBook(bookConfig, body.sourceText, body.sourceName ?? "source", (body.mode ?? "canon") as "canon");
      broadcast("fanfic:complete", { bookId });
      return c.json({ ok: true, bookId });
    } catch (e) {
      broadcast("fanfic:error", { bookId, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Fanfic Show (read canon) ---

  app.get("/api/v1/books/:id/fanfic", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);
    try {
      const content = await readFile(join(bookDir, "story", "fanfic_canon.md"), "utf-8");
      return c.json({ bookId: id, content });
    } catch {
      return c.json({ bookId: id, content: null });
    }
  });

  // --- Fanfic Refresh ---

  app.post("/api/v1/books/:id/fanfic/refresh", async (c) => {
    const id = c.req.param("id");
    const { sourceText, sourceName } = await c.req.json<{ sourceText: string; sourceName?: string }>();
    if (!sourceText?.trim()) return c.json({ error: "sourceText is required" }, 400);

    broadcast("fanfic:refresh:start", { bookId: id });
    try {
      const book = await state.loadBookConfig(id);
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      await pipeline.importFanficCanon(id, sourceText, sourceName ?? "source", (book.fanficMode ?? "canon") as "canon");
      broadcast("fanfic:refresh:complete", { bookId: id });
      return c.json({ ok: true });
    } catch (e) {
      broadcast("fanfic:refresh:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Side-story (番外) init: companion book inheriting a parent's canon ---

  app.post("/api/v1/spinoff/init", async (c) => {
    const body = await c.req.json<{
      title: string; parentBookId: string; direction?: string;
      genre?: string; platform?: string;
      targetChapters?: number; chapterWordCount?: number; language?: string;
    }>();
    if (!body.title?.trim() || !body.parentBookId?.trim()) {
      return c.json({ error: "title and parentBookId are required" }, 400);
    }
    let parent;
    try {
      parent = await state.loadBookConfig(body.parentBookId);
    } catch {
      return c.json({ error: `Parent book "${body.parentBookId}" not found` }, 404);
    }
    const language = (body.language ?? parent.language) as "zh" | "en" | undefined;
    const now = new Date().toISOString();
    const bookConfig = buildStudioBookConfig({
      title: body.title,
      genre: body.genre ?? parent.genre ?? "other",
      platform: body.platform ?? parent.platform,
      targetChapters: body.targetChapters ?? parent.targetChapters,
      chapterWordCount: body.chapterWordCount ?? parent.chapterWordCount,
      ...(language ? { language } : {}),
    }, now);
    const bookId = bookConfig.id;
    if (!bookId) {
      return c.json({ error: "Could not derive a valid book id from title" }, 400);
    }
    if (await completeBookExists(state.bookDir(bookId))) {
      return c.json({ error: `Book "${bookId}" already exists` }, 409);
    }
    broadcast("spinoff:start", { bookId, title: body.title, parentBookId: body.parentBookId });
    bookCreateStatus.set(bookId, { status: "creating" });
    void (async () => {
      try {
        const pipeline = new PipelineRunner(await buildPipelineConfig());
        await pipeline.initSpinoffBook(bookConfig, body.parentBookId, body.direction);
        const book = await loadStudioBookListSummary(state, bookId).catch(() => undefined);
        bookCreateStatus.delete(bookId);
        broadcast("spinoff:complete", { bookId });
        broadcast("book:created", { bookId, ...(book ? { book } : {}) });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        bookCreateStatus.set(bookId, { status: "error", error });
        broadcast("spinoff:error", { bookId, error });
        broadcast("book:error", { bookId, error });
      }
    })();
    return c.json({ status: "creating", bookId });
  });

  // --- Imitation (仿写) init: original story imitating a reference work's style ---

  app.post("/api/v1/imitation/init", async (c) => {
    const body = await c.req.json<{
      title: string; referenceText: string; storyIdea: string; sourceName?: string;
      genre?: string; platform?: string;
      targetChapters?: number; chapterWordCount?: number; language?: string;
    }>();
    if (!body.title?.trim() || !body.referenceText?.trim() || !body.storyIdea?.trim()) {
      return c.json({ error: "title, referenceText and storyIdea are required" }, 400);
    }
    const now = new Date().toISOString();
    const bookConfig = buildStudioBookConfig({
      title: body.title,
      genre: body.genre ?? "other",
      platform: body.platform,
      targetChapters: body.targetChapters,
      chapterWordCount: body.chapterWordCount,
      ...(body.language ? { language: body.language as "zh" | "en" } : {}),
    }, now);
    const bookId = bookConfig.id;
    if (!bookId) {
      return c.json({ error: "Could not derive a valid book id from title" }, 400);
    }
    if (await completeBookExists(state.bookDir(bookId))) {
      return c.json({ error: `Book "${bookId}" already exists` }, 409);
    }
    broadcast("imitation:start", { bookId, title: body.title });
    bookCreateStatus.set(bookId, { status: "creating" });
    void (async () => {
      try {
        const pipeline = new PipelineRunner(await buildPipelineConfig());
        await pipeline.initImitationBook(bookConfig, body.referenceText, body.storyIdea, body.sourceName);
        const book = await loadStudioBookListSummary(state, bookId).catch(() => undefined);
        bookCreateStatus.delete(bookId);
        broadcast("imitation:complete", { bookId });
        broadcast("book:created", { bookId, ...(book ? { book } : {}) });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        bookCreateStatus.set(bookId, { status: "error", error });
        broadcast("imitation:error", { bookId, error });
        broadcast("book:error", { bookId, error });
      }
    })();
    return c.json({ status: "creating", bookId });
  });

  // --- Radar Scan ---

  app.post("/api/v1/radar/scan", async (c) => {
    broadcast("radar:start", {});
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      const result = await pipeline.runRadar();
      await saveRadarScan(root, result);
      broadcast("radar:complete", { result });
      return c.json(result);
    } catch (e) {
      broadcast("radar:error", { error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get("/api/v1/radar/history", async (c) => {
    try {
      const items = await loadRadarHistory(root);
      return c.json({ items });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Doctor (environment health check) ---

  app.get("/api/v1/doctor", async (c) => {
    const { existsSync } = await import("node:fs");
    const { GLOBAL_ENV_PATH } = await import("@actalk/inkos-core");

    const checks = {
      inkosJson: existsSync(join(root, "inkos.json")),
      projectEnv: existsSync(join(root, ".env")),
      globalEnv: existsSync(GLOBAL_ENV_PATH),
      booksDir: existsSync(join(root, "books")),
      llmConnected: false,
      bookCount: 0,
    };

    try {
      const books = await state.listBooks();
      checks.bookCount = books.length;
    } catch { /* ignore */ }

    try {
      const currentConfig = await loadCurrentProjectConfig({ requireApiKey: false });
      const service = currentConfig.llm.service ?? currentConfig.llm.provider;
      // Hard overall budget so the diagnostics page never hangs on a slow /
      // rate-limited upstream — if we can't confirm connectivity quickly, report
      // it as not-connected rather than spinning.
      const probe = await withTimeout(
        probeServiceCapabilities({
          root,
          service,
          apiKey: currentConfig.llm.apiKey,
          baseUrl: currentConfig.llm.baseUrl,
          preferredApiFormat: currentConfig.llm.apiFormat,
          preferredStream: currentConfig.llm.stream,
          preferredModel: currentConfig.llm.model,
          proxyUrl: currentConfig.llm.proxyUrl,
          language: normalizeStudioLanguage(currentConfig.language),
        }),
        DOCTOR_LLM_PROBE_BUDGET_MS,
        "doctor llm probe",
      );
      checks.llmConnected = probe.ok;
    } catch { /* slow/unreachable upstream — leave llmConnected false */ }

    return c.json(checks);
  });

  app.get("/api/v1/interactive-films", async (c) => {
    const filmsDir = join(root, "interactive-films");
    let entries: string[] = [];
    try {
      const dirents = await readdir(filmsDir, { withFileTypes: true });
      entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const films: Array<{ projectId: string; title: string }> = [];
    for (const projectId of entries) {
      if (!isSafeBookId(projectId)) continue;
      try {
        const graph = await loadStoryGraph(root, projectId);
        if (graph) films.push({ projectId, title: graph.title || projectId });
      } catch { /* skip dirs without valid story-graph */ }
    }
    films.sort((a, b) => a.title.localeCompare(b.title, "zh"));
    return c.json({ films });
  });

  app.get("/api/v1/translations", async (c) => {
    const translationsDir = join(root, "translations");
    let entries: string[] = [];
    try {
      const dirents = await readdir(translationsDir, { withFileTypes: true });
      entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const translations: Array<{ projectId: string; title: string; sourceLanguage: string; targetLanguage: string; chapters: number }> = [];
    for (const projectId of entries) {
      if (!isSafeBookId(projectId)) continue;
      try {
        const manifest = await loadTranslationManifest(root, projectId);
        translations.push({
          projectId,
          title: manifest.title,
          sourceLanguage: manifest.sourceLanguage,
          targetLanguage: manifest.targetLanguage,
          chapters: manifest.chapters.length,
        });
      } catch {
        // Skip dirs without a valid translation manifest.
      }
    }
    translations.sort((a, b) => b.projectId.localeCompare(a.projectId));
    return c.json({ translations });
  });

  app.post("/api/v1/translations/upload", async (c) => {
    const body: { filename?: string; dataUrl?: string } = await c.req.json().catch(() => ({}));
    const result = await storeTranslationUpload(root, body);
    return c.json(result);
  });

  app.post("/api/v1/translations/create", async (c) => {
    const body: {
      filePath?: string;
      sourceLanguage?: string;
      targetLanguage?: string;
      title?: string;
      segmentMaxChars?: number;
    } = await c.req.json().catch(() => ({}));
    if (!body.filePath?.trim()) {
      return c.json({ error: { code: "MISSING_FILE_PATH", message: "filePath is required" } }, 400);
    }
    if (!body.sourceLanguage?.trim() || !body.targetLanguage?.trim()) {
      return c.json({ error: { code: "MISSING_LANGUAGES", message: "sourceLanguage and targetLanguage are required" } }, 400);
    }
    const result = await createTranslationProjectFromFile(root, {
      filePath: body.filePath,
      sourceLanguage: body.sourceLanguage,
      targetLanguage: body.targetLanguage,
      title: body.title,
      segmentMaxChars: body.segmentMaxChars,
    });
    return c.json({
      ...result,
      projectId: result.manifest.id,
      title: result.manifest.title,
    });
  });

  app.get("/api/v1/translations/:id", async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) {
      return c.json({ error: { code: "INVALID_ID", message: `invalid translation id: ${id}` } }, 400);
    }
    try {
      const manifest = await loadTranslationManifest(root, id);
      const reportPath = join(root, "translations", id, "review-report.md");
      const report = await readFile(reportPath, "utf-8").catch(() => "");
      const chapters = await Promise.all(manifest.chapters.map(async (chapter) => {
        const source = await loadTranslationChapter(root, chapter.sourcePath);
        const translated = await loadTranslationChapter(root, chapter.translatedPath).catch(() => ({
          ...source,
          segments: [],
        }));
        const targets = new Map(translated.segments.map((segment) => [segment.index, segment]));
        return {
          number: chapter.number,
          title: chapter.title,
          status: chapter.status,
          segments: source.segments.map((segment) => ({
            index: segment.index,
            source: segment.source,
            target: targets.get(segment.index)?.target ?? "",
            notes: targets.get(segment.index)?.notes ?? "",
          })),
        };
      }));
      return c.json({ manifest, report, chapters });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return c.json({ error: { code: "NOT_FOUND", message: `translation project not found for ${id}` } }, 404);
      }
      throw error;
    }
  });

  app.post("/api/v1/translations/:id/run", async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) {
      return c.json({ error: { code: "INVALID_ID", message: `invalid translation id: ${id}` } }, 400);
    }
    const body: { batchSize?: number; maxTokens?: number } = await c.req.json().catch(() => ({}));
    try {
      const currentConfig = await loadCurrentProjectConfig();
      const model = createLLMTranslationModel({
        client: createLLMClient(currentConfig.llm),
        model: currentConfig.llm.model,
        maxTokens: body.maxTokens,
      });
      const result = await runTranslationProject(root, id, {
        model,
        batchSize: body.batchSize,
      });
      return c.json(result);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const isUpstream = /API|LLM|provider|upstream|temporarily unavailable|rate limit|quota|fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|503|502|504/i.test(message);
      throw new ApiError(
        isUpstream ? 502 : 500,
        "TRANSLATION_RUN_FAILED",
        message || "Translation run failed.",
      );
    }
  });

  app.post("/api/v1/translations/:id/export", async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) {
      return c.json({ error: { code: "INVALID_ID", message: `invalid translation id: ${id}` } }, 400);
    }
    const body: { format?: "txt" | "md" | "epub"; outputPath?: string } = await c.req.json().catch(() => ({}));
    const result = await writeTranslationExport(root, id, {
      format: body.format ?? "md",
      outputPath: body.outputPath,
    });
    return c.json(result);
  });

  app.post("/api/v1/projects/:id/story-graph/delta", async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) {
      return c.json({ error: { code: "INVALID_ID", message: `invalid project id: ${id}` } }, 400);
    }
    const { delta } = await c.req.json<{ delta: unknown }>();
    const { graph, rev } = await applyGraphDelta({ projectRoot: root, projectId: id, delta: delta as never });
    return c.json({ rev, graph });
  });

  app.get("/api/v1/projects/:id/story-graph", async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) {
      return c.json({ error: { code: "INVALID_ID", message: `invalid project id: ${id}` } }, 400);
    }
    const graphPath = join(root, "interactive-films", id, "story-graph.json");
    try {
      const raw = await readFile(graphPath, "utf-8");
      return c.json(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return c.json({ error: { code: "NOT_FOUND", message: `story graph not found for ${id}` } }, 404);
      }
      throw error;
    }
  });

  app.get("/api/v1/projects/:id/export", async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) {
      return c.json({ error: { code: "INVALID_ID", message: `invalid project id: ${id}` } }, 400);
    }
    const projectDir = join(root, "interactive-films", id);
    try {
      await access(projectDir);
      const archive = gzipSync(await buildTarArchive(projectDir, id));
      return new Response(new Uint8Array(archive), {
        headers: {
          "Content-Type": "application/gzip",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(id)}.tar.gz"`,
        },
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return c.json({ error: { code: "NOT_FOUND", message: `interactive film project not found for ${id}` } }, 404);
      }
      throw error;
    }
  });

  app.get("/api/v1/projects/:id/story-graph/validation", async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) {
      return c.json({ error: { code: "INVALID_ID", message: `invalid project id: ${id}` } }, 400);
    }
    const graph = await loadStoryGraph(root, id);
    if (!graph) {
      return c.json({ error: { code: "NOT_FOUND", message: `story graph not found for ${id}` } }, 404);
    }
    return c.json(reviewStoryGraph(graph));
  });

  app.get("/api/v1/projects/:id/story-graph/analysis", async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) return c.json({ error: { code: "INVALID_ID", message: `invalid project id: ${id}` } }, 400);
    const graph = await loadStoryGraph(root, id);
    if (!graph) return c.json({ error: { code: "NOT_FOUND", message: `story graph not found for ${id}` } }, 404);
    return c.json({ report: reviewStoryGraph(graph), arcs: analyzeEmotionalArcs(graph), distribution: analyzePathDistribution(graph) });
  });

  app.get("/api/v1/projects/:id/export/json", async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) return c.json({ error: { code: "INVALID_ID", message: `invalid project id: ${id}` } }, 400);
    const graph = await loadStoryGraph(root, id);
    if (!graph) return c.json({ error: { code: "NOT_FOUND", message: `story graph not found for ${id}` } }, 404);
    return new Response(JSON.stringify(graph, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": attachmentDisposition(`${id}.story-graph.json`),
      },
    });
  });

  app.get("/api/v1/projects/:id/export/ink", async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) return c.json({ error: { code: "INVALID_ID", message: `invalid project id: ${id}` } }, 400);
    const graph = await loadStoryGraph(root, id);
    if (!graph) return c.json({ error: { code: "NOT_FOUND", message: `story graph not found for ${id}` } }, 404);
    return new Response(exportInk(graph), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": attachmentDisposition(`${id}.ink`),
      },
    });
  });

  app.get("/api/v1/projects/:id/export/html", async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) return c.json({ error: { code: "INVALID_ID", message: `invalid project id: ${id}` } }, 400);
    const graph = await loadStoryGraph(root, id);
    if (!graph) return c.json({ error: { code: "NOT_FOUND", message: `story graph not found for ${id}` } }, 404);
    const assetDataUris: Record<string, string> = {};
    for (const node of graph.nodes) {
      const ref = node.imageSlot?.assetRef;
      if (!ref || assetDataUris[ref]) continue;
      try {
        const file = resolveProjectImageFile(root, ref);
        const buf = await readFile(file.resolved);
        assetDataUris[ref] = `data:${file.contentType};base64,${buf.toString("base64")}`;
      } catch (err) {
        console.warn(`[studio] export/html: skipping assetRef "${ref}" —`, err);
      }
    }
    return new Response(buildPlayableHtml(graph, { assetDataUris }), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": attachmentDisposition(`${id}.html`),
      },
    });
  });

  app.post("/api/v1/projects/:id/nodes/:nodeId/image", async (c) => {
    const id = c.req.param("id");
    const nodeId = c.req.param("nodeId");
    if (!isSafeBookId(id)) {
      return c.json({ error: { code: "INVALID_ID", message: `invalid project id: ${id}` } }, 400);
    }
    const graph = await loadStoryGraph(root, id);
    const node = graph?.nodes.find((n) => n.id === nodeId);
    if (!node) {
      return c.json({ error: { code: "NODE_NOT_FOUND", message: `node ${nodeId} not found` } }, 404);
    }
    const deps = overrides.nodeImageGenerator ?? (await defaultNodeImageDeps(root));
    const { assetRef, delta } = await generateNodeImage({ projectRoot: root, projectId: id, node, deps });
    const { rev } = await applyGraphDelta({ projectRoot: root, projectId: id, delta });
    return c.json({ assetRef, rev });
  });

  return app;
}

// --- Standalone runner ---

export async function startStudioServer(
  root: string,
  port = 4567,
  options?: { readonly staticDir?: string },
): Promise<void> {
  const config = await loadProjectConfig(root, { consumer: "studio", requireApiKey: false });

  const app = createStudioServer(config, root);

  // Serve frontend static files — single process for API + frontend
  if (options?.staticDir) {
    const { readFile: readFileFs } = await import("node:fs/promises");
    const { join: joinPath } = await import("node:path");
    const { existsSync } = await import("node:fs");

    // Serve static assets (js, css, etc.)
    app.get("/assets/*", async (c) => {
      const filePath = joinPath(options.staticDir!, c.req.path);
      try {
        const content = await readFileFs(filePath);
        const ext = filePath.split(".").pop() ?? "";
        const contentTypes: Record<string, string> = {
          js: "application/javascript",
          css: "text/css",
          svg: "image/svg+xml",
          png: "image/png",
          ico: "image/x-icon",
          json: "application/json",
        };
        return new Response(content, {
          headers: { "Content-Type": contentTypes[ext] ?? "application/octet-stream" },
        });
      } catch {
        return c.notFound();
      }
    });

    // SPA fallback — serve index.html for all non-API routes
    const indexPath = joinPath(options.staticDir!, "index.html");
    if (existsSync(indexPath)) {
      const indexHtml = await readFileFs(indexPath, "utf-8");
      app.get("*", (c) => {
        if (c.req.path.startsWith("/api/v1/")) return c.notFound();
        return c.html(indexHtml);
      });
    }
  }

  console.log(`InkOS Studio running on http://localhost:${port}`);
  serve({ fetch: app.fetch, port });
}
