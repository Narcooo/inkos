import { randomUUID } from "node:crypto";
import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import { streamSimple, getModel, getEnvApiKey } from "@mariozechner/pi-ai";
import type { Model, Api, AssistantMessage, Message, ToolResultMessage, UserMessage } from "@mariozechner/pi-ai";
import type { PipelineRunner } from "../pipeline/runner.js";
import { buildAgentSystemPrompt } from "./agent-system-prompt.js";
import {
  createPatchChapterTextTool,
  createRenameEntityTool,
  createSubAgentTool,
  createReadTool,
  createGrepTool,
  createLsTool,
  createWriteTruthFileTool,
  createShortFictionRunTool,
  createGenerateCoverTool,
} from "./agent-tools.js";
import { createBookContextTransform } from "./context-transform.js";
import {
  appendTranscriptEvents,
  readTranscriptEvents,
} from "../interaction/session-transcript.js";
import {
  TOOL_RESULT_BRIDGE_TEXT,
  adaptRestoredAgentMessagesForModel,
  restoreAgentMessagesFromTranscript,
} from "../interaction/session-transcript-restore.js";
import type { TranscriptEvent, TranscriptRole } from "../interaction/session-transcript-schema.js";
import { assertSafeBookId } from "../utils/book-id.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentSessionConfig {
  /** Unique session identifier (typically the BookSession id). */
  sessionId: string;
  /** Book ID, or null if in "new book" mode. */
  bookId: string | null;
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
  /** Optional custom system prompt override (from agentPrompts config). */
  customSystemPrompt?: string | null;
}

export interface AgentSessionResult {
  /** Extracted text from the final assistant message. */
  responseText: string;
  /** Full raw Agent conversation history. */
  messages: AgentMessage[];
  /** Upstream model error surfaced by pi-agent-core, if the final assistant turn failed. */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CachedAgent {
  agent: Agent;
  sessionId: string;
  projectRoot: string;
  bookId: string | null;
  language: string;
  modelIdentity: string;
  apiKey: string | undefined;
  allowSystemFileRead: boolean;
  customSystemPrompt: string | null | undefined;
  lastCommittedSeq: number;
  lastActive: number;
}

const agentCache = new Map<string, CachedAgent>();
const agentSessionQueues = new Map<string, Promise<void>>();

/** TTL for cached agents: 5 minutes. */
const CACHE_TTL_MS = 5 * 60 * 1000;

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

function sessionQueueKey(projectRoot: string, sessionId: string): string {
  return `${projectRoot}\0${sessionId}`;
}

function agentCacheKey(projectRoot: string, sessionId: string): string {
  return sessionQueueKey(projectRoot, sessionId);
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
  const llmMessages = messages.filter((message): message is Message => {
    if (!message || typeof message !== "object" || !("role" in message)) return false;
    return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
  });

  const candidate = model as { api?: unknown; baseUrl?: unknown };
  const isGoogleOpenAICompatible = (
    candidate.api === "openai-completions" &&
    typeof candidate.baseUrl === "string" &&
    candidate.baseUrl.includes("generativelanguage.googleapis.com")
  );
  if (!isGoogleOpenAICompatible) return llmMessages;

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

function createAgentToolsForMode(params: {
  readonly pipeline: PipelineRunner;
  readonly bookId: string | null;
  readonly projectRoot: string;
  readonly allowSystemFileRead: boolean;
}) {
  const subAgentTool = createSubAgentTool(params.pipeline, params.bookId, params.projectRoot);
  const shortFictionTool = createShortFictionRunTool(params.pipeline, params.projectRoot);
  const generateCoverTool = createGenerateCoverTool(params.projectRoot);
  if (!params.bookId) {
    return [subAgentTool, shortFictionTool, generateCoverTool];
  }

  return [
    subAgentTool,
    shortFictionTool,
    generateCoverTool,
    createReadTool(params.projectRoot, { allowSystemPaths: params.allowSystemFileRead }),
    createWriteTruthFileTool(params.pipeline, params.projectRoot, params.bookId),
    createRenameEntityTool(params.pipeline, params.projectRoot, params.bookId),
    createPatchChapterTextTool(params.pipeline, params.projectRoot, params.bookId),
    createGrepTool(params.projectRoot),
    createLsTool(params.projectRoot),
  ];
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
  const { sessionId, language, pipeline, projectRoot, onEvent } = config;
  // Normalize at the entry point so downstream comparisons, closures, and
  // fs paths never see `undefined`. The type is already `string | null`, but
  // some callers may bypass the type system (e.g. `activeBookId ?? null` gets
  // skipped) and we don't want that to (a) throw in path.join or (b) trigger
  // a spurious cache eviction because `null !== undefined`.
  const bookId: string | null = config.bookId ? assertSafeBookId(config.bookId) : null;
  const model = resolveModel(config.model);
  const requestedModelIdentity = agentModelIdentity(model);
  const allowSystemFileRead = config.allowSystemFileRead ?? envFlagEnabled(process.env.INKOS_AGENT_ALLOW_SYSTEM_READ, false);
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
    const languageChanged = cached.language !== language;
    const apiKeyChanged = cached.apiKey !== config.apiKey;
    const readPermissionChanged = cached.allowSystemFileRead !== allowSystemFileRead;
    const transcriptChanged = cached.lastCommittedSeq !== currentCommittedSeq;
    const customPromptChanged = cached.customSystemPrompt !== config.customSystemPrompt;

    if (
      modelChanged ||
      projectRootChanged ||
      bookChanged ||
      languageChanged ||
      apiKeyChanged ||
      readPermissionChanged ||
      transcriptChanged ||
      customPromptChanged
    ) {
      agentCache.delete(cacheKey);
      cached = undefined;
    }
  }

  if (!cached) {
    const restoredMessages = adaptRestoredAgentMessagesForModel(
      await restoreAgentMessagesFromTranscript(projectRoot, sessionId),
      model,
    );
    const initialAgentMessages = restoredMessages.length > 0
      ? restoredMessages
      : initialMessages && initialMessages.length > 0
        ? plainToAgentMessages(initialMessages)
        : [];
    const agent = new Agent({
      initialState: {
        model,
        systemPrompt: config.customSystemPrompt || buildAgentSystemPrompt(bookId, language),
        tools: createAgentToolsForMode({ pipeline, bookId, projectRoot, allowSystemFileRead }),
        messages: initialAgentMessages,
      },
      transformContext: createBookContextTransform(bookId, projectRoot),
      convertToLlm: (messages) => convertAgentMessagesForModel(messages, model),
      streamFn: streamSimple,
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
      language,
      modelIdentity: requestedModelIdentity,
      apiKey: config.apiKey,
      allowSystemFileRead,
      customSystemPrompt: config.customSystemPrompt,
      lastCommittedSeq: currentCommittedSeq ?? await latestCommittedSeq(projectRoot, sessionId),
      lastActive: Date.now(),
    };
    agentCache.set(cacheKey, cached);
    ensureCleanupTimer();
  }

  cached.lastActive = Date.now();
  const { agent } = cached;

  // ----- Prepare transcript persistence -----
  const requestId = randomUUID();
  await ensureSessionCreatedEvent(projectRoot, sessionId, bookId);
  await appendAgentTranscriptEvent(projectRoot, sessionId, (seq) => ({
    type: "request_started",
    version: 1,
    sessionId,
    requestId,
    seq,
    timestamp: Date.now(),
    input: userMessage,
  }));

  let parentUuid: string | null = null;
  let piTurnIndex = 0;
  let lastAssistantUuid: string | null = null;

  const persistAgentEvent = async (event: AgentEvent): Promise<void> => {
    if (event.type === "turn_start") {
      piTurnIndex += 1;
      return;
    }
    if (event.type !== "message_end") return;

    const role = transcriptRoleForMessage(event.message);
    if (!role) return;

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
      message: event.message,
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

  try {
    await agent.prompt(userMessage);

    finalAssistant = lastAssistantMessage(agent.state.messages);
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
