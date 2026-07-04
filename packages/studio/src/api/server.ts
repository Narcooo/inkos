import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { gzipSync } from "node:zlib";
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
  loadConfiguredCapabilitySkills,
  CapabilitySkillManifestSchema,
  type ActionPayload,
  type ActionSource,
  type CapabilitySkillManifest,
  createGenerateCoverTool,
  createInteractiveFilmCreationTool,
  createPlayStartTool,
  createScriptCreationTool,
  createShortFictionRunTool,
  createStoryboardCreationTool,
  createSubAgentTool,
  createDraftStructureTool,
  createConnectChoiceTool,
  createRemoveNodeTool,
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
} from "@actalk/inkos-core";
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isSafeBookId } from "./safety.js";
import { ApiError } from "./errors.js";
import { buildStudioBookConfig } from "./book-create.js";
import { createRelationsRouter } from "./routes/relations.js";
import { createVolumesRouter } from "./routes/volumes.js";
import { createSceneRolesRouter } from "./routes/scene-roles.js";
import { createCharactersRouter } from "./routes/characters.js";
import { createPersonasRouter } from "./routes/personas.js";
import { createPresetsRouter } from "./routes/presets.js";
import { createPersonaAIGenRouter } from "./routes/persona-ai-gen.js";
import { createOutlineRouter } from "./routes/outline.js";
import { createVoiceProfilesRouter } from "./routes/voice-profiles.js";
import { createTimelinesRouter } from "./routes/timelines.js";
import { createSkillsRouter } from "./routes/skills.js";
import { createSessionTagsRouter } from "./routes/session-tags.js";
import { createSessionsRouter } from "./routes/sessions.js";
import { createRelationExtractionRouter } from "./routes/relation-extraction.js";
import { createSearchRouter } from "./routes/search.js";
import { createForeshadowingRouter } from "./routes/foreshadowing.js";
import { createWorldsRouter, createBookWorldsRouter } from "./routes/worlds.js";
import { createWorldsExtractRouter } from "./routes/worlds-extract.js";
import { createWorldsAIGenRouter } from "./routes/worlds-ai-gen.js";
import { createMapsAIGenRouter } from "./routes/maps-ai-gen.js";
import { createPublishRouter } from "./routes/publish.js";
import { createBookStyleRouter } from "./routes/book-style.js";
import { createStyleProfilesRouter } from "./routes/style-profiles.js";
import { createStyleConsistencyRouter } from "./routes/style-consistency.js";
import { createConsistencyRouter } from "./routes/consistency.js";
import { createRelationLabelerRouter } from "./routes/relation-labeler.js";
import { createWritingContinueRouter } from "./routes/writing-continue.js";
import { createAgentTeamRouter } from "./routes/agent-team.js";
import { createForeshadowingExtractRouter } from "./routes/foreshadowing-extract.js";
import { createForeshadowingRelationsRouter } from "./routes/foreshadowing-relations.js";
import { createTimelineExtractRouter } from "./routes/timeline-extract.js";
import { createChapterVersionsRouter } from "./routes/chapter-versions.js";
import { createAgentTemplatesRouter } from "./routes/agent-templates.js";

import { createChapterVersionsRouter } from "./routes/chapter-versions.js";
import { createAgentTemplatesRouter } from "./routes/agent-templates.js";
import { createCustomAgentsRouter } from "./routes/custom-agents.js";
import { createAgentOrderRouter } from "./routes/agent-order.js";

// -- Pipeline stage definitions per agent type --

const PIPELINE_STAGES: Record<string, string[]> = {
  writer: [
    "准备章节输入", "撰写章节草稿", "落盘最终章节",
    "生成最终真相文件", "校验真相文件变更", "同步记忆索引",
    "更新章节索引与快照",
  ],
  architect: [
    "生成基础设定", "保存书籍配置", "写入基础设定文件",
    "初始化控制文档", "创建初始快照",
  ],
  reviser: [
    "加载修订上下文", "修订章节", "落盘修订结果",
    "更新索引与快照",
  ],
  auditor: ["审计章节"],
};

function attachmentDisposition(fileName: string): string {
  const safeAscii = fileName.replace(/[^A-Za-z0-9._-]+/g, "_") || "download";
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

const AGENT_LABELS: Record<string, string> = {
  architect: "建书", writer: "写作", auditor: "审计",
  reviser: "修订", exporter: "导出",
};
const TOOL_LABELS: Record<string, string> = {
  read: "读取文件", edit: "编辑文件", grep: "搜索", ls: "列目录",
  propose_action: "确认动作",
  short_fiction_run: "短篇生产",
  script_create: "剧本创作",
  storyboard_create: "分镜创作",
  interactive_film_create: "互动影游",
  generate_cover: "生成封面",
  play_edit: "编辑互动世界",
  play_start: "启动互动世界",
  play_revise: "重做互动回合",
  play_step: "推进互动世界",
};

function resolveToolLabel(tool: string, agent?: string): string {
  if (tool === "sub_agent" && agent) return AGENT_LABELS[agent] ?? agent;
  return TOOL_LABELS[tool] ?? tool;
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

function nonTextModelMessage(modelId: string): string {
  return `模型 ${modelId} 不适合文本聊天/写作。请在模型选择器中改用文本模型，例如 gemini-2.5-flash、gemini-2.5-pro 或对应服务的 chat 模型。`;
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

function projectSkillsDir(root: string): string {
  return join(root, ".inkos", "skills");
}

function projectSkillDir(root: string, id: string): string {
  return join(projectSkillsDir(root), id);
}

function projectSkillPath(root: string, id: string): string {
  return join(projectSkillDir(root, id), "SKILL.md");
}

function toStudioSkill(skill: CapabilitySkillManifest, root: string, projectSkillIds: ReadonlySet<string>) {
  const projectPath = projectSkillPath(root, skill.id);
  const isProjectFile = projectSkillIds.has(skill.id);
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    whenToUse: skill.whenToUse,
    triggers: skill.triggers,
    sessionKinds: skill.sessionKinds,
    promptPacks: skill.promptPacks,
    toolHints: skill.toolHints,
    contextNeeds: skill.contextNeeds,
    body: skill.body,
    source: isProjectFile ? "project" : skill.source,
    editable: isProjectFile,
    path: isProjectFile ? relative(root, projectPath) : undefined,
  };
}

function normalizeSkillPayload(value: unknown, idOverride?: string): CapabilitySkillManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "INVALID_SKILL_PAYLOAD", "Skill payload must be an object");
  }
  const data = value as Record<string, unknown>;
  const id = normalizeStudioSkillId(idOverride ?? data.id, "id");
  const textOr = (field: string, fallback: string): string => {
    const raw = data[field];
    return typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
  };
  const stringList = (field: string): string[] => (
    Array.isArray(data[field])
      ? data[field]
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map((item) => item.trim())
      : []
  );
  try {
    return CapabilitySkillManifestSchema.parse({
      id,
      name: textOr("name", id),
      description: textOr("description", "Project runtime skill."),
      whenToUse: textOr("whenToUse", "Use when explicitly selected by the user."),
      triggers: stringList("triggers"),
      sessionKinds: stringList("sessionKinds"),
      promptPacks: stringList("promptPacks"),
      toolHints: stringList("toolHints"),
      contextNeeds: Array.isArray(data.contextNeeds) ? data.contextNeeds : [],
      body: typeof data.body === "string" ? data.body : "",
      source: "project",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ApiError(400, "INVALID_SKILL_PAYLOAD", message);
  }
}

function serializeProjectSkill(skill: CapabilitySkillManifest): string {
  const frontmatter = {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    whenToUse: skill.whenToUse,
    triggers: skill.triggers,
    sessionKinds: skill.sessionKinds,
    promptPacks: skill.promptPacks,
    toolHints: skill.toolHints,
    contextNeeds: skill.contextNeeds,
  };
  return [
    "---",
    ...Object.entries(frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
    "---",
    skill.body.trim(),
    "",
  ].join("\n");
}

async function loadStudioSkills(root: string) {
  const configured = await loadConfiguredCapabilitySkills({ projectRoot: root });
  const projectSkillIds = await listProjectSkillIds(root);
  const registry = createSkillRegistry({ skills: configured.skills });
  return {
    skills: registry.listSkills().map((skill) => toStudioSkill(skill, root, projectSkillIds)),
    diagnostics: configured.diagnostics,
  };
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

function shouldRunDirectWriteNext(args: {
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
}): string | undefined {
  const failedExec = args.collectedToolExecs.find(isLikelyFailedToolResult);
  if (failedExec) {
    return `${failedExec.label} 执行失败：${failedExec.error ?? failedExec.result ?? "未知错误"}`;
  }

  if (
    args.agentBookId
    && args.requestedIntent === "write_next"
    && !hasSuccessfulSubAgentExec(args.collectedToolExecs, "writer")
  ) {
    return "模型声称已完成下一章，但没有实际调用写作工具。请重试；如果仍失败，请检查模型是否支持工具调用。";
  }

  if (
    !args.agentBookId
    && args.requestedIntent === "create_book"
    && !hasSuccessfulSubAgentExec(args.collectedToolExecs, "architect")
  ) {
    return "已确认建书，但模型没有实际调用建书工具。请重试；如果仍失败，请检查模型是否支持工具调用。";
  }

  if (args.requestedIntent === "short_run" && !hasSuccessfulToolExec(args.collectedToolExecs, "short_fiction_run")) {
    return "已确认生成短篇，但模型没有实际调用短篇生产工具。请重试；如果仍失败，请检查模型是否支持工具调用。";
  }

  if (args.requestedIntent === "play_start" && !hasSuccessfulToolExec(args.collectedToolExecs, "play_start")) {
    return "已确认启动互动世界，但模型没有实际调用互动世界工具。请重试；如果仍失败，请检查模型是否支持工具调用。";
  }

  if (args.requestedIntent === "generate_cover" && !hasSuccessfulToolExec(args.collectedToolExecs, "generate_cover")) {
    return "已确认生成封面，但模型没有实际调用封面工具。请重试；如果仍失败，请检查模型是否支持工具调用。";
  }

  return undefined;
}

type AgentFailureKind = "llm" | "internal" | "unknown";

function classifyAgentFailure(message: string): AgentFailureKind {
  const text = message.trim();
  if (!text) return "unknown";
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

function formatAgentFailure(message: string): { readonly code: string; readonly message: string; readonly status: 500 | 502 } {
  const kind = classifyAgentFailure(message);
  if (kind === "llm") {
    return { code: "AGENT_LLM_ERROR", message, status: 502 };
  }
  if (kind === "internal") {
    return { code: "AGENT_INTERNAL_ERROR", message: `InkOS 内部流程错误：${message}`, status: 500 };
  }
  return { code: "AGENT_ERROR", message, status: 500 };
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

function toolResultText(result: unknown): string {
  const text = extractToolError(result).trim();
  return text || "已完成。";
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
}): Promise<CollectedToolExec> {
  const id = `direct-${args.requestedIntent}-${Date.now().toString(36)}`;
  const actionPayload = args.actionPayload;
  let tool: ReturnType<typeof createSubAgentTool>
    | ReturnType<typeof createShortFictionRunTool>
    | ReturnType<typeof createGenerateCoverTool>
    | ReturnType<typeof createScriptCreationTool>
    | ReturnType<typeof createStoryboardCreationTool>
    | ReturnType<typeof createInteractiveFilmCreationTool>
    | ReturnType<typeof createPlayStartTool>
    | ReturnType<typeof createDraftStructureTool>
    | ReturnType<typeof createConnectChoiceTool>
    | ReturnType<typeof createRemoveNodeTool>;
  let params: Record<string, unknown>;
  let agent: string | undefined;

  if (args.requestedIntent === "create_book") {
    const payload = actionPayload?.createBook;
    const title = requirePayloadText(payload?.title, "确认建书缺少书名，请重新生成确认卡。");
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
    if (!direction) throw new ApiError(400, "CONFIRMED_ACTION_PAYLOAD_INCOMPLETE", "确认短篇缺少方向，请重新生成确认卡。");
    tool = createShortFictionRunTool(args.pipeline, args.root, { actionPayload });
    params = {
      direction,
      ...(payload?.reference ? { reference: payload.reference } : {}),
      ...(payload?.storyId ? { storyId: payload.storyId } : {}),
      ...(payload?.chapters ? { chapters: payload.chapters } : {}),
      ...(payload?.charsPerChapter ? { charsPerChapter: payload.charsPerChapter } : {}),
      ...(payload?.cover !== undefined ? { cover: payload.cover } : {}),
    };
  } else if (args.requestedIntent === "generate_cover") {
    const payload = actionPayload?.generateCover;
    const title = requirePayloadText(payload?.title, "确认生成封面缺少标题，请重新生成确认卡。");
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
    const title = requirePayloadText(payload?.title, "确认创建剧本缺少标题，请重新生成确认卡。");
    tool = createScriptCreationTool(args.pipeline, args.root, { actionPayload });
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
    const title = requirePayloadText(payload?.title, "确认创建分镜缺少标题，请重新生成确认卡。");
    tool = createStoryboardCreationTool(args.pipeline, args.root, { actionPayload });
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
    const title = requirePayloadText(payload?.title, "确认创建互动影游缺少标题，请重新生成确认卡。");
    tool = createInteractiveFilmCreationTool(args.pipeline, args.root, { actionPayload });
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
  } else if (args.requestedIntent === "play_start") {
    const payload = actionPayload?.playStart;
    const title = requirePayloadText(payload?.title, "确认启动互动世界缺少标题，请重新生成确认卡。");
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
    tool = createDraftStructureTool(args.root, projectId, deps);
    params = {
      instruction: payload?.instruction?.trim() || args.instruction,
    };
  } else if (args.requestedIntent === "connect_choice") {
    const payload = actionPayload?.connectChoice;
    if (!payload?.node) {
      throw new ApiError(400, "CONFIRMED_ACTION_PAYLOAD_INCOMPLETE", "确认连接选择缺少节点数据，请重新生成确认卡。");
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
      throw new ApiError(400, "CONFIRMED_ACTION_PAYLOAD_INCOMPLETE", "确认删除节点缺少 nodeId，请重新生成确认卡。");
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
    label: resolveToolLabel(tool.name, agent),
    status: "running",
    args: params,
    stages: agent ? PIPELINE_STAGES[agent]?.map(label => ({ label, status: "pending" as const })) : undefined,
    startedAt: Date.now(),
  };

  broadcast("tool:start", {
    sessionId: args.streamSessionId,
    id,
    tool: tool.name,
    args: params,
    stages: exec.stages?.map(stage => stage.label),
  });

  try {
    const result = await tool.execute(
      id,
      params as never,
      undefined,
      (partialResult) => {
        broadcast("tool:update", {
          sessionId: args.streamSessionId,
          tool: tool.name,
          partialResult,
        });
      },
    );
    exec.status = "completed";
    exec.completedAt = Date.now();
    exec.result = toolResultText(result);
    exec.details = (result as { details?: unknown } | undefined)?.details;
    exec.stages = exec.stages?.map(stage => ({ ...stage, status: "completed" as const }));
    broadcast("tool:end", {
      sessionId: args.streamSessionId,
      id,
      tool: tool.name,
      result,
      details: exec.details,
      isError: false,
    });
    return exec;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result = { content: [{ type: "text", text: message }] };
    exec.status = "error";
    exec.completedAt = Date.now();
    exec.error = message;
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

function normalizeCoverConfig(raw: unknown): { service: string; model: string } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const service = typeof record.service === "string" ? record.service : "";
  const preset = resolveCoverProviderPreset(service);
  if (!preset) return undefined;
  const requestedModel = typeof record.model === "string" ? record.model.trim() : "";
  const model = requestedModel && preset.models.includes(requestedModel)
    ? requestedModel
    : preset.defaultModel;
  return { service: preset.service, model };
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} 超时（${timeoutMs}ms）`)), timeoutMs);
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
}): string {
  const rawDetail = args.error
    .replace(/\n\s*\(baseUrl:[\s\S]*?\)$/m, "")
    .trim();
  const upstreamDetail = rawDetail.includes("上游详情：")
    ? rawDetail
    : "";
  const context = [
    `服务商：${args.label ?? args.service}`,
    `测试模型：${args.model ?? "未确定"}`,
    `协议：${args.apiFormat === "responses" ? "Responses" : "Chat / Completions"}${typeof args.stream === "boolean" ? `，${args.stream ? "流式" : "非流式"}` : ""}`,
    `Base URL：${args.baseUrl}`,
  ].join("\n");

  if (args.service === "google") {
    return [
      "Google Gemini 测试连接失败。",
      context,
      "",
      "请优先检查：",
      "1. API Key 是否来自 Google AI Studio 的 Gemini API key，而不是 OAuth、Vertex AI 或其它 Google 服务凭据。",
      "2. 该 key 所属项目是否已启用 Gemini API，并且没有被限制到其它 API、来源或服务。",
      "3. 当前地区/账号是否允许访问 Gemini API。",
      "4. 如果 key 曾经泄露，请在 AI Studio 重新生成后再保存。",
      upstreamDetail ? `\n上游返回：${upstreamDetail}` : "",
    ].filter(Boolean).join("\n");
  }

  if (args.service === "moonshot" || args.service === "kimiCodingPlan" || args.service === "kimicode") {
    return [
      `${args.label ?? args.service} 测试连接失败。`,
      context,
      "",
      "请优先检查模型是否可用，以及 kimi-k2.x 这类模型是否需要 temperature=1。",
      rawDetail ? `\n上游返回：${rawDetail}` : "",
    ].filter(Boolean).join("\n");
  }

  return [
    `${args.label ?? args.service} 测试连接失败。`,
    context,
    "",
    "请检查 API Key、模型可用性、账号额度，以及协议类型是否匹配该服务商。",
    rawDetail ? `\n上游返回：${rawDetail}` : "",
  ].filter(Boolean).join("\n");
}

async function fetchModelsFromServiceBaseUrl(
  serviceId: string,
  baseUrl: string,
  apiKey: string,
  proxyUrl?: string,
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
      headers: buildBearerAuthHeaders(apiKey),
      signal: AbortSignal.timeout(SERVICE_MODELS_PROBE_TIMEOUT_MS),
    }, proxyUrl);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        models: [],
        error: `服务商返回 ${res.status}: ${body.slice(0, 200)}`,
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

function buildBearerAuthHeaders(apiKey: string | undefined): Record<string, string> {
  const trimmed = apiKey?.trim() ?? "";
  if (!trimmed) return {};
  if (!/^[\x20-\x7e]+$/.test(trimmed)) {
    throw new Error("API Key 只能包含英文、数字和常见 ASCII 符号，请检查是否误粘贴了中文说明。");
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
}): Promise<ServiceProbeResult> {
  const rawConfig = await loadRawConfig(args.root).catch(() => ({} as Record<string, unknown>));
  const llm = (rawConfig.llm as Record<string, unknown> | undefined) ?? {};
  const envConfig = await readEnvConfigStatus(args.root);
  const envModel = envConfig.effectiveSource === "project"
    ? envConfig.project.model
    : envConfig.effectiveSource === "global"
      ? envConfig.global.model
      : null;

  const baseService = isCustomServiceId(args.service) ? "custom" : args.service;
  const modelsResponse = await fetchModelsFromServiceBaseUrl(baseService, args.baseUrl, args.apiKey, args.proxyUrl);
  if (modelsResponse.authFailed) {
    return {
      ok: false,
      models: [],
      error: modelsResponse.error ?? "API Key 无效或无权访问模型列表。",
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
        error: "模型列表可访问，但没有发现可用于文本对话的模型。",
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
  const useDynamicLocalModels = baseService === "ollama";
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
      error: "无法自动确定模型，请先填写可用模型或提供支持 /models 的服务端点。",
    };
  }

  let lastError = modelsResponse.error ?? "自动探测失败";

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

  async function buildPipelineConfig(
    overrides?: Partial<Pick<PipelineConfig, "externalContext" | "client" | "model">> & {
      readonly currentConfig?: ProjectConfig;
      readonly sessionIdForSSE?: string;
      readonly bookIdForSettings?: string;
    },
  ): Promise<PipelineConfig> {
    const currentConfig = overrides?.currentConfig ?? await loadCurrentProjectConfig();
    const projectReviewMode = readProjectChapterReviewMode(currentConfig as unknown as Record<string, unknown>);
    const chapterReviewMode = await resolveBookChapterReviewMode(root, overrides?.bookIdForSettings, projectReviewMode);
    const scopedSseSink: LogSink = overrides?.sessionIdForSSE
      ? {
          write(entry) {
            broadcast("log", {
              sessionId: overrides.sessionIdForSSE,
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
      modelOverrides: currentConfig.modelOverrides,
      notifyChannels: currentConfig.notify,
      logger,
      onContextCompression: (event) => {
        broadcast("context:compression", {
          ...(overrides?.sessionIdForSSE ? { sessionId: overrides.sessionIdForSSE } : {}),
          ...event,
        });
      },
      onStreamProgress: (progress) => {
        broadcast("llm:progress", {
          ...(overrides?.sessionIdForSSE ? { sessionId: overrides.sessionIdForSSE } : {}),
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

  // --- Chapter Save ---

  app.put("/api/v1/books/:id/chapters/:num", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    const bookDir = state.bookDir(id);
    const chaptersDir = join(bookDir, "chapters");
    const { content } = await c.req.json<{ content: string }>();

    try {
      const files = await readdir(chaptersDir);
      const paddedNum = String(num).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const { writeFile: writeFileFs } = await import("node:fs/promises");
      await writeFileFs(join(chaptersDir, match), content, "utf-8");
      return c.json({ ok: true, chapterNumber: num });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
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

    // Phase hotfix 3 + R-04: accept all 5 tier directory names (both zh and en
    // locale) so that roles/主角/王二.md through roles/scene/茶馆老板.md are all
    // reachable. Must stay in sync with TIER_DIR_MAP in core/src/models/character.ts.
    const tierDirs = ["主角","重要","次要","客串","一次性",
                      "protagonist","supporting","guest","one-shot","scene",
                      "主要角色","次要角色","major","minor"];
    const tierDirPattern = `roles/(${tierDirs.join("|")})/[^/]+\\.md$`;
    const allowed =
      TRUTH_FLAT_FILES.includes(file)
      || TRUTH_OUTLINE_FILES.includes(file)
      || RUNTIME_DIAGNOSTIC_FILE_RE.test(file)
      || new RegExp(tierDirPattern).test(file);

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

  // --- Dashboard Aggregated Data (R-14) ---

  app.get("/api/v1/books/:id/dashboard", async (c) => {
    const id = c.req.param("id");
    try {
      const book = await state.loadBookConfig(id);
      const chapters = await state.loadChapterIndex(id);
      const nextChapter = await state.getNextChapterNumber(id);
      const bookDir = state.bookDir(id);
      const { join } = await import("node:path");
      const { readFile, readdir } = await import("node:fs/promises");

      // Chapter / word count stats
      const totalChapters = nextChapter - 1;
      const targetChapters = (book as any).targetChapters ?? 0;
      const totalWords = chapters.reduce((sum: number, ch: any) => sum + (ch.wordCount ?? 0), 0);

      // Characters grouped by tier
      const TIER_ROLE_DIRS = [
        "protagonist", "supporting", "guest", "one-shot", "scene",
        "主角", "重要", "次要", "客串", "一次性",
        "主要角色", "次要角色", "major", "minor",
      ];
      const characters: Array<{ name: string; tier: string; description: string }> = [];
      const rolesDir = join(bookDir, "story", "roles");
      for (const dir of TIER_ROLE_DIRS) {
        try {
          const files = await readdir(join(rolesDir, dir));
          for (const file of files) {
            if (file.endsWith(".md")) {
              const name = file.replace(/\.md$/, "");
              let description = "";
              try {
                const content = await readFile(join(rolesDir, dir, file), "utf-8");
                const lines = content.split("\n").filter((l: string) => l.trim() && !l.startsWith("---"));
                description = lines.slice(0, 3).join(" ").slice(0, 200);
              } catch { /* ignore */ }
              characters.push({ name, tier: dir, description });
            }
          }
        } catch { /* directory doesn't exist */ }
      }

      // Recent timeline events (last 10)
      let recentEvents: Array<{ id: string; chapter: number; description: string; date?: string }> = [];
      try {
        const timelinesRaw = await readFile(join(bookDir, "story", "state", "character_timelines.json"), "utf-8");
        const timelinesData = JSON.parse(timelinesRaw);
        const events = (timelinesData.events ?? []).sort((a: any, b: any) => (b.chapter ?? 0) - (a.chapter ?? 0));
        recentEvents = events.slice(0, 10).map((e: any) => ({
          id: e.id,
          chapter: e.chapter ?? 0,
          description: (e.description ?? "").slice(0, 200),
          date: e.date,
        }));
      } catch { /* no timeline data */ }

      // Relations summary
      let relationCount = 0;
      let recentRelations: Array<{ id: string; source: string; target: string; type: string }> = [];
      try {
        const relationsRaw = await readFile(join(bookDir, "story", "state", "relations.json"), "utf-8");
        const relationsData = JSON.parse(relationsRaw);
        const rels = relationsData.relations ?? [];
        relationCount = rels.length;
        recentRelations = rels.slice(-5).map((r: any) => ({
          id: r.id,
          source: r.sourceRoleId ?? r.source ?? "",
          target: r.targetRoleId ?? r.target ?? "",
          type: r.type ?? r.relationType ?? "unknown",
        }));
      } catch { /* no relations data */ }

      // World info
      const worldId = (book as any).worldId ?? null;
      let worldSummary: any = null;
      if (worldId) {
        try {
          const { loadWorld } = await import("@actalk/inkos-core");
          const world: any = await loadWorld(root, worldId as string);
          if (world) {
            worldSummary = {
              id: world.id,
              name: world.name,
              dimensions: world.dimensions
                ? Object.entries(world.dimensions).map(([key, dim]: [string, any]) => ({
                    name: key,
                    content: (dim.content ?? dim.description ?? "").slice(0, 100),
                  }))
                : [],
            };
          }
        } catch { /* world not found */ }
      }

      return c.json({
        book: {
          id,
          title: (book as any).title ?? id,
          genre: (book as any).genre ?? "unknown",
          status: (book as any).status ?? "active",
        },
        stats: {
          totalChapters,
          targetChapters,
          totalWords,
          chaptersWritten: totalChapters,
        },
        characters,
        recentEvents,
        relations: {
          total: relationCount,
          recent: recentRelations,
        },
        world: worldSummary,
      });
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

    // Fast: only check connection status from secrets, no external API calls.
    const services = endpoints.map((ep) => ({
      service: ep.id,
      label: ep.label,
      group: ep.group,
      connected: Boolean(secrets.services[ep.id]?.apiKey),
    })).sort(compareServiceListItems);

    // Add custom services from inkos.json
    try {
      const config = await loadRawConfig(root);
      for (const svc of normalizeServiceConfig((config.llm as Record<string, unknown> | undefined)?.services)) {
        if (svc.service === "custom") {
          const secretKey = `custom:${svc.name}`;
          services.push({
            service: secretKey,
            label: svc.name ?? "Custom",
            group: undefined,
            connected: Boolean(secrets.services[secretKey]?.apiKey),
          });
        }
      }
    } catch { /* no config file */ }

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
        error: "未检测到可导入的 LLM 环境变量配置，或缺少 INKOS_LLM_API_KEY。",
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
        error: "Studio 运行时不支持切换到 env；env 只在 CLI/daemon/部署运行时作为覆盖层使用。",
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
    const body = await c.req.json<{ service?: string; model?: string }>();
    const preset = resolveCoverProviderPreset(body.service);
    if (!preset) {
      return c.json({ error: "Unsupported cover service" }, 400);
    }
    const model = typeof body.model === "string" && preset.models.includes(body.model)
      ? body.model
      : preset.defaultModel;

    const config = await loadRawConfig(root);
    config.llm = config.llm ?? {};
    const llm = config.llm as Record<string, unknown>;
    llm.cover = {
      service: preset.service,
      model,
    };
    await saveRawConfig(root, config);
    return c.json({ ok: true, service: preset.service, model });
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
      return c.json({ error: "API Key 包含不能放入 HTTP Authorization header 的字符，请只粘贴原始密钥。" }, 400);
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

    const resolvedBaseUrl = await resolveConfiguredServiceBaseUrl(root, service, baseUrl);
    if (!resolvedBaseUrl) {
      return c.json({ ok: false, error: `未知服务商: ${service}` }, 400);
    }

    const baseService = isCustomServiceId(service) ? "custom" : service;
    const apiKeyOptional = isApiKeyOptionalForEndpoint({
      provider: resolveServiceProviderFamily(baseService) ?? "openai",
      baseUrl: resolvedBaseUrl,
    });
    if (!apiKey?.trim() && !apiKeyOptional) {
      return c.json({
        ok: false,
        error: "API Key 不能为空",
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
    });

    // B12: 升级响应 shape 为 { probe, chat, ... }，同时保留老字段供 UI 过渡期兼容
    const probeStatus = {
      ok: probe.ok,
      models: probe.models?.length ?? 0,
      ...(probe.ok ? {} : { error: probe.error ?? "连接失败" }),
    };

    if (!probe.ok) {
      return c.json({
        ok: false,
        error: probe.error ?? "连接失败",
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
          error: "API Key 只能包含可放进 HTTP Authorization header 的非空白 ASCII 字符；请不要粘贴连接失败提示或诊断文本。",
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

  app.post("/api/v1/skills", async (c) => {
    const payload = await c.req.json().catch(() => {
      throw new ApiError(400, "INVALID_SKILL_PAYLOAD", "Skill payload must be JSON");
    });
    const skill = normalizeSkillPayload(payload);
    await mkdir(projectSkillDir(root, skill.id), { recursive: true });
    await writeFile(projectSkillPath(root, skill.id), serializeProjectSkill(skill), "utf-8");
    return c.json({ skill: toStudioSkill(skill, root, new Set([skill.id])) });
  });

  app.put("/api/v1/skills/:skillId", async (c) => {
    const id = normalizeStudioSkillId(c.req.param("skillId"), "skillId");
    const payload = await c.req.json().catch(() => {
      throw new ApiError(400, "INVALID_SKILL_PAYLOAD", "Skill payload must be JSON");
    });
    const skill = normalizeSkillPayload(payload, id);
    await mkdir(projectSkillDir(root, skill.id), { recursive: true });
    await writeFile(projectSkillPath(root, skill.id), serializeProjectSkill(skill), "utf-8");
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
      // R-04: Scan all 5 tier directories (zh + en + legacy).
      const TIER_ROLE_DIRS = [
        "主角","protagonist",
        "重要","supporting",
        "次要","guest",
        "客串","one-shot",
        "一次性","scene",
        // Legacy compatibility
        "主要角色","major",
        "次要角色","minor",
      ];
      const roleDirFiles: string[] = [];
      for (const dir of TIER_ROLE_DIRS) {
        const files = await listDir(`roles/${dir}`);
        roleDirFiles.push(...files.map((f) => `roles/${dir}/${f}`));
      }
      const runtimeFiles = (await listDir("runtime"))
        .map((f) => `runtime/${f}`)
        .filter((f) => RUNTIME_DIAGNOSTIC_FILE_RE.test(f));

      const all = [
        ...flatFiles,
        ...outlineFiles,
        ...roleDirFiles,
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
    const status = c.req.query("status");
    const statusFilter = status === "active" || status === "archived" ? status : undefined;
    const sessions = await listBookSessions(root, bookId === undefined ? null : bookId === "null" ? null : bookId, statusFilter);
    return c.json({ sessions });
  });

  app.get("/api/v1/sessions/:sessionId", async (c) => {
    const session = await loadBookSession(root, c.req.param("sessionId"));
    if (!session) return c.json({ error: "Session not found" }, 404);
    return c.json({ session });
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
    await deleteBookSession(root, c.req.param("sessionId"));
    return c.json({ ok: true });
  });

  app.post("/api/v1/agent", async (c) => {
    const {
      instruction,
      activeBookId,
      sessionId: reqSessionId,
      sessionKind: reqSessionKind,
      actionSource: reqActionSource,
      requestedIntent: reqRequestedIntent,
      actionPayload: reqActionPayload,
      requestedSkills: reqRequestedSkills,
      disabledSkills: reqDisabledSkills,
      playMode: reqPlayMode,
      model: reqModel,
      service: reqService,
    } = await c.req.json<{
      instruction: string;
      activeBookId?: string;
      sessionId?: string;
      sessionKind?: string;
      actionSource?: string;
      requestedIntent?: string;
      actionPayload?: unknown;
      requestedSkills?: unknown;
      disabledSkills?: unknown;
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
    if (reqModel && !isTextChatModelId(reqModel)) {
      const message = nonTextModelMessage(reqModel);
      return c.json({ error: message, response: message }, 400);
    }

    const actionSource = normalizeStudioActionSource(reqActionSource);
    const requestedIntent = normalizeStudioRequestedIntent(reqRequestedIntent);
    const actionPayload = normalizeStudioActionPayload(reqActionPayload);
    const requestedSkills = normalizeStudioSkillIdList(reqRequestedSkills, "requestedSkills");
    const disabledSkills = normalizeStudioSkillIdList(reqDisabledSkills, "disabledSkills");
    const playMode = normalizeStudioPlayMode(reqPlayMode);

    broadcast("agent:start", { instruction, activeBookId, sessionId, actionSource, requestedIntent, requestedSkills });

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
      const streamSessionId = loadedBookSession.sessionId;
      const titleBeforeRun = bookSession.title;
      let sessionTitleBroadcasted = false;
      const refreshBookSessionFromTranscript = async (): Promise<void> => {
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
        await appendManualSessionMessages(root, bookSession.sessionId, [{
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
              error: `请先为 ${reqService} 配置 API Key`,
              response: `请先在模型配置中为 ${reqService} 填写 API Key，然后再试。`,
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
      const pipeline = new PipelineRunner(await buildPipelineConfig({
        client: pipelineClient,
        model: reqModel ?? config.llm.model,
        currentConfig: config,
        sessionIdForSSE: bookSession.sessionId,
        bookIdForSettings: activeBookId ?? undefined,
      }));

      if (requestedIntent && isConfirmedProductionAction({ actionSource, requestedIntent })) {
        const pendingBookId = requestedIntent === "create_book" && actionPayload?.createBook?.title
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

        try {
          const exec = await executeConfirmedProductionAction({
            pipeline,
            root,
            sessionId: bookSession.sessionId,
            bookId: agentBookId,
            streamSessionId,
            instruction,
            requestedIntent,
            actionPayload,
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

          const responseText = exec.result ?? "已完成。";
          const responseForUser = suppressManualTextForTool(exec) ? "" : responseText;
          await appendManualSessionMessages(root, bookSession.sessionId, [
            manualToolAssistantMessage(
              responseText,
              exec,
              configuredEntry?.service ?? reqService ?? config.llm.provider,
              reqModel ?? config.llm.model,
            ),
          ], instruction, manualToolAppendOptions(sessionKind, exec));
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
          if (pendingBookId) {
            bookCreateStatus.set(pendingBookId, { status: "error", error: message });
            broadcast("book:error", { bookId: pendingBookId, sessionId: streamSessionId, error: message });
          }
          if (error instanceof ConfirmedActionExecutionError) {
            await appendManualSessionMessages(root, bookSession.sessionId, [
              manualToolAssistantMessage(
                message,
                error.exec,
                configuredEntry?.service ?? reqService ?? config.llm.provider,
                reqModel ?? config.llm.model,
              ),
            ], instruction, manualToolAppendOptions(sessionKind, error.exec)).catch(() => undefined);
            await refreshBookSessionFromTranscript().catch(() => undefined);
          }
          broadcast("agent:error", { instruction, activeBookId: agentBookId, sessionId: bookSession.sessionId, sessionKind, error: message });
          return c.json({
            error: { code: "AGENT_ACTION_FAILED", message },
            response: message,
          }, 502);
        }
      }

      if (shouldRunDirectWriteNext({ instruction, agentBookId, sessionKind, actionSource, requestedIntent })) {
        const directWriteBookId = agentBookId;
        if (!directWriteBookId) {
          throw new ApiError(400, "BOOK_ID_REQUIRED", "write_next requires an active book");
        }
        const toolCallId = `direct-writer-${Date.now().toString(36)}`;
        const toolArgs = { agent: "writer", bookId: directWriteBookId };
        broadcast("tool:start", {
          sessionId: streamSessionId,
          id: toolCallId,
          tool: "sub_agent",
          args: toolArgs,
          stages: PIPELINE_STAGES.writer,
        });

        try {
          const writeResult = await pipeline.writeNextChapter(directWriteBookId);
          const writeNeedsReview = Boolean(writeResult.status && writeResult.status !== "ready-for-review");
          const responseText = writeNeedsReview
            ? [
                `已为 ${directWriteBookId} 写出第 ${writeResult.chapterNumber} 章`,
                writeResult.title ? `《${writeResult.title}》` : "",
                `，字数 ${writeResult.wordCount}，但审稿未通过，状态 ${writeResult.status}，需要复核后再继续。`,
              ].join("")
            : [
                `已为 ${directWriteBookId} 完成第 ${writeResult.chapterNumber} 章`,
                writeResult.title ? `《${writeResult.title}》` : "",
                `，字数 ${writeResult.wordCount}，状态 ${writeResult.status}。`,
              ].join("");
          const toolResult = {
            content: [{ type: "text", text: responseText }],
            details: {
              kind: "chapter_written",
              bookId: directWriteBookId,
              chapterNumber: writeResult.chapterNumber,
              title: writeResult.title,
              wordCount: writeResult.wordCount,
              status: writeResult.status,
            },
          };
          broadcast("tool:end", {
            sessionId: streamSessionId,
            id: toolCallId,
            tool: "sub_agent",
            result: toolResult,
            details: toolResult.details,
            isError: writeNeedsReview,
          });
          const exec: CollectedToolExec = {
            id: toolCallId,
            tool: "sub_agent",
            agent: "writer",
            label: resolveToolLabel("sub_agent", "writer"),
            status: writeNeedsReview ? "error" : "completed",
            args: toolArgs,
            result: responseText,
            details: toolResult.details,
            startedAt: Date.now(),
            completedAt: Date.now(),
          };
          await appendManualSessionMessages(root, bookSession.sessionId, [
            manualToolAssistantMessage(
              responseText,
              exec,
              configuredEntry?.service ?? reqService ?? config.llm.provider,
              reqModel ?? config.llm.model,
            ),
          ], instruction, manualToolAppendOptions(sessionKind, exec));
          await refreshBookSessionFromTranscript();
          broadcast("agent:complete", { instruction, activeBookId: directWriteBookId, sessionId: bookSession.sessionId, sessionKind });
          return c.json({
            response: responseText,
            session: {
              sessionId: bookSession.sessionId,
              sessionKind,
              activeBookId: directWriteBookId,
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const toolResult = { content: [{ type: "text", text: message }] };
          const exec: CollectedToolExec = {
            id: toolCallId,
            tool: "sub_agent",
            agent: "writer",
            label: resolveToolLabel("sub_agent", "writer"),
            status: "error",
            args: toolArgs,
            error: message,
            startedAt: Date.now(),
            completedAt: Date.now(),
          };
          broadcast("tool:end", {
            sessionId: streamSessionId,
            id: toolCallId,
            tool: "sub_agent",
            result: toolResult,
            isError: true,
          });
          await appendManualSessionMessages(root, bookSession.sessionId, [
            manualToolAssistantMessage(
              message,
              exec,
              configuredEntry?.service ?? reqService ?? config.llm.provider,
              reqModel ?? config.llm.model,
            ),
          ], instruction, manualToolAppendOptions(sessionKind, exec)).catch(() => undefined);
          await refreshBookSessionFromTranscript().catch(() => undefined);
          broadcast("agent:error", { instruction, activeBookId: agentBookId, sessionId: bookSession.sessionId, sessionKind, error: message });
          return c.json({
            error: { code: "AGENT_ACTION_FAILED", message },
            response: message,
          }, 502);
        }
      }

      // The surface agent should speak the user's language, not just the project default.
      // Pre-commitment surfaces (chat / play / short / book-create, no book yet) infer it
      // from the instruction; committed book/edit sessions keep the configured language.
      // Without this, an English request on a zh-default project gets Chinese replies — and
      // a Chinese play world, because play_start then infers from the rewritten premise.
      const configLanguage = config.language === "en" ? "en" : "zh";
      const bookLanguage = activeBookConfig?.language === "en" ? "en" : activeBookConfig?.language === "zh" ? "zh" : undefined;
      const surfaceLanguage = agentBookId ? (bookLanguage ?? configLanguage) : inferLanguage(instruction);

      // Run pi-agent session
      const collectedToolExecs: CollectedToolExec[] = [];
      const result = await runAgentSession(
        {
          model,
          apiKey: agentApiKey,
          pipeline,
          projectRoot: root,
          bookId: agentBookId,
          sessionKind,
          playMode,
          actionSource,
          requestedIntent,
          actionPayload,
          requestedSkills,
          disabledSkills,
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
              const stages = agent ? (PIPELINE_STAGES[agent] ?? []) : [];

              collectedToolExecs.push({
                id: event.toolCallId,
                tool: event.toolName,
                agent,
                label: resolveToolLabel(event.toolName, agent),
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
            if (event.type === "tool_execution_update") {
              broadcast("tool:update", {
                sessionId: streamSessionId,
                tool: event.toolName,
                partialResult: event.partialResult,
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
          const failure = formatAgentFailure(result.errorMessage);
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

        const emptyMessage = "模型未返回文本内容。请检查协议类型（chat/responses）、流式开关或上游服务兼容性。";
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
          error: { code: "AGENT_BUSY", message: "正在处理中，请等待当前操作完成" },
          response: "正在处理中，请等待当前操作完成后再发送。",
        }, 429);
      }

      const failure = formatAgentFailure(msg);
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
      const rollbackTarget = chapterNum - 1;
      const discarded = await state.rollbackToChapter(id, rollbackTarget);
      const pipeline = new PipelineRunner(await buildPipelineConfig({
        externalContext: body.brief,
      }));
      pipeline.writeNextChapter(id).then(
        (result) => broadcast("rewrite:complete", { bookId: id, chapterNumber: result.chapterNumber, title: result.title, wordCount: result.wordCount }),
        (e) => broadcast("rewrite:error", { bookId: id, error: e instanceof Error ? e.message : String(e) }),
      );
      return c.json({ status: "rewriting", bookId: id, chapter: chapterNum, rolledBackTo: rollbackTarget, discarded });
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

  // ── Relations CRUD ──
  const relationsRouter = createRelationsRouter((id) => state.bookDir(id));
  app.route("/api/v1/books", relationsRouter);

  // ── AI Relation Extraction (AI-1) ──
  const relationExtractionRouter = createRelationExtractionRouter(
    (id) => state.bookDir(id),
    () => root,
  );
  app.route("/api/v1/books", relationExtractionRouter);

  // ── AI World Extraction (Wrld-7) ──
  const worldsExtractRouter = createWorldsExtractRouter((id) => state.bookDir(id));
  app.route("/api/v1/books", worldsExtractRouter);

  // ── AI Relation Labeler (R-15) ──
  const relationLabelerRouter = createRelationLabelerRouter(
    (id) => state.bookDir(id),
  );
  app.route("/api/v1/books", relationLabelerRouter);

  // ── AI Foreshadowing Extraction (Issue #211) ──
  const foreshadowingExtractRouter = createForeshadowingExtractRouter((id) => state.bookDir(id), root);
  app.route("/api/v1/books", foreshadowingExtractRouter);

  // ── Foreshadowing Relations (Issue #324) ──
  const foreshadowingRelationsRouter = createForeshadowingRelationsRouter();
  app.route("/api/v1/books", foreshadowingRelationsRouter);

  // ── AI Timeline Extraction (Issue #211) ──
  const timelineExtractRouter = createTimelineExtractRouter((id) => state.bookDir(id), root);
  app.route("/api/v1/books", timelineExtractRouter);

  // ── Volumes CRUD ──
  const volumesRouter = createVolumesRouter((id) => state.bookDir(id));
  app.route("/api/v1/books", volumesRouter);

  // ── Per-Book Style Analysis (Issue #328) ──
  const bookStyleRouter = createBookStyleRouter((id) => state.bookDir(id));
  app.route("/api/v1/books", bookStyleRouter);

  // ── Chapter Versions (Issue #235) ──
  const chapterVersionsRouter = createChapterVersionsRouter((id) => state.bookDir(id));
  app.route("/api/v1/books", chapterVersionsRouter);

  // ── Timelines CRUD ──
  const timelinesRouter = createTimelinesRouter((id) => state.bookDir(id));
  app.route("/api/v1/books", timelinesRouter);

  // ── Scene Roles CRUD ──
  const sceneRolesRouter = createSceneRolesRouter((id) => state.bookDir(id));
  app.route("/api/v1/books", sceneRolesRouter);

  // ── Outline CRUD (E1-1) ──
  const outlineRouter = createOutlineRouter((id) => state.bookDir(id));
  app.route("/api/v1/books", outlineRouter);

  // ── Character Tier Change ──
  const charactersRouter = createCharactersRouter((id) => state.bookDir(id));
  app.route("/api/v1/books", charactersRouter);

  // ── Persona CRUD (project-level) ──
  const personasRouter = createPersonasRouter(() => root);
  app.route("/api/v1/project", personasRouter);

  // ── Persona Presets (Per-6) ──
  const presetsRouter = createPresetsRouter(() => root);
  app.route("/api/v1/project", presetsRouter);

  // ── Persona AI Generation (Per-7) ──
  const personaAIGenRouter = createPersonaAIGenRouter({ getProjectRoot: () => root });
  app.route("/api/v1/project", personaAIGenRouter);

  // ── Session Archive (Ar-1) ──
  const sessionsRouter = createSessionsRouter(() => root);
  app.route("/api/v1/project", sessionsRouter);

  // ── Session Tags (R-02) ──
  const sessionTagsRouter = createSessionTagsRouter(() => root);
  app.route("/api/v1/project", sessionTagsRouter);

  // ── Voice Profile CRUD (C3-1) ──
  const voiceProfilesRouter = createVoiceProfilesRouter(() => root);
  app.route("/api/v1/project", voiceProfilesRouter);

  // ── Full-Text Search (Ar-2) ──
  const searchRouter = createSearchRouter(() => root);
  app.route("/api/v1/books", searchRouter);

  app.route("/api/skills", createSkillsRouter(root));
  app.route("/api/worlds", createWorldsRouter(root));
  app.route("/api/worlds", createWorldsAIGenRouter(root));
  app.route("/api/worlds", createMapsAIGenRouter(root));
  app.route("/api/books", createBookWorldsRouter(root));
  app.route("/api/foreshadowing", createForeshadowingRouter(root));
  app.route("/api/publish", createPublishRouter(root));
  app.route("/api/style-profiles", createStyleProfilesRouter(root));
  app.route("/api/consistency", createConsistencyRouter(root));
  app.route("/api/style-consistency", createStyleConsistencyRouter(root));
  app.route("/api/v1/writing", createWritingContinueRouter(root));
  app.route("/api/v1/project/agent-team", createAgentTeamRouter(root));
  app.route("/api/v1/agent-templates", createAgentTemplatesRouter(root));

  app.route("/api/v1/agent-templates", createAgentTemplatesRouter(root));
  app.route("/api/v1/custom-agents", createCustomAgentsRouter(root));
  app.route("/api/v1/agent-order", createAgentOrderRouter(root));

  // ── Writer's Block Breakthrough (E4 simplified) ──
  // GET  /api/v1/books/:id/writers-block — analyze context and return 3-5 advancement suggestions
  app.get("/api/v1/books/:id/writers-block", async (c) => {
    const id = c.req.param("id");
    const dir = state.bookDir(id);
    const { join } = await import("node:path");
    const { readFile } = await import("node:fs/promises");

    // ── 1. Load story frame ──
    let storyFrame = "";
    const framePaths = [
      join(dir, "story", "outline", "story_frame.md"),
      join(dir, "story", "story_bible.md"),
    ];
    for (const fp of framePaths) {
      try { storyFrame = await readFile(fp, "utf-8"); break; } catch { /* try next */ }
    }

    // ── 2. Load character context ──
    const roleDir = join(dir, "story", "roles");
    let characters = "";
    try {
      const { readdir } = await import("node:fs/promises");
      const tierDirs = ["主要角色", "次要角色", "major", "minor"];
      const cards: string[] = [];
      for (const td of tierDirs) {
        let entries: string[];
        try { entries = await readdir(join(roleDir, td)); } catch { continue; }
        for (const entry of entries) {
          if (!entry.endsWith(".md")) continue;
          const content = await readFile(join(roleDir, td, entry), "utf-8").catch(() => "");
          if (content.trim()) cards.push(`--- ${entry.replace(/\.md$/, "")} (${td}) ---\n${content}`);
        }
      }
      characters = cards.join("\n\n");
    } catch { characters = "(no character data available)"; }

    // ── 3. Load current chapter state ──
    let currentState = "";
    try {
      currentState = await readFile(join(dir, "story", "state", "current_state.json"), "utf-8");
    } catch {
      try { currentState = await readFile(join(dir, "story", "current_state.md"), "utf-8"); } catch { currentState = "(no current state)"; }
    }

    // ── 4. Load latest chapter content ──
    let latestChapterContent = "";
    try {
      const { readdir } = await import("node:fs/promises");
      const chaptersDir = join(dir, "story", "chapters");
      let indexPath = join(chaptersDir, "index.json");
      let index: { chapters?: Array<{ number: number }> };
      try { index = JSON.parse(await readFile(indexPath, "utf-8")); } catch { index = { chapters: [] }; }
      const chapters = (index.chapters ?? []).sort((a, b) => b.number - a.number);
      if (chapters.length > 0) {
        const latest = chapters[0].number;
        try { latestChapterContent = await readFile(join(chaptersDir, `${latest}.md`), "utf-8").then(r => r.substring(0, 3000)); } catch { latestChapterContent = ""; }
      }
    } catch { latestChapterContent = ""; }

    // ── 5. Call LLM ──
    const client = createLLMClient(config.llm);
    const systemPrompt = `你是一位资深小说创作顾问。你的任务是为一位卡文的作者提供 3-5 条推进建议。

基于提供的故事框架、角色设定和当前写作状态，给出具体的推进方向。

每条建议应包含：
1. **情节方向** — 故事下一步可以朝哪个方向发展
2. **角色行为** — 具体角色可以做什么
3. **冲突点** — 这一方向下的核心冲突或张力

请以 JSON 数组格式返回，每条建议为一个对象：
{
  "suggestions": [
    { "direction": "情节方向标题", "plot": "具体情节描述", "characterAction": "角色行为描述", "conflict": "冲突点描述" }
  ]
}

注意：
- 建议必须基于已有设定，不离谱
- 每条建议独立可行
- 使用与用户作品相同的语言
- 返回**纯 JSON**，不要 markdown 包装`;

    const userPrompt = `## 故事框架 / Story Frame
${storyFrame.substring(0, 4000) || "(无故事框架)"}

## 角色设定 / Characters
${characters.substring(0, 4000) || "(无角色数据)"}

## 当前写作状态 / Current State
${currentState.substring(0, 2000) || "(无状态数据)"}

## 最新章节内容 / Latest Chapter (开头 3000 字)
${latestChapterContent || "(无已写章节)"}

请基于以上信息，给出 3-5 条推进建议。`;

    try {
      const response = await chatCompletion(client, config.llm.model, [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ], { temperature: 0.7, maxTokens: 4096 });

      // Parse the response
      const text = response.content.trim();
      let suggestions: Array<Record<string, string>> = [];
      // Try to extract JSON from the response (it might be wrapped in markdown code blocks)
      const jsonMatch = text.match(/\[\s*\{.*\}\s*\]/s) || text.match(/\{[\s\S]*"suggestions"[\s\S]*\}/s);
      if (jsonMatch) {
        try { const parsed = JSON.parse(jsonMatch[0]); suggestions = parsed.suggestions ?? (Array.isArray(parsed) ? parsed : []); } catch { /* fallback */ }
      }
      if (suggestions.length === 0) {
        // Fallback: return raw text
        suggestions = [{ direction: "建议", plot: text.substring(0, 2000), characterAction: "", conflict: "" }];
      }
      return c.json({ suggestions });
    } catch (err) {
      return c.json({ error: { code: "LLM_ERROR", message: String(err) } }, 500);
    }
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
