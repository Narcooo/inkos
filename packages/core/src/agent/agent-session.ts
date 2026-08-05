import { createHash, randomUUID } from "node:crypto";
import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import { streamSimple, getModel, getEnvApiKey, createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import type {
  Model,
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context as PiContext,
  ImageContent,
  Message,
  SimpleStreamOptions,
  ToolResultMessage,
  UserMessage,
} from "@mariozechner/pi-ai";
import type { PipelineRunner } from "../pipeline/runner.js";
import { assertWithinContextWindow, estimatePiContextTokens } from "../llm/provider.js";
import { buildAgentSystemPrompt } from "./agent-system-prompt.js";
import {
  createPatchChapterTextTool,
  createReplaceChapterTextTool,
  createDeleteLatestChapterTool,
  createRenameEntityTool,
  createSubAgentTool,
  createReadTool,
  createGrepTool,
  createLsTool,
  createWriteTruthFileTool,
  createShortFictionRunTool,
  createGenerateCoverTool,
  createPlayEditTool,
  createPlayReviseTool,
  createPlayStartTool,
  createPlayStepTool,
  createProposeActionTool,
  createScriptCreationTool,
  createStoryboardCreationTool,
  createInteractiveFilmCreationTool,
  createTranslationCreateTool,
  createResearchWebTool,
  createIngestMaterialTool,
  createRetrieveMaterialTool,
  createImportChaptersTool,
} from "./agent-tools.js";
import { createFilmAuthoringTools, filmLLMDepsFromClient } from "./film-authoring-tools.js";
import {
  createNarrativeForecastCreateTool,
  createNarrativeForecastGetTool,
  createNarrativeForecastSelectTool,
} from "./forecast-tools.js";
import { createBookContextTransform } from "./context-transform.js";
import {
  appendTranscriptEvents,
  readTranscriptEvents,
} from "../interaction/session-transcript.js";
import {
  TOOL_RESULT_BRIDGE_TEXT,
  adaptRestoredAgentMessagesForModel,
  appendRestoredHistoryBoundary,
  restoreAgentMessagesFromTranscript,
} from "../interaction/session-transcript-restore.js";
import type { TranscriptEvent, TranscriptRole } from "../interaction/session-transcript-schema.js";
import type { PlayMode, SessionKind } from "../interaction/session.js";
import type { ActionPayload, ActionSource, RequestedIntent } from "../interaction/action-envelope.js";
import type { ContextCompressionCallback } from "../models/context-compression.js";
import { createSkillRegistry, loadConfiguredAgentSkills } from "../skills/index.js";
import { assertSafeBookId } from "../utils/book-id.js";
import { PlayStore } from "../play/play-store.js";
import { isLlmStubEnabled, stubAgentStream } from "./llm-stub.js";
import {
  assistantInvokesSkill,
  createUseSkillTool,
  sanitizeSkillTurnMessage,
} from "./skill-tool.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentSessionConfig {
  /** Unique session identifier (typically the BookSession id). */
  sessionId: string;
  /** Book ID, or null if in "new book" mode. */
  bookId: string | null;
  /** Studio conversation surface. Used to narrow the visible tools. */
  sessionKind?: SessionKind;
  /** Play interaction mode chosen by the player at launch (guided = choice-only, open = free text). */
  playMode?: PlayMode;
  /** Where this turn came from. Button/slash turns can execute confirmed production actions. */
  actionSource?: ActionSource;
  /** Explicit user-confirmed action requested by the UI/command surface. */
  requestedIntent?: RequestedIntent;
  /** Structured execution arguments confirmed by the UI/command surface. */
  actionPayload?: ActionPayload;
  /** User/UI-forced Agent Skills for this turn, e.g. @open-world-play. */
  requestedSkills?: ReadonlyArray<string>;
  /** Agent Skills explicitly disabled for this turn. */
  disabledSkills?: ReadonlyArray<string>;
  /** Language for the system prompt. */
  language: string;
  /** PipelineRunner for sub-agent tool delegation. */
  pipeline: PipelineRunner;
  /** Project root directory (books/ lives under this). */
  projectRoot: string;
  /** pi-ai Model to use, or provider+modelId to resolve via getModel. */
  model: Model<Api> | { provider: string; modelId: string };
  /** Optional API key. When omitted, falls back to env-based key lookup. */
  apiKey?: string;
  /** Allow the read tool to read absolute paths outside projectRoot/books. Defaults to false; set INKOS_AGENT_ALLOW_SYSTEM_READ=1 to enable. */
  allowSystemFileRead?: boolean;
  /** Optional listener for streaming events (for SSE forwarding). */
  onEvent?: (event: AgentEvent) => void;
  /** Optional listener for context compression lifecycle events. */
  onContextCompression?: ContextCompressionCallback;
  /** Attachments uploaded with this user turn. Text is injected as protected user context; images use pi-ai ImageContent. */
  attachments?: ReadonlyArray<AgentSessionAttachment>;
  /**
   * Status block for a production task running in the background of this session
   * (e.g. a confirmed short-fiction run). Appended to the system prompt so the
   * agent can answer progress questions instead of claiming nothing is running.
   * Changing this value evicts the cached Agent so the prompt stays current.
   */
  backgroundTaskContext?: string;
  /**
   * Remove book/artifact-mutating production tools from this turn's tool table
   * (a confirmed production task is already running in this session, so a
   * parallel chat turn must not mutate the same book concurrently). Read-style
   * tools, research/material tools, and propose_action stay available —
   * confirmed actions started via propose_action are gated host-side anyway.
   * Changing this value evicts the cached Agent so the tool table stays current.
   */
  suppressProductionTools?: boolean;
}

export interface AgentSessionResult {
  /** Extracted text from the final assistant message. */
  responseText: string;
  /** Full raw Agent conversation history. */
  messages: AgentMessage[];
  /** Upstream model error surfaced by pi-agent-core, if the final assistant turn failed. */
  errorMessage?: string;
}

export interface AgentSessionAttachment {
  readonly id: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly size: number;
  readonly storedPath?: string;
  readonly text?: string;
  readonly image?: {
    readonly data: string;
    readonly mimeType: string;
  };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CachedAgent {
  agent: Agent;
  sessionId: string;
  projectRoot: string;
  bookId: string | null;
  sessionKind: SessionKind;
  actionSource: NonNullable<AgentSessionConfig["actionSource"]>;
  requestedIntent: AgentSessionConfig["requestedIntent"];
  actionPayloadKey: string;
  skillResolutionKey: string;
  turnSkillIds: Set<string>;
  playWorldExists: boolean;
  language: string;
  modelIdentity: string;
  apiKey: string | undefined;
  allowSystemFileRead: boolean;
  backgroundTaskContext: string | undefined;
  suppressProductionTools: boolean;
  lastCommittedSeq: number;
  lastActive: number;
}

const agentCache = new Map<string, CachedAgent>();
const agentSessionQueues = new Map<string, Promise<void>>();

/** TTL for cached agents: 5 minutes. */
const CACHE_TTL_MS = 5 * 60 * 1000;

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** Cleanup interval handle (lazy-started). */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of agentCache) {
      if (now - entry.lastActive > CACHE_TTL_MS) {
        agentCache.delete(id);
      }
    }
    // Stop the timer when nothing left to watch.
    if (agentCache.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, 60_000); // run every 60 s
  // Allow the process to exit even if this timer is alive.
  if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveModel(spec: AgentSessionConfig["model"]): Model<Api> {
  if (!spec) {
    throw new Error("Model is required but was undefined. Check LLM configuration.");
  }
  if (typeof spec === "object" && "id" in spec && "api" in spec) {
    // Already a Model object.
    return spec as Model<Api>;
  }
  const { provider, modelId } = spec as { provider: string; modelId: string };
  if (!provider || !modelId) {
    throw new Error(`Invalid model spec: provider=${provider}, modelId=${modelId}`);
  }
  return getModel(provider as any, modelId as any);
}

function envFlagEnabled(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  if (value === "1" || value.toLowerCase() === "true") return true;
  if (value === "0" || value.toLowerCase() === "false") return false;
  return defaultValue;
}

function agentModelIdentity(model: Model<Api>): string {
  return [
    model.api,
    model.provider,
    model.baseUrl ?? "",
    model.id,
  ].join("::");
}

function actionPayloadCacheKey(payload: ActionPayload | undefined): string {
  return payload ? JSON.stringify(payload) : "";
}

function skillResolutionCacheKey(value: {
  readonly usedSkills: ReadonlyArray<{
    readonly id: string;
    readonly source?: string;
    readonly body?: string;
  }>;
  readonly forcedSkillIds: ReadonlyArray<string>;
  readonly missingSkillIds: ReadonlyArray<string>;
  readonly disabledSkillIds: ReadonlyArray<string>;
  readonly availableSkills: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly body?: string;
    readonly baseDir?: string;
  }>;
}): string {
  return createHash("sha256").update(JSON.stringify({
    used: value.usedSkills.map((skill) => ({
      id: skill.id,
      source: skill.source,
      body: skill.body ?? "",
    })),
    forced: value.forcedSkillIds,
    missing: value.missingSkillIds,
    disabled: value.disabledSkillIds,
    available: value.availableSkills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      body: skill.body ?? "",
      baseDir: skill.baseDir ?? "",
    })),
  })).digest("hex");
}

function sessionQueueKey(projectRoot: string, sessionId: string): string {
  return `${projectRoot}\0${sessionId}`;
}

function agentCacheKey(projectRoot: string, sessionId: string): string {
  return sessionQueueKey(projectRoot, sessionId);
}

function buildAttachmentUserBlock(attachments: ReadonlyArray<AgentSessionAttachment> | undefined, language: string): string {
  if (!attachments?.length) return "";
  const isEn = language === "en";
  const lines = [
    isEn
      ? "\n\n## Uploaded Files (host-provided, user-authorized)"
      : "\n\n## 用户上传文件（宿主已接收，用户授权本轮使用）",
  ];
  for (const attachment of attachments) {
    lines.push(`\n### ${attachment.filename}`);
    lines.push(`- id: ${attachment.id}`);
    lines.push(`- mime: ${attachment.mimeType || "application/octet-stream"}`);
    lines.push(`- size: ${attachment.size}`);
    if (attachment.storedPath) lines.push(`- stored_path: ${attachment.storedPath}`);
    if (attachment.text) {
      lines.push(isEn ? "\nContent:" : "\n内容：");
      lines.push("```");
      lines.push(attachment.text);
      lines.push("```");
    } else if (attachment.image) {
      lines.push(isEn ? "- image: attached as multimodal input" : "- 图片：已作为多模态输入附加");
    } else {
      lines.push(isEn
        ? "- content: stored only; no extractor is available for this MIME type yet"
        : "- 内容：已保存；当前 MIME 类型暂未配置文本抽取器");
    }
  }
  return lines.join("\n");
}

function attachmentImages(attachments: ReadonlyArray<AgentSessionAttachment> | undefined): ImageContent[] {
  return (attachments ?? [])
    .filter((attachment) => attachment.image)
    .map((attachment) => ({
      type: "image",
      data: attachment.image!.data,
      mimeType: attachment.image!.mimeType,
    }));
}

function guardedStreamSimple<TApi extends Api>(
  model: Model<TApi>,
  context: PiContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const reservedOutputTokens = Number.isFinite(options?.maxTokens)
    ? options!.maxTokens!
    : Number.isFinite(model.maxTokens)
      ? model.maxTokens
      : 4096;
  assertWithinContextWindow({
    piModel: model,
    model: model.id,
    estimatedInputTokens: estimatePiContextTokens(context),
    reservedOutputTokens,
  });
  return streamSimple(model, context, options);
}

function localAssistantStopStream(model: Model<Api>): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE,
    stopReason: "stop",
    timestamp: Date.now(),
  };
  queueMicrotask(() => {
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
  });
  return stream;
}

export function isTerminalProductionToolName(toolName: unknown): boolean {
  return toolName === "propose_action"
    || toolName === "sub_agent"
    || toolName === "short_fiction_run"
    || toolName === "script_create"
    || toolName === "storyboard_create"
    || toolName === "interactive_film_create"
    || toolName === "generate_cover"
    || toolName === "play_start"
    || toolName === "play_edit"
    || toolName === "play_revise"
    || toolName === "play_step"
    || toolName === "create_narrative_forecast"
    || toolName === "get_narrative_forecast"
    || toolName === "select_narrative_branch";
}

function hasUnansweredTerminalToolResult(messages: AgentMessage[]): boolean {
  let assistantTextAfterTool = false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object" || !("role" in message)) continue;
    const role = (message as { role?: unknown }).role;
    if (role === "user") return false;
    if (role === "assistant") {
      const text = extractTextFromAssistant(message as AssistantMessage).trim();
      if (text) assistantTextAfterTool = true;
      continue;
    }
    if (role !== "toolResult") continue;
    const toolName = (message as { toolName?: unknown }).toolName;
    const isError = (message as { isError?: unknown }).isError;
    if (isTerminalProductionToolName(toolName) && isError !== true) {
      return !assistantTextAfterTool;
    }
  }
  return false;
}

async function runInAgentSessionQueue<T>(
  projectRoot: string,
  sessionId: string,
  task: () => Promise<T>,
): Promise<T> {
  const key = sessionQueueKey(projectRoot, sessionId);
  const previous = agentSessionQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => gate);
  agentSessionQueues.set(key, queued);

  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (agentSessionQueues.get(key) === queued) {
      agentSessionQueues.delete(key);
    }
  }
}

async function latestCommittedSeq(projectRoot: string, sessionId: string): Promise<number> {
  const events = await readTranscriptEvents(projectRoot, sessionId);
  return events
    .filter((event) => event.type === "request_committed")
    .reduce((max, event) => Math.max(max, event.seq), 0);
}

function transcriptRoleForMessage(message: AgentMessage): TranscriptRole | null {
  if (!message || typeof message !== "object" || !("role" in message)) return null;
  const role = (message as { role?: unknown }).role;
  return role === "user" || role === "assistant" || role === "toolResult" || role === "system"
    ? role
    : null;
}

function firstToolCallId(message: AgentMessage): string | undefined {
  if (!message || typeof message !== "object" || !("content" in message)) return undefined;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const block = content.find(
    (item): item is { type: "toolCall"; id: string } =>
      !!item &&
      typeof item === "object" &&
      (item as { type?: unknown }).type === "toolCall" &&
      typeof (item as { id?: unknown }).id === "string",
  );
  return block?.id;
}

function toolCallIdForMessage(message: AgentMessage): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  if ((message as { role?: unknown }).role === "toolResult") {
    const toolCallId = (message as { toolCallId?: unknown }).toolCallId;
    return typeof toolCallId === "string" && toolCallId.length > 0 ? toolCallId : undefined;
  }
  return firstToolCallId(message);
}

function messageTimestamp(message: AgentMessage): number {
  if (message && typeof message === "object") {
    const timestamp = (message as { timestamp?: unknown }).timestamp;
    if (typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp >= 0) {
      return Math.floor(timestamp);
    }
  }
  return Date.now();
}

async function ensureSessionCreatedEvent(
  projectRoot: string,
  sessionId: string,
  bookId: string | null,
  sessionKind?: SessionKind,
): Promise<void> {
  await appendTranscriptEvents(projectRoot, sessionId, ({ events, nextSeq }) => {
    if (events.some((event) => event.type === "session_created")) return [];

    const now = Date.now();
    return [{
      type: "session_created",
      version: 1,
      sessionId,
      seq: nextSeq,
      timestamp: now,
      bookId,
      ...(sessionKind ? { sessionKind } : {}),
      title: null,
      createdAt: now,
      updatedAt: now,
    }];
  });
}

async function appendAgentTranscriptEvent(
  projectRoot: string,
  sessionId: string,
  buildEvent: (seq: number) => TranscriptEvent,
): Promise<TranscriptEvent> {
  const events = await appendTranscriptEvents(projectRoot, sessionId, ({ nextSeq }) => [
    buildEvent(nextSeq),
  ]);
  const event = events[0];
  if (!event) throw new Error(`Failed to append transcript event for session "${sessionId}"`);
  return event;
}

/**
 * Extract readable text from an AssistantMessage's content array.
 * Filters out tool-call blocks; concatenates text blocks.
 */
function extractTextFromAssistant(msg: AssistantMessage): string {
  return msg.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");
}

function looksLikeUnsavedChapterProse(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 800) return false;
  if (looksLikeChapterRevisionPlan(trimmed)) return false;
  return /(^|\n)\s{0,3}#{1,3}\s*(?:第\s*[0-9一二三四五六七八九十百千]+\s*章|Chapter\s+\d+)/i.test(trimmed);
}

function looksLikeChapterRevisionPlan(text: string): boolean {
  const headingLines = text
    .split(/\n+/)
    .filter((line) => /^\s{0,3}#{1,3}\s*(?:第\s*[0-9一二三四五六七八九十百千]+\s*章|Chapter\s+\d+)/i.test(line))
    .slice(0, 8);
  if (headingLines.length === 0) return false;
  const planSignals = [
    /修改指令|修订指令|重写指令|执行指令|改稿指令|具体修改|修改方案|修订方案|重写方案/,
    /问题|目标|处理方式|调整|建议|要求|保留|删除|新增|强化|弱化/,
    /revision brief|revision plan|rewrite plan|edit instruction|actionable instruction|change request/i,
  ];
  return headingLines.some((line) => planSignals.some((signal) => signal.test(line)))
    || planSignals.some((signal) => signal.test(text.slice(0, 1200)));
}

function bookRawChapterBoundaryText(language: string): string {
  return language === "zh"
    ? "这次模型输出了疑似章节正文的聊天文本，但没有调用落盘工具。InkOS 不会把聊天正文当成已保存章节：如果要续写新章，请发送“继续写下一章”；如果要修改旧章，请发送“重写/修订第 N 章 + 具体要求”，系统会走 reviser/writer 管线落盘。"
    : "The model produced chapter-like prose in chat without calling a persistence tool. InkOS will not treat chat prose as a saved chapter. Ask to write the next chapter only when you want to append; ask to rewrite/revise chapter N with concrete requirements when you want to change existing chapters.";
}

function replaceAssistantText(message: AssistantMessage, text: string): void {
  message.content = [{ type: "text", text }];
  message.stopReason = "stop";
  delete message.errorMessage;
}

function lastAssistantMessage(messages: AgentMessage[]): AssistantMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg && typeof msg === "object" && "role" in msg && (msg as { role?: unknown }).role === "assistant") {
      return msg as AssistantMessage;
    }
  }
  return undefined;
}

function assistantErrorMessage(message: AssistantMessage | undefined): string | undefined {
  return message &&
    (message.stopReason === "error" || message.stopReason === "aborted") &&
    message.errorMessage
      ? message.errorMessage
      : undefined;
}

function convertAgentMessagesForModel(messages: AgentMessage[], model: Model<Api>): Message[] {
  const llmMessages = messages.flatMap((message): Message[] => {
    if (!message || typeof message !== "object" || !("role" in message)) return [];
    const raw = message as { role?: unknown; content?: unknown };
    if (raw.role === "user" || raw.role === "assistant" || raw.role === "toolResult") {
      return [message as Message];
    }
    if (raw.role === "system" && typeof raw.content === "string") {
      return [{
        role: "user",
        content: raw.content,
        timestamp: messageTimestamp(message),
      }];
    }
    return [];
  });

  const candidate = model as { api?: unknown; baseUrl?: unknown };
  // InkOS's internal `toolResult` role is not part of the OpenAI Chat Completions spec.
  // Many openai-completions upstreams (Google, and kkaiapi/DeepSeek-Pro-style gateways) reject
  // it outright — which surfaces as an opaque "503 provider temporarily unavailable" — so fold
  // tool results into a plain user message for EVERY openai-completions endpoint, not just Google.
  // Anthropic-format endpoints (MiniMax / 百炼) handle tool results natively and are left untouched.
  const isOpenAICompletionsCompatible = candidate.api === "openai-completions";
  if (!isOpenAICompletionsCompatible) return llmMessages;

  const converted: Message[] = [];
  const pushToolResultsAsUser = (toolResults: ToolResultMessage[]) => {
    const lines = toolResults.flatMap((result) => {
      const content = result.content
        .map((block) => block.type === "text" ? block.text : "[image]")
        .filter(Boolean)
        .join("\n")
        .trim() || "(empty tool result)";
      return [`- ${result.toolName} (${result.toolCallId}):`, content];
    });
    converted.push({
      role: "user",
      content: [
        "[Tool results]",
        ...lines,
        "Use these tool results to answer the active user request. If a tool failed, explain the failure and choose the next useful action.",
      ].join("\n"),
      timestamp: toolResults.reduce(
        (max, result) => Math.max(max, messageTimestamp(result as AgentMessage)),
        0,
      ) || Date.now(),
    });
  };

  for (let i = 0; i < llmMessages.length; i++) {
    const message = llmMessages[i];

    if (message.role === "assistant") {
      const textContent = message.content.filter(
        (block): block is { type: "text"; text: string } =>
          block.type === "text" && typeof block.text === "string" && block.text.trim().length > 0,
      );
      if (
        textContent.length === 1 &&
        message.content.length === 1 &&
        textContent[0].text.trim() === TOOL_RESULT_BRIDGE_TEXT
      ) {
        continue;
      }

      const toolCallIds = new Set<string>();
      for (const block of message.content) {
        if (block.type === "toolCall" && typeof block.id === "string" && block.id.length > 0) {
          toolCallIds.add(block.id);
        }
      }
      if (toolCallIds.size === 0) {
        converted.push(message);
        continue;
      }

      if (textContent.length > 0) {
        converted.push({ ...message, content: textContent });
      }

      const toolResults: ToolResultMessage[] = [];
      let nextIndex = i + 1;
      while (nextIndex < llmMessages.length) {
        const next = llmMessages[nextIndex];
        if (next.role !== "toolResult" || !toolCallIds.has(next.toolCallId)) break;
        toolResults.push(next);
        nextIndex += 1;
      }

      if (toolResults.length > 0) {
        pushToolResultsAsUser(toolResults);
        i = nextIndex - 1;
      }
      continue;
    }

    if (message.role === "toolResult") {
      pushToolResultsAsUser([message]);
      continue;
    }

    converted.push(message);
  }

  return converted;
}

/**
 * Extract thinking/reasoning text from an AssistantMessage's content array.
 */
function extractThinkingFromAssistant(msg: AssistantMessage): string {
  return msg.content
    .filter((c: any) => c.type === "thinking")
    .map((c: any) => c.thinking ?? "")
    .join("");
}

/**
 * Convert plain `{ role, content }` messages (from BookSession disk storage)
 * back into pi-agent AgentMessage format so they can be loaded into an Agent.
 */
function plainToAgentMessages(
  plain: Array<{ role: string; content: string }>,
): AgentMessage[] {
  return plain.map((m) => {
    const ts = Date.now();
    if (m.role === "user") {
      return { role: "user", content: m.content, timestamp: ts } satisfies UserMessage;
    }
    // For stored assistant messages we only have the text.
    // Re-wrap as a minimal AssistantMessage with a single TextContent.
    return {
      role: "assistant",
      content: [{ type: "text", text: m.content }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "unknown",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: ts,
    } satisfies AssistantMessage;
  });
}

/**
 * Flatten the Agent's in-memory messages to plain `{ role, content }` pairs
 * suitable for BookSession persistence.
 */
function agentMessagesToPlain(
  messages: AgentMessage[],
): Array<{ role: string; content: string; thinking?: string }> {
  const out: Array<{ role: string; content: string; thinking?: string }> = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object" || !("role" in msg)) continue;

    const m = msg as { role: string; [k: string]: any };

    if (m.role === "user") {
      const content = typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("")
          : "";
      if (content) out.push({ role: "user", content });
    } else if (m.role === "assistant") {
      const text = extractTextFromAssistant(m as AssistantMessage);
      const thinking = extractThinkingFromAssistant(m as AssistantMessage);
      if (text || thinking) {
        const entry: { role: string; content: string; thinking?: string } = { role: "assistant", content: text };
        if (thinking) entry.thinking = thinking;
        out.push(entry);
      }
    }
    // ToolResult messages are internal; skip them for persistence.
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * 会创建/修改书籍与产物的生产工具。suppressProductionTools 为 true（同会话
 * 有后台生产任务在运行）时从工具表剔除；read/grep/ls、research/material 与
 * propose_action 保留——propose_action 引发的确认任务在 host 侧另有单任务闸门。
 */
const PRODUCTION_MUTATION_TOOL_NAMES = new Set([
  "sub_agent",
  "generate_cover",
  "write_truth_file",
  "rename_entity",
  "patch_chapter_text",
  "replace_chapter_text",
  "delete_latest_chapter",
  "import_chapters",
]);

type CreateAgentToolsForModeParams = {
  readonly pipeline: PipelineRunner;
  readonly bookId: string | null;
  readonly sessionId: string;
  readonly sessionKind: SessionKind;
  readonly actionSource: NonNullable<AgentSessionConfig["actionSource"]>;
  readonly requestedIntent: AgentSessionConfig["requestedIntent"];
  readonly actionPayload: AgentSessionConfig["actionPayload"];
  readonly projectRoot: string;
  readonly allowSystemFileRead: boolean;
  readonly language: string;
  readonly playMode?: "open" | "guided";
  readonly playWorldExists: boolean;
  readonly intentSkillTool?: ReturnType<typeof createUseSkillTool>;
  readonly requestedSkillIds?: () => ReadonlyArray<string>;
};

function createAgentToolsForMode(params: CreateAgentToolsForModeParams) {
  const tools = createModeTools(params);
  return params.intentSkillTool ? [...tools, params.intentSkillTool] : tools;
}

function createModeTools(params: CreateAgentToolsForModeParams) {
  const lang = params.language === "en" ? "en" : "zh";
  const subAgentTool = createSubAgentTool(params.pipeline, params.bookId, params.projectRoot, {
    actionPayload: params.actionPayload,
    language: lang,
  });
  const proposalTool = createProposeActionTool(lang, {
    sameSession: params.sessionKind !== "chat",
    requestedSkillIds: params.requestedSkillIds,
  });
  const researchTool = createResearchWebTool(params.projectRoot);
  const materialTool = createIngestMaterialTool(params.projectRoot);
  const materialRetrievalTool = createRetrieveMaterialTool(params.projectRoot);
  const importChaptersTool = createImportChaptersTool(params.pipeline, params.bookId, params.projectRoot);
  const isConfirmed = (
    intent: NonNullable<AgentSessionConfig["requestedIntent"]>,
  ): boolean => {
    return (params.actionSource === "button" || params.actionSource === "slash")
      && params.requestedIntent === intent;
  };

  if (params.sessionKind === "chat") {
    if (isConfirmed("translation_create")) {
      return [createTranslationCreateTool(params.projectRoot, { actionPayload: params.actionPayload })];
    }
    return [proposalTool, researchTool, materialTool, materialRetrievalTool, importChaptersTool];
  }

  if (params.sessionKind === "short") {
    if (isConfirmed("short_run")) {
      return [createShortFictionRunTool(params.pipeline, params.projectRoot, { actionPayload: params.actionPayload, language: lang })];
    }
    if (isConfirmed("generate_cover")) {
      return [createGenerateCoverTool(params.projectRoot, { actionPayload: params.actionPayload })];
    }
    return [proposalTool, materialTool, materialRetrievalTool];
  }

  if (params.sessionKind === "script") {
    if (isConfirmed("script_create")) {
      return [createScriptCreationTool(params.pipeline, params.projectRoot, { actionPayload: params.actionPayload, language: lang })];
    }
    return [proposalTool, materialTool, materialRetrievalTool];
  }

  if (params.sessionKind === "storyboard") {
    if (isConfirmed("storyboard_create")) {
      return [createStoryboardCreationTool(params.pipeline, params.projectRoot, { actionPayload: params.actionPayload, language: lang })];
    }
    return [proposalTool, materialTool, materialRetrievalTool];
  }

  if (params.sessionKind === "interactive-film") {
    if (isConfirmed("interactive_film_create")) {
      return [createInteractiveFilmCreationTool(params.pipeline, params.projectRoot, { actionPayload: params.actionPayload, language: lang })];
    }
    return [proposalTool, materialTool, materialRetrievalTool];
  }

  if (params.sessionKind === "interactive-film-authoring") {
    const projectId = params.bookId;
    if (!projectId) {
      throw new Error("interactive-film-authoring session requires a non-null bookId");
    }
    const agentCtx = params.pipeline.createAgentContext("film-authoring", projectId);
    const llm = filmLLMDepsFromClient(agentCtx.client, agentCtx.model);
    return createFilmAuthoringTools({
      projectRoot: params.projectRoot,
      projectId,
      llm,
      proposeActionTool: proposalTool,
      confirmedIntent: params.requestedIntent,
      language: lang,
    });
  }


  if (params.sessionKind === "play") {
    if (isConfirmed("play_start")) {
      return [createPlayStartTool(params.pipeline, params.projectRoot, params.sessionId, params.playMode, { actionPayload: params.actionPayload })];
    }
    if (params.playWorldExists) {
      return [
        createPlayEditTool(params.projectRoot, params.sessionId, lang),
        createPlayReviseTool(params.pipeline, params.projectRoot, params.sessionId, { language: lang }),
        createPlayStepTool(params.pipeline, params.projectRoot, params.sessionId, { language: lang }),
        materialTool,
        materialRetrievalTool,
      ];
    }
    return [proposalTool, materialTool, materialRetrievalTool];
  }

  if (params.sessionKind === "book-create" && !params.bookId) {
    if (isConfirmed("create_book")) {
      return [createSubAgentTool(params.pipeline, params.bookId, params.projectRoot, {
        actionPayload: params.actionPayload,
        architectCreateOnly: true,
        language: lang,
      })];
    }
    return [proposalTool, researchTool, materialTool, materialRetrievalTool];
  }

  if (!params.bookId) {
    return [];
  }

  const bookTools = [
    subAgentTool,
    createGenerateCoverTool(params.projectRoot, { actionPayload: params.actionPayload }),
    createReadTool(params.projectRoot, { allowSystemPaths: params.allowSystemFileRead }),
    createWriteTruthFileTool(params.pipeline, params.projectRoot, params.bookId),
    createRenameEntityTool(params.pipeline, params.projectRoot, params.bookId),
    createPatchChapterTextTool(params.pipeline, params.projectRoot, params.bookId),
    createReplaceChapterTextTool(params.pipeline, params.projectRoot, params.bookId),
    createDeleteLatestChapterTool(params.projectRoot, params.bookId),
    researchTool,
    materialTool,
    materialRetrievalTool,
    importChaptersTool,
    createNarrativeForecastCreateTool(params.pipeline, params.bookId, params.projectRoot),
    createNarrativeForecastGetTool(params.bookId, params.projectRoot),
    createNarrativeForecastSelectTool(params.bookId, params.projectRoot),
    createGrepTool(params.projectRoot),
    createLsTool(params.projectRoot),
  ];

  if (params.sessionKind === "edit") {
    // Edit mode stays deterministic: forecast create runs an LLM projection,
    // and get/select belong to the planning workflow, not text editing.
    return bookTools.filter((tool) => ![
      "sub_agent",
      "generate_cover",
      "research_web",
      "import_chapters",
      "create_narrative_forecast",
      "get_narrative_forecast",
      "select_narrative_branch",
    ].includes(tool.name));
  }

  return bookTools;
}

/**
 * Run a single conversation turn within a cached Agent session.
 *
 * If the session already exists in the cache, reuses the Agent (with its full
 * in-memory message history including tool calls). Otherwise creates a new
 * Agent, optionally restoring messages from `initialMessages`.
 */
export async function runAgentSession(
  config: AgentSessionConfig,
  userMessage: string,
  initialMessages?: Array<{ role: string; content: string }>,
): Promise<AgentSessionResult> {
  return runInAgentSessionQueue(config.projectRoot, config.sessionId, () =>
    runAgentSessionUnlocked(config, userMessage, initialMessages)
  );
}

async function runAgentSessionUnlocked(
  config: AgentSessionConfig,
  userMessage: string,
  initialMessages?: Array<{ role: string; content: string }>,
): Promise<AgentSessionResult> {
  const { sessionId, language, pipeline, projectRoot, onEvent, onContextCompression } = config;
  // Normalize at the entry point so downstream comparisons, closures, and
  // fs paths never see `undefined`. The type is already `string | null`, but
  // some callers may bypass the type system (e.g. `activeBookId ?? null` gets
  // skipped) and we don't want that to (a) throw in path.join or (b) trigger
  // a spurious cache eviction because `null !== undefined`.
  const bookId: string | null = config.bookId ? assertSafeBookId(config.bookId) : null;
  const sessionKind: SessionKind = config.sessionKind ?? (bookId ? "book" : "chat");
  const playMode = config.playMode;
  const actionSource = config.actionSource ?? "free-text";
  const requestedIntent = config.requestedIntent;
  const actionPayload = config.actionPayload;
  const actionPayloadKey = actionPayloadCacheKey(actionPayload);
  const configuredSkills = await loadConfiguredAgentSkills({ projectRoot });
  const skillRegistry = createSkillRegistry({ skills: configuredSkills.skills });
  const skillResolution = skillRegistry.resolveSkills({
    requestedSkills: config.requestedSkills,
    disabledSkills: config.disabledSkills,
  });
  const skillResolutionKey = skillResolutionCacheKey(skillResolution);
  const model = resolveModel(config.model);
  const requestedModelIdentity = agentModelIdentity(model);
  const allowSystemFileRead = config.allowSystemFileRead ?? envFlagEnabled(process.env.INKOS_AGENT_ALLOW_SYSTEM_READ, false);
  const suppressProductionTools = config.suppressProductionTools ?? false;
  const playWorldExists = sessionKind === "play"
    ? Boolean(await new PlayStore(projectRoot).loadWorld(sessionId))
    : false;
  const cacheKey = agentCacheKey(projectRoot, sessionId);

  // ----- Resolve or create Agent -----
  let cached = agentCache.get(cacheKey);
  let currentCommittedSeq: number | undefined;

  if (cached) {
    currentCommittedSeq = await latestCommittedSeq(projectRoot, sessionId);
    // Evict and rebuild if model protocol identity OR bookId changed. Both are
    // captured into the Agent at construction time (model via initialState,
    // bookId via closures in systemPrompt / tools / transformContext), so a
    // mismatch means the cached Agent would keep using stale context.
    const modelChanged = cached.modelIdentity !== requestedModelIdentity;
    const projectRootChanged = cached.projectRoot !== projectRoot;
    const bookChanged = cached.bookId !== bookId;
    const sessionKindChanged = cached.sessionKind !== sessionKind;
    const actionSourceChanged = cached.actionSource !== actionSource;
    const requestedIntentChanged = cached.requestedIntent !== requestedIntent;
    const actionPayloadChanged = cached.actionPayloadKey !== actionPayloadKey;
    const skillResolutionChanged = cached.skillResolutionKey !== skillResolutionKey;
    const languageChanged = cached.language !== language;
    const apiKeyChanged = cached.apiKey !== config.apiKey;
    const readPermissionChanged = cached.allowSystemFileRead !== allowSystemFileRead;
    const playWorldChanged = cached.playWorldExists !== playWorldExists;
    const backgroundTaskContextChanged = cached.backgroundTaskContext !== config.backgroundTaskContext;
    const suppressProductionToolsChanged = cached.suppressProductionTools !== suppressProductionTools;
    const transcriptChanged = cached.lastCommittedSeq !== currentCommittedSeq;

    if (
      modelChanged ||
      projectRootChanged ||
      bookChanged ||
      sessionKindChanged ||
      actionSourceChanged ||
      requestedIntentChanged ||
      actionPayloadChanged ||
      skillResolutionChanged ||
      languageChanged ||
      apiKeyChanged ||
      readPermissionChanged ||
      playWorldChanged ||
      backgroundTaskContextChanged ||
      suppressProductionToolsChanged ||
      transcriptChanged
    ) {
      agentCache.delete(cacheKey);
      cached = undefined;
    }
  }

  if (!cached) {
    const restoredHistory = await restoreAgentMessagesFromTranscript(projectRoot, sessionId, sessionKind);
    if (restoredHistory.length > 0) {
      onContextCompression?.({
        category: "session_context",
        phase: "start",
        sources: ["session transcript"],
      });
      onContextCompression?.({
        category: "session_context",
        phase: "end",
        sources: ["session transcript"],
      });
    }
    const restoredMessages = appendRestoredHistoryBoundary(
      adaptRestoredAgentMessagesForModel(
        restoredHistory,
        model,
      ),
      language,
    );
    const initialAgentMessages = restoredMessages.length > 0
      ? restoredMessages
      : initialMessages && initialMessages.length > 0
        ? plainToAgentMessages(initialMessages)
        : [];
    let terminalToolResultTail = false;
    const turnSkillIds = new Set(skillResolution.forcedSkillIds);
    const allowIntentSkillSelection = actionSource === "free-text"
      && skillResolution.forcedSkillIds.length === 0;
    const baseSystemPrompt = buildAgentSystemPrompt(bookId, language, sessionKind, {
      actionSource,
      requestedIntent,
      playWorldExists,
      skills: skillResolution,
      allowIntentSkillSelection,
    });
    const intentSkillTool = allowIntentSkillSelection
      ? createUseSkillTool({
          registry: skillRegistry,
          disabledSkillIds: skillResolution.disabledSkillIds,
          onActivate: (skillId) => turnSkillIds.add(skillId),
        })
      : undefined;
    const agentTools = createAgentToolsForMode({
      pipeline,
      bookId,
      sessionId,
      sessionKind,
      actionSource,
      requestedIntent,
      actionPayload,
      projectRoot,
      allowSystemFileRead,
      language,
      playMode,
      playWorldExists,
      intentSkillTool,
      requestedSkillIds: () => [...turnSkillIds],
    });
    const agent = new Agent({
      initialState: {
        model,
        systemPrompt: config.backgroundTaskContext
          ? `${baseSystemPrompt}\n\n${config.backgroundTaskContext}`
          : baseSystemPrompt,
        tools: suppressProductionTools
          ? agentTools.filter((tool) => !PRODUCTION_MUTATION_TOOL_NAMES.has(tool.name))
          : agentTools,
        messages: initialAgentMessages,
      },
      transformContext: createBookContextTransform(bookId, projectRoot, { onContextCompression }),
      convertToLlm: (messages) => {
        terminalToolResultTail = hasUnansweredTerminalToolResult(messages);
        return convertAgentMessagesForModel(messages, model);
      },
      streamFn: (streamModel, context, options) => {
        if (terminalToolResultTail) {
          terminalToolResultTail = false;
          return localAssistantStopStream(streamModel);
        }
        if (isLlmStubEnabled()) return stubAgentStream(streamModel, context);
        return guardedStreamSimple(streamModel, context, options);
      },
      getApiKey: (provider: string) => {
        if (config.apiKey) return config.apiKey;
        return getEnvApiKey(provider);
      },
    });

    cached = {
      agent,
      sessionId,
      projectRoot,
      bookId,
      sessionKind,
      actionSource,
      requestedIntent,
      actionPayloadKey,
      skillResolutionKey,
      turnSkillIds,
      playWorldExists,
      language,
      modelIdentity: requestedModelIdentity,
      apiKey: config.apiKey,
      allowSystemFileRead,
      backgroundTaskContext: config.backgroundTaskContext,
      suppressProductionTools,
      lastCommittedSeq: currentCommittedSeq ?? await latestCommittedSeq(projectRoot, sessionId),
      lastActive: Date.now(),
    };
    agentCache.set(cacheKey, cached);
    ensureCleanupTimer();
  }

  cached.lastActive = Date.now();
  cached.turnSkillIds.clear();
  for (const skillId of skillResolution.forcedSkillIds) {
    cached.turnSkillIds.add(skillId);
  }
  const { agent } = cached;
  const attachmentBlock = buildAttachmentUserBlock(config.attachments, language);
  const promptMessage = attachmentBlock ? `${userMessage}${attachmentBlock}` : userMessage;
  const promptImages = attachmentImages(config.attachments);

  // ----- Prepare transcript persistence -----
  const requestId = randomUUID();
  await ensureSessionCreatedEvent(projectRoot, sessionId, bookId, sessionKind);
  await appendAgentTranscriptEvent(projectRoot, sessionId, (seq) => ({
    type: "request_started",
    version: 1,
    sessionId,
    requestId,
    seq,
    timestamp: Date.now(),
    sessionKind,
    input: promptMessage,
  }));

  let parentUuid: string | null = null;
  let piTurnIndex = 0;
  let lastAssistantUuid: string | null = null;
  let successfulProductionToolResultSeen = false;
  let skillTurnActive = cached.turnSkillIds.size > 0;

  const persistAgentEvent = async (event: AgentEvent): Promise<void> => {
    if (event.type === "turn_start") {
      piTurnIndex += 1;
      return;
    }
    if (event.type !== "message_end") return;

    const role = transcriptRoleForMessage(event.message);
    if (!role) return;

    if (role === "toolResult") {
      const toolName = (event.message as { toolName?: unknown }).toolName;
      const isError = (event.message as { isError?: unknown }).isError;
      if (isTerminalProductionToolName(toolName) && isError !== true) {
        successfulProductionToolResultSeen = true;
      }
    }

    if (role === "assistant" && sessionKind === "book" && !successfulProductionToolResultSeen) {
      const assistant = event.message as AssistantMessage;
      if (looksLikeUnsavedChapterProse(extractTextFromAssistant(assistant))) {
        replaceAssistantText(assistant, bookRawChapterBoundaryText(language));
      }
    }

    if (assistantInvokesSkill(event.message)) skillTurnActive = true;
    const persistedMessage = sanitizeSkillTurnMessage(event.message, skillTurnActive);
    const uuid = randomUUID();
    const isToolResult = role === "toolResult";
    const toolCallId = toolCallIdForMessage(event.message);
    await appendAgentTranscriptEvent(projectRoot, sessionId, (seq) => ({
      type: "message",
      version: 1,
      sessionId,
      requestId,
      uuid,
      parentUuid: isToolResult && lastAssistantUuid ? lastAssistantUuid : parentUuid,
      seq,
      role,
      timestamp: messageTimestamp(event.message),
      piTurnIndex,
      ...(toolCallId ? { toolCallId } : {}),
      ...(isToolResult && lastAssistantUuid
        ? { sourceToolAssistantUuid: lastAssistantUuid }
        : {}),
      message: persistedMessage,
    }));

    if (role === "assistant") lastAssistantUuid = uuid;
    parentUuid = uuid;
  };

  // ----- Subscribe to events (transcript persistence + SSE forwarding) -----
  const unsubscribe = agent.subscribe(async (event: AgentEvent) => {
    await persistAgentEvent(event);
    onEvent?.(event);
  });

  // ----- Execute the turn -----
  let finalAssistant: AssistantMessage | undefined;
  let errorMessage: string | undefined;
  const turnMessageStartIndex = agent.state.messages.length;

  try {
    if (promptImages.length > 0) {
      await agent.prompt(promptMessage, promptImages);
    } else {
      await agent.prompt(promptMessage);
    }

    finalAssistant = lastAssistantMessage(agent.state.messages);
    agent.state.messages = agent.state.messages.map((message, index) => (
      sanitizeSkillTurnMessage(
        message,
        skillTurnActive && index >= turnMessageStartIndex,
      )
    ));
    errorMessage = assistantErrorMessage(finalAssistant);
    if (errorMessage) {
      const failedError = errorMessage;
      await appendAgentTranscriptEvent(projectRoot, sessionId, (seq) => ({
        type: "request_failed",
        version: 1,
        sessionId,
        requestId,
        seq,
        timestamp: Date.now(),
        error: failedError,
      }));
      agentCache.delete(cacheKey);
    } else {
      const committed = await appendAgentTranscriptEvent(projectRoot, sessionId, (seq) => ({
        type: "request_committed",
        version: 1,
        sessionId,
        requestId,
        seq,
        timestamp: Date.now(),
      }));
      cached.lastCommittedSeq = committed.seq;
    }
  } catch (error) {
    await appendAgentTranscriptEvent(projectRoot, sessionId, (seq) => ({
      type: "request_failed",
      version: 1,
      sessionId,
      requestId,
      seq,
      timestamp: Date.now(),
      error: error instanceof Error ? error.message : String(error),
    }));
    agentCache.delete(cacheKey);
    throw error;
  } finally {
    unsubscribe();
  }

  // ----- Extract result -----
  const allMessages = agent.state.messages;
  finalAssistant ??= lastAssistantMessage(allMessages);
  const responseText = finalAssistant ? extractTextFromAssistant(finalAssistant) : "";
  errorMessage ??= assistantErrorMessage(finalAssistant);

  return {
    responseText,
    messages: allMessages.slice(),
    ...(errorMessage ? { errorMessage } : {}),
  };
}

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

/** Manually evict a cached Agent session. */
export function evictAgentCache(sessionId: string): boolean {
  let deleted = agentCache.delete(sessionId);
  for (const [key, entry] of agentCache) {
    if (entry.sessionId !== sessionId) continue;
    agentCache.delete(key);
    deleted = true;
  }
  return deleted;
}

/** Abort an active cached pi-agent session and evict it from cache. */
export function abortAgentSession(projectRoot: string, sessionId: string): boolean {
  let aborted = false;
  for (const [key, entry] of agentCache) {
    if (entry.projectRoot !== projectRoot || entry.sessionId !== sessionId) continue;
    entry.agent.abort();
    entry.agent.clearAllQueues?.();
    agentCache.delete(key);
    aborted = true;
  }
  return aborted;
}
